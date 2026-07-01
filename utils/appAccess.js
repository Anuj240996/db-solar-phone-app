const pool = require('../database/db');

/** Integer auth_user id from the current session (never UUID). */
function resolveAuthUserIdFromReq(req) {
  if (req.user?.auth_user_id != null) {
    const n = parseInt(req.user.auth_user_id, 10);
    if (!isNaN(n)) return n;
  }
  if (req.user?.auth_source === 'auth_user' && req.user?.id != null) {
    const idStr = String(req.user.id);
    if (/^\d+$/.test(idStr)) {
      const n = parseInt(idStr, 10);
      if (!isNaN(n)) return n;
    }
  }
  return null;
}

/** Logged-in app user id from user_app (not auth_user). */
function getAppUserId(req) {
  if (req.user?.auth_source === 'user_app' && req.user.id != null) {
    const n = parseInt(req.user.id, 10);
    if (!isNaN(n)) return n;
  }
  // JWT may carry user_app id even when auth_source was not attached
  if (req.user?.jwt_source === 'user_app' && req.user?.jwt_user_id != null) {
    const n = parseInt(req.user.jwt_user_id, 10);
    if (!isNaN(n)) return n;
  }
  return null;
}

function getAppOwnerId(req) {
  const appUserId = getAppUserId(req);
  if (appUserId != null) return appUserId;
  const authUserId = resolveAuthUserIdFromReq(req);
  if (authUserId != null) return authUserId;
  return null;
}

/**
 * Returns whether auth_user is already linked in app_auth_links.
 * @returns {'own'|'other'|null} null when no link exists for this auth_user_id
 */
async function checkAppAuthLinkConflict(appUserId, authUserId) {
  const appId = parseInt(appUserId, 10);
  const authId = parseInt(authUserId, 10);
  if (isNaN(appId) || isNaN(authId)) return null;

  try {
    const res = await pool.query(
      `SELECT app_user_id FROM app_auth_links WHERE auth_user_id = $1 LIMIT 1`,
      [authId]
    );
    if (!res.rows.length) return null;
    const existingAppUserId = parseInt(res.rows[0].app_user_id, 10);
    if (isNaN(existingAppUserId)) return null;
    return existingAppUserId === appId ? 'own' : 'other';
  } catch (e) {
    console.warn('checkAppAuthLinkConflict failed:', e.message);
    return null;
  }
}

const APP_AUTH_LINK_MESSAGES = {
  own: 'Already add this project',
  other: 'Already add this project in other Consumer',
};

async function getLinkedAuthIds(appOwnerId) {
  const appId = parseInt(appOwnerId, 10);
  if (isNaN(appId)) return [];
  try {
    const linkRows = await pool.query(
      `SELECT auth_user_id FROM app_auth_links WHERE app_user_id = $1`,
      [appId]
    );
    return linkRows.rows
      .map((r) => parseInt(r.auth_user_id, 10))
      .filter((n) => !isNaN(n));
  } catch (e) {
    console.warn('getLinkedAuthIds failed:', e.message);
    return [];
  }
}

/**
 * Collect linked auth_user ids using every plausible app_user_id for this session.
 * Fixes false-empty lists when links were stored under auth_user id but lookup used
 * a different user_app id resolved by email (or vice versa).
 */
async function getLinkedAuthIdsForSession(req, appUserId, appOwnerId) {
  const keys = new Set();
  const appN = appUserId != null ? parseInt(appUserId, 10) : NaN;
  const ownerN = appOwnerId != null ? parseInt(appOwnerId, 10) : NaN;
  if (!isNaN(appN)) keys.add(appN);
  if (!isNaN(ownerN)) keys.add(ownerN);

  if (keys.size === 0) {
    const resolved = await resolveAppUserId(req);
    if (resolved != null) keys.add(resolved);
  }

  const merged = new Set();
  for (const key of keys) {
    for (const authId of await getLinkedAuthIds(key)) {
      merged.add(authId);
    }
  }
  return [...merged];
}

