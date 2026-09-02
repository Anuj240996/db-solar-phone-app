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
  bitToBoolean,
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

const DJANGO_MEDIA_BASE = `${String(process.env.DJANGO_BASE_URL || 'https://app.db-solar.co.in').replace(/\/$/, '')}/media`;

function mediaUrl(path) {
  if (!path) return null;
  const p = String(path).trim();
  if (!p) return null;
  if (p.startsWith('http://') || p.startsWith('https://')) return p;
  return `${DJANGO_MEDIA_BASE}/${p.replace(/^\//, '')}`;
}

function normalizeSurveyStatus(status) {
  const v = String(status || 'pending').toLowerCase();
  if (v === 'completed') return 'Completed';
  if (v === 'in_progress' || v === 'in progress') return 'In Progress';
  if (v === 'scheduled' || v === 'pending' || v === 'created') return 'Pending';
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : 'Pending';
}

function mapSurveyRow(r) {
  const kw = Number(r.recommended_size || 0);
  const status = normalizeSurveyStatus(r.status);
  return {
    id: `s-${r.id}`,
    surveyId: String(r.id),
    source: 'survey',
    name: r.lead_name || `Survey #${r.id}`,
    customer: r.lead_name || `Survey #${r.id}`,
    phone: r.lead_phone,
    location: [r.lead_city, r.state].filter(Boolean).join(', ') || r.address || '',
    city: r.lead_city,
    address: r.address,
    capacity: kw > 0 ? `${kw.toFixed(2)} kWp` : null,
    capacityKwp: kw,
    stage: 'Site Survey',
    status,
    rawStatus: r.status,
    progress: status === 'Completed' ? 1 : status === 'In Progress' ? 0.55 : 0.2,
    nextAction: status === 'Completed' ? 'Prepare quotation' : 'Complete survey',
    followUp: r.scheduled_date,
    surveyDate: r.scheduled_date,
    completedDate: r.completed_date,
    feasibility: r.feasibility,
    leadId: r.lead_id,
    roofType: r.roof_type,
    propertyType: r.property_type,
    createdAt: r.scheduled_date || r.created,
  };
}

async function queryAssociateSurveys(authUserIds) {
  if (!authUserIds.length) return [];
  const surveys = await pool.query(
    `SELECT s.id, s.status, s.scheduled_date, s.completed_date, s.recommended_size,
            s.feasibility, s.panel_count, s.created, s.modified,
            s.created_by_id, s.engineer_id, s.lead_id,
            l.name AS lead_name, l.phone AS lead_phone, l.city AS lead_city,
            l.address, l.state, l.roof_type, l.property_type
     FROM surveys_survey s
     LEFT JOIN crm_leads_lead l ON l.id = s.lead_id
     WHERE s.created_by_id = ANY($1::int[])
        OR s.engineer_id = ANY($1::int[])
        OR l.assigned_to_id = ANY($1::int[])
        OR EXISTS (
          SELECT 1 FROM customer c
          WHERE c.assoc_assign_id = ANY($1::int[])
            AND c.phone IS NOT NULL
            AND l.phone IS NOT NULL
            AND TRIM(c.phone::text) = TRIM(l.phone::text)
        )
     ORDER BY COALESCE(s.scheduled_date, s.created) DESC NULLS LAST
     LIMIT 200`,
    [authUserIds]
  ).catch(() => ({ rows: [] }));
  return surveys.rows.map(mapSurveyRow);
}

