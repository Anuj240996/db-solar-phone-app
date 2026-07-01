const express = require('express');
const { authenticate } = require('../middleware/auth');
const pool = require('../database/db');
const { buildEngineerFromRow } = require('../utils/profileImage');
const { buildServiceReportPdf } = require('../utils/serviceReportPdf');
const {
  getAppAccessContext,
  resolveAppUserId,
  resolveAppUserIdForConsumerAuth,
  loadCustomerForApp,
  resolveAuthUserIdFromCustId,
  resolveAuthUserIdFromReq,
  resolveCustomerFields,
  resolveDefaultCustomerFields,
} = require('../utils/appAccess');

const router = express.Router();

const TABLE_REQUEST = 'firereport_servicerequest';
const TABLE_HISTORY = 'firereport_servicerequesthistory';
const TABLE_REPORT = 'firereport_servicereport';
const TABLE_REMARKS = 'firereport_serviceremarkmaster';

const DEFAULT_SERVICE_TYPES = [
  'Panel cleaning',
  'Annual maintenance service (AMC)',
  'Inverter service / fault',
  'Net meter issue',
  'Low generation / performance check',
  'Site inspection',
  'Wiring / connection issue',
  'MSEB / grid connectivity',
  'Monitoring system issue',
  'Other',
];

let schemaReady = false;

function quoteServiceColumn(columnName) {
  return columnName === 'Location' ? '"Location"' : columnName;
}

/** Embed warranty/type in message when legacy DB rows lack dedicated columns. */
function buildServiceLegacyMessage(values) {
  const parts = [];
  if (values.warrantyType) parts.push(`[Warranty: ${values.warrantyType}]`);
  if (values.serviceType && values.serviceType !== values.legacyMessage) {
    parts.push(`[Type: ${values.serviceType}]`);
  }
  if (values.legacyMessage) parts.push(values.legacyMessage);
  if (values.additionalNotes) parts.push(values.additionalNotes);
  return parts.join(' ').trim() || values.legacyMessage || 'Service request';
}

async function syncServiceRequestIdSequence() {
  try {
    await pool.query(`
      SELECT setval(
        pg_get_serial_sequence('${TABLE_REQUEST}', 'id'),
        GREATEST(COALESCE((SELECT MAX(id) FROM ${TABLE_REQUEST}), 0), 1)
      )
    `);
  } catch (e) {
    console.warn('syncServiceRequestIdSequence:', e.message);
  }
}

