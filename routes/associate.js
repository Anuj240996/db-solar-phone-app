const express = require('express');
const pool = require('../database/db');
const { authenticate } = require('../middleware/auth');
const {
  resolveAssociateContext,
  mapCrmStageToPipeline,
  mapQuoteStatusToPipeline,
  progressForStage,
  ensureAssociateAuthUserColumn,
} = require('../utils/associateAccess');
const {
  fetchCustomerResultForCustomer,
  computeProjectStatusFromResult,
} = require('../utils/customerResult');

const router = express.Router();

const STAGE_META = [
  { stage: 'Lead', color: 0xff059669, icon: 'person_add' },
  { stage: 'Site Survey', color: 0xff2563eb, icon: 'description' },
  { stage: 'Quotation', color: 0xff7c3aed, icon: 'request_quote' },
  { stage: 'Approval', color: 0xffd97706, icon: 'fact_check' },
  { stage: 'Installation', color: 0xff0891b2, icon: 'handyman' },
  { stage: 'Deployed', color: 0xff059669, icon: 'verified' },
];

function requireAssociate(req, res, next) {
  const role = String(req.user?.role || req.user?.jwt_role || '').toLowerCase();
  const name = String(req.user?.name || req.user?.username || '').toLowerCase();
  const source = String(req.user?.auth_source || req.user?.jwt_source || '').toLowerCase();
  const isAso =
    role === 'associate' ||
    role === 'aso' ||
    role === 'employee' ||
    role === 'staff' ||
    name.startsWith('aso_') ||
    (source === 'auth_user' && (req.user?.is_staff === true || String(req.user?.is_staff).toLowerCase() === 'true'));
  if (!isAso) {
    return res.status(403).json({ message: 'Associate access only' });
  }
  return next();
}

