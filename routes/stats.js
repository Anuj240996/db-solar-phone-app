const express = require('express');
const { authenticate } = require('../middleware/auth');
const pool = require('../database/db');

const router = express.Router();

/**
 * Company marketing stats for dashboard "Why Choose Us".
 * Experience years: 20 Yrs in 2026, then +1 each calendar year.
 * Installations: live registered consumer count from `customer`.
 */
router.get('/company', authenticate, async (req, res) => {
  try {
    const baseExperienceYear = 2006; // 2026 => 20 Yrs
    const currentYear = new Date().getFullYear();
    const experienceYears = Math.max(20, currentYear - baseExperienceYear);

    let installationCount = 0;
    try {
      const countRes = await pool.query(
        `SELECT COUNT(*)::int AS n FROM customer`
      );
      installationCount = countRes.rows[0]?.n ?? 0;
    } catch (e) {
      console.warn('stats/company customer count failed:', e.message);
    }

    res.set('Cache-Control', 'private, max-age=60');
    res.json({
      experienceYears,
      installationCount,
      experienceLabel: `${experienceYears} Yrs`,
      installationLabel: `${Number(installationCount).toLocaleString('en-IN')}+`,
    });
  } catch (error) {
    console.error('stats/company error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
