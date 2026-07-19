const express = require('express');
const { authenticate } = require('../middleware/auth');
const pool = require('../database/db');
const {
  getAppAccessContext,
  getProjectOwnerAuthIds,
  checkAppAuthLinkConflict,
  APP_AUTH_LINK_MESSAGES,
  resolveLinkAppUserId,
  isUserAppSession,
  queryLinkedCustomersForAppUser,
  isCustomerLinkedToAppUser,
} = require('../utils/appAccess');
const { buildSimplePdf } = require('../utils/simplePdf');
const { buildNetMeterDetailsForCustomer } = require('../utils/netMeterDetails');
const {
  fetchCustomerResultForCustomer,
  computeProjectStatusFromResult,
} = require('../utils/customerResult');
const { buildProjectsForAuthUserId, buildProjectTypeImageUrl } = require('../utils/projectBuilders');
const { buildProgressFallback } = require('../utils/buildProjectProgress');
const { verifyAuthUserCredentials } = require('../utils/authUserVerify');
const path = require('path');
const fs = require('fs');

const router = express.Router();

/**
 * Ensure the authenticated session may access this customer/project.
 * Returns { customer } or { error, message }.
 */
async function assertProjectAccess(req, ctx, projectId) {
  const customerResult = await pool.query(
    `SELECT cust_id, new_customer_id, consumer, comp_name, first_name, last_name
     FROM customer
     WHERE cust_id = $1
     LIMIT 1`,
    [projectId]
  );
  if (customerResult.rows.length === 0) {
    return { error: 404, message: 'Project not found' };
  }

  const customer = customerResult.rows[0];
  const custOwnerId =
    customer.new_customer_id != null ? parseInt(customer.new_customer_id, 10) : null;
  const allowedAuthIds = new Set(getProjectOwnerAuthIds(req, ctx));
  let hasAccess = custOwnerId == null || allowedAuthIds.has(custOwnerId);
  if (!hasAccess && isUserAppSession(req)) {
    const linkAppUserId = await resolveLinkAppUserId(req);
    if (linkAppUserId != null) {
      hasAccess = await isCustomerLinkedToAppUser(linkAppUserId, projectId);
    }
  }
  if (!hasAccess) {
    return { error: 403, message: 'Project not linked to your account' };
  }
  return { customer };
}