/** Stable id used when writing/reading app_auth_links for the current session. */
async function resolveLinkAppUserId(req) {
  const fromApp = getAppUserId(req);
  if (fromApp != null) return fromApp;

  if (req.user?.jwt_source === 'user_app' && req.user?.jwt_user_id != null) {
    const n = parseInt(req.user.jwt_user_id, 10);
    if (!isNaN(n)) return n;
  }

  const appOwnerId = getAppOwnerId(req);
  if (appOwnerId != null) {
    const n = parseInt(appOwnerId, 10);
    if (!isNaN(n)) return n;
  }

  const resolved = await resolveAppUserId(req);
  if (resolved != null) return resolved;

  return null;
}

function isUserAppSession(req) {
  return (
    req.user?.auth_source === 'user_app' || req.user?.jwt_source === 'user_app'
  );
}

/**
 * Load customer rows for the project list using app_auth_links JOIN (most reliable).
 */
async function queryLinkedCustomersForAppUser(linkAppUserId) {
  const appId = parseInt(linkAppUserId, 10);
  if (isNaN(appId)) return [];

  try {
    const res = await pool.query(
      `SELECT DISTINCT c.cust_id, c.consumer, c.first_name, c.last_name, c.middle_name,
              c.email, c.phone, c.address, c.city, c.state, c.comp_name, c.new_customer_id,
              c.plant_capacity, c.qunt_solar
       FROM customer c
       INNER JOIN app_auth_links l
         ON l.auth_user_id::bigint = c.new_customer_id::bigint
       WHERE l.app_user_id = $1
       ORDER BY c.cust_id DESC`,
      [appId]
    );
    return res.rows;
  } catch (e) {
    console.warn('queryLinkedCustomersForAppUser failed:', e.message);
    return null;
  }
}

async function getAppAccessContext(req) {
  const appUserId = getAppUserId(req);
  const appOwnerId = getAppOwnerId(req);
  if (!appOwnerId) return null;

  const linkedAuthIds = await getLinkedAuthIdsForSession(req, appUserId, appOwnerId);
  return { appUserId, appOwnerId, linkedAuthIds };
}

/** Resolve user_app.id for the logged-in session. */
async function resolveAppUserId(req) {
  const direct = getAppUserId(req);
  if (direct != null) return direct;

  // JWT was issued for user_app (handles id collision with auth_user in middleware)
  if (req.user?.jwt_source === 'user_app' && req.user?.jwt_user_id != null) {
    const n = parseInt(req.user.jwt_user_id, 10);
    if (!isNaN(n)) {
      try {
        const check = await pool.query('SELECT id FROM user_app WHERE id = $1 LIMIT 1', [n]);
        if (check.rows.length > 0) return n;
      } catch (_) { /* ignore */ }
    }
  }

  const authUserId = resolveAuthUserIdFromReq(req);

  if (authUserId != null) {
    try {
      const linkRes = await pool.query(
        `SELECT app_user_id FROM app_auth_links WHERE auth_user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [authUserId]
      );
      if (linkRes.rows.length > 0) {
        const n = parseInt(linkRes.rows[0].app_user_id, 10);
        if (!isNaN(n)) return n;
      }
    } catch (e) {
      console.warn('resolveAppUserId app_auth_links lookup failed:', e.message);
    }

    // App owner: auth_user id matches app_user_id that has linked consumers (e.g. auth_user 2 → user_app 2)
    try {
      const ownerLink = await pool.query(
        `SELECT l.app_user_id
         FROM app_auth_links l
         INNER JOIN user_app ua ON ua.id = l.app_user_id
         WHERE l.app_user_id = $1
         LIMIT 1`,
        [authUserId]
      );
      if (ownerLink.rows.length > 0) {
        const n = parseInt(ownerLink.rows[0].app_user_id, 10);
        if (!isNaN(n)) return n;
      }
    } catch (e) {
      console.warn('resolveAppUserId app owner lookup failed:', e.message);
    }
  }

  const emails = [
    req.user?.email,
    req.user?.jwt_email,
    req.user?.username,
  ].filter((v) => v && String(v).trim());

  for (const raw of emails) {
    const email = String(raw).trim();
    try {
      const res = await pool.query(
        `SELECT id FROM user_app WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) LIMIT 1`,
        [email]
      );
      if (res.rows.length > 0) {
        const n = parseInt(res.rows[0].id, 10);
        if (!isNaN(n)) return n;
      }
    } catch (e) {
      console.warn('resolveAppUserId email lookup failed:', e.message);
    }
  }

  return null;
}

/** user_app id that manages a consumer (from app_auth_links). */
async function resolveAppUserIdForConsumerAuth(consumerAuthUserId) {
  if (consumerAuthUserId == null || isNaN(consumerAuthUserId)) return null;
  try {
    const res = await pool.query(
      `SELECT app_user_id FROM app_auth_links WHERE auth_user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [consumerAuthUserId]
    );
    if (res.rows.length > 0) {
      const n = parseInt(res.rows[0].app_user_id, 10);
      if (!isNaN(n)) return n;
    }
  } catch (e) {
    console.warn('resolveAppUserIdForConsumerAuth failed:', e.message);
  }
  return null;
}

