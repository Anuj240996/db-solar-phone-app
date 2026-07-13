const express = require('express');
const { authenticate } = require('../middleware/auth');
const pool = require('../database/db');

const router = express.Router();

/**
 * Company marketing stats for dashboard "Why Choose Us".
 * Experience years: 20 Yrs in 2026, then +1 each calendar year.
 * Installations: 2000 base + live registered consumer count from `customer`
 *   (e.g. 2000 + 588 = 2588+).
 */
router.get('/company', authenticate, async (req, res) => {
  try {
    const baseExperienceYear = 2006; // 2026 => 20 Yrs
    const installationBase = 2000;
    const currentYear = new Date().getFullYear();
    const experienceYears = Math.max(20, currentYear - baseExperienceYear);

    let registeredConsumers = 0;
    try {
      const countRes = await pool.query(
        `SELECT COUNT(*)::int AS n FROM customer`
      );
      registeredConsumers = countRes.rows[0]?.n ?? 0;
    } catch (e) {
      console.warn('stats/company customer count failed:', e.message);
    }

    const installationCount = installationBase + registeredConsumers;

    res.set('Cache-Control', 'private, max-age=60');
    res.json({
      experienceYears,
      installationBase,
      registeredConsumers,
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
