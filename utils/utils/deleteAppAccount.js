const pool = require('../database/db');

/**
 * Permanently delete a user_app mobile account and unlink web customer link/Doc fields.
 * @returns {{ success: true, deletedUserId: number, unlinkedCustomers: number } | { errorStatus: number, message: string }}
 */
async function deleteAppAccountById(appUserId, { reason = '', feedback = '' } = {}) {
  const id = parseInt(appUserId, 10);
  if (Number.isNaN(id)) {
    return { errorStatus: 400, message: 'Invalid user id' };
  }

  const client = await pool.connect();
  try {
    const userRes = await client.query(
      `SELECT id, name, email, phone FROM user_app WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (!userRes.rows.length) {
      return { errorStatus: 404, message: 'User not found' };
    }
    const appUser = userRes.rows[0];

    await client.query('BEGIN');

    await client.query(`
      CREATE TABLE IF NOT EXISTS account_deletion_log (
        id SERIAL PRIMARY KEY,
        user_app_id INTEGER,
        email TEXT,
        phone TEXT,
        name TEXT,
        reason TEXT,
        feedback TEXT,
        cleared_customer_ids INTEGER[] DEFAULT '{}',
        deleted_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    const custRes = await client.query(
      `SELECT cust_id FROM customer WHERE new_customer_id = $1`,
      [id]
    );
    const clearedIds = custRes.rows
      .map((r) => parseInt(r.cust_id, 10))
      .filter((n) => !Number.isNaN(n));

    if (clearedIds.length) {
      await client.query(
        `UPDATE customer
         SET new_customer_id = NULL,
             mobile_app_password = NULL,
             mobile_app_linked_at = NULL,
             mobile_app_linked_username = NULL
         WHERE new_customer_id = $1`,
        [id]
      );
    }

    await client.query(`DELETE FROM app_auth_links WHERE app_user_id = $1`, [id]).catch(() => {});
    await client
      .query(`UPDATE leads_lead SET user_app_id = NULL WHERE user_app_id = $1`, [id])
      .catch(() => {});

    await client.query(
      `INSERT INTO account_deletion_log
         (user_app_id, email, phone, name, reason, feedback, cleared_customer_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        appUser.email || null,
        appUser.phone != null ? String(appUser.phone) : null,
        appUser.name || null,
        reason || null,
        feedback || null,
        clearedIds,
      ]
    );

    await client.query(`DELETE FROM user_app WHERE id = $1`, [id]);
    await client.query('COMMIT');

    return {
      success: true,
      deletedUserId: id,
      unlinkedCustomers: clearedIds.length,
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    console.error('deleteAppAccountById error:', error);
    return {
      errorStatus: 500,
      message: error.message || 'Failed to delete account',
    };
  } finally {
    client.release();
  }
}

function resolveUserAppIdFromReq(req) {
  const user = req.user || {};
  if (user.auth_source === 'user_app' && user.id != null) {
    return parseInt(user.id, 10);
  }
  if (user.jwt_source === 'user_app' && user.jwt_user_id != null) {
    return parseInt(user.jwt_user_id, 10);
  }
  return NaN;
}

async function handleDeleteAccountRequest(req, res) {
  const appUserId = resolveUserAppIdFromReq(req);
  if (Number.isNaN(appUserId)) {
    return res.status(403).json({
      message:
        'Only consumer mobile app accounts can be deleted here. Staff/associate accounts cannot use this action.',
    });
  }

  const reason = req.body?.reason != null ? String(req.body.reason).trim() : '';
  const feedback = req.body?.feedback != null ? String(req.body.feedback).trim() : '';
  const confirmed = req.body?.confirmed === true || req.body?.confirmed === 'true';
  if (!confirmed) {
    return res.status(400).json({
      message: 'Please confirm account deletion before continuing.',
    });
  }

  const result = await deleteAppAccountById(appUserId, { reason, feedback });
  if (result.errorStatus) {
    return res.status(result.errorStatus).json({ message: result.message });
  }

  return res.json({
    success: true,
    message: 'Your DB Solar mobile account has been permanently deleted.',
    data: {
      deletedUserId: result.deletedUserId,
      unlinkedCustomers: result.unlinkedCustomers,
    },
  });
}

module.exports = {
  deleteAppAccountById,
  handleDeleteAccountRequest,
  resolveUserAppIdFromReq,
};