async function loadAssociateRecords(ctx) {
  const { appUserId, authUserIds } = ctx;
  const items = [];
  const seen = new Set();

  const push = (row) => {
    const key = `${row.source}:${row.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(row);
  };

  // 1) App leads created by this associate (only when linked user_app exists)
  if (appUserId) {
    const appLeads = await pool.query(
      `SELECT id, name, phone, email, city, state, address, stage, status,
              property_type, roof_type, electricity_bill, next_followup, created_at,
              estimated_value, user_app_id
       FROM leads_lead
       WHERE user_app_id = $1
       ORDER BY created_at DESC NULLS LAST
       LIMIT 500`,
      [appUserId]
    );
    for (const r of appLeads.rows) {
      push({
        id: String(r.id),
        source: 'app_lead',
        name: r.name,
        customer: r.name,
        phone: r.phone,
        email: r.email,
        city: r.city,
        location: [r.city, r.state].filter(Boolean).join(', ') || r.address || '',
        capacity: null,
        capacityKwp: 0,
        stage: mapCrmStageToPipeline(r.stage || r.status),
        status: r.status || r.stage,
        progress: progressForStage(mapCrmStageToPipeline(r.stage || r.status)),
        nextAction: r.next_followup ? 'Follow up' : 'Qualify lead',
        followUp: r.next_followup,
        createdAt: r.created_at,
        estimatedValue: Number(r.estimated_value || 0),
        propertyType: r.property_type,
        roof: r.roof_type,
        bill: r.electricity_bill,
      });
    }
  }

  // 2) CRM leads assigned to linked staff user(s)
  if (authUserIds.length) {
    const crm = await pool.query(
      `SELECT id, name, phone, email, city, state, address, stage, assigned_to_id,
              estimated_value, next_followup, created, property_type, roof_type,
              electricity_bill
       FROM crm_leads_lead
       WHERE assigned_to_id = ANY($1::int[])
       ORDER BY created DESC NULLS LAST
       LIMIT 500`,
      [authUserIds]
    );
    for (const r of crm.rows) {
      const stage = mapCrmStageToPipeline(r.stage);
      push({
        id: String(r.id),
        source: 'crm_lead',
        name: r.name,
        customer: r.name,
        phone: r.phone,
        email: r.email,
        city: r.city,
        location: [r.city, r.state].filter(Boolean).join(', ') || r.address || '',
        capacity: null,
        capacityKwp: 0,
        stage,
        status: r.stage,
        progress: progressForStage(stage),
        nextAction: r.next_followup ? 'Follow up' : 'Continue pipeline',
        followUp: r.next_followup,
        createdAt: r.created,
        estimatedValue: Number(r.estimated_value || 0),
        propertyType: r.property_type,
        roof: r.roof_type,
        bill: r.electricity_bill,
      });
    }

    // 3) Quotations created by / assigned to associate staff
    const quotes = await pool.query(
      `SELECT id, consumer_name, consumer_mobile, consumer_address1, status,
              dc_capacity, final_amount, created_at, date,
              assigned_associate_id, created_by_id, employee_name, lead_id
       FROM quotation_quotation
       WHERE created_by_id = ANY($1::int[])
          OR assigned_associate_id = ANY($1::int[])
          OR LOWER(COALESCE(employee_name,'')) LIKE '%' || $2 || '%'
       ORDER BY COALESCE(created_at, date) DESC NULLS LAST
       LIMIT 300`,
      [authUserIds, String(ctx.displayName || '').toLowerCase()]
    );

    for (const r of quotes.rows) {
      const stage = mapQuoteStatusToPipeline(r.status);
      const kw = Number(r.dc_capacity || 0);
      push({
        id: `q-${r.id}`,
        source: 'quotation',
        name: r.consumer_name,
        customer: r.consumer_name,
        phone: r.consumer_mobile,
        location: r.consumer_address1 || '',
        city: null,
        capacity: kw > 0 ? `${kw.toFixed(2)} kWp` : null,
        capacityKwp: kw,
        stage,
        status: r.status,
        progress: progressForStage(stage),
        nextAction: stage === 'Quotation' ? 'Follow quote' : 'Continue',
        createdAt: r.created_at || r.date,
        estimatedValue: Number(r.final_amount || 0),
        quotedAmount: Number(r.final_amount || 0),
      });
    }

    // 4) Surveys for this staff
    const surveys = await pool.query(
      `SELECT s.id, s.status, s.scheduled_date, s.completed_date, s.recommended_size,
              s.created_by_id, s.engineer_id, s.lead_id,
              l.name AS lead_name, l.phone AS lead_phone, l.city AS lead_city
       FROM surveys_survey s
       LEFT JOIN crm_leads_lead l ON l.id = s.lead_id
       WHERE s.created_by_id = ANY($1::int[])
          OR s.engineer_id = ANY($1::int[])
          OR l.assigned_to_id = ANY($1::int[])
       ORDER BY COALESCE(s.scheduled_date, s.created) DESC NULLS LAST
       LIMIT 200`,
      [authUserIds]
    ).catch(() => ({ rows: [] }));

    for (const r of surveys.rows) {
      const stage = String(r.status || '').toLowerCase() === 'completed' ? 'Site Survey' : 'Site Survey';
      const kw = Number(r.recommended_size || 0);
      push({
        id: `s-${r.id}`,
        source: 'survey',
        name: r.lead_name || `Survey #${r.id}`,
        customer: r.lead_name || `Survey #${r.id}`,
        phone: r.lead_phone,
        location: r.lead_city || '',
        city: r.lead_city,
        capacity: kw > 0 ? `${kw.toFixed(2)} kWp` : null,
        capacityKwp: kw,
        stage,
        status: r.status,
        progress: progressForStage(stage),
        nextAction: r.status === 'completed' ? 'Prepare quotation' : 'Complete survey',
        followUp: r.scheduled_date,
        createdAt: r.scheduled_date || r.completed_date,
        surveyDate: r.scheduled_date,
      });
    }

    // 5) Customer projects owned by this employee (emp_id_id → auth_user)
    const customers = await pool.query(
      `SELECT cust_id, consumer, first_name, last_name, middle_name, comp_name,
              city, state, address, plant_capacity, phone, email, cust_type, project_type,
              emp_id_id
       FROM customer
       WHERE emp_id_id = ANY($1::int[])
       ORDER BY cust_id DESC
       LIMIT 500`,
      [authUserIds]
    );

    for (const c of customers.rows) {
      const result = await fetchCustomerResultForCustomer(c);
      const resultStatus = computeProjectStatusFromResult(result);
      const stage = resultStatus === 'Completed' ? 'Deployed' : 'Installation';
      const name =
        c.comp_name ||
        `${c.first_name || ''} ${c.middle_name || ''} ${c.last_name || ''}`.trim() ||
        `AF#${c.consumer || c.cust_id}`;
      const kw = Number(c.plant_capacity || 0);
      push({
        id: String(c.cust_id),
        source: 'project',
        name,
        customer: name,
        phone: c.phone != null ? String(c.phone) : null,
        email: c.email,
        location: [c.city, c.state].filter(Boolean).join(', ') || c.address || '',
        city: c.city,
        capacity: kw > 0 ? `${kw.toFixed(2)} kWp` : null,
        capacityKwp: kw,
        stage,
        status: resultStatus,
        progress: progressForStage(stage),
        nextAction: stage === 'Deployed' ? 'Monitor' : 'Update installation',
        type: c.cust_type || c.project_type,
        createdAt: null,
      });
    }
  }

  return items;
}

