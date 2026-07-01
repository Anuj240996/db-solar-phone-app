const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../database/db');
const { authenticate } = require('../middleware/auth');
const { ensureLeadsLeadSchema } = require('../utils/ensureLeadsLeadSchema');

const router = express.Router();

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

    // Get email and phone from user_app (app user record) for the logged-in user
    if (user.auth_source === 'user_app' && user.id != null) {
      appUserId = user.id;
      email = user.email || null;
      contact = user.phone != null && String(user.phone).trim() !== '' ? String(user.phone).trim() : '';
    } else {
      // Logged in via auth_user: look up user_app by email to get app user's email and phone
      const loginEmail = user.email || user.username;
      if (loginEmail) {
        try {
          const ua = await pool.query(
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
        const custResult = await pool.query(
          'SELECT 1 FROM customer WHERE new_customer_id = $1 LIMIT 1',
          [appUserId]
        );
        if (custResult.rows.length > 0) {
          stage = 'ext_app';
          hasProjects = true;
        }
      } catch (e) {
        // If customer table doesn't exist or query fails, keep new_app
      }
    }
    const status = hasProjects ? 'ext_enq' : 'new_enq';

    // Request body keys must match Flutter createLead payload. See LEADS_FIELD_MAPPING.md
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

    // Build values for every column we might send (string -> default 'NA', number -> 0, date -> now)
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

    // Only insert into columns that exist in the table (avoids "column does not exist")
    const colsResult = await pool.query(
      `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leads_lead' AND column_name != 'id' ORDER BY ordinal_position`
    );
    const existingColumns = colsResult.rows.map((r) => r.column_name);
    const nullableSet = new Set(colsResult.rows.filter((r) => r.is_nullable === 'YES').map((r) => r.column_name));

    if (existingColumns.length === 0) {
      return res.status(500).json({ message: 'leads_lead table has no insertable columns' });
    }

    const numericColumns = new Set([
      'probability', 'score', 'budget', 'estimated_value',
    ]);
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

    const result = await pool.query(
      `INSERT INTO leads_lead (${columnList}) VALUES (${placeholders}) RETURNING *`,
      values
    );

    res.status(201).json({
      message: 'Lead submitted successfully',
      lead: result.rows[0],
    });
  } catch (error) {
    console.error('Create lead error:', error);
    const message = process.env.NODE_ENV === 'development' || process.env.DEBUG
      ? (error.message || 'Server error')
      : 'Server error';
    res.status(500).json({ message });
  }
});

module.exports = router;