async function loadSurveyDetailForAssociate(surveyId, authUserIds) {
  const id = parseInt(surveyId, 10);
  if (Number.isNaN(id)) return null;
  const res = await pool.query(
    `SELECT s.*,
            l.name AS lead_name, l.phone AS lead_phone, l.email AS lead_email,
            l.address AS lead_address, l.city AS lead_city, l.state AS lead_state,
            l.pincode AS lead_pincode, l.property_type, l.roof_type,
            l.electricity_bill, l.estimated_value, l.stage AS lead_stage,
            l.assigned_to_id
     FROM surveys_survey s
     LEFT JOIN crm_leads_lead l ON l.id = s.lead_id
     WHERE s.id = $1
       AND (
         s.created_by_id = ANY($2::int[])
         OR s.engineer_id = ANY($2::int[])
         OR l.assigned_to_id = ANY($2::int[])
         OR EXISTS (
           SELECT 1 FROM customer c
           WHERE c.assoc_assign_id = ANY($2::int[])
             AND c.phone IS NOT NULL
             AND l.phone IS NOT NULL
             AND TRIM(c.phone::text) = TRIM(l.phone::text)
         )
       )
     LIMIT 1`,
    [id, authUserIds]
  );
  if (!res.rows.length) return null;
  const row = res.rows[0];
  const images = await pool.query(
    `SELECT id, image, caption, is_primary, created
     FROM surveys_surveyimage
     WHERE survey_id = $1
     ORDER BY is_primary DESC, id ASC`,
    [id]
  ).catch(() => ({ rows: [] }));

  const status = normalizeSurveyStatus(row.status);
  return {
    id: String(row.id),
    surveyId: String(row.id),
    status,
    rawStatus: row.status,
    scheduledDate: row.scheduled_date,
    completedDate: row.completed_date,
    assignedDate: row.assigned_date,
    created: row.created,
    modified: row.modified,
    feasibility: row.feasibility,
    recommendedSizeKwp: row.recommended_size != null ? Number(row.recommended_size) : null,
    panelCount: row.panel_count,
    inverterCapacity: row.inverter_capacity,
    estimatedGenerationKwh: row.estimated_generation,
    roofAreaRequired: row.roof_area_required,
    hasShadowIssues: row.has_shadow_issues,
    structuralFeasible: row.structural_feasible,
    technicalNotes: row.technical_notes,
    structureType: row.structure_type,
    structureBackHeightFt: row.structure_back_height_ft,
    structureFrontHeightFt: row.structure_front_height_ft,
    structureLegCount: row.structure_leg_count,
    structurePurlinCount: row.structure_purlin_count,
    structureRafterCount: row.structure_rafter_count,
    structureSolarPanelCount: row.structure_solar_panel_count,
    structureSquarePipeCount: row.structure_square_pipe_count,
    structureHasWalkway: row.structure_has_walkway,
    structureHasLadder: row.structure_has_ladder,
    buildingHeight: row.building_height,
    lengthNorthFt: row.length_north_ft,
    lengthSouthFt: row.length_south_ft,
    lengthEastFt: row.length_east_ft,
    lengthWestFt: row.length_west_ft,
    areaUseNorth: row.area_use_north,
    areaUseSouth: row.area_use_south,
    areaUseEast: row.area_use_east,
    areaUseWest: row.area_use_west,
    lead: {
      id: row.lead_id,
      name: row.lead_name,
      phone: row.lead_phone,
      email: row.lead_email,
      address: row.lead_address,
      city: row.lead_city,
      state: row.lead_state,
      pincode: row.lead_pincode,
      propertyType: row.property_type,
      roofType: row.roof_type,
      electricityBill: row.electricity_bill,
      estimatedValue: row.estimated_value,
      stage: row.lead_stage,
    },
    images: images.rows.map((img) => ({
      id: img.id,
      caption: img.caption,
      isPrimary: img.is_primary,
      url: mediaUrl(img.image),
      path: img.image,
    })),
    webUrl: `${String(process.env.DJANGO_BASE_URL || 'https://app.db-solar.co.in').replace(/\/$/, '')}/new-lead/surveys/${row.id}/`,
  };
}