async function insertServiceRequestRow(values) {
  await ensureServiceRequestSchema();
  await syncServiceRequestIdSequence();

  const valueMap = {
    fullname: values.fullName || 'NA',
    mobilenumber: values.mobileNumber || '0',
    Location: values.location || '',
    message: buildServiceLegacyMessage(values),
    service_type: values.serviceType || values.legacyMessage,
    additional_notes: values.additionalNotes || null,
    warranty_type: values.warrantyType,
    status: values.status || 'Pending',
    postingdate: values.postingDate || new Date(),
    account_id: values.accountId,
    assignby: values.assignBy ?? values.accountId,
    app_user_id: values.appUserId ?? null,
  };

  const colsResult = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name != 'id'
     ORDER BY ordinal_position`,
    [TABLE_REQUEST]
  );
  const tableCols = new Set(colsResult.rows.map((r) => r.column_name));

  const insertCols = [];
  const insertParams = [];
  const params = [];
  let paramIndex = 1;
  for (const [col, val] of Object.entries(valueMap)) {
    if (!tableCols.has(col)) continue;
    insertCols.push(quoteServiceColumn(col));
    insertParams.push(`$${paramIndex++}`);
    params.push(val);
  }

  if (!insertCols.length) {
    throw new Error('firereport_servicerequest has no insertable columns');
  }

  const sql = `INSERT INTO ${TABLE_REQUEST} (${insertCols.join(', ')})
               VALUES (${insertParams.join(', ')})
               RETURNING id`;
  const insertResult = await pool.query(sql, params);
  return insertResult.rows[0].id;
}

async function ensureServiceRequestSchema() {
  try {
    await pool.query(
      `ALTER TABLE ${TABLE_REQUEST} ADD COLUMN IF NOT EXISTS app_user_id INTEGER`
    );
    await pool.query(
      `ALTER TABLE ${TABLE_REQUEST} ADD COLUMN IF NOT EXISTS service_type TEXT`
    );
    await pool.query(
      `ALTER TABLE ${TABLE_REQUEST} ADD COLUMN IF NOT EXISTS additional_notes TEXT`
    );
    await pool.query(
      `ALTER TABLE ${TABLE_REQUEST} ADD COLUMN IF NOT EXISTS warranty_type TEXT`
    );
    await pool.query(
      `ALTER TABLE ${TABLE_REQUEST} ALTER COLUMN assignby DROP NOT NULL`
    ).catch(() => {});
    schemaReady = true;
  } catch (e) {
    console.warn('Service request schema migration:', e.message);
    schemaReady = true;
  }
}

function getValue(row, colName) {
  const keys = Object.keys(row);
  const found = keys.find((k) => k.toLowerCase() === colName.toLowerCase());
  return found ? row[found] : null;
}

function isProjectPlaceholderName(name) {
  if (!name) return true;
  const s = String(name).trim();
  return /^project\s*#?\s*\d+$/i.test(s) || /^project\d+$/i.test(s);
}

function pickConsumerDisplayName(row, getVal = getValue) {
  const fromCustomer = (getVal(row, 'consumer_display_name') || '').toString().trim();
  const stored = (getVal(row, 'fullname') || '').toString().trim();
  if (fromCustomer) return fromCustomer;
  if (stored && !isProjectPlaceholderName(stored)) return stored;
  return stored || fromCustomer;
}

function mapServiceRequestRow(row, getVal = getValue) {
  const assignToId = getVal(row, 'assignto_id');
  const postingDate = getVal(row, 'postingdate');
  const consumerName = pickConsumerDisplayName(row, getVal);
  return {
    id: getVal(row, 'id'),
    userId: getVal(row, 'account_id'),
    appUserId: getVal(row, 'app_user_id'),
    assignBy: getVal(row, 'assignby'),
    consumerName,
    fullName: consumerName || getVal(row, 'fullname') || '',
    mobileNumber: getVal(row, 'mobilenumber') || '',
    location: getVal(row, 'Location') || getVal(row, 'location') || '',
    message: getVal(row, 'message') || '',
    serviceType: getVal(row, 'service_type') || '',
    additionalNotes: getVal(row, 'additional_notes') || '',
    warrantyType: getVal(row, 'warranty_type') || '',
    status: (getVal(row, 'status') || 'Pending').toString(),
    createdAt: postingDate ? new Date(postingDate).toISOString() : new Date().toISOString(),
    postingdate: postingDate ? new Date(postingDate).toISOString() : null,
    updatedAt: getVal(row, 'updationdate')
      ? new Date(getVal(row, 'updationdate')).toISOString()
      : null,
    completeDate: getVal(row, 'complete_date')
      ? new Date(getVal(row, 'complete_date')).toISOString()
      : null,
    assignToId,
    assignedTime: getVal(row, 'assignedtime')
      ? new Date(getVal(row, 'assignedtime')).toISOString()
      : null,
    engineer: buildEngineerFromRow(row, assignToId, getVal),
  };
}

function mapServiceReportRow(row) {
  const out = {};
  for (const [key, val] of Object.entries(row)) {
    const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[camel] = val;
  }
  if (row.service_request_id != null) {
    out.serviceRequestId = row.service_request_id;
  }
  return out;
}

function isServiceCompleted(serviceRequest, history) {
  const status = (serviceRequest?.status || '').toString().toLowerCase();
  if (status.includes('complete')) return true;
  if (serviceRequest?.completeDate) return true;
  if (!Array.isArray(history)) return false;
  return history.some((entry) =>
    String(entry?.status || '')
      .toLowerCase()
      .includes('complete')
  );
}

async function fetchLatestServiceReport(serviceId) {
  const queries = [
    `SELECT * FROM ${TABLE_REPORT} WHERE service_request_id = $1 ORDER BY created_at DESC LIMIT 1`,
    `SELECT * FROM ${TABLE_REPORT} WHERE service_request_id = $1 ORDER BY id DESC LIMIT 1`,
    `SELECT * FROM ${TABLE_REPORT} WHERE "service_request_id" = $1 ORDER BY id DESC LIMIT 1`,
  ];
  for (const sql of queries) {
    try {
      const result = await pool.query(sql, [serviceId]);
      if (result.rows.length > 0) return result.rows[0];
    } catch (_) {}
  }
  return null;
}

async function sendServiceReportPdf(res, { report, serviceRequest, engineer, serviceId }) {
  const pdf = await buildServiceReportPdf({
    report,
    serviceRequest,
    engineer,
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `inline; filename="service_report_${serviceId}.pdf"`
  );
  res.setHeader('Content-Length', pdf.length);
  return res.status(200).send(pdf);
}

function engineerPayload(engineer) {
  if (!engineer) return null;
  return {
    firstName: engineer.firstName,
    lastName: engineer.lastName,
    fullName: engineer.fullName,
    profileName: engineer.profileName,
    employeeId: engineer.employeeId,
  };
}

const LIST_SELECT = `
  sr.*,
  au.first_name AS engineer_first_name,
  au.last_name AS engineer_last_name,
  au.email AS engineer_email,
  au.username AS engineer_username,
  up.phone AS engineer_contact_number,
  up.address AS engineer_address,
  up.designation AS engineer_designation,
  up.image AS engineer_image,
  up.name AS engineer_profile_name,
  c_disp.comp_name AS consumer_display_name`;

const LIST_JOINS = `
  LEFT JOIN auth_user au ON sr.assignto_id = au.id
  LEFT JOIN user_profile up ON au.id = up.customer_id
  LEFT JOIN LATERAL (
    SELECT comp_name FROM customer
    WHERE new_customer_id = COALESCE(sr.assignby, sr.account_id)
    ORDER BY cust_id DESC
    LIMIT 1
  ) c_disp ON true`;

function buildListAccessWhere() {
  return `
    (
      sr.app_user_id = $1
      OR ($1 IS NULL AND (
        sr.account_id = $2
        OR sr.account_id = ANY($3::int[])
      ))
      OR (sr.app_user_id IS NULL AND (
        sr.account_id = $2
        OR sr.account_id = ANY($3::int[])
      ))
    )
    AND ($4::int IS NULL OR sr.assignby = $4 OR sr.account_id = $4)`;
}

function parseServiceRequestBody(body) {
  const serviceType = body.remark != null ? String(body.remark).trim() : '';
  const additionalNotes = body.message != null ? String(body.message).trim() : '';
  const legacyMessage = serviceType || additionalNotes;
  return { serviceType, additionalNotes, legacyMessage };
}

function isLikelyServiceRemark(remark) {
  const s = String(remark || '').trim();
  if (s.length < 4) return false;
  if (/\s/.test(s)) return true;
  return /solar|panel|inverter|meter|amc|maintenance|grid|site|monitor|wire|clean|fault|inspect/i.test(
    s
  );
}

router.get('/remarks', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, remark FROM ${TABLE_REMARKS} WHERE is_active = true ORDER BY remark ASC`
    );
    const merged = [...DEFAULT_SERVICE_TYPES];
    for (const row of result.rows) {
      const remark = (row.remark || '').toString().trim();
      if (!remark || !isLikelyServiceRemark(remark)) continue;
      if (merged.some((item) => item.toLowerCase() === remark.toLowerCase())) continue;
      merged.push(remark);
    }
    res.json({
      remarks: merged.map((remark, index) => ({
        id: String(index + 1),
        remark,
      })),
    });
  } catch (error) {
    console.error('Get service remarks error:', error);
    res.status(500).json({ message: 'Failed to load service remarks' });
  }
});