/** Metadata only (no PDF bytes) for a consumer's release/agreement docs. */
async function fetchReleaseAgreementMeta(custId) {
  try {
    const result = await pool.query(
      `SELECT id, title, consumer_id_id AS cust_id,
              NULLIF(TRIM(release_pdf), '') AS release_pdf_path,
              NULLIF(TRIM(agreement_pdf), '') AS agreement_pdf_path,
              (release_pdf_data IS NOT NULL AND octet_length(release_pdf_data) > 4) AS has_release_pdf,
              (agreement_pdf_data IS NOT NULL AND octet_length(agreement_pdf_data) > 4) AS has_agreement_pdf,
              updated_at, created_at
       FROM customer_release_agreement
       WHERE consumer_id_id = $1
       ORDER BY updated_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [custId]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      id: row.id,
      title: row.title || 'Release & Agreement',
      custId: row.cust_id,
      hasReleasePdf: row.has_release_pdf === true,
      hasAgreementPdf: row.has_agreement_pdf === true,
      // available = at least one PDF; complete only when both are present
      available: row.has_release_pdf === true || row.has_agreement_pdf === true,
      complete: row.has_release_pdf === true && row.has_agreement_pdf === true,
      updatedAt: row.updated_at || null,
    };
  } catch (e) {
    console.warn('fetchReleaseAgreementMeta failed:', e.message);
    return null;
  }
}

function resolveMediaFile(relativePath) {
  if (!relativePath || typeof relativePath !== 'string') return null;
  const trimmed = relativePath.trim().replace(/^[/\\]+/, '');
  if (!trimmed) return null;
  const candidates = [
    process.env.MEDIA_ROOT,
    path.join(__dirname, '..', 'media'),
    path.join(__dirname, '..', '..', 'media'),
  ].filter(Boolean);
  for (const root of candidates) {
    const full = path.join(root, trimmed);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  }
  return null;
}

async function loadReleaseAgreementPdfBytes(custId, docType) {
  const column =
    docType === 'agreement' ? 'agreement_pdf_data' : 'release_pdf_data';
  const pathColumn = docType === 'agreement' ? 'agreement_pdf' : 'release_pdf';

  const result = await pool.query(
    `SELECT ${column} AS pdf_data, NULLIF(TRIM(${pathColumn}), '') AS pdf_path
     FROM customer_release_agreement
     WHERE consumer_id_id = $1
     ORDER BY updated_at DESC NULLS LAST, id DESC
     LIMIT 1`,
    [custId]
  );
  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  if (row.pdf_data && Buffer.isBuffer(row.pdf_data) && row.pdf_data.length > 4) {
    return row.pdf_data;
  }
  // Some drivers return bytea as hex string / Uint8Array
  if (row.pdf_data && !(row.pdf_data instanceof Buffer)) {
    try {
      const buf = Buffer.from(row.pdf_data);
      if (buf.length > 4) return buf;
    } catch (_) {}
  }

  const filePath = resolveMediaFile(row.pdf_path);
  if (filePath) {
    return fs.readFileSync(filePath);
  }
  return null;
}

/** Shared link path for QR (external link_only) and manual credential add. */
async function handleLinkOnlyImport(req, res, options = {}) {
  let sourceAuthUserId =
    options.sourceAuthUserId != null ? parseInt(options.sourceAuthUserId, 10) : NaN;
  const token = options.token ?? null;
  const username = options.username != null ? String(options.username).trim() : '';
  const password = options.password != null ? String(options.password) : '';

  const linkAppUserId = await resolveLinkAppUserId(req);
  if (!linkAppUserId) {
    return res.status(401).json({ success: false, message: 'Could not identify user' });
  }

  if ((isNaN(sourceAuthUserId) || sourceAuthUserId <= 0) && username && password) {
    const verified = await verifyAuthUserCredentials(username, password);
    if (!verified) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    sourceAuthUserId = verified.id;
  }

  if (isNaN(sourceAuthUserId) || sourceAuthUserId <= 0) {
    return res.status(400).json({
      success: false,
      message: 'source_auth_user_id or username/password is required for link',
    });
  }

  const linkConflict = await checkAppAuthLinkConflict(linkAppUserId, sourceAuthUserId);
  if (linkConflict === 'other') {
    return res.status(409).json({
      success: false,
      message: APP_AUTH_LINK_MESSAGES.other,
      reason: 'already_linked_other',
    });
  }

  try {
    await ensureAppAuthLink(linkAppUserId, sourceAuthUserId, token);
  } catch (linkErr) {
    console.error('❌ handleLinkOnlyImport link failed:', linkErr.message);
    return res.status(500).json({
      success: false,
      message: 'Could not link account',
    });
  }

  const projects = await buildProjectsForAuthUserId(sourceAuthUserId);
  const message =
    linkConflict === 'own'
      ? APP_AUTH_LINK_MESSAGES.own
      : 'Account linked and projects fetched';

  return res.status(200).json({
    success: true,
    message,
    alreadyLinked: linkConflict === 'own',
    data: { projects, linkedAuthUserId: sourceAuthUserId },
  });
}

// Create a project (customer) from external data and associate with authenticated user
router.post('/external', authenticate, async (req, res) => {
  try {
    const sourceAuthUserIdRaw =
      req.body.source_auth_user_id ??
      req.body.sourceAuthUserId ??
      req.body.new_customer_id ??
      req.body.newCustomerId ??
      null;
    const sourceAuthUserId =
      sourceAuthUserIdRaw != null ? parseInt(sourceAuthUserIdRaw, 10) : null;
    const linkOnly =
      req.body.link_only === true ||
      req.body.linkOnly === true ||
      req.body.link_only === 'true' ||
      req.body.linkOnly === 'true';
    const username = (req.body.username ?? '').toString().trim();
    const password = req.body.password != null ? String(req.body.password) : '';

    // Link only — same path as QR fallback (resolveLinkAppUserId + app_auth_links)
    if (
      linkOnly &&
      ((sourceAuthUserId != null && !isNaN(sourceAuthUserId)) || (username && password))
    ) {
      return handleLinkOnlyImport(req, res, {
        sourceAuthUserId,
        token: req.body.token ?? null,
        username,
        password,
      });
    }

    // Determine app owner id for create flow (not link-only)
    let appOwnerId = null;
    if (req.user && req.user.auth_source === 'user_app' && req.user.id) {
      appOwnerId = req.user.id;
    } else if (req.user && req.user.id && typeof req.user.id === 'number') {
      appOwnerId = req.user.id;
    } else if (req.user && req.user.auth_user_id) {
      appOwnerId = req.user.auth_user_id;
    } else if (req.user && req.user.id && typeof req.user.id === 'string') {
      const parsed = parseInt(req.user.id, 10);
      if (!isNaN(parsed)) appOwnerId = parsed;
    }

    if (!appOwnerId) {
      return res.status(401).json({ message: 'Could not identify user' });
    }

    const {
      comp_name,
      consumer,
      first_name,
      last_name,
      email,
      phone,
      address,
      city,
      state,
      location,
    } = req.body;

    // Basic validation (create flow only — not link_only)
    if (!comp_name && !consumer) {
      return res.status(400).json({ success: false, message: 'comp_name or consumer is required' });
    }

    // Normalize phone and ensure not null (DB constraint)
    const phoneValueRaw = phone ?? req.body.phone ?? '';
    const phoneParam = (typeof phoneValueRaw === 'string' && phoneValueRaw.trim() !== '')
      ? phoneValueRaw.trim()
      : (typeof phoneValueRaw === 'number' ? String(phoneValueRaw) : '0000000000');

    // Ensure required columns (some schemas enforce NOT NULL on plant_capacity)
    const plantCapacityValue = req.body.plant_capacity ?? req.body.plantCapacity ?? 0;

    // Prevent duplicate customer for the same app user by consumer.
    // If another user has the same consumer, we still allow creating a copy for this app user.
    if (consumer != null) {
      try {
        const existing = await pool.query('SELECT * FROM customer WHERE consumer = $1 AND new_customer_id = $2 LIMIT 1', [consumer, appOwnerId]);
        if (existing.rows.length > 0) {
          const existingRow = existing.rows[0];
          // Return existing record in standardized format
          return res.json({
            success: true,
            message: 'Project already exists',
            data: {
              project: {
                id: existingRow.cust_id,
                projectId: existingRow.cust_id,
                projectName: existingRow.comp_name,
                consumer: existingRow.consumer,
                location: `${existingRow.city || ''}, ${existingRow.state || ''}`.trim() || existingRow.address || 'N/A',
                phone: existingRow.phone,
                email: existingRow.email
              }
            }
          });
        }
      } catch (dupErr) {
        console.error('❌ Error checking existing customer by consumer for this user:', dupErr.message);
        // Continue to attempt insert
      }
      // Block only when another mobile app user already owns this consumer.
      try {
        const otherMobileOwner = await findConsumerOwnedByOtherMobileApp(consumer, appOwnerId);
        if (otherMobileOwner) {
          return res.status(409).json({
            success: false,
            message: 'Project already assigned to another mobile app user',
            data: {
              projectId: otherMobileOwner.cust_id,
              ownerId: otherMobileOwner.new_customer_id,
            },
          });
        }
      } catch (globalErr) {
        console.error('❌ Error checking global existing customer by consumer:', globalErr.message);
        // proceed with insert as fallback
      }
    }

    // Ensure pincode is always provided (some schemas require NOT NULL)
    const pincodeValueRaw = req.body.pincode ?? req.body.pin ?? '';
    const pincodeParam = (typeof pincodeValueRaw === 'string' && pincodeValueRaw.trim() !== '')
      ? pincodeValueRaw.trim()
      : (typeof pincodeValueRaw === 'number' ? String(pincodeValueRaw) : '000000');

    // Some schemas have a non-null "qunt_solar" column - default to 0 if not provided
    const quntSolarRaw = req.body.qunt_solar ?? req.body.quntSolar ?? 0;
    const quntSolarParam = (typeof quntSolarRaw === 'number') ? quntSolarRaw : (parseInt(quntSolarRaw, 10) || 0);
    // Some schemas also have a non-null "qunt_inv" column - default to 0 if not provided
    const quntInvRaw = req.body.qunt_inv ?? req.body.quntInv ?? 0;
    const quntInvParam = (typeof quntInvRaw === 'number') ? quntInvRaw : (parseInt(quntInvRaw, 10) || 0);
    // Some schemas require an emp_id_id (employee who created/assigned) - default to current app owner
    const empIdRaw = req.body.emp_id ?? req.body.empId ?? appOwnerId;
    const empIdParam = (typeof empIdRaw === 'number') ? empIdRaw : (parseInt(empIdRaw, 10) || appOwnerId);

    // Build an object of fields we intend to insert (start with common ones)
    const fieldsToInsert = {
      comp_name: comp_name || null,
      consumer: consumer || null,
      first_name: first_name || null,
      last_name: last_name || null,
      email: email || null,
      phone: phoneParam,
      address: address || location || null,
      city: city || null,
      state: state || null,
      pincode: pincodeParam,
      qunt_solar: quntSolarParam,
      qunt_inv: quntInvParam,
      plant_capacity: (typeof plantCapacityValue === 'number') ? plantCapacityValue : (parseFloat(plantCapacityValue) || 0),
      emp_id_id: empIdParam,
      new_customer_id: appOwnerId,
    };

    // Query database for NOT NULL columns without defaults and fill sensible fallbacks dynamically
    try {
      const requiredColsRes = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'customer' AND is_nullable = 'NO' AND column_default IS NULL
      `);
      requiredColsRes.rows.forEach(col => {
        const name = col.column_name;
        const type = col.data_type || '';
        if (fieldsToInsert[name] === undefined) {
          // Provide a reasonable fallback depending on type
          if (name === 'cust_id' || name === 'id') return; // skip primary key
          if (type.includes('integer') || type.includes('bigint')) {
            fieldsToInsert[name] = 0;
          } else if (type.includes('numeric') || type.includes('decimal')) {
            fieldsToInsert[name] = 0;
          } else if (type.includes('character') || type.includes('text')) {
            fieldsToInsert[name] = '';
          } else if (type.includes('boolean')) {
            fieldsToInsert[name] = false;
          } else if (type.includes('timestamp') || type.includes('date') || type.includes('time')) {
            fieldsToInsert[name] = new Date().toISOString();
          } else {
            // Generic fallback
            fieldsToInsert[name] = null;
          }
        }
      });
    } catch (schemaErr) {
      console.warn('Could not introspect customer table schema; proceeding with provided fields. Error:', schemaErr.message);
    }

    // Build dynamic INSERT using fieldsToInsert
    const insertColumns = Object.keys(fieldsToInsert);
    const insertValues = Object.values(fieldsToInsert);
    const placeholders = insertValues.map((_, i) => `$${i + 1}`).join(',');
    const insertQuery = `INSERT INTO customer (${insertColumns.join(',')}) VALUES (${placeholders}) RETURNING *`;

    console.log('🔵 Creating external project with params:', insertValues);
    let insertResult;
    try {
      insertResult = await pool.query(insertQuery, insertValues);
    } catch (insertErr) {
      console.error('❌ Error creating external project - SQL error:', insertErr.message);
      console.error('   Query:', insertQuery.replace(/\s+/g, ' ').trim());
      console.error('   Params:', insertValues);
      return res.status(500).json({ message: 'Server error creating project', error: insertErr.message });
    }
    const row = insertResult.rows[0];

    // Build project object in the same shape as GET /projects returns
    const project = {
      id: row.cust_id,
      projectId: row.cust_id,
      projectName: row.comp_name || row.consumer || `AF#${row.cust_id}`,
      consumer: row.consumer,
      location: `${row.city || ''}, ${row.state || ''}`.trim().replace(/^,\s*/, '').replace(/,\s*$/, '') || (row.address || 'N/A'),
      status: 'Pending',
      plantCapacity: String(row.plant_capacity || '0'),
      powerGeneration: '0',
      projectImage: buildProjectTypeImageUrl(row),
      customerId: row.cust_id,
      phone: row.phone,
      email: row.email,
    };

    // Return created project
    res.status(201).json({ success: true, message: 'Project created', data: { project } });
  } catch (err) {
    console.error('Error creating external project:', err.message);
    res.status(500).json({ message: 'Server error creating project', error: err.message });
  }
});

