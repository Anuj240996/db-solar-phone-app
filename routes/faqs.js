const express = require('express');
const pool = require('../database/db');

const router = express.Router();

// Get all FAQs
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, question, answer, category, order_index, created_at
       FROM faqs
       ORDER BY order_index ASC, created_at DESC`
    );

    // Map database fields to camelCase for frontend
    const faqs = result.rows.map(row => ({
      id: row.id?.toString() || '',
      question: row.question || '',
      answer: row.answer || '',
      category: row.category || '',
      order: row.order_index || null,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    }));

    res.json({ faqs: faqs });
  } catch (error) {
    console.error('Get FAQs error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Search FAQs
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;

    if (!q) {
      return res.status(400).json({ message: 'Search query is required' });
    }

    const result = await pool.query(
      `SELECT id, question, answer, category, order_index, created_at
       FROM faqs
       WHERE question ILIKE $1 OR answer ILIKE $1
       ORDER BY order_index ASC`,
      [`%${q}%`]
    );

    // Map database fields to camelCase for frontend
    const faqs = result.rows.map(row => ({
      id: row.id?.toString() || '',
      question: row.question || '',
      answer: row.answer || '',
      category: row.category || '',
      order: row.order_index || null,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    }));

    res.json({ faqs: faqs });
  } catch (error) {
    console.error('Search FAQs error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