function resolveListAccountIds(req, ctx, filterAuthUserId = null) {
  const authFromReq = resolveAuthUserIdFromReq(req);
  const ids = new Set();
  if (authFromReq != null && !isNaN(authFromReq)) ids.add(authFromReq);
  const ownerN = parseInt(ctx.appOwnerId, 10);
  if (!isNaN(ownerN)) ids.add(ownerN);
  for (const raw of ctx.linkedAuthIds || []) {
    const n = parseInt(raw, 10);
    if (!isNaN(n)) ids.add(n);
  }
  if (filterAuthUserId != null && !isNaN(filterAuthUserId)) ids.add(filterAuthUserId);
  return [...ids];
}

router.get('/', authenticate, async (req, res) => {
  try {
    const ctx = await getAppAccessContext(req);
    if (!ctx) {
      return res.status(401).json({ message: 'Could not identify user' });
    }

    await ensureServiceRequestSchema();

    let filterAuthUserId = null;
    const filterCustId = req.query.cust_id ? parseInt(req.query.cust_id, 10) : null;
    if (filterCustId && !isNaN(filterCustId)) {
      filterAuthUserId = await resolveAuthUserIdFromCustId(
        filterCustId,
        ctx.appOwnerId,
        ctx.linkedAuthIds,
        req,
        ctx
      );
    }

    const accountIds = resolveListAccountIds(req, ctx, filterAuthUserId);
    const listOwnerId =
      accountIds.length > 0 ? accountIds[0] : parseInt(ctx.appOwnerId, 10);
    const resolvedAppUserId = await resolveAppUserId(req);

    const result = await pool.query(
      `SELECT ${LIST_SELECT}
       FROM ${TABLE_REQUEST} sr
       ${LIST_JOINS}
       WHERE ${buildListAccessWhere()}
       ORDER BY sr.postingdate DESC`,
      [
        resolvedAppUserId,
        !isNaN(listOwnerId) ? listOwnerId : ctx.appOwnerId,
        accountIds.length ? accountIds : [ctx.appOwnerId],
        filterAuthUserId && !isNaN(filterAuthUserId) ? filterAuthUserId : null,
      ]
    );

    res.json({
      serviceRequests: result.rows.map((row) => mapServiceRequestRow(row)),
    });
  } catch (error) {
    console.error('List service requests error:', error);
    res.status(500).json({ message: 'Failed to load service requests' });
  }
});