function buildProjectFromCustomerRow(row, status = 'Pending') {
  return {
    id: row.cust_id,
    projectId: row.cust_id,
    projectName: row.comp_name || row.consumer || `AF#${row.cust_id}`,
    consumer: row.consumer,
    location: `${row.city || ''}, ${row.state || ''}`.trim().replace(/^,\s*/, '').replace(/,\s*$/, '') || (row.address || 'N/A'),
    status,
    plantCapacity: String(row.plant_capacity || '0'),
    powerGeneration: '0',
    projectImage: buildProjectTypeImageUrl(row),
    cust_type: row.cust_type || null,
    custType: row.cust_type || null,
    customerId: row.cust_id,
    phone: row.phone,
    email: row.email,
    new_customer_id: row.new_customer_id,
  };
}

async function isMobileAppUserId(userId) {
  if (userId == null) return false;
  const result = await pool.query('SELECT id FROM user_app WHERE id = $1 LIMIT 1', [userId]);
  return result.rows.length > 0;
}

/** True when another mobile app user already owns this consumer name. */
async function findConsumerOwnedByOtherMobileApp(consumer, appOwnerId) {
  if (consumer == null) return null;
  const result = await pool.query(
    `SELECT c.cust_id, c.new_customer_id
     FROM customer c
     INNER JOIN user_app ua ON ua.id = c.new_customer_id
     WHERE c.consumer = $1 AND c.new_customer_id <> $2
     LIMIT 1`,
    [consumer, appOwnerId]
  );
  return result.rows.length ? result.rows[0] : null;
}

