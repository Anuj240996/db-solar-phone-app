const express = require('express');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const pool = require('../database/db');
const { authenticate } = require('../middleware/auth');
const { ensureLeadsLeadSchema } = require('../utils/ensureLeadsLeadSchema');

const router = express.Router();

async function resolveMobileAppSourceId(client) {
  const existing = await client.query(
    `SELECT id FROM crm_leads_leadsource
     WHERE LOWER(TRIM(name)) IN ('mobile app', 'app', 'phone app')
     ORDER BY id ASC LIMIT 1`
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  try {
    const orgRes = await client.query(
      `SELECT id FROM core_organization WHERE deleted_at IS NULL ORDER BY id ASC LIMIT 1`
    );
    const organizationId = orgRes.rows[0]?.id;
    if (organizationId != null) {
      const nextId = await client.query(
        `SELECT COALESCE(MAX(id), 0) + 1 AS id FROM crm_leads_leadsource`
      );
      const id = nextId.rows[0].id;
      const now = new Date();
      const inserted = await client.query(
        `INSERT INTO crm_leads_leadsource
          (id, created, modified, name, is_active, cost_per_lead, organization_id)
         VALUES ($1, $2, $3, 'Mobile App', true, 0, $4)
         RETURNING id`,
        [id, now, now, organizationId]
      );
      if (inserted.rows[0]?.id) return inserted.rows[0].id;
    }
  } catch (e) {
    console.warn('Could not create Mobile App lead source:', e.message);
  }

  const other = await client.query(
    `SELECT id FROM crm_leads_leadsource WHERE LOWER(TRIM(name)) = 'other' LIMIT 1`
  );
  return other.rows[0]?.id || null;
}

async function insertCrmLead(client, payload) {
  const {
    name,
    phone,
    email,
    address,
    city,
    state,
    pincode,
    property_type,
    roof_type,
    electricity_bill,
    monthly_consumption,
    lat,
    lng,
    stage,
    notes,
    next_followup,
    budget,
    estimated_value,
    probability,
    alternate_phone,
    payment_mode,
    rooftop_area,
    rooftop_area_unit,
    source,
    campaign,
    sorting_address,
  } = payload;

  const orgRes = await client.query(
    `SELECT id FROM core_organization WHERE deleted_at IS NULL ORDER BY id ASC LIMIT 1`
  );
  const organizationId = orgRes.rows[0]?.id;
  if (!organizationId) {
    throw new Error('No organization found for CRM lead');
  }

  const sourceId = await resolveMobileAppSourceId(client);
  const id = crypto.randomUUID();
  const now = new Date();

  const crmStage = stage === 'ext_app' ? 'quote' : 'new';
  const crmScore = 'medium';
  const phoneVal = phone && String(phone).trim() ? String(phone).trim() : 'NA';
  const emailVal = email && String(email).trim() ? String(email).trim() : '';
  const addressVal = address && String(address).trim() ? String(address).trim() : 'NA';
  const cityVal = city && String(city).trim() ? String(city).trim() : 'NA';
  const stateVal = state && String(state).trim() ? String(state).trim() : 'NA';
  const pinVal = pincode && String(pincode).trim() ? String(pincode).trim() : 'NA';
  const propVal = property_type && String(property_type).trim()
    ? String(property_type).trim().toLowerCase()
    : 'residential';
  const roofVal = roof_type && String(roof_type).trim()
    ? String(roof_type).trim().toLowerCase()
    : 'flat';
  const altPhone =
    alternate_phone && String(alternate_phone).trim() && String(alternate_phone).trim() !== 'NA'
      ? String(alternate_phone).trim()
      : '';

  let billNum = null;
  if (electricity_bill != null && String(electricity_bill).trim() !== '') {
    const n = Number(String(electricity_bill).replace(/[^\d.]/g, ''));
    if (!Number.isNaN(n)) billNum = n;
  }
  let consumptionNum = null;
  if (monthly_consumption != null && String(monthly_consumption).trim() !== '') {
    const n = parseInt(String(monthly_consumption).replace(/[^\d]/g, ''), 10);
    if (!Number.isNaN(n)) consumptionNum = n;
  }

  // NOT NULL on CRM: rooftop_area_unit (varchar 5) + finance_type
  let rooftopAreaNum = null;
  if (rooftop_area != null && String(rooftop_area).trim() !== '') {
    const n = Number(String(rooftop_area).replace(/[^\d.]/g, ''));
    if (!Number.isNaN(n)) rooftopAreaNum = n;
  }
  const unitRaw = rooftop_area_unit != null ? String(rooftop_area_unit).trim().toLowerCase() : '';
  let rooftopAreaUnit = 'm2';
  if (unitRaw === 'm2' || unitRaw === 'sq_m' || unitRaw === 'sqm' || unitRaw === 'sq.m') {
    rooftopAreaUnit = 'm2';
  } else if (unitRaw === 'ft2' || unitRaw === 'sq_ft' || unitRaw === 'sqft' || unitRaw === 'sq.ft') {
    rooftopAreaUnit = 'ft2';
  } else if (unitRaw && unitRaw.length <= 5) {
    rooftopAreaUnit = unitRaw;
  }

  const payRaw = payment_mode != null ? String(payment_mode).trim().toLowerCase() : '';
  let financeType = '';
  if (payRaw.includes('cash')) financeType = 'cash';
  else if (payRaw.includes('net') || payRaw.includes('bank')) financeType = 'netbanking';
  else if (payRaw.includes('finance') || payRaw.includes('loan')) financeType = 'finance';
  else if (payRaw && payRaw !== 'na' && payRaw.length <= 20) financeType = payRaw;

  // CRM table has no dedicated columns for every app field — keep full form snapshot in notes.
  const extraLines = [];
  if (payment_mode) extraLines.push(`Payment mode: ${payment_mode}`);
  if (rooftop_area != null && String(rooftop_area).trim() !== '') {
    extraLines.push(
      `Rooftop area: ${rooftop_area}${rooftop_area_unit ? ` ${rooftop_area_unit}` : ''}`
    );
  }
  if (sorting_address && String(sorting_address).trim() && String(sorting_address).trim() !== addressVal) {
    extraLines.push(`Sorting address: ${sorting_address}`);
  }
  if (source) extraLines.push(`App source: ${source}`);
  if (campaign) extraLines.push(`Campaign: ${campaign}`);
  if (monthly_consumption != null && String(monthly_consumption).trim() !== '') {
    extraLines.push(`Monthly consumption (kWh): ${monthly_consumption}`);
  }
  if (electricity_bill != null && String(electricity_bill).trim() !== '') {
    extraLines.push(`Electricity bill (Rs): ${electricity_bill}`);
  }

  const userNotes =
    notes != null && String(notes).trim() && String(notes).trim() !== 'NA'
      ? String(notes).trim()
      : '';
  const notesCombined = [userNotes, ...extraLines].filter(Boolean).join('\n');
  const internalNotes = [
    'Submitted from DB Solar mobile app',
    `property_type=${propVal}`,
    `roof_type=${roofVal}`,
    lat != null ? `lat=${lat}` : null,
    lng != null ? `lng=${lng}` : null,
    payment_mode ? `payment_mode=${payment_mode}` : null,
    rooftop_area != null ? `rooftop_area=${rooftop_area}` : null,
    rooftop_area_unit ? `rooftop_area_unit=${rooftop_area_unit}` : null,
  ]
    .filter(Boolean)
    .join(' | ');

  const result = await client.query(
    `INSERT INTO crm_leads_lead (
      created, modified, id, name, phone, email, alternate_phone,
      address, city, state, pincode, latitude, longitude,
      property_type, roof_type, electricity_bill, monthly_consumption,
      stage, score, budget, estimated_value, probability,
      next_followup, notes, internal_notes, lost_reason, competitor,
      organization_id, source_id, rooftop_area, rooftop_area_unit, finance_type
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11, $12, $13,
      $14, $15, $16, $17,
      $18, $19, $20, $21, $22,
      $23, $24, $25, $26, $27,
      $28, $29, $30, $31, $32
    ) RETURNING id, name, phone, email, stage, organization_id, source_id, created, notes, internal_notes,
               property_type, roof_type, electricity_bill, monthly_consumption, city, state, pincode,
               rooftop_area, rooftop_area_unit, finance_type`,
    [
      now,
      now,
      id,
      name || 'NA',
      phoneVal,
      emailVal,
      altPhone,
      addressVal,
      cityVal,
      stateVal,
      pinVal,
      lat != null && !Number.isNaN(Number(lat)) ? Number(lat) : null,
      lng != null && !Number.isNaN(Number(lng)) ? Number(lng) : null,
      propVal,
      roofVal,
      billNum,
      consumptionNum,
      crmStage,
      crmScore,
      budget != null && !Number.isNaN(Number(budget)) ? Number(budget) : null,
      estimated_value != null && !Number.isNaN(Number(estimated_value))
        ? Number(estimated_value)
        : null,
      probability != null ? Math.min(100, Math.max(0, Number(probability) || 0)) : 10,
      next_followup || new Date(now.getTime() + 24 * 60 * 60 * 1000),
      notesCombined,
      internalNotes,
      '',
      '',
      organizationId,
      sourceId,
      rooftopAreaNum,
      rooftopAreaUnit,
      financeType,
    ]
  );

  return result.rows[0];
}

// Create lead from Get Quote flow (any authenticated user - user_app or auth_user)
router.post('/', authenticate, [
  body('name').trim().notEmpty().withMessage('Project/Customer name is required'),
  body('property_type').trim().notEmpty().withMessage('Category is required'),
  body('sorting_address').optional().trim(),
  body('city').optional().trim(),
  body('state').optional().trim(),
  body('pincode').optional().trim(),
  body('roof_type').optional().trim(),
  body('electricity_bill').optional().trim(),
  body('monthly_consumption').optional().trim(),
  body('payment_mode').optional().trim(),
  body('lat').optional(),
  body('lng').optional(),
], async (req, res) => {
  const client = await pool.connect();
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    await ensureLeadsLeadSchema();

    const user = req.user;
    let email = null;
    let contact = '';
    let appUserId = null;

    if (user.auth_source === 'user_app' && user.id != null) {
      appUserId = user.id;
      email = user.email || null;
      contact = user.phone != null && String(user.phone).trim() !== '' ? String(user.phone).trim() : '';
    } else {
      const loginEmail = user.email || user.username;
      if (loginEmail) {
        try {
          const ua = await client.query(
            'SELECT id, email, phone FROM user_app WHERE email = $1 LIMIT 1',
            [loginEmail]
          );
          if (ua.rows.length > 0) {
            const appUser = ua.rows[0];
            appUserId = appUser.id;
            email = appUser.email || null;
            contact = appUser.phone != null && String(appUser.phone).trim() !== '' ? String(appUser.phone).trim() : '';
          } else {
            email = loginEmail;
          }
        } catch (e) {
          email = loginEmail;
        }
      }
    }

    let stage = 'new_app';
    let hasProjects = false;
    if (appUserId != null) {
      try {
        const custResult = await client.query(
          'SELECT 1 FROM customer WHERE new_customer_id = $1 LIMIT 1',
          [appUserId]
        );
        if (custResult.rows.length > 0) {
          stage = 'ext_app';
          hasProjects = true;
        }
      } catch (e) {
        // keep new_app
      }
    }
    const status = hasProjects ? 'ext_enq' : 'new_enq';

    const {
      name,
      property_type,
      roof_type,
      electricity_bill,
      monthly_consumption,
      sorting_address,
      address: bodyAddress,
      city,
      state,
      pincode,
      payment_mode,
      lat,
      lng,
      phone: bodyPhone,
      email: bodyEmail,
      probability: bodyProbability,
      score: bodyScore,
      source: bodySource,
      campaign: bodyCampaign,
      next_followup: bodyNextFollowup,
      alternate_phone,
      notes,
      internal_notes,
      lost_reason,
      competitor,
      budget,
      estimated_value,
      latitude,
      longitude,
      rooftop_area: bodyRooftopArea,
      rooftop_area_unit: bodyRooftopAreaUnit,
    } = req.body;

    const addressParts = [sorting_address || bodyAddress, city, state, pincode].filter(Boolean).map(String);
    const address = (bodyAddress && String(bodyAddress).trim()) || (addressParts.length > 0 ? addressParts.join(', ') + ', India' : (sorting_address || 'NA'));
    const phoneValue = (bodyPhone != null && String(bodyPhone).trim() !== '') ? String(bodyPhone).trim() : (contact || 'NA');
    const emailValue = (bodyEmail != null && String(bodyEmail).trim() !== '') ? String(bodyEmail).trim() : email;

    const source = bodySource === undefined || bodySource === null ? 'app' : String(bodySource);
    const campaign = bodyCampaign === undefined || bodyCampaign === null ? 'NA' : String(bodyCampaign);
    const score = (bodyScore !== undefined && bodyScore !== null && !Number.isNaN(Number(bodyScore))) ? Number(bodyScore) : 0;
    const probability = (bodyProbability !== undefined && bodyProbability !== null && !Number.isNaN(Number(bodyProbability))) ? Math.min(100, Math.max(0, Number(bodyProbability))) : 0;
    const tags = '[]';

    const now = new Date();
    const nextFollowupDate = bodyNextFollowup ? new Date(bodyNextFollowup) : new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const nextFollowup = (nextFollowupDate instanceof Date && !Number.isNaN(nextFollowupDate.getTime())) ? nextFollowupDate : new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const latVal = lat != null ? lat : latitude;
    const lngVal = lng != null ? lng : longitude;
    const extraJson = JSON.stringify({});

    const allColumnValues = {
      name: name || 'NA',
      property_type: property_type || 'NA',
      roof_type: roof_type || 'NA',
      electricity_bill: electricity_bill != null && electricity_bill !== '' ? String(electricity_bill) : null,
      monthly_consumption: monthly_consumption != null && monthly_consumption !== '' ? String(monthly_consumption) : null,
      sorting_address: sorting_address || address || 'NA',
      city: city || 'NA',
      state: state || 'NA',
      pincode: pincode || 'NA',
      address: address || 'NA',
      email: emailValue != null ? emailValue : 'NA',
      phone: phoneValue || 'NA',
      contact: phoneValue || 'NA',
      stage,
      status,
      payment_mode: payment_mode || null,
      user_app_id: appUserId ?? null,
      lat: latVal != null && latVal !== '' && !Number.isNaN(Number(latVal)) ? Number(latVal) : null,
      lng: lngVal != null && lngVal !== '' && !Number.isNaN(Number(lngVal)) ? Number(lngVal) : null,
      latitude: latVal != null && latVal !== '' && !Number.isNaN(Number(latVal)) ? Number(latVal) : null,
      longitude: lngVal != null && lngVal !== '' && !Number.isNaN(Number(lngVal)) ? Number(lngVal) : null,
      source,
      campaign,
      score,
      tags,
      probability,
      next_followup: nextFollowup,
      created_at: now,
      updated_at: now,
      extra: extraJson,
      assigned_to_id: null,
      alternate_phone: alternate_phone != null ? String(alternate_phone) : 'NA',
      notes: notes != null ? String(notes) : 'NA',
      internal_notes: internal_notes != null ? String(internal_notes) : 'NA',
      lost_reason: lost_reason != null ? String(lost_reason) : 'NA',
      competitor: competitor != null ? String(competitor) : 'NA',
      budget: (budget != null && !Number.isNaN(Number(budget))) ? Number(budget) : 0,
      estimated_value: (estimated_value != null && !Number.isNaN(Number(estimated_value))) ? Number(estimated_value) : 0,
      rooftop_area: (bodyRooftopArea != null && bodyRooftopArea !== '' && !Number.isNaN(Number(bodyRooftopArea))) ? Number(bodyRooftopArea) : null,
      rooftop_area_unit: (bodyRooftopAreaUnit != null && String(bodyRooftopAreaUnit).trim()) ? String(bodyRooftopAreaUnit).trim() : 'sq_m',
    };

    await client.query('BEGIN');

    const crmLead = await insertCrmLead(client, {
      name: allColumnValues.name,
      phone: allColumnValues.phone,
      email: allColumnValues.email,
      address: allColumnValues.address,
      city: allColumnValues.city,
      state: allColumnValues.state,
      pincode: allColumnValues.pincode,
      property_type: allColumnValues.property_type,
      roof_type: allColumnValues.roof_type,
      electricity_bill: allColumnValues.electricity_bill,
      monthly_consumption: allColumnValues.monthly_consumption,
      lat: allColumnValues.lat,
      lng: allColumnValues.lng,
      stage,
      notes: notes != null ? String(notes) : '',
      next_followup: nextFollowup,
      budget: allColumnValues.budget,
      estimated_value: allColumnValues.estimated_value,
      probability: allColumnValues.probability || 10,
      alternate_phone: allColumnValues.alternate_phone,
      payment_mode: allColumnValues.payment_mode,
      rooftop_area: allColumnValues.rooftop_area,
      rooftop_area_unit: allColumnValues.rooftop_area_unit,
      source,
      campaign,
      sorting_address: sorting_address || null,
    });

    let legacyLead = null;
    try {
      const colsResult = await client.query(
        `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name != 'id' ORDER BY ordinal_position`
      );
      const existingColumns = colsResult.rows.map((r) => r.column_name);
      const nullableSet = new Set(colsResult.rows.filter((r) => r.is_nullable === 'YES').map((r) => r.column_name));

      if (existingColumns.length > 0) {
        const numericColumns = new Set(['probability', 'score', 'budget', 'estimated_value']);
        const nullableIdColumns = new Set(['user_app_id', 'assigned_to_id']);
        const floatColumns = new Set(['lat', 'lng', 'latitude', 'longitude', 'rooftop_area']);
        const dateColumns = new Set([
          'created_at', 'updated_at', 'next_followup',
          'assigned_date', 'last_contacted', 'converted_at', 'lost_at',
        ]);
        const jsonColumns = new Set(['extra', 'tags']);

        const values = existingColumns.map((col) => {
          const v = allColumnValues[col];
          if (v !== undefined) return v;
          if (dateColumns.has(col)) return now;
          if (col === 'extra' || (jsonColumns.has(col) && col !== 'tags')) return extraJson;
          if (col === 'tags') return '[]';
          if (floatColumns.has(col) || nullableIdColumns.has(col)) return null;
          if (numericColumns.has(col)) return 0;
          if (nullableSet.has(col)) return null;
          return 'NA';
        });

        const placeholders = existingColumns.map((_, i) => `$${i + 1}`).join(', ');
        const columnList = existingColumns.join(', ');
        const result = await client.query(
          `INSERT INTO leads_lead (${columnList}) VALUES (${placeholders}) RETURNING *`,
          values
        );
        legacyLead = result.rows[0];
      }
    } catch (legacyErr) {
      console.warn('Legacy leads_lead insert skipped:', legacyErr.message);
    }

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Lead submitted successfully',
      lead: crmLead || legacyLead,
      crmLead,
      legacyLead,
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    console.error('Create lead error:', error);
    const message = process.env.NODE_ENV === 'development' || process.env.DEBUG
      ? (error.message || 'Server error')
      : 'Server error';
    res.status(500).json({ message });
  } finally {
    client.release();
  }
});

module.exports = router;