/**
 * auth_user ids whose customer rows appear on this user's project list.
 * user_app: only via app_auth_links (QR / verify) — never match user_app.id to new_customer_id.
 * auth_user login: that user's id plus any linked ids.
 */
function getProjectOwnerAuthIds(req, ctx) {
  const { appOwnerId, linkedAuthIds } = ctx;
  const isUserApp = isUserAppSession(req);

  const linked = linkedAuthIds
    .map((id) => parseInt(id, 10))
    .filter((n) => !isNaN(n));

  if (isUserApp) {
    return linked;
  }

  const authUserId = resolveAuthUserIdFromReq(req);
  const ownId =
    authUserId != null
      ? authUserId
      : parseInt(appOwnerId, 10);
  const ids = new Set([
    ...( !isNaN(ownId) ? [ownId] : []),
    ...linked,
  ]);
  return [...ids];
}

/** True when cust_id belongs to an auth_user linked to this user_app session. */
async function isCustomerLinkedToAppUser(linkAppUserId, custId) {
  const appId = parseInt(linkAppUserId, 10);
  const cust = parseInt(custId, 10);
  if (isNaN(appId) || isNaN(cust)) return false;
  try {
    const res = await pool.query(
      `SELECT 1
       FROM customer c
       INNER JOIN app_auth_links l
         ON l.auth_user_id::bigint = c.new_customer_id::bigint
       WHERE l.app_user_id = $1 AND c.cust_id = $2
       LIMIT 1`,
      [appId, cust]
    );
    return res.rows.length > 0;
  } catch (e) {
    console.warn('isCustomerLinkedToAppUser failed:', e.message);
    return false;
  }
}

async function loadCustomerForApp(custId, appOwnerId, linkedAuthIds, req = null, ctx = null) {
  let ownerIds;
  if (req && ctx) {
    ownerIds = getProjectOwnerAuthIds(req, ctx);
  } else {
    ownerIds = [
      parseInt(appOwnerId, 10),
      ...linkedAuthIds.map((id) => parseInt(id, 10)),
    ].filter((n) => !isNaN(n));
  }
  if (!ownerIds.length) return null;

  const res = await pool.query(
    `SELECT cust_id, comp_name, first_name, last_name, consumer, phone, city, new_customer_id
     FROM customer
     WHERE cust_id = $1
       AND new_customer_id::bigint = ANY($2::bigint[])
     LIMIT 1`,
    [custId, ownerIds]
  );
  return res.rows[0] || null;
}

async function resolveAuthUserIdFromCustId(custId, appOwnerId, linkedAuthIds, req = null, ctx = null) {
  if (req && ctx) {
    const rows = await loadProjectCustomersForSession(req, ctx);
    const custN = parseInt(custId, 10);
    const match = rows.find((row) => parseInt(row.cust_id, 10) === custN);
    if (match?.new_customer_id != null) {
      const n = parseInt(match.new_customer_id, 10);
      if (!isNaN(n)) return n;
    }
  }
  const c = await loadCustomerForApp(custId, appOwnerId, linkedAuthIds, req, ctx);
  if (!c || c.new_customer_id == null) return null;
  const n = parseInt(c.new_customer_id, 10);
  return !isNaN(n) ? n : null;
}