async function ensureAppAuthLink(appOwnerId, authUserId, token = null) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_auth_links (
      id BIGSERIAL PRIMARY KEY,
      app_user_id BIGINT NOT NULL,
      auth_user_id BIGINT NOT NULL,
      token TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (app_user_id, auth_user_id)
    )
  `);
  await pool.query(
    `INSERT INTO app_auth_links (app_user_id, auth_user_id, token)
     VALUES ($1, $2, $3)
     ON CONFLICT (app_user_id, auth_user_id) DO UPDATE
       SET token = COALESCE(EXCLUDED.token, app_auth_links.token),
           created_at = CURRENT_TIMESTAMP`,
    [appOwnerId, authUserId, token]
  );
}

async function resolveDrfTokenUser(rawToken) {
  const trimmed = (rawToken ?? '').toString().trim();
  if (!trimmed) return null;

  const candidates = new Set([trimmed]);
  if (trimmed.toLowerCase().startsWith('token ')) {
    candidates.add(trimmed.slice(6).trim());
  }

  for (const key of candidates) {
    if (!key) continue;
    try {
      const tokenRes = await pool.query(
        `SELECT t.user_id, u.username, u.email
         FROM authtoken_token t
         JOIN auth_user u ON u.id = t.user_id
         WHERE t.key = $1
         LIMIT 1`,
        [key]
      );
      if (tokenRes.rows.length) return tokenRes.rows[0];
    } catch (e) {
      console.warn('resolveDrfTokenUser lookup failed:', e.message);
    }
  }
  return null;
}

// Import a single project from mobile QR (DRF authtoken + cust_id).
router.post('/import-from-qr', authenticate, async (req, res) => {
  try {
    const linkAppUserId = await resolveLinkAppUserId(req);
    if (!linkAppUserId) {
      return res.status(401).json({ message: 'Could not identify user' });
    }

    const token = (req.body.token ?? '').toString().trim();
    const username = (req.body.username ?? '').toString().trim();
    const custId = parseInt(req.body.cust_id ?? req.body.custId, 10);
    const authUserIdRaw = req.body.auth_user_id ?? req.body.authUserId ?? null;
    const authUserId = authUserIdRaw != null ? parseInt(authUserIdRaw, 10) : null;

    if (!token) {
      return res.status(400).json({ success: false, message: 'API token is required' });
    }
    if (isNaN(custId)) {
      return res.status(400).json({ success: false, message: 'cust_id is required' });
    }

    let tokenUser;
    try {
      tokenUser = await resolveDrfTokenUser(token);
      if (!tokenUser && !isNaN(authUserId) && authUserId > 0) {
        const userCheck = await pool.query(
          'SELECT id, username, email FROM auth_user WHERE id = $1 LIMIT 1',
          [authUserId]
        );
        if (userCheck.rows.length) {
          tokenUser = userCheck.rows[0];
          console.log(
            `import-from-qr: DRF token not found; using auth_user_id ${authUserId} from QR payload`
          );
        }
      }
      if (!tokenUser) {
        return res.status(401).json({ success: false, message: 'Invalid API token' });
      }
    } catch (tokenErr) {
      console.error('import-from-qr token lookup failed:', tokenErr.message);
      return res.status(500).json({ success: false, message: 'Could not verify API token' });
    }

    const resolvedAuthUserId = parseInt(tokenUser.user_id ?? tokenUser.id, 10);
    if (!isNaN(authUserId) && authUserId !== resolvedAuthUserId) {
      return res.status(401).json({ success: false, message: 'Token does not match auth user' });
    }
    if (username && tokenUser.username && username !== tokenUser.username) {
      return res.status(401).json({ success: false, message: 'Username does not match API token' });
    }

    const custRes = await pool.query(
      `SELECT * FROM customer WHERE cust_id = $1 AND new_customer_id = $2 LIMIT 1`,
      [custId, resolvedAuthUserId]
    );
    if (!custRes.rows.length) {
      const byCustId = await pool.query(
        'SELECT cust_id, new_customer_id FROM customer WHERE cust_id = $1 LIMIT 1',
        [custId]
      );
      if (byCustId.rows.length) {
        const ownerId = byCustId.rows[0].new_customer_id;
        const onMobileApp = await isMobileAppUserId(ownerId);
        if (!onMobileApp) {
          return res.status(400).json({
            success: false,
            message: 'This customer is not assigned to any mobile app user',
          });
        }
      }
      return res.status(404).json({ success: false, message: 'Project not found for this account' });
    }
    const source = custRes.rows[0];

    const linkConflict = await checkAppAuthLinkConflict(linkAppUserId, resolvedAuthUserId);
    if (linkConflict === 'own') {
      return res.status(409).json({
        success: false,
        message: APP_AUTH_LINK_MESSAGES.own,
        reason: 'already_linked_own',
      });
    }
    if (linkConflict === 'other') {
      return res.status(409).json({
        success: false,
        message: APP_AUTH_LINK_MESSAGES.other,
        reason: 'already_linked_other',
      });
    }

    try {
      await ensureAppAuthLink(linkAppUserId, resolvedAuthUserId, token);
    } catch (linkErr) {
      console.error('import-from-qr link upsert failed:', linkErr.message);
      return res.status(500).json({
        success: false,
        message: 'Could not link account from QR',
      });
    }

    // Link only — do not copy customer rows. Projects are listed via app_auth_links
    // (new_customer_id = linked auth_user_id).
    return res.status(200).json({
      success: true,
      message: 'Account linked from QR',
      data: { project: buildProjectFromCustomerRow(source) },
    });
  } catch (err) {
    console.error('import-from-qr error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error importing project from QR' });
  }
});

// Helper function to convert bit varying to boolean
function parseWarrantyBaseDate(raw) {
  if (raw == null || raw === '') return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function computeWarrantyRange(baseDateRaw, yearsRaw) {
  const base = parseWarrantyBaseDate(baseDateRaw);
  const years = parseInt(yearsRaw, 10);
  if (!base || !years || years <= 0) return { start: null, end: null };
  const start = base.toISOString().split('T')[0];
  const endDate = new Date(base);
  endDate.setFullYear(endDate.getFullYear() + years);
  return { start, end: endDate.toISOString().split('T')[0] };
}

function bitToBoolean(bitValue) {
  if (bitValue === null || bitValue === undefined) return false;
  if (typeof bitValue === 'boolean') return bitValue;
  if (typeof bitValue === 'string') {
    // PostgreSQL bit varying returns as string like '1' or '0'
    return bitValue === '1' || bitValue.toLowerCase() === 'true';
  }
  if (typeof bitValue === 'number') return bitValue === 1;
  return false;
}

// Helper function to get auth_user_id from req.user
function getAuthUserId(req) {
  if (req.user && req.user.auth_user_id) {
    return req.user.auth_user_id;
  }
  // Only consider req.user.id as auth_user id if the auth source is explicitly auth_user
  if (req.user && req.user.auth_source === 'auth_user') {
    if (req.user.id && typeof req.user.id === 'number') {
      return req.user.id;
    } else if (req.user.id && typeof req.user.id === 'string') {
      const userIdNum = parseInt(req.user.id, 10);
      if (!isNaN(userIdNum) && req.user.id === userIdNum.toString()) {
        return userIdNum;
      }
    }
  }
  return null;
}

const MSEB_ROW_SELECT = `load_extension, flisibility, quotation, sent_to_bill, net_meter,
              flexibility, approval, meter_testing, agreement, release, installation_date,
              load_extension_date, flisibility_date, quotation_date, sent_to_bill_date,
              net_meter_date, flexibility_date, approval_date, meter_testing_date,
              agreement_date, release_date, installation_date_date, customer_id, comp_name`;

/** Resolve customer_mseb row: cust_id, customer_result link, then comp_name match. */
async function fetchMsebRowForCustomer(customer, customerResultRow = null) {
  const custId = customer.cust_id;
  const compName = (customer.comp_name || '').trim();
  const linkedIds = new Set([custId]);

  if (customerResultRow?.consumer_id_id != null) {
    linkedIds.add(parseInt(customerResultRow.consumer_id_id, 10));
  }

  try {
    const byCust = await pool.query(
      `SELECT consumer_id_id FROM customer_result
       WHERE consumer_id_id = $1 ORDER BY id DESC LIMIT 1`,
      [custId]
    );
    if (byCust.rows[0]?.consumer_id_id != null) {
      linkedIds.add(parseInt(byCust.rows[0].consumer_id_id, 10));
    }
  } catch (_) {
    /* ignore */
  }

  if (customer.consumer != null && String(customer.consumer).trim() !== '') {
    try {
      const byConsumer = await pool.query(
        `SELECT consumer_id_id FROM customer_result
         WHERE consumer::text = $1 ORDER BY id DESC LIMIT 1`,
        [String(customer.consumer)]
      );
      if (byConsumer.rows[0]?.consumer_id_id != null) {
        linkedIds.add(parseInt(byConsumer.rows[0].consumer_id_id, 10));
      }
    } catch (_) {
      /* ignore */
    }
  }

  const idList = [...linkedIds].filter((id) => !isNaN(id) && id > 0);

  if (idList.length > 0) {
    const byIds = await pool.query(
      `SELECT ${MSEB_ROW_SELECT}
       FROM customer_mseb
       WHERE customer_id = ANY($1::int[])
       ORDER BY CASE WHEN customer_id = $2 THEN 0 ELSE 1 END, id DESC
       LIMIT 1`,
      [idList, custId]
    );
    if (byIds.rows.length > 0) {
      return byIds.rows[0];
    }
  }

  if (compName) {
    const byName = await pool.query(
      `SELECT ${MSEB_ROW_SELECT}
       FROM customer_mseb
       WHERE TRIM(LOWER(COALESCE(comp_name, ''))) = TRIM(LOWER($1))
       ORDER BY
         CASE WHEN customer_id = $2 THEN 0
              WHEN customer_id = ANY($3::int[]) THEN 1
              ELSE 2 END,
         id DESC
       LIMIT 1`,
      [compName, custId, idList.length ? idList : [custId]]
    );
    if (byName.rows.length > 0) {
      console.log(
        `ℹ️ MSEB linked by comp_name for cust_id ${custId} → customer_mseb.customer_id ${byName.rows[0].customer_id}`
      );
      return byName.rows[0];
    }
  }

  return null;
}

function buildMsebDetailsFromRow(msebData) {
  if (!msebData) return null;
    const netMeterCompleted = bitToBoolean(msebData.net_meter);
    const netMeterDate = msebData.net_meter_date;

    const isNotCompleted = (value) =>
      value == null || value === '' || value === 0 || value === '0' || value === false || value === undefined;

    const shouldSkipInitialSteps =
      isNotCompleted(msebData.load_extension) &&
      isNotCompleted(msebData.flisibility) &&
      isNotCompleted(msebData.quotation) &&
      isNotCompleted(msebData.sent_to_bill) &&
      netMeterCompleted &&
      netMeterDate != null &&
      netMeterDate !== '';

    const msebStepsMap = {};
    if (!shouldSkipInitialSteps) {
      msebStepsMap.loadExtension = {
        completed: bitToBoolean(msebData.load_extension),
        date: msebData.load_extension_date || null,
      };
      msebStepsMap.flisibility = {
        completed: bitToBoolean(msebData.flisibility),
        date: msebData.flisibility_date || null,
      };
      msebStepsMap.quotation = {
        completed: bitToBoolean(msebData.quotation),
        date: msebData.quotation_date || null,
      };
      msebStepsMap.sentToBill = {
        completed: bitToBoolean(msebData.sent_to_bill),
        date: msebData.sent_to_bill_date || null,
      };
    }
    msebStepsMap.netMeter = {
      completed: bitToBoolean(msebData.net_meter),
      date: msebData.net_meter_date || null,
    };
    msebStepsMap.technicalFlexibility = {
      completed: bitToBoolean(msebData.flexibility),
      date: msebData.flexibility_date || null,
    };
    msebStepsMap.approval = {
      completed: bitToBoolean(msebData.approval),
      date: msebData.approval_date || null,
    };
    msebStepsMap.meterTesting = {
      completed: bitToBoolean(msebData.meter_testing),
      date: msebData.meter_testing_date || null,
    };
    msebStepsMap.agreement = {
      completed: bitToBoolean(msebData.agreement),
      date: msebData.agreement_date || null,
    };
    msebStepsMap.release = {
      completed: bitToBoolean(msebData.release),
      date: msebData.release_date || null,
    };
    msebStepsMap.installationDate = {
      completed: bitToBoolean(msebData.installation_date),
      date: msebData.installation_date_date || null,
    };

    const msebSteps = Object.values(msebStepsMap);
    const completedMsebSteps = msebSteps.filter((step) => step.completed).length;
    const totalMsebSteps = msebSteps.length;
    const msebPercentage = totalMsebSteps > 0 ? (completedMsebSteps / totalMsebSteps) * 100 : 0;

  return {
    progress: msebPercentage.toFixed(1),
    completedSteps: completedMsebSteps,
    totalSteps: totalMsebSteps,
    steps: msebStepsMap,
    linkedCustomerId: msebData.customer_id ?? null,
    compName: msebData.comp_name ?? null,
  };
}

/** Load MSEB steps for a project using customer + customer_result linkage. */
async function buildMsebDetailsForCustomer(customer, customerResultRow = null) {
  try {
    const msebData = await fetchMsebRowForCustomer(customer, customerResultRow);
    return buildMsebDetailsFromRow(msebData);
  } catch (e) {
    console.log('Error fetching MSEB details for customer', customer?.cust_id, ':', e.message);
    return null;
  }
}

// Get all projects for authenticated customer
router.get('/', authenticate, async (req, res) => {
  try {
    // Disable caching for project lists to avoid 304 Not Modified responses
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const ctx = await getAppAccessContext(req);
    if (!ctx) {
      return res.status(401).json({
        message: 'Could not identify user',
        projects: [],
      });
    }

    const linkAppUserId = await resolveLinkAppUserId(req);
    let customerRows = [];

    // user_app accounts: load via app_auth_links JOIN (same path as verify/QR link)
    if (isUserAppSession(req) && linkAppUserId) {
      const joined = await queryLinkedCustomersForAppUser(linkAppUserId);
      if (joined?.length) {
        customerRows = joined;
      }
      console.log(
        `📋 GET /projects user_app id=${linkAppUserId} join rows=${joined?.length ?? 'err'}`
      );
    }

    // Fallback: linked auth_user ids (covers JOIN mismatch / stale VPS link app_user_id)
    if (!customerRows.length) {
      const ownerAuthIds = getProjectOwnerAuthIds(req, ctx);
      console.log('📋 GET /projects ownerAuthIds:', ownerAuthIds, 'auth_source:', req.user?.auth_source);
      if (ownerAuthIds.length > 0) {
        const { queryCustomersByOwnerAuthIds } = require('../utils/projectBuilders');
        customerRows = await queryCustomersByOwnerAuthIds(ownerAuthIds);
      }
    }

    if (!customerRows.length) {
      return res.json({
        projects: [],
        message: 'No projects found for this user',
      });
    }

    const { buildProjectsFromCustomerRows } = require('../utils/projectBuilders');

    // Get project details for each customer
    const projects = await buildProjectsFromCustomerRows(customerRows);

    res.json({ projects });
  } catch (error) {
    console.error('Get projects error:', error);
    res.status(500).json({ 
      message: 'Server error', 
      projects: [],
      error: process.env.NODE_ENV === 'development' ? error.message : undefined 
    });
  }
});

// Get project details with products
router.get('/:projectId', authenticate, async (req, res) => {
  try {
    // Disable caching for project details to avoid 304 Not Modified responses
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const ctx = await getAppAccessContext(req);
    const projectId = parseInt(req.params.projectId, 10);

    if (!ctx) {
      return res.status(401).json({ message: 'Could not identify user' });
    }

    const { appOwnerId, linkedAuthIds } = ctx;

    if (isNaN(projectId)) {
      return res.status(400).json({ message: 'Invalid project ID' });
    }

    const customerResult = await pool.query(
      `SELECT cust_id, consumer, first_name, last_name, middle_name, 
              email, phone, address, city, state, comp_name, new_customer_id,
              qunt_solar, qunt_inv, sol_warranty, inv_warranty, com_warranty, po_date,
              plant_capacity
       FROM customer
       WHERE cust_id = $1
       LIMIT 1`,
      [projectId]
    );

    if (customerResult.rows.length === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const customer = customerResult.rows[0];

    const custOwnerId =
      customer.new_customer_id != null ? parseInt(customer.new_customer_id, 10) : null;
    const allowedAuthIds = new Set(getProjectOwnerAuthIds(req, ctx));
    let hasAccess =
      custOwnerId == null || allowedAuthIds.has(custOwnerId);
    if (!hasAccess && isUserAppSession(req)) {
      const linkAppUserId = await resolveLinkAppUserId(req);
      if (linkAppUserId != null) {
        hasAccess = await isCustomerLinkedToAppUser(linkAppUserId, projectId);
      }
    }
    if (!hasAccess) {
      return res.status(403).json({ message: 'Project not linked to your account' });
    }

    const assetOwnerId = customer.new_customer_id || ctx.appOwnerId;

    const customerResultData = await fetchCustomerResultForCustomer(customer);
    const status = computeProjectStatusFromResult(customerResultData);

    // Get electricity production, storage, and total panels from barcode images
    let electricityProduction = '0';
    let storageOrInGrid = '0';
    let totalPanel = '0';

    try {
      const barcodeQuery = await pool.query(
        `SELECT 
          SUM(CASE WHEN product_name ILIKE '%SolarPanel%' OR product_name ILIKE '%Solar Panel%' THEN CAST(wattage AS NUMERIC) ELSE 0 END) as total_solar_wattage,
          COUNT(CASE WHEN product_name ILIKE '%SolarPanel%' OR product_name ILIKE '%Solar Panel%' THEN 1 END) as solar_count,
          SUM(CASE WHEN product_name ILIKE '%Battery%' OR product_name ILIKE '%Storage%' THEN CAST(wattage AS NUMERIC) ELSE 0 END) as storage_wattage
         FROM detect_barcodes_barcodeimage
        WHERE assignto_id = $1`,
        [assetOwnerId]
      );

      if (barcodeQuery.rows.length > 0) {
        const row = barcodeQuery.rows[0];
        electricityProduction = row.total_solar_wattage ? Math.round(row.total_solar_wattage / 1000).toString() : '0';
        storageOrInGrid = row.storage_wattage ? Math.round(row.storage_wattage / 1000).toString() : '0';
        totalPanel = row.solar_count ? row.solar_count.toString() : '0';
      }
    } catch (e) {
      console.log('Error fetching barcode data:', e.message);
    }

    // Fetch warranty and quantity fields from customer table (already selected earlier)
    let solWarranty = null;
    let invWarranty = null;
    let omWarranty = null;
    let quntSolar = null;
    let quntInv = null;
    try {
      solWarranty = customer.sol_warranty || null;
      invWarranty = customer.inv_warranty || null;
      omWarranty = customer.com_warranty || null;
      quntSolar = customer.qunt_solar || 0;
      quntInv = customer.qunt_inv || 0;
    } catch (e) {
      // ignore missing columns
    }

    // Get installation date from customer_mseb to compute warranty start/end
    let installationDateFromMseb = null;
    try {
      const msebRowForWarranty = await fetchMsebRowForCustomer(customer, customerResultData);
      if (msebRowForWarranty?.installation_date_date) {
        installationDateFromMseb = msebRowForWarranty.installation_date_date;
      }
    } catch (e) {
      // ignore
    }

    // Warranty start: MSEB installation date, else PO date (same as legacy project detail behaviour)
    const warrantyBaseDate = installationDateFromMseb || customer.po_date || null;
    let solWarrantyStart = null, solWarrantyEnd = null;
    let invWarrantyStart = null, invWarrantyEnd = null;
    let omWarrantyStart = null, omWarrantyEnd = null;
    try {
      if (warrantyBaseDate) {
        const solarRange = computeWarrantyRange(warrantyBaseDate, solWarranty);
        solWarrantyStart = solarRange.start;
        solWarrantyEnd = solarRange.end;
        const invRange = computeWarrantyRange(warrantyBaseDate, invWarranty);
        invWarrantyStart = invRange.start;
        invWarrantyEnd = invRange.end;
        const omRange = computeWarrantyRange(warrantyBaseDate, omWarranty);
        omWarrantyStart = omRange.start;
        omWarrantyEnd = omRange.end;
      }
    } catch (e) {
      // ignore
    }

    // Get net meter counts
    let netMeterTotal = 0;
    let netMeterUsed = 0;
    try {
      const netCount = await pool.query(
        `SELECT COUNT(*)::int as total FROM customer_meters WHERE customer_id = $1`,
        [customer.cust_id]
      );
      netMeterTotal = netCount.rows[0]?.total ?? 0;
      const netUsed = await pool.query(
        `SELECT COUNT(*)::int as used FROM customer_meters WHERE customer_id = $1 AND serial_no IS NOT NULL`,
        [customer.cust_id]
      );
      netMeterUsed = netUsed.rows[0]?.used ?? 0;
    } catch (e) {
      // ignore
    }
    // Get products (solar panels and inverters from barcode images)
    const products = [];
    try {
      // Determine app owner id (useful to look up linked auth_user ids)
      let appOwnerId = null;
      if (req.user && req.user.auth_source === 'user_app' && req.user.id) {
        appOwnerId = req.user.id;
      } else if (req.user && req.user.id && typeof req.user.id === 'number') {
        appOwnerId = req.user.id;
      } else if (req.user && req.user.auth_user_id) {
        appOwnerId = req.user.auth_user_id;
      } else if (req.user && req.user.id && typeof req.user.id === 'string') {
        const parsed = parseInt(req.user.id, 10);
        if (!isNaN(parsed)) appOwnerId = parsed;
      }

      // First try: fetch products using the project's asset owner id (usually customer.new_customer_id)
      let productsRows = [];
      const baseQuery = `
        SELECT id, barcode_data, product_name, company, wattage, barcode_type, file_saved_at, company_name
        FROM detect_barcodes_barcodeimage
        WHERE (product_name ILIKE '%SolarPanel%' OR product_name ILIKE '%Solar Panel%' OR product_name ILIKE '%Inverter%')
          AND assignto_id = $1
        ORDER BY id DESC
      `;
      const rows1 = await pool.query(baseQuery, [assetOwnerId]);
      productsRows = rows1.rows || [];

      // If none found, try linked ids: appOwnerId, any auth_user ids linked to this app user, and customer.new_customer_id
      if ((!productsRows || productsRows.length === 0)) {
        let linkedIds = [];
        try {
          const linkRes = await pool.query('SELECT auth_user_id FROM app_auth_links WHERE app_user_id = $1', [appOwnerId]);
          linkedIds = linkRes.rows.map(r => r.auth_user_id).filter(Boolean);
        } catch (linkErr) {
          // ignore if table missing
          linkedIds = [];
        }

        const candidateIds = [assetOwnerId, appOwnerId, ...linkedIds].filter(Boolean);
        // Remove duplicates
        const uniqueIds = [...new Set(candidateIds)];
        if (uniqueIds.length > 0) {
          const q = await pool.query(
            `SELECT id, barcode_data, product_name, company, wattage, barcode_type, file_saved_at, company_name
             FROM detect_barcodes_barcodeimage
             WHERE (product_name ILIKE '%SolarPanel%' OR product_name ILIKE '%Solar Panel%' OR product_name ILIKE '%Inverter%')
               AND assignto_id = ANY($1)
             ORDER BY id DESC`,
            [uniqueIds]
          );
          productsRows = q.rows || [];
        }
      }

      productsRows.forEach((row) => {
        const productName = row.product_name || '';
        const productNameLower = productName.toLowerCase();
        let productType = 'Product';
        if (productNameLower.includes('solar')) {
          productType = 'Solar Panel';
        } else if (productNameLower.includes('inverter')) {
          productType = 'Inverter';
        }
        products.push({
          id: row.id,
          productId: row.barcode_data || `PROD-${row.id}`,
          productImage: row.barcode_path || null,
          brand: row.company_name || row.company || 'Unknown Brand',
          model: productName || 'Unknown Model',
          productName: productName || 'Unknown Model',
          productType,
          wattage: row.wattage ? `${row.wattage} Wp` : null,
          quantity: 1,
          warranty: '25 year', // Default warranty
          warrantyStart: null,
          warrantyEnd: null,
          price: null,
          tax: null,
          taxPercent: 18,
          assigntoId: row.assignto_id || null,
        });
      });
    } catch (e) {
      console.log('Error fetching products:', e.message);
    }

    const projectName = customer.comp_name || 
                       `${customer.first_name || ''} ${customer.middle_name || ''} ${customer.last_name || ''}`.trim() ||
                       `AF#${customer.consumer || customer.cust_id}`;

    // Get installation progress data similar to progress.js route
    let progressData = null;
    try {
      const resultRow = customerResultData;

      if (resultRow) {
        const solarPanel = bitToBoolean(resultRow.solar_panel);
        const inverter = bitToBoolean(resultRow.inverter);
        const netMeter = bitToBoolean(resultRow.net_meter);
        const mseb = bitToBoolean(resultRow.mseb);
        const inspectionReport = bitToBoolean(resultRow.inspection_report);

        // Calculate percentages
        const completedCount = [solarPanel, inverter, netMeter, mseb, inspectionReport].filter(Boolean).length;
        const percentage = (completedCount / 5) * 100;
        const allCompleted = completedCount === 5;

        // Get customer warranty years and MSEB installation date
        let solWarrantyYears = null;
        let invWarrantyYears = null;
        let installationDateFromMseb = null;
        
        try {
          const customerWarrantyQuery = await pool.query(
            `SELECT sol_warranty, inv_warranty
             FROM customer
             WHERE cust_id = $1
             LIMIT 1`,
            [projectId]
          );
          if (customerWarrantyQuery.rows.length > 0) {
            solWarrantyYears = customerWarrantyQuery.rows[0].sol_warranty;
            invWarrantyYears = customerWarrantyQuery.rows[0].inv_warranty;
          }
        } catch (e) {
          console.log('Error fetching warranty years:', e.message);
        }

        // Installation / warranty base date: MSEB row (with comp_name fallback), else PO date
        try {
          const msebRowForProgress = await fetchMsebRowForCustomer(customer, resultRow);
          if (msebRowForProgress?.installation_date_date) {
            installationDateFromMseb = msebRowForProgress.installation_date_date;
          }
        } catch (e) {
          console.log('Error fetching MSEB installation date:', e.message);
        }
        const progressWarrantyBase = installationDateFromMseb || customer.po_date || null;

        let solarPanelWarrantyStart = null;
        let solarPanelWarrantyEnd = null;
        let inverterWarrantyStart = null;
        let inverterWarrantyEnd = null;

        if (progressWarrantyBase) {
          const solarRange = computeWarrantyRange(progressWarrantyBase, solWarrantyYears);
          solarPanelWarrantyStart = solarRange.start;
          solarPanelWarrantyEnd = solarRange.end;
          const invRange = computeWarrantyRange(progressWarrantyBase, invWarrantyYears);
          inverterWarrantyStart = invRange.start;
          inverterWarrantyEnd = invRange.end;
        }

        // Solar / inverter barcode counts — always from product list, not only when customer_result flag is set
        let solarPanelSerial = null;
        let solarPanelCompany = null;
        let solarPanelType = null;
        let solarPanelQuantity = products.filter((p) =>
          String(p.productType || p.model || '').toLowerCase().includes('solar')
        ).length;
        let solarPanelWattage = null;
        try {
          const solarQuery = await pool.query(
            `SELECT barcode_data, company_name, company, stock_id, wattage
             FROM detect_barcodes_barcodeimage
             WHERE (product_name ILIKE '%SolarPanel%' OR product_name ILIKE '%Solar Panel%')
               AND assignto_id = $1
             ORDER BY id DESC`,
            [assetOwnerId]
          );
          if (solarQuery.rows.length > 0) {
            solarPanelQuantity = solarQuery.rows.length;
            const row = solarQuery.rows[0];
            solarPanelSerial = row.barcode_data || null;
            solarPanelCompany = row.company_name || row.company || null;
            solarPanelWattage = row.wattage ? `${row.wattage} Wp` : null;

            if (row.stock_id) {
              try {
                const solarTypeQuery = await pool.query(
                  `SELECT inv_stock.name as solar_type
                   FROM transactions_purchaseserial tps
                   LEFT JOIN inventory_stock inv_stock ON inv_stock.id = tps.stock_id
                   WHERE tps.stock_id = $1
                   LIMIT 1`,
                  [row.stock_id]
                );
                if (solarTypeQuery.rows.length > 0 && solarTypeQuery.rows[0].solar_type) {
                  solarPanelType = solarTypeQuery.rows[0].solar_type;
                }
              } catch (typeError) {
                console.log('Error fetching solar type:', typeError.message);
              }
            }
          }
        } catch (e) {
          console.log('Error fetching solar panel details:', e.message);
        }

        let inverterSerial = null;
        let inverterCompany = null;
        let inverterQuantity = products.filter((p) =>
          String(p.productType || p.model || '').toLowerCase().includes('inverter')
        ).length;
        let inverterWattage = null;
        try {
          const inverterQuery = await pool.query(
            `SELECT barcode_data, company_name, company, wattage
             FROM detect_barcodes_barcodeimage
             WHERE product_name ILIKE '%Inverter%'
               AND assignto_id = $1
             ORDER BY id DESC`,
            [assetOwnerId]
          );
          if (inverterQuery.rows.length > 0) {
            inverterQuantity = inverterQuery.rows.length;
            const row = inverterQuery.rows[0];
            if (row.barcode_data) {
              inverterSerial = row.barcode_data;
            }
            inverterCompany = row.company_name || row.company || null;
            inverterWattage = row.wattage ? `${row.wattage} Wp` : null;
          }
        } catch (e) {
          console.log('Error fetching inverter details:', e.message);
        }

        let netMeterDetails = null;
        let netMeterQuantity = netMeterUsed;
        try {
          netMeterDetails = await buildNetMeterDetailsForCustomer(pool, projectId);
        } catch (e) {
          console.log('Error fetching net meter details:', e.message);
        }

        // Always load MSEB steps when a customer_mseb row exists (not only when mseb flag is 1)
        const msebDetails = await buildMsebDetailsForCustomer(
          customer,
          resultQuery?.rows?.[0] || customerResultData
        );

        progressData = {
          projectStatus: computeProjectStatusFromResult(resultRow),
          percentage: percentage.toFixed(1),
          solarPanel: {
            status: solarPanel ? 'Completed' : 'Pending',
            completed: solarPanel,
            serialNo: solarPanelSerial,
            companyName: solarPanelCompany,
            solarType: solarPanelType,
            quantity: solarPanelQuantity,
            wattage: solarPanelWattage,
            warrantyYears: solWarrantyYears,
            warrantyStart: solarPanelWarrantyStart,
            warrantyEnd: solarPanelWarrantyEnd,
          },
          inverter: {
            status: inverter ? 'Completed' : 'Pending',
            completed: inverter,
            serialNo: inverterSerial,
            companyName: inverterCompany,
            quantity: inverterQuantity,
            wattage: inverterWattage,
            warrantyYears: invWarrantyYears,
            warrantyStart: inverterWarrantyStart,
            warrantyEnd: inverterWarrantyEnd,
          },
          netMeter: {
            status: netMeter ? 'Completed' : 'Pending',
            completed: netMeter,
            serialNo: netMeterDetails?.serialNo,
            quantity: netMeterQuantity,
            details: netMeterDetails,
          },
          mseb: {
            status: mseb ? 'Completed' : (msebDetails ? 'In Progress' : 'Pending'),
            completed: mseb,
            details: msebDetails,
          },
          inspectionReport: {
            status: inspectionReport ? 'Completed' : 'Pending',
            completed: inspectionReport,
          },
        };
      } else {
        const msebDetailsOnly = await buildMsebDetailsForCustomer(customer, customerResultData);
        if (msebDetailsOnly) {
          progressData = {
            projectStatus: 'Pending',
            percentage: '0.0',
            solarPanel: { status: 'Pending', completed: false },
            inverter: { status: 'Pending', completed: false },
            netMeter: { status: 'Pending', completed: false },
            mseb: {
              status: 'Pending',
              completed: false,
              details: msebDetailsOnly,
            },
            inspectionReport: { status: 'Pending', completed: false },
          };
        }
      }
    } catch (e) {
      console.log('❌ Error fetching progress data:', e.message);
      console.log('Error stack:', e.stack);
    }

    if (!progressData) {
      let netMeterDetailsFallback = null;
      try {
        netMeterDetailsFallback = await buildNetMeterDetailsForCustomer(pool, projectId);
      } catch (_) {}
      let msebDetailsFallback = null;
      try {
        msebDetailsFallback = await buildMsebDetailsForCustomer(
          customer,
          customerResultData
        );
      } catch (_) {}
      progressData = buildProgressFallback({
        customer,
        products,
        customerResultData,
        netMeterDetails: netMeterDetailsFallback,
        msebDetails: msebDetailsFallback,
        netMeterUsed,
      });
      console.log('ℹ️ Built fallback progress for project', projectId);
    }

    // Keep top-level warranties in sync with progress component warranty dates
    if (progressData?.solarPanel) {
      solWarrantyStart = solWarrantyStart || progressData.solarPanel.warrantyStart || null;
      solWarrantyEnd = solWarrantyEnd || progressData.solarPanel.warrantyEnd || null;
    }
    if (progressData?.inverter) {
      invWarrantyStart = invWarrantyStart || progressData.inverter.warrantyStart || null;
      invWarrantyEnd = invWarrantyEnd || progressData.inverter.warrantyEnd || null;
    }

    const releaseAgreement = await fetchReleaseAgreementMeta(customer.cust_id);

    const project = {
      id: customer.cust_id,
      projectId: customer.cust_id,
      projectName: projectName,
      consumer: customer.consumer,
      city: customer.city || null,
      state: customer.state || null,
      cust_type: customer.cust_type || null,
      custType: customer.cust_type || null,
      project_type: customer.project_type || null,
      projectType: customer.project_type || null,
      solar_pump: customer.solar_pump || null,
      poDate: customer.po_date || null,
      po_date: customer.po_date || null,
      location: `${customer.city || ''}, ${customer.state || ''}`.trim().replace(/^,\s*/, '').replace(/,\s*$/, '') || 'N/A',
      phone: customer.phone || null,
      email: customer.email || null,
      address: customer.address || null,
      status: status,
      plantCapacity:
        customer.plant_capacity != null && String(customer.plant_capacity).trim() !== ''
          ? String(customer.plant_capacity)
          : electricityProduction || '0',
      qunt_solar: quntSolar ?? 0,
      qunt_inv: quntInv ?? 0,
      powerGeneration: electricityProduction || '0',
      electricityProduction: electricityProduction,
      storageOrInGrid: storageOrInGrid,
      totalPanel: totalPanel,
      projectImage: buildProjectTypeImageUrl(customer),
      products: products,
      progress: progressData, // Include progress data
      releaseAgreement,
      // Quantities from customer record (preferred over barcode counts)
      quantities: {
        solar: quntSolar ?? 0,
        inverter: quntInv ?? 0,
        netMeter: {
          total: netMeterTotal,
          used: netMeterUsed
        }
      },
      // Warranty info (computed from customer warranty years and MSEB installation date)
      warranties: {
        solar: {
          years: solWarranty ?? null,
          start: solWarrantyStart,
          end: solWarrantyEnd
        },
        inverter: {
          years: invWarranty ?? null,
          start: invWarrantyStart,
          end: invWarrantyEnd
        },
        om: {
          years: omWarranty ?? null,
          start: omWarrantyStart,
          end: omWarrantyEnd
        }
      },
    };

    console.log('✅ Project details response - Progress data included:', progressData ? 'Yes' : 'No');
    res.json({ project });
  } catch (error) {
    console.error('Get project details error:', error);
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined 
    });
  }
});

