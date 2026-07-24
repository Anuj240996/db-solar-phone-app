const express = require('express');
const { authenticate } = require('../middleware/auth');
const pool = require('../database/db');
const { getAppAccessContext, getProjectOwnerAuthIds } = require('../utils/appAccess');

const router = express.Router();

// GET /api/notifications - from dashboard_staff_notification
// Filter by auth_user ids that own the projects shown on the project list.
router.get('/', authenticate, async (req, res) => {
  try {
    const ctx = await getAppAccessContext(req);
    if (!ctx) {
      return res.json({ notifications: [] });
    }

    const authUserIds = getProjectOwnerAuthIds(req, ctx);

    let result;
    if (authUserIds.length === 0) {
      result = { rows: [] };
    } else {
      result = await pool.query(
        `SELECT id, message, created_at, staff_id_id, status, "read" AS read_flag, is_current, sender_id
         FROM dashboard_staff_notification
         WHERE staff_id_id = ANY($1)
         ORDER BY created_at DESC
         LIMIT 100`,
        [authUserIds]
      );
    }

    const notifications = (result.rows || []).map((row) => ({
      id: row.id,
      message: row.message || '',
      created_at: row.created_at,
      staff_id: row.staff_id_id,
      status: row.status,
      read: row.read_flag === true || row.read_flag === 1 || (typeof row.read_flag === 'string' && row.read_flag !== '0'),
      is_current: row.is_current === true || row.is_current === 1 || (typeof row.is_current === 'string' && row.is_current !== '0'),
      sender_id: row.sender_id,
    }));

    res.json({ notifications });
  } catch (err) {
    console.error('Notifications list error:', err.message);
    res.status(500).json({ message: 'Failed to load notifications', error: process.env.NODE_ENV === 'development' ? err.message : undefined });
  }
});

module.exports = router;