function mapCustomerRowToFields(c) {
  const authUserId = c.new_customer_id != null ? parseInt(c.new_customer_id, 10) : null;
  if (!authUserId || isNaN(authUserId)) {
    throw new Error('Consumer has no linked auth_user account');
  }
  return {
    fullName:
      c.comp_name ||
      `${c.first_name || ''} ${c.last_name || ''}`.trim() ||
      (c.consumer ? `AF#${c.consumer}` : ''),
    mobileNumber: c.phone?.toString() || '',
    location: c.city || '',
    authUserId,
    custId: c.cust_id != null ? parseInt(c.cust_id, 10) : null,
  };
}

/** Same customer rows as GET /api/projects (dropdown list). */
async function loadProjectCustomersForSession(req, ctx) {
  const linkAppUserId = await resolveLinkAppUserId(req);
  let customerRows = [];

  if (isUserAppSession(req) && linkAppUserId) {
    const joined = await queryLinkedCustomersForAppUser(linkAppUserId);
    if (joined?.length) customerRows = joined;
  }

  if (!customerRows.length) {
    const ownerAuthIds = getProjectOwnerAuthIds(req, ctx);
    if (ownerAuthIds.length) {
      const { queryCustomersByOwnerAuthIds } = require('./projectBuilders');
      customerRows = await queryCustomersByOwnerAuthIds(ownerAuthIds);
    }
  }

  return customerRows;
}

async function resolveCustomerFields(appOwnerId, linkedAuthIds, custId, req = null, ctx = null) {
  if (!custId) {
    throw new Error('Please select a consumer');
  }
  const custN = parseInt(custId, 10);
  if (isNaN(custN)) {
    throw new Error('Invalid consumer');
  }

  let c = null;

  // Prefer the exact same project list the app shows in the consumer dropdown.
  if (req && ctx) {
    const projectRows = await loadProjectCustomersForSession(req, ctx);
    c = projectRows.find((row) => parseInt(row.cust_id, 10) === custN) || null;
  }

  if (!c) {
    c = await loadCustomerForApp(custId, appOwnerId, linkedAuthIds, req, ctx);
  }

  if (!c && req && ctx) {
    const linkAppUserId = await resolveLinkAppUserId(req);
    if (isUserAppSession(req) && linkAppUserId) {
      if (await isCustomerLinkedToAppUser(linkAppUserId, custN)) {
        const row = await pool.query(
          `SELECT cust_id, comp_name, first_name, last_name, consumer, phone, city, new_customer_id
           FROM customer WHERE cust_id = $1 LIMIT 1`,
          [custN]
        );
        c = row.rows[0] || null;
      }
    }
  }

  if (!c) {
    throw new Error('Consumer not linked to your app account');
  }
  return mapCustomerRowToFields(c);
}

/** Same project/customer resolution as GET /api/projects — used when cust_id is omitted. */
async function resolveDefaultCustomerFields(req, ctx) {
  const customerRows = await loadProjectCustomersForSession(req, ctx);

  if (!customerRows.length) {
    throw new Error('Customer data not found');
  }

  return mapCustomerRowToFields(customerRows[0]);
}

module.exports = {
  getAppUserId,
  getAppOwnerId,
  getProjectOwnerAuthIds,
  checkAppAuthLinkConflict,
  APP_AUTH_LINK_MESSAGES,
  getLinkedAuthIds,
  getLinkedAuthIdsForSession,
  resolveLinkAppUserId,
  isUserAppSession,
  queryLinkedCustomersForAppUser,
  getAppAccessContext,
  resolveAppUserId,
  resolveAppUserIdForConsumerAuth,
  resolveAuthUserIdFromReq,
  loadCustomerForApp,
  resolveAuthUserIdFromCustId,
  loadProjectCustomersForSession,
  resolveCustomerFields,
  resolveDefaultCustomerFields,
  mapCustomerRowToFields,
  isCustomerLinkedToAppUser,
};
