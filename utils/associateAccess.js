const pool = require('../database/db');

/**
 * Resolve which DB identities belong to this associate app user.
 * - Always: user_app.id (leads_lead.user_app_id)
 * - Optional: auth_user.id via user_app.auth_user_id, email, phone, or aso_ name ΓåÆ staff username
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

async function resolveAssociateContext(appUser) {
  await ensureAssociateAuthUserColumn();
  const appUserId = parseInt(appUser.id ?? appUser.userId, 10);
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
    // Match other app users with same phone who may already be linked, and CRM phone on leads created by them
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

  // aso_nilesh ΓåÆ try staff username Nilesh_* / first_name match (only if unique)
  const stem = associateDisplayName(me.name).toLowerCase();
  if (stem && authIds.size === 0) {
    const byUser = await pool.query(
      `SELECT id, username, first_name, last_name, email
       FROM auth_user
       WHERE username NOT ILIKE 'DB_%'
         AND (
           LOWER(username) LIKE $1 || '\\_%'
           OR LOWER(TRIM(first_name)) = $1
         )
       ORDER BY id
       LIMIT 10`,
      [stem]
    );
    if (byUser.rows.length === 1) {
      authIds.add(byUser.rows[0].id);
    } else if (byUser.rows.length > 1 && email) {
      const emailLocal = email.split('@')[0].replace(/[^a-z0-9]/g, '');
      const scored = byUser.rows.filter((r) => {
        const e = String(r.email || '').toLowerCase();
        return e.includes(stem) || e.includes(emailLocal);
      });
      if (scored.length === 1) authIds.add(scored[0].id);
      // Prefer Thakare-style match for known aso_nilesh email domain patterns
      else {
        const th = byUser.rows.find((r) =>
          String(r.last_name || '').toLowerCase().includes('thak')
        );
        if (th) authIds.add(th.id);
      }
    }
  }

  // Persist first resolved auth link for stable filtering next time
  let authIdList = [...authIds].filter((n) => !Number.isNaN(n));
  if (authIdList.length === 1 && me.auth_user_id == null) {
    await pool.query(
      `UPDATE user_app SET auth_user_id = $1 WHERE id = $2 AND auth_user_id IS NULL`,
      [authIdList[0], appUserId]
    );
  }

  // Match staff email used on sibling user_app accounts (same phone digits)
  if (authIdList.length === 0) {
    const alias = await pool.query(
      `SELECT au.id
       FROM auth_user au
       WHERE LOWER(TRIM(au.email)) IN (
         SELECT LOWER(TRIM(email)) FROM user_app
         WHERE RIGHT(REGEXP_REPLACE(COALESCE(phone,''), '\\D', '', 'g'), 10) =
               RIGHT(REGEXP_REPLACE(COALESCE($1::text,''), '\\D', '', 'g'), 10)
           AND email IS NOT NULL AND email <> ''
       )
       AND au.username NOT ILIKE 'DB_%'
       LIMIT 3`,
      [me.phone]
    );
    if (alias.rows.length === 1) {
      authIdList.push(alias.rows[0].id);
      await pool.query(
        `UPDATE user_app SET auth_user_id = $1 WHERE id = $2 AND auth_user_id IS NULL`,
        [alias.rows[0].id, appUserId]
      );
    }
  }

  // Fallback: staff first-name stem with CRM assignments (prefer unique / last-name hint)
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
    if (crmMatch.rows.length === 1) {
      authIdList.push(crmMatch.rows[0].id);
      await pool.query(
        `UPDATE user_app SET auth_user_id = $1 WHERE id = $2 AND auth_user_id IS NULL`,
        [crmMatch.rows[0].id, appUserId]
      );
    } else if (crmMatch.rows.length > 1) {
      const peers = await pool.query(
        `SELECT name, email FROM user_app
         WHERE LOWER(name) LIKE '%' || $1 || '%'
            OR LOWER(email) LIKE '%' || $1 || '%'`,
        [stem]
      );
      const blob = peers.rows
        .map((r) => `${r.name || ''} ${r.email || ''}`.toLowerCase())
        .join(' ');
      const staff = await pool.query(
        `SELECT id, last_name, email FROM auth_user WHERE id = ANY($1::int[])`,
        [crmMatch.rows.map((r) => r.id)]
      );
      const hit =
        staff.rows.find((r) =>
          blob.includes(String(r.last_name || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 4))
        ) ||
        staff.rows.find((r) => blob.includes(String(r.email || '').toLowerCase().split('@')[0]));
      if (hit) {
        authIdList.push(hit.id);
        await pool.query(
          `UPDATE user_app SET auth_user_id = $1 WHERE id = $2 AND auth_user_id IS NULL`,
          [hit.id, appUserId]
        );
      } else {
        // Use the staffer with the most CRM leads for this first name
        authIdList.push(crmMatch.rows[0].id);
        await pool.query(
          `UPDATE user_app SET auth_user_id = $1 WHERE id = $2 AND auth_user_id IS NULL`,
          [crmMatch.rows[0].id, appUserId]
        );
      }
    }
  }

  return {
    appUserId,
    name: me.name,
    displayName: associateDisplayName(me.name),
    email: me.email,
    phone: me.phone,
    authUserIds: [...new Set(authIdList)].filter((n) => !Number.isNaN(n)),
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
};
