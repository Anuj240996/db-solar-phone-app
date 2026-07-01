const express = require('express');
const { authenticate } = require('../middleware/auth');
const pool = require('../database/db');
const { getAppAccessContext, getProjectOwnerAuthIds } = require('../utils/appAccess');

const router = express.Router();

// Helper function to convert snake_case to camelCase
function toCamelCase(str) {
  return str.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
}

// Helper function to map database row to camelCase JSON
function mapPlantToJson(row) {
  // Handle installation_date - it might be a Date object or a string
  let installationDate = null;
  if (row.installation_date) {
    if (row.installation_date instanceof Date) {
      installationDate = row.installation_date.toISOString().split('T')[0];
    } else if (typeof row.installation_date === 'string') {
      // Already a string, use it directly (PostgreSQL DATE types are returned as strings)
      installationDate = row.installation_date.split('T')[0]; // Remove time if present
    } else {
      // Try to parse if it's some other format
      try {
        installationDate = new Date(row.installation_date).toISOString().split('T')[0];
      } catch (e) {
        installationDate = null;
      }
    }
  }

  return {
    id: row.id ? String(row.id) : null,
    name: row.name || '',
    location: row.location || '',
    capacity: parseFloat(row.capacity || 0),
    status: row.status || 'active',
    installationDate: installationDate,
    dailyGeneration: row.daily_generation != null ? parseFloat(row.daily_generation) : null,
    monthlyGeneration: row.monthly_generation != null ? parseFloat(row.monthly_generation) : null,
    yearlyGeneration: row.yearly_generation != null ? parseFloat(row.yearly_generation) : null,
    lifetimeGeneration: row.lifetime_generation != null ? parseFloat(row.lifetime_generation) : null,
    efficiency: row.efficiency != null ? parseFloat(row.efficiency) : null,
    healthMetrics: row.health_metrics || null,
    growattPlantId: row.growatt_plant_id || null,
  };
}

// Get all plants for authenticated user (linked auth_user ids only for user_app)
router.get('/', authenticate, async (req, res) => {
  try {
    const ctx = await getAppAccessContext(req);
    if (!ctx) {
      return res.json({ plants: [], message: 'Could not identify user' });
    }

    const ownerAuthIds = getProjectOwnerAuthIds(req, ctx);
    if (ownerAuthIds.length === 0) {
      return res.json({ plants: [], message: 'No plants found' });
    }

    console.log('📋 Fetching plants for auth_user ids:', ownerAuthIds);

    const result = await pool.query(
      `SELECT id, name, location, capacity, status, installation_date,
              daily_generation, monthly_generation, yearly_generation,
              lifetime_generation, efficiency, health_metrics, growatt_plant_id
       FROM plants
       WHERE user_id = ANY($1::int[])
       ORDER BY created_at DESC`,
      [ownerAuthIds]
    );

    console.log(`✅ Found ${result.rows.length} plant(s)`);

    res.json({ plants: result.rows.map(mapPlantToJson) });
  } catch (error) {
    console.error('❌ Get plants error:', error.message);
    console.error('Error stack:', error.stack);
    console.error('User object:', JSON.stringify(req.user, null, 2));
    res.status(500).json({ 
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get single plant details
router.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Use auth_user_id if available, otherwise use id (handle conversion)
    let userId = req.user.auth_user_id || req.user.id;
    if (typeof userId === 'string' && !userId.includes('-')) {
      userId = parseInt(userId, 10);
    } else if (userId && typeof userId === 'string' && userId.includes('-')) {
      // UUID case - try auth_user_id
      if (req.user.auth_user_id) {
        userId = req.user.auth_user_id;
      }
    }

    const result = await pool.query(
      `SELECT id, name, location, capacity, status, installation_date,
              daily_generation, monthly_generation, yearly_generation,
              lifetime_generation, efficiency, health_metrics, growatt_plant_id
       FROM plants
       WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Plant not found' });
    }

    res.json({ plant: mapPlantToJson(result.rows[0]) });
  } catch (error) {
    console.error('Get plant error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get generation data for a plant
router.get('/:id/generation', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { period } = req.query; // daily, monthly, yearly

    // Verify plant belongs to user
    const plantCheck = await pool.query(
      'SELECT id FROM plants WHERE id = $1 AND user_id = $2',
      [id, req.user.id]
    );

    if (plantCheck.rows.length === 0) {
      return res.status(404).json({ message: 'Plant not found' });
    }

    let query;
    if (period === 'daily') {
      query = `
        SELECT date, generation
        FROM generation_data
        WHERE plant_id = $1 AND date >= CURRENT_DATE - INTERVAL '30 days'
        ORDER BY date ASC
      `;
    } else if (period === 'monthly') {
      query = `
        SELECT DATE_TRUNC('month', date) as date, SUM(generation) as generation
        FROM generation_data
        WHERE plant_id = $1 AND date >= CURRENT_DATE - INTERVAL '12 months'
        GROUP BY DATE_TRUNC('month', date)
        ORDER BY date ASC
      `;
    } else if (period === 'yearly') {
      query = `
        SELECT DATE_TRUNC('year', date) as date, SUM(generation) as generation
        FROM generation_data
        WHERE plant_id = $1
        GROUP BY DATE_TRUNC('year', date)
        ORDER BY date ASC
      `;
    } else {
      return res.status(400).json({ message: 'Invalid period' });
    }

    const result = await pool.query(query, [id]);

    res.json({
      data: result.rows.map(row => ({
        date: row.date,
        generation: parseFloat(row.generation),
      })),
    });
  } catch (error) {
    console.error('Get generation data error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