// Release & Agreement PDF for a specific consumer/project (scoped to linked account)
router.get('/:projectId/release-agreement/:docType', authenticate, async (req, res) => {
  try {
    const ctx = await getAppAccessContext(req);
    if (!ctx) {
      return res.status(401).json({ message: 'Could not identify user' });
    }

    const projectId = parseInt(req.params.projectId, 10);
    const docType = String(req.params.docType || '').toLowerCase().trim();
    if (isNaN(projectId)) {
      return res.status(400).json({ message: 'Invalid project ID' });
    }
    if (docType !== 'release' && docType !== 'agreement') {
      return res.status(400).json({ message: 'docType must be release or agreement' });
    }

    const access = await assertProjectAccess(req, ctx, projectId);
    if (access.error) {
      return res.status(access.error).json({ message: access.message });
    }

    const bytes = await loadReleaseAgreementPdfBytes(projectId, docType);
    if (!bytes || bytes.length < 5) {
      return res.status(404).json({
        message: `${docType === 'agreement' ? 'Agreement' : 'Release'} PDF not found for this consumer`,
      });
    }

    const filename =
      docType === 'agreement'
        ? `agreement_${projectId}.pdf`
        : `release_${projectId}.pdf`;

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': bytes.length,
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'private, max-age=300',
    });
    return res.send(bytes);
  } catch (error) {
    console.error('Release agreement PDF error:', error);
    return res.status(500).json({
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// Get product details
router.get('/products/:productId', authenticate, async (req, res) => {
  try {
    const ctx = await getAppAccessContext(req);
    const productId = req.params.productId;

    if (!ctx) {
      return res.status(401).json({ message: 'Could not identify user' });
    }

    const { appOwnerId, linkedAuthIds } = ctx;
    let assignIds = [
      ...new Set(
        [appOwnerId, ...linkedAuthIds]
          .map((id) => parseInt(id, 10))
          .filter((n) => !isNaN(n))
      ),
    ];

    const projectIdFromQuery = req.query.projectId ?? req.query.custId ?? null;
    if (projectIdFromQuery) {
      try {
        const custRes = await pool.query(
          `SELECT new_customer_id FROM customer WHERE cust_id = $1 LIMIT 1`,
          [projectIdFromQuery]
        );
        if (custRes.rows.length > 0 && custRes.rows[0].new_customer_id) {
          const ownerId = parseInt(custRes.rows[0].new_customer_id, 10);
          if (!isNaN(ownerId)) {
            assignIds = [ownerId, ...assignIds.filter((id) => id !== ownerId)];
          }
        }
      } catch (e) {
        console.warn('Product details: could not resolve project owner:', e.message);
      }
    }

    if (assignIds.length === 0) {
      return res.status(401).json({ message: 'Could not identify user' });
    }

    // Get product from barcode image table (scoped to accessible assign ids)
    let productQuery = await pool.query(
      `SELECT id, barcode_data, product_name, company, wattage,
              barcode_type, file_saved_at, company_name, barcode_path, image, assignto_id
       FROM detect_barcodes_barcodeimage
       WHERE (barcode_data = $1 OR id::text = $1)
         AND assignto_id = ANY($2::int[])
       LIMIT 1`,
      [productId, assignIds]
    );

    if (productQuery.rows.length === 0) {
      // Fallback: try to find product globally (without assignto_id filter)
      try {
        const globalQuery = await pool.query(
          `SELECT id, barcode_data, product_name, company, wattage,
                  barcode_type, file_saved_at, company_name, barcode_path, image, assignto_id
           FROM detect_barcodes_barcodeimage
           WHERE barcode_data = $1 OR id::text = $1
           LIMIT 1`,
          [productId]
        );
        if (globalQuery.rows.length === 0) {
          return res.status(404).json({ message: 'Product not found' });
        }
        console.log(
          'ℹ️ Product found by global lookup for productId:',
          productId,
          'assignto_id:',
          globalQuery.rows[0].assignto_id
        );
        productQuery.rows.push(globalQuery.rows[0]);
      } catch (gErr) {
        console.error('❌ Global product lookup error:', gErr.message);
        return res.status(500).json({ message: 'Server error' });
      }
    }

    const row = productQuery.rows[0];

    let consumerDetails = null;
    if (projectIdFromQuery) {
      try {
        const custRes = await pool.query(
          `SELECT cust_id, consumer, comp_name, first_name, last_name, middle_name,
                  email, phone, address, city, state, plant_capacity, qunt_solar, qunt_inv
           FROM customer
           WHERE cust_id = $1
           LIMIT 1`,
          [projectIdFromQuery]
        );
        if (custRes.rows.length > 0) {
          const c = custRes.rows[0];
          const consumerName =
            (c.comp_name && String(c.comp_name).trim()) ||
            `${c.first_name || ''} ${c.middle_name || ''} ${c.last_name || ''}`.trim() ||
            null;
          const location =
            `${c.city || ''}, ${c.state || ''}`.trim().replace(/^,\s*/, '').replace(/,\s*$/, '') ||
            c.address ||
            null;
          const cityLabel = c.city != null ? String(c.city).trim() : '';
          const displayName =
            consumerName && cityLabel
              ? `${consumerName}, ${cityLabel}`
              : consumerName;
          consumerDetails = {
            name: displayName,
            city: cityLabel || null,
            consumerNo: c.consumer != null ? String(c.consumer) : null,
            plantCapacity:
              c.plant_capacity != null && String(c.plant_capacity).trim() !== ''
                ? String(c.plant_capacity)
                : null,
            solarPanelQuantity:
              c.qunt_solar != null && String(c.qunt_solar).trim() !== ''
                ? String(c.qunt_solar)
                : null,
            inverterQuantity:
              c.qunt_inv != null && String(c.qunt_inv).trim() !== ''
                ? String(c.qunt_inv)
                : null,
            phone: c.phone || null,
            email: c.email || null,
            address: c.address || null,
            location: location || null,
          };
        }
      } catch (e) {
        console.warn('Product details: could not load consumer info:', e.message);
      }
    }
    
    // Calculate warranty dates (default 25 years from installation)
    const installationDate = row.file_saved_at ? new Date(row.file_saved_at) : new Date();
    const warrantyEndDate = new Date(installationDate);
    warrantyEndDate.setFullYear(warrantyEndDate.getFullYear() + 25);

    const wattageRaw = row.wattage != null ? String(row.wattage).trim() : '';
    const wattageDisplay =
      wattageRaw && !/wp/i.test(wattageRaw) ? `${wattageRaw} Wp` : wattageRaw || null;

    const product = {
      id: row.id,
      productId: row.barcode_data || `PROD-${row.id}`,
      productImage: row.barcode_path || null,
      productPhoto: row.image || null,
      barcodeImage: row.barcode_path || null,
      brand: row.company_name || row.company || 'Unknown Brand',
      companyName: row.company_name || row.company || 'Unknown Brand',
      model: row.product_name || 'Unknown Model',
      wattage: wattageDisplay,
      quantity: 1,
      warranty: '25 year',
      warrantyStart: installationDate.toISOString().split('T')[0],
      warrantyEnd: warrantyEndDate.toISOString().split('T')[0],
      price: null, // Price not stored in barcodeimage table
      tax: null,
      taxPercent: 18,
    };

    res.json({ product, consumer: consumerDetails });
  } catch (error) {
    console.error('Get product details error:', error);
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined 
    });
  }
});

// Download invoice (simple PDF)
router.get('/products/:productId/invoice', authenticate, async (req, res) => {
  try {
    const ctx = await getAppAccessContext(req);
    const productId = req.params.productId;

    if (!ctx) {
      return res.status(401).json({ message: 'Could not identify user' });
    }

    const { appOwnerId, linkedAuthIds } = ctx;
    let assignIds = [
      ...new Set(
        [appOwnerId, ...linkedAuthIds]
          .map((id) => parseInt(id, 10))
          .filter((n) => !isNaN(n))
      ),
    ];

    const projectIdFromQuery = req.query.projectId ?? req.query.custId ?? null;
    if (projectIdFromQuery) {
      try {
        const custRes = await pool.query(
          `SELECT new_customer_id FROM customer WHERE cust_id = $1 LIMIT 1`,
          [projectIdFromQuery]
        );
        if (custRes.rows.length > 0 && custRes.rows[0].new_customer_id) {
          const ownerId = parseInt(custRes.rows[0].new_customer_id, 10);
          if (!isNaN(ownerId)) {
            assignIds = [ownerId, ...assignIds.filter((id) => id !== ownerId)];
          }
        }
      } catch (e) {
        console.warn('Invoice: could not resolve project owner:', e.message);
      }
    }

    if (assignIds.length === 0) {
      return res.status(401).json({ message: 'Could not identify user' });
    }

    let productQuery = await pool.query(
      `SELECT id, barcode_data, product_name, company, wattage,
              file_saved_at, company_name, assignto_id
       FROM detect_barcodes_barcodeimage
       WHERE (barcode_data = $1 OR id::text = $1)
         AND assignto_id = ANY($2::int[])
       LIMIT 1`,
      [productId, assignIds]
    );

    if (productQuery.rows.length === 0) {
      const globalQuery = await pool.query(
        `SELECT id, barcode_data, product_name, company, wattage,
                file_saved_at, company_name, assignto_id
         FROM detect_barcodes_barcodeimage
         WHERE barcode_data = $1 OR id::text = $1
         LIMIT 1`,
        [productId]
      );
      if (globalQuery.rows.length === 0) {
        return res.status(404).json({ message: 'Product not found' });
      }
      productQuery = globalQuery;
    }

    const row = productQuery.rows[0];
    const brand = row.company_name || row.company || 'Unknown Brand';
    const model = row.product_name || 'Solar Product';
    const barcode = row.barcode_data || `PROD-${row.id}`;
    const wattageRaw = row.wattage != null ? String(row.wattage).trim() : '';
    const wattage =
      wattageRaw && !/wp/i.test(wattageRaw) ? `${wattageRaw} Wp` : wattageRaw || 'N/A';

    const installDate = row.file_saved_at ? new Date(row.file_saved_at) : new Date();
    const warrantyEnd = new Date(installDate);
    warrantyEnd.setFullYear(warrantyEnd.getFullYear() + 25);

    const fmt = (d) =>
      `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

    let consumerName = null;
    if (projectIdFromQuery) {
      try {
        const custRes = await pool.query(
          `SELECT comp_name, first_name, last_name, middle_name, consumer
           FROM customer WHERE cust_id = $1 LIMIT 1`,
          [projectIdFromQuery]
        );
        if (custRes.rows.length > 0) {
          const c = custRes.rows[0];
          consumerName =
            (c.comp_name && String(c.comp_name).trim()) ||
            `${c.first_name || ''} ${c.middle_name || ''} ${c.last_name || ''}`.trim() ||
            (c.consumer != null ? String(c.consumer) : null);
        }
      } catch (e) {
        console.warn('Invoice: could not load consumer:', e.message);
      }
    }

    const invoiceNo = `INV-${barcode}-${Date.now()}`;
    const lines = [
      'DB Solar - Product Invoice',
      '----------------------------------------',
      `Invoice No: ${invoiceNo}`,
      `Date: ${fmt(new Date())}`,
      `Product ID: ${barcode}`,
      `Brand: ${brand}`,
      `Model: ${model}`,
      `Wattage: ${wattage}`,
      `Warranty Start: ${fmt(installDate)}`,
      `Warranty End: ${fmt(warrantyEnd)}`,
    ];
    if (consumerName) {
      lines.push(`Customer: ${consumerName}`);
    }
    lines.push('----------------------------------------');
    lines.push('Thank you for choosing DB Solar.');

    const pdf = buildSimplePdf(lines);
    const safeName = String(barcode).replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice_${safeName}.pdf"`);
    res.setHeader('Content-Length', pdf.length);
    return res.status(200).send(pdf);
  } catch (error) {
    console.error('Download invoice error:', error);
    res.status(500).json({
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

module.exports = router;
