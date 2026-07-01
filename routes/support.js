const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../database/db');
const { authenticate } = require('../middleware/auth');
const { ensureSupportSchema } = require('../utils/ensureSupportSchema');

const router = express.Router();

function resolveSupportUserIds(req) {
  const user = req.user || {};
  let appUserId = null;
  let authUserId = null;

  if (user.auth_source === 'user_app' && user.id != null) {
    const n = parseInt(user.id, 10);
    if (!isNaN(n)) appUserId = n;
  }

  if (user.auth_user_id != null) {
    const n = parseInt(user.auth_user_id, 10);
    if (!isNaN(n)) authUserId = n;
  } else if (user.auth_source === 'auth_user' && user.id != null) {
    const idStr = String(user.id);
    if (/^\d+$/.test(idStr)) {
      const n = parseInt(idStr, 10);
      if (!isNaN(n)) authUserId = n;
    }
  }

  return { appUserId, authUserId };
}

// Submit support query
router.post('/query', authenticate, [
  body('subject').trim().notEmpty().withMessage('Subject is required'),
  body('message').trim().notEmpty().withMessage('Message is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    await ensureSupportSchema();

    const { subject, message } = req.body;
    const { appUserId, authUserId } = resolveSupportUserIds(req);

    const result = await pool.query(
      `INSERT INTO app_support_queries (app_user_id, auth_user_id, subject, message)
       VALUES ($1, $2, $3, $4)
       RETURNING id, subject, message, status, created_at`,
      [appUserId, authUserId, subject, message]
    );

    res.json({
      message: 'Query submitted successfully',
      query: result.rows[0],
    });
  } catch (error) {
    console.error('Submit query error:', error);
    res.status(500).json({
      message: process.env.NODE_ENV === 'development'
        ? (error.message || 'Server error')
        : 'Server error',
    });
  }
});

module.exports = router;
