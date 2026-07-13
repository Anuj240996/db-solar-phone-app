const express = require('express');
const pool = require('../database/db');
const { ensureFaqsSeeded } = require('../utils/ensureFaqsSeeded');

const router = express.Router();

function mapFaqRows(rows) {
  return rows.map((row) => ({
    id: row.id?.toString() || '',
    question: row.question || '',
    answer: row.answer || '',
    category: row.category || '',
    order: row.order_index || null,
    createdAt: row.created_at
      ? new Date(row.created_at).toISOString()
      : new Date().toISOString(),
  }));
}

// Get all FAQs (auto-seeds defaults when empty)
router.get('/', async (req, res) => {
  try {
    await ensureFaqsSeeded();

    const result = await pool.query(
      `SELECT id, question, answer, category, order_index, created_at
       FROM faqs
       ORDER BY order_index ASC NULLS LAST, created_at DESC`
    );

    res.json({ faqs: mapFaqRows(result.rows) });
  } catch (error) {
    console.error('Get FAQs error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Search FAQs
router.get('/search', async (req, res) => {
  try {
    await ensureFaqsSeeded();
    const { q } = req.query;

    if (!q) {
      return res.status(400).json({ message: 'Search query is required' });
    }

    const result = await pool.query(
      `SELECT id, question, answer, category, order_index, created_at
       FROM faqs
       WHERE question ILIKE $1 OR answer ILIKE $1
       ORDER BY order_index ASC NULLS LAST`,
      [`%${q}%`]
    );

    res.json({ faqs: mapFaqRows(result.rows) });
  } catch (error) {
    console.error('Search FAQs error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