function buildPipeline(items) {
  return STAGE_META.map((meta) => {
    const stageItems = items.filter((i) => i.stage === meta.stage);
    const value = stageItems.reduce((s, i) => s + (Number(i.estimatedValue) || 0), 0);
    let insight = `${stageItems.length} projects`;
    if (meta.stage === 'Quotation' && value > 0) {
      insight = `₹${(value / 100000).toFixed(1)}L quoted`;
    } else if (meta.stage === 'Lead') {
      insight = `${stageItems.length} open`;
    } else if (meta.stage === 'Site Survey') {
      insight = `${stageItems.filter((i) => i.source === 'survey').length} surveys`;
    }
    return {
      stage: meta.stage,
      count: stageItems.length,
      insight,
      color: meta.color,
      icon: meta.icon,
    };
  });
}

function buildOverview(items) {
  const total = items.length;
  const completed = items.filter((i) => i.stage === 'Deployed').length;
  const inProgress = items.filter((i) =>
    ['Site Survey', 'Quotation', 'Approval', 'Installation'].includes(i.stage)
  ).length;
  const pending = items.filter((i) => i.stage === 'Lead' || i.stage === 'Approval').length;
  const capacity = items.reduce((s, i) => s + (Number(i.capacityKwp) || 0), 0);
  return {
    totalProjects: total,
    inProgress,
    pendingAction: pending,
    completed,
    deployed: completed,
    awaitingAction: pending,
    totalCapacityKwp: Math.round(capacity * 100) / 100,
  };
}

function buildTasks(items) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tasks = [];

  for (const i of items) {
    if (i.followUp) {
      const d = new Date(i.followUp);
      const dueLabel =
        d.toDateString() === today.toDateString()
          ? 'Today'
          : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      tasks.push({
        title: i.stage === 'Site Survey' ? 'Site Survey Visit' : 'Follow up with Customer',
        project: i.name,
        due: dueLabel,
        urgent: dueLabel === 'Today' || d < today,
        stage: i.stage,
        projectId: i.id,
      });
    } else if (i.stage === 'Quotation') {
      tasks.push({
        title: 'Submit Quotation',
        project: i.name,
        due: 'Upcoming',
        urgent: false,
        stage: i.stage,
        projectId: i.id,
      });
    }
  }

  return tasks.slice(0, 20);
}

function buildActivities(items) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return items
    .filter((i) => i.followUp || i.surveyDate)
    .map((i) => {
      const d = new Date(i.followUp || i.surveyDate);
      return {
        time: d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        title: i.stage === 'Site Survey' ? 'Site Survey' : 'Follow up Call',
        subtitle: i.name,
        date: d.toISOString(),
      };
    })
    .filter((a) => {
      const d = new Date(a.date);
      d.setHours(0, 0, 0, 0);
      return d.getTime() === today.getTime() || true;
    })
    .slice(0, 8);
}