function requireAssociate(req, res, next) {
  const role = String(req.user?.role || req.user?.jwt_role || '').toLowerCase();
  const name = String(req.user?.name || req.user?.username || '').toLowerCase();
  const source = String(req.user?.auth_source || req.user?.jwt_source || '').toLowerCase();
  const staff =
    req.user?.is_staff === true ||
    String(req.user?.is_staff || '').toLowerCase() === 'true' ||
    String(req.user?.is_staff || '') === '1';
  const isAso =
    role === 'associate' ||
    role === 'aso' ||
    role === 'employee' ||
    role === 'staff' ||
    name.startsWith('aso_') ||
    (source === 'auth_user' && (role === 'associate' || staff || req.user?.auth_user_id != null));
  if (!isAso) {
    return res.status(403).json({
      message: 'Associate access only',
      role: req.user?.role,
      jwt_role: req.user?.jwt_role,
      source,
    });
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

  // 1) App leads created by linked user_app (optional)
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
    const surveyRows = await queryAssociateSurveys(authUserIds);
    for (const item of surveyRows) {
      push(item);
    }
    // 5) Consumers/projects assigned via customer.assoc_assign_id only
    // (do not use emp_id_id / engg_assign_id — those are employee/engineer, not associate field)
    const customers = await pool.query(
      `SELECT cust_id, consumer, first_name, last_name, middle_name, comp_name,
              city, state, address, plant_capacity, phone, email, cust_type, project_type,
              emp_id_id, assoc_assign_id, engg_assign_id
       FROM customer
       WHERE assoc_assign_id = ANY($1::int[])
       ORDER BY cust_id DESC
       LIMIT 800`,
      [authUserIds]
    );

    for (const c of customers.rows) {
      const result = await fetchCustomerResultForCustomer(c);
      const resultStatus = computeProjectStatusFromResult(result);
      let stage = 'Installation';
      const st = String(resultStatus || '').toLowerCase();
      if (st.includes('complete') || st.includes('deploy') || st.includes('live')) {
        stage = 'Deployed';
      } else if (st.includes('approv') || st.includes('agreement')) {
        stage = 'Approval';
      } else if (st.includes('quot')) {
        stage = 'Quotation';
      } else if (st.includes('survey') || st.includes('site')) {
        stage = 'Site Survey';
      } else if (st.includes('install') || st.includes('progress') || st.includes('pending')) {
        stage = 'Installation';
      }
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
        status: resultStatus || stage,
        progress: progressForStage(stage),
        nextAction: stage === 'Deployed' ? 'Monitor' : 'Update installation',
        type: c.cust_type || c.project_type,
        assignVia: 'associate',
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
      insight = `???${(value / 100000).toFixed(1)}L quoted`;
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

async function loadCustomersByAssociate(authUserIds) {
  if (!authUserIds.length) return [];
  const customers = await pool.query(
    `SELECT cust_id, consumer, first_name, last_name, middle_name, comp_name,
            city, state, address, plant_capacity, phone, email, cust_type, project_type,
            assoc_assign_id
     FROM customer
     WHERE assoc_assign_id = ANY($1::int[])
     ORDER BY cust_id DESC
     LIMIT 800`,
    [authUserIds]
  );

  const items = [];
  for (const c of customers.rows) {
    const result = await fetchCustomerResultForCustomer(c);
    const resultStatus = computeProjectStatusFromResult(result); // Completed | Pending
    let status = resultStatus || 'Pending';
    let stage = 'Installation';

    // Refine Pending → In Progress when some install flags are set
    if (status === 'Pending' && result) {
      const anyStarted =
        bitToBoolean(result.solar_panel) ||
        bitToBoolean(result.inverter) ||
        bitToBoolean(result.net_meter) ||
        bitToBoolean(result.mseb);
      if (anyStarted) {
        status = 'In Progress';
        stage = 'Installation';
      } else {
        status = 'Pending';
        stage = 'Lead';
      }
    } else if (status === 'Completed') {
      stage = 'Deployed';
    }

    const name =
      c.comp_name ||
      `${c.first_name || ''} ${c.middle_name || ''} ${c.last_name || ''}`.trim() ||
      `AF#${c.consumer || c.cust_id}`;
    const kw = Number(c.plant_capacity || 0);
    items.push({
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
      status,
      progress: status === 'Completed' ? 1 : status === 'In Progress' ? 0.55 : 0.15,
      nextAction: status === 'Completed' ? 'Monitor' : 'Update project',
      type: c.cust_type || c.project_type,
      assignVia: 'associate',
      createdAt: null,
    });
  }
  return items;
}

/** Overview cards: ONLY customer rows where assoc_assign_id = logged-in associate */
function buildOverview(items) {
  return buildCustomerOverview((items || []).filter((i) => i.source === 'project'));
}
function buildCustomerOverview(customerItems) {
  const totalProjects = customerItems.length;
  const completed = customerItems.filter((i) => i.status === 'Completed' || i.stage === 'Deployed').length;
  const inProgress = customerItems.filter((i) => i.status === 'In Progress').length;
  const pendingAction = customerItems.filter((i) => i.status === 'Pending').length;
  const capacity = customerItems.reduce((acc, i) => acc + (Number(i.capacityKwp) || 0), 0);

  const statusMap = {};
  for (const i of customerItems) {
    const key = String(i.status || 'Pending');
    statusMap[key] = (statusMap[key] || 0) + 1;
  }
  const statusBreakdown = ['Completed', 'In Progress', 'Pending']
    .filter((s) => statusMap[s])
    .map((status) => ({ status, count: statusMap[status] }))
    .concat(
      Object.entries(statusMap)
        .filter(([s]) => !['Completed', 'In Progress', 'Pending'].includes(s))
        .map(([status, count]) => ({ status, count }))
    );

  return {
    totalProjects,
    totalConsumers: totalProjects,
    inProgress,
    pendingAction,
    completed,
    deployed: completed,
    awaitingAction: pendingAction,
    totalCapacityKwp: Math.round(capacity * 100) / 100,
    statusBreakdown,
    filter: 'customer.assoc_assign_id',
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
    // Overview cards: ONLY customer where assoc_assign_id = logged-in associate.
    // Do not let Django proxy replace these counts.
    await ensureAssociateAuthUserColumn();
    const ctx = await resolveAssociateContext(req.user);
    const customerItems = await loadCustomersByAssociate(ctx.authUserIds || []);
    const overview = buildCustomerOverview(customerItems);

    let items = [...customerItems];
    try {
      const all = await loadAssociateRecords(ctx);
      const seen = new Set(customerItems.map((i) => 'project:' + i.id));
      for (const row of all) {
        const key = row.source + ':' + row.id;
        if (seen.has(key)) continue;
        if (row.source === 'project') continue;
        seen.add(key);
        items.push(row);
      }
    } catch (loadErr) {
      console.warn('associate extra records load failed:', loadErr.message);
    }

    const pipeline = buildPipeline(customerItems.length ? customerItems : items);
    const tasks = buildTasks(items);
    const activities = buildActivities(items).slice(0, 5);
    const recentProjects = customerItems.slice(0, 8).map((i) => ({
      name: i.name,
      customer: i.customer,
      capacity: i.capacity || '-',
      location: i.location || i.city || '-',
      type: i.type || '',
      stage: i.stage,
      status: i.status,
      progress: i.progress,
      id: i.id,
      source: i.source,
      assignVia: 'associate',
    }));

    const siteVisitsToday = items.filter((i) => {
      if (!i.surveyDate && !i.followUp) return false;
      const d = new Date(i.surveyDate || i.followUp);
      const t = new Date();
      return d.toDateString() === t.toDateString() && i.stage === 'Site Survey';
    }).length;

    const tasksDueToday = tasks.filter((t) => t.due === 'Today').length;
    const estGen = Math.round(overview.totalCapacityKwp * 4 * 10) / 10;

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
      recentProjects,
      overviewProjects: customerItems.map((i) => ({
        id: i.id,
        projectId: i.id,
        name: i.name,
        customer: i.customer,
        phone: i.phone,
        email: i.email,
        stage: i.stage,
        status: i.status,
        location: i.location,
        city: i.city,
        capacity: i.capacity,
        capacityKwp: i.capacityKwp,
        progress: i.progress,
        type: i.type,
        source: i.source,
        assignVia: 'associate',
      })),
      consumers: customerItems.slice(0, 50).map((i) => ({
        id: i.id,
        name: i.name,
        stage: i.stage,
        status: i.status,
        location: i.location,
        capacity: i.capacity,
        source: i.source,
        assignVia: 'associate',
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
            (items.reduce((sum, i) => sum + (Number(i.estimatedValue) || 0), 0) / 100000) * 100
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
    const surveyIdParam = String(req.query.surveyId || '').trim();
    const statusFilter = String(req.query.status || '').trim();
    const ctx = await resolveAssociateContext(req.user);

    // Full survey detail (fallback when /surveys/:id route missing on older deploys).
    if (surveyIdParam) {
      const detail = await loadSurveyDetailForAssociate(surveyIdParam, ctx.authUserIds || []);
      if (!detail) {
        return res.status(404).json({ message: 'Survey not found or not assigned to you' });
      }
      return res.json({ success: true, survey: detail });
    }

    // Status-filtered lists must use customer.assoc_assign_id (same as overview cards).
    const skipDjango = statusFilter.length > 0;
    if (!skipDjango) {
      try {
        const { djangoEnabled, associateGet } = require('../utils/djangoClient');
        if (djangoEnabled()) {
          const authUserId =
            req.user?.auth_user_id ??
            req.user?.jwt_user_id ??
            (String(req.user?.auth_source || req.user?.jwt_source || '').toLowerCase() === 'auth_user'
              ? req.user?.id ?? req.user?.userId
              : null);
          if (authUserId != null) {
            const djangoRes = await associateGet('/api/v1/associate/projects/', authUserId, {
              stage: req.query.stage || 'All',
              q: req.query.q || '',
            });
            if (djangoRes.status >= 200 && djangoRes.status < 300) {
              return res.status(djangoRes.status).json(djangoRes.data);
            }
            console.warn('Django associate projects status', djangoRes.status, djangoRes.data);
          }
        }
      } catch (djangoErr) {
        console.warn('Django associate projects failed, falling back:', djangoErr.message);
      }
    }

    const stage = String(req.query.stage || 'All').trim();
    const q = String(req.query.q || '').trim().toLowerCase();
    // Primary list: customer.assoc_assign_id for this associate
    let items = await loadCustomersByAssociate(ctx.authUserIds || []);
    const surveyRows = await queryAssociateSurveys(ctx.authUserIds || []);
    const seen = new Set(items.map((i) => `${i.source}:${i.id}`));
    for (const row of surveyRows) {
      const key = `${row.source}:${row.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        items.push(row);
      }
    }
    if (items.length === 0) {
      items = await loadAssociateRecords(ctx);
    }

    if (statusFilter && statusFilter !== 'All') {
      items = items.filter((i) => {
        const s = String(i.status || '');
        const st = String(i.stage || '');
        if (statusFilter === 'Completed') return s === 'Completed' || st === 'Deployed';
        if (statusFilter === 'In Progress') return s === 'In Progress';
        if (statusFilter === 'Pending') return s === 'Pending';
        return s.toLowerCase() === statusFilter.toLowerCase();
      });
    }

    if (stage && stage !== 'All') {
      const needle = stage.toLowerCase() === 'survey' ? 'site survey' : stage.toLowerCase();
      items = items.filter((i) =>
        i.stage.toLowerCase().includes(needle) ||
        String(i.status || '').toLowerCase().includes(needle)
      );
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

router.get('/surveys', authenticate, requireAssociate, async (req, res) => {
  try {
    await ensureAssociateAuthUserColumn();
    const ctx = await resolveAssociateContext(req.user);
    const surveys = await queryAssociateSurveys(ctx.authUserIds || []);
    res.json({
      success: true,
      count: surveys.length,
      surveys,
      associate: { id: ctx.appUserId, name: ctx.displayName, linkedAuthUserIds: ctx.authUserIds },
    });
  } catch (e) {
    console.error('associate surveys list error:', e);
    res.status(500).json({ message: e.message || 'Failed to load surveys' });
  }
});

router.get('/surveys/:surveyId', authenticate, requireAssociate, async (req, res) => {
  try {
    await ensureAssociateAuthUserColumn();
    const ctx = await resolveAssociateContext(req.user);
    const detail = await loadSurveyDetailForAssociate(req.params.surveyId, ctx.authUserIds || []);
    if (!detail) {
      return res.status(404).json({ message: 'Survey not found or not assigned to you' });
    }
    res.json({ success: true, survey: detail });
  } catch (e) {
    console.error('associate survey detail error:', e);
    res.status(500).json({ message: e.message || 'Failed to load survey details' });
  }
});

router.get('/tasks', authenticate, requireAssociate, async (req, res) => {
  try {
    try {
      const { djangoEnabled, associateGet } = require('../utils/djangoClient');
      if (djangoEnabled()) {
        const authUserId =
          req.user?.auth_user_id ??
          req.user?.jwt_user_id ??
          (String(req.user?.auth_source || req.user?.jwt_source || '').toLowerCase() === 'auth_user'
            ? req.user?.id ?? req.user?.userId
            : null);
        if (authUserId != null) {
          const djangoRes = await associateGet('/api/v1/associate/tasks/', authUserId);
          if (djangoRes.status >= 200 && djangoRes.status < 300) {
            return res.status(djangoRes.status).json(djangoRes.data);
          }
          console.warn('Django associate tasks status', djangoRes.status, djangoRes.data);
        }
      }
    } catch (djangoErr) {
      console.warn('Django associate tasks failed, falling back:', djangoErr.message);
    }

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