router.post('/report-pdf/generate', authenticate, async (req, res) => {
  try {
    const report = req.body?.report;
    const serviceRequest = req.body?.serviceRequest;
    const engineer = req.body?.engineer;
    if (!report || typeof report !== 'object') {
      return res.status(400).json({ message: 'Report data is required' });
    }

    const serviceId = serviceRequest?.id ?? report.serviceRequestId ?? 'report';
    return await sendServiceReportPdf(res, {
      report,
      serviceRequest: serviceRequest || {},
      engineer,
      serviceId,
    });
  } catch (error) {
    console.error('Generate service report PDF error:', error);
    res.status(500).json({ message: 'Failed to generate service report PDF' });
  }
});

router.get('/:id/report-pdf', authenticate, async (req, res) => {
  try {
    const ctx = await getAppAccessContext(req);
    const serviceId = parseInt(req.params.id, 10);
    if (!ctx || isNaN(serviceId)) {
      return res.status(400).json({ message: 'Invalid request' });
    }

    await ensureServiceRequestSchema();
    const accountIds = [ctx.appOwnerId, ...ctx.linkedAuthIds];
    const resolvedAppUserId = await resolveAppUserId(req);

    const result = await pool.query(
      `SELECT ${LIST_SELECT}
       FROM ${TABLE_REQUEST} sr
       ${LIST_JOINS}
       WHERE sr.id = $1
         AND (
           sr.app_user_id = $2
           OR ($2 IS NULL AND (sr.account_id = $3 OR sr.account_id = ANY($4::int[])))
           OR (sr.app_user_id IS NULL AND (sr.account_id = $3 OR sr.account_id = ANY($4::int[])))
         )`,
      [serviceId, resolvedAppUserId, ctx.appOwnerId, accountIds]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Service request not found' });
    }

    const reportRow = await fetchLatestServiceReport(serviceId);
    if (!reportRow) {
      return res.status(404).json({ message: 'Service report not found' });
    }

    const historyResult = await pool.query(
      `SELECT status FROM ${TABLE_HISTORY} WHERE service_request_id = $1`,
      [serviceId]
    );

    const serviceRequest = mapServiceRequestRow(result.rows[0]);
    const report = mapServiceReportRow(reportRow);
    if (!isServiceCompleted(serviceRequest, historyResult.rows)) {
      return res.status(400).json({
        message: 'Service report PDF is available only for completed requests',
      });
    }

    return await sendServiceReportPdf(res, {
      report,
      serviceRequest: {
        id: serviceRequest.id,
        status: serviceRequest.status,
        serviceType: serviceRequest.serviceType,
        message: serviceRequest.message,
        warrantyType: serviceRequest.warrantyType,
      },
      engineer: engineerPayload(serviceRequest.engineer),
      serviceId,
    });
  } catch (error) {
    console.error('Service report PDF error:', error);
    res.status(500).json({ message: 'Failed to generate service report PDF' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const ctx = await getAppAccessContext(req);
    const serviceId = parseInt(req.params.id, 10);
    if (!ctx || isNaN(serviceId)) {
      return res.status(400).json({ message: 'Invalid request' });
    }

    await ensureServiceRequestSchema();
    const accountIds = [ctx.appOwnerId, ...ctx.linkedAuthIds];
    const resolvedAppUserId = await resolveAppUserId(req);

    const result = await pool.query(
      `SELECT ${LIST_SELECT}
       FROM ${TABLE_REQUEST} sr
       ${LIST_JOINS}
       WHERE sr.id = $1
         AND (
           sr.app_user_id = $2
           OR ($2 IS NULL AND (sr.account_id = $3 OR sr.account_id = ANY($4::int[])))
           OR (sr.app_user_id IS NULL AND (sr.account_id = $3 OR sr.account_id = ANY($4::int[])))
         )`,
      [serviceId, resolvedAppUserId, ctx.appOwnerId, accountIds]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Service request not found' });
    }

    const historyResult = await pool.query(
      `SELECT id, status, remark, "postingDate", assignby, assignto_id, service_request_id
       FROM ${TABLE_HISTORY}
       WHERE service_request_id = $1
       ORDER BY "postingDate" DESC`,
      [serviceId]
    );

    const reportRow = await fetchLatestServiceReport(serviceId);

    const history = historyResult.rows.map((h) => ({
      id: h.id,
      status: h.status || '',
      remark: h.remark || '',
      postingdate: h.postingDate ? new Date(h.postingDate).toISOString() : null,
      assignToId: h.assignto_id,
      assignBy: h.assignby,
      serviceRequestId: h.service_request_id,
    }));

    const serviceReport = reportRow ? mapServiceReportRow(reportRow) : null;

    res.json({
      serviceRequest: mapServiceRequestRow(result.rows[0]),
      history,
      serviceReport,
    });
  } catch (error) {
    console.error('Get service request error:', error);
    res.status(500).json({ message: 'Failed to load service request' });
  }
});

router.post('/', authenticate, async (req, res) => {
  try {
    const ctx = await getAppAccessContext(req);
    if (!ctx) {
      return res.status(401).json({ message: 'Could not identify user' });
    }

    const { serviceType, additionalNotes, legacyMessage } = parseServiceRequestBody(req.body);
    const warrantyType =
      req.body.warrantyType != null
        ? String(req.body.warrantyType).trim()
        : req.body.warranty_type != null
          ? String(req.body.warranty_type).trim()
          : '';
    if (!legacyMessage) {
      return res.status(400).json({
        message: 'Select a service type or enter a description',
      });
    }
    if (!warrantyType) {
      return res.status(400).json({
        message: 'Please select a warranty type',
      });
    }

    const custId = req.body.cust_id ? parseInt(req.body.cust_id, 10) : null;

    let customerFields;
    try {
      if (custId && !isNaN(custId)) {
        customerFields = await resolveCustomerFields(
          ctx.appOwnerId,
          ctx.linkedAuthIds,
          custId,
          req,
          ctx
        );
      } else {
        customerFields = await resolveDefaultCustomerFields(req, ctx);
      }
    } catch (e) {
      const status = e.message?.includes('linked')
        ? 403
        : e.message?.includes('not found')
          ? 404
          : 400;
      return res.status(status).json({ message: e.message || 'Invalid consumer' });
    }

    const { fullName, mobileNumber, location, authUserId } = customerFields;
    let appUserId = await resolveAppUserId(req);
    if (appUserId == null) {
      appUserId = await resolveAppUserIdForConsumerAuth(authUserId);
    }
    const accountId = authUserId;
    if (!accountId || isNaN(accountId)) {
      return res.status(400).json({ message: 'Consumer has no linked account' });
    }
    console.log('👤 Service app_user_id (user_app):', appUserId);

    await ensureServiceRequestSchema();

    const postingDate = new Date();
    const status = 'Pending';
    const assignBy = authUserId;

    const nextId = await insertServiceRequestRow({
      fullName,
      mobileNumber,
      location,
      legacyMessage,
      serviceType,
      additionalNotes,
      warrantyType,
      status,
      postingDate,
      accountId,
      assignBy,
      appUserId,
    });

    res.status(201).json({
      message: 'Service request created',
      serviceRequest: {
        id: nextId,
        status,
        message: legacyMessage,
        serviceType,
        additionalNotes,
        warrantyType,
        consumerName: fullName,
        fullName,
        mobileNumber,
        location,
        accountId,
        assignBy,
        appUserId,
        authUserId,
        createdAt: postingDate,
      },
    });
  } catch (error) {
    console.error('Create service request error:', error);
    const detail = error.message || 'Failed to create service request';
    const code = error.code || '';
    let message = detail;
    if (detail.includes('violates') || detail.includes('null value') || code === '23502') {
      message = 'Could not save service request. Please try again or contact support.';
    } else if (code === '23505') {
      message = 'Could not save service request (duplicate id). Please retry.';
    } else if (detail.includes('does not exist') || code === '42703') {
      message = 'Server database schema is outdated. Please redeploy the latest API.';
    }
    res.status(500).json({ message });
  }
});

module.exports = router;
