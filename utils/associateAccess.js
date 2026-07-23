const pool = require('../database/db');

/**
 * Resolve associate identity for dashboard/projects/tasks.
 * Prefer auth_user staff session (login against auth_user).
 * Fallback: user_app linked via auth_user_id / email / name heuristics.
 */
async function ensureAssociateAuthUserColumn() {
  await pool.query(
    `ALTER TABLE user_app ADD COLUMN IF NOT EXISTS auth_user_id INTEGER`
  );
}

function digits(v) {
  return String(v || '').replace(/\D/g, '');
}

function associateDisplayName(name) {
  const n = String(name || '').trim();
  if (n.toLowerCase().startsWith('aso_')) return n.slice(4).trim() || n;
  return n;
}

function bitFlagTrue(value) {
  if (value === true || value === 1) return true;
  const s = String(value ?? '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 't' || s === 'yes';
}

async function resolveAssociateContext(reqUser) {
  await ensureAssociateAuthUserColumn();

  const source = String(reqUser.auth_source || reqUser.jwt_source || '').toLowerCase();
  const jwtRole = String(reqUser.role || reqUser.jwt_role || '').toLowerCase();
  const rawId = reqUser.auth_user_id ?? reqUser.id ?? reqUser.userId ?? reqUser.jwt_user_id;
  const parsedId = parseInt(rawId, 10);

  // Primary path: logged in as auth_user staff
  if (source === 'auth_user' && !Number.isNaN(parsedId)) {
    const au = await pool.query(
      `SELECT id, username, first_name, last_name, email, is_staff
       FROM auth_user WHERE id = $1 LIMIT 1`,
      [parsedId]
    );
    const row = au.rows[0];
    if (!row) throw new Error('Associate auth_user not found');

    const displayName =
      [row.first_name, row.last_name].filter(Boolean).join(' ').trim() ||
      row.username ||
      'Associate';

    // Optional linked app leads created under a user_app row
    const linkedApp = await pool.query(
      `SELECT id FROM user_app WHERE auth_user_id = $1 ORDER BY id LIMIT 5`,
      [parsedId]
    );
    const appUserId =
      linkedApp.rows[0]?.id != null ? parseInt(linkedApp.rows[0].id, 10) : null;

    return {
      appUserId: Number.isNaN(appUserId) ? null : appUserId,
      name: displayName,
      displayName,
      email: row.email,
      phone: null,
      authUserIds: [parsedId],
      authSource: 'auth_user',
    };
  }

  // Legacy / fallback: user_app associate session
  const appUserId = parseInt(reqUser.id ?? reqUser.userId, 10);
  if (!appUserId || Number.isNaN(appUserId)) {
    throw new Error('Invalid associate user');
  }

  const meRes = await pool.query(
    `SELECT id, name, email, phone, role, auth_user_id
     FROM user_app WHERE id = $1`,
    [appUserId]
  );
  const me = meRes.rows[0];
  if (!me) throw new Error('Associate user not found');

  const authIds = new Set();
  if (me.auth_user_id != null) {
    authIds.add(parseInt(me.auth_user_id, 10));
  }

  const email = String(me.email || '').trim().toLowerCase();
  if (email && email.includes('@')) {
    const byEmail = await pool.query(
      `SELECT id FROM auth_user WHERE LOWER(TRIM(email)) = $1 LIMIT 5`,
      [email]
    );
    byEmail.rows.forEach((r) => authIds.add(r.id));
  }

  const phoneDigits = digits(me.phone);
  if (phoneDigits.length >= 10) {
    const phoneTail = phoneDigits.slice(-10);
    const peer = await pool.query(
      `SELECT auth_user_id FROM user_app
       WHERE auth_user_id IS NOT NULL
         AND RIGHT(REGEXP_REPLACE(COALESCE(phone,''), '\\D', '', 'g'), 10) = $1`,
      [phoneTail]
    );
    peer.rows.forEach((r) => {
      if (r.auth_user_id) authIds.add(parseInt(r.auth_user_id, 10));
    });
  }

  const stem = associateDisplayName(me.name).toLowerCase();
  let authIdList = [...authIds].filter((n) => !Number.isNaN(n));

  if (authIdList.length === 0 && stem) {
    const crmMatch = await pool.query(
      `SELECT au.id, COUNT(l.id)::int AS leads
       FROM auth_user au
       INNER JOIN crm_leads_lead l ON l.assigned_to_id = au.id
       WHERE au.username NOT ILIKE 'DB_%'
         AND LOWER(TRIM(au.first_name)) = $1
       GROUP BY au.id
       ORDER BY leads DESC
       LIMIT 5`,
      [stem]
    );
    if (crmMatch.rows.length >= 1) {
      authIdList.push(crmMatch.rows[0].id);
      await pool.query(
        `UPDATE user_app SET auth_user_id = $1 WHERE id = $2 AND auth_user_id IS NULL`,
        [crmMatch.rows[0].id, appUserId]
      );
    }
  }

  if (authIdList.length === 1 && me.auth_user_id == null) {
    await pool.query(
      `UPDATE user_app SET auth_user_id = $1 WHERE id = $2 AND auth_user_id IS NULL`,
      [authIdList[0], appUserId]
    );
  }

  return {
    appUserId,
    name: me.name,
    displayName: associateDisplayName(me.name),
    email: me.email,
    phone: me.phone,
    authUserIds: [...new Set(authIdList)].filter((n) => !Number.isNaN(n)),
    authSource: 'user_app',
    jwtRole,
  };
}

function mapCrmStageToPipeline(stage) {
  const s = String(stage || '').toLowerCase();
  if (['new', 'contacted', 'qualified', 'new_app', 'new_enq'].some((x) => s.includes(x))) {
    return 'Lead';
  }
  if (['survey', 'site', 'visit'].some((x) => s.includes(x))) return 'Site Survey';
  if (['quote', 'quot', 'negotiat'].some((x) => s.includes(x))) return 'Quotation';
  if (['approv', 'token', 'agreement'].some((x) => s.includes(x))) return 'Approval';
  if (['install'].some((x) => s.includes(x))) return 'Installation';
  if (['won', 'deploy', 'complete', 'live'].some((x) => s.includes(x))) return 'Deployed';
  return 'Lead';
}

function mapQuoteStatusToPipeline(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'converted' || s === 'won') return 'Deployed';
  if (s.includes('approv')) return 'Approval';
  if (['sent', 'draft', 'revised', 'customer'].some((x) => s.includes(x))) return 'Quotation';
  return 'Quotation';
}

function progressForStage(stage) {
  switch (stage) {
    case 'Lead':
      return 0.1;
    case 'Site Survey':
      return 0.25;
    case 'Quotation':
      return 0.4;
    case 'Approval':
      return 0.55;
    case 'Installation':
      return 0.7;
    case 'Deployed':
      return 1.0;
    default:
      return 0.15;
  }
}

module.exports = {
  ensureAssociateAuthUserColumn,
  resolveAssociateContext,
  mapCrmStageToPipeline,
  mapQuoteStatusToPipeline,
  progressForStage,
  associateDisplayName,
  bitFlagTrue,
};