router.get('/dashboard', authenticate, requireAssociate, async (req, res) => {
  try {
    await ensureAssociateAuthUserColumn();
    const ctx = await resolveAssociateContext(req.user);
    const items = await loadAssociateRecords(ctx);
    const overview = buildOverview(items);
    const pipeline = buildPipeline(items);
    const tasks = buildTasks(items);
    const activities = buildActivities(items).slice(0, 5);
    const recentProjects = items
      .filter((i) => i.source === 'project' || i.source === 'quotation' || i.stage !== 'Lead')
      .slice(0, 8)
      .map((i) => ({
        name: i.name,
        customer: i.customer,
        capacity: i.capacity || '—',
        location: i.location || i.city || '—',
        type: i.type || '',
        stage: i.stage,
        progress: i.progress,
        id: i.id,
        source: i.source,
      }));

    const siteVisitsToday = items.filter((i) => {
      if (!i.surveyDate && !i.followUp) return false;
      const d = new Date(i.surveyDate || i.followUp);
      const t = new Date();
      return d.toDateString() === t.toDateString() && i.stage === 'Site Survey';
    }).length;

    const tasksDueToday = tasks.filter((t) => t.due === 'Today').length;
    const estGen = Math.round(overview.totalCapacityKwp * 4 * 10) / 10; // rough kWh/day

    res.json({
      success: true,
      associate: {
        id: ctx.appUserId,
        name: ctx.displayName,
        fullName: ctx.name,
        email: ctx.email,
        linkedAuthUserIds: ctx.authUserIds,
      },
      overview,
      pipeline,
      tasks: tasks.slice(0, 10),
      activities,
      recentProjects:
        recentProjects.length > 0
          ? recentProjects
          : items.slice(0, 5).map((i) => ({
              name: i.name,
              customer: i.customer,
              capacity: i.capacity || '—',
              location: i.location || '—',
              type: i.type || '',
              stage: i.stage,
              progress: i.progress,
              id: i.id,
              source: i.source,
            })),
      snapshot: {
        capacityPlannedKwp: overview.totalCapacityKwp,
        estGenerationKwh: estGen,
        siteVisits: siteVisitsToday,
        tasksDueToday,
      },
      insights: {
        pipelineValueLakh:
          Math.round(
            (items.reduce((s, i) => s + (Number(i.estimatedValue) || 0), 0) / 100000) * 100
          ) / 100,
        surveysDue: pipeline.find((p) => p.stage === 'Site Survey')?.count || 0,
        followUps: tasksDueToday,
        estGenKwh: estGen,
      },
    });
  } catch (e) {
    console.error('associate dashboard error:', e);
    res.status(500).json({ message: e.message || 'Failed to load associate dashboard' });
  }
});

router.get('/projects', authenticate, requireAssociate, async (req, res) => {
  try {
    const ctx = await resolveAssociateContext(req.user);
    const stage = String(req.query.stage || 'All').trim();
    const q = String(req.query.q || '').trim().toLowerCase();
    let items = await loadAssociateRecords(ctx);

    if (stage && stage !== 'All') {
      const needle = stage.toLowerCase() === 'survey' ? 'site survey' : stage.toLowerCase();
      items = items.filter((i) => i.stage.toLowerCase().includes(needle));
    }
    if (q) {
      items = items.filter((i) =>
        `${i.name}${i.customer}${i.location}${i.phone}${i.city}`.toLowerCase().includes(q)
      );
    }

    res.json({
      success: true,
      count: items.length,
      projects: items,
      associate: { id: ctx.appUserId, name: ctx.displayName, linkedAuthUserIds: ctx.authUserIds },
    });
  } catch (e) {
    console.error('associate projects error:', e);
    res.status(500).json({ message: e.message || 'Failed to load associate projects' });
  }
});

router.get('/tasks', authenticate, requireAssociate, async (req, res) => {
  try {
    const ctx = await resolveAssociateContext(req.user);
    const items = await loadAssociateRecords(ctx);
    const tasks = buildTasks(items);
    const today = tasks.filter((t) => t.due === 'Today');
    const overdue = tasks.filter((t) => t.urgent && t.due !== 'Today');
    const upcoming = tasks.filter((t) => !t.urgent && t.due !== 'Today');
    res.json({
      success: true,
      today,
      upcoming,
      overdue,
      completed: [],
      all: tasks,
    });
  } catch (e) {
    console.error('associate tasks error:', e);
    res.status(500).json({ message: e.message || 'Failed to load associate tasks' });
  }
});

module.exports = router;
