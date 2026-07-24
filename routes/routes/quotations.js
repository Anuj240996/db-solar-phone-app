const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../database/db');

const router = express.Router();

// Create quotation request
router.post('/', [
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('phone').trim().notEmpty().withMessage('Phone is required'),
  body('address').trim().notEmpty().withMessage('Address is required'),
  body('propertyType').trim().notEmpty().withMessage('Property type is required'),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, email, phone, address, propertyType, expectedLoad, notes } = req.body;

    const result = await pool.query(
      `INSERT INTO quotations (name, email, phone, address, property_type, expected_load, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, email, phone, address, property_type, expected_load, notes, status, created_at`,
      [name, email, phone, address, propertyType, expectedLoad || null, notes || null]
    );

    res.status(201).json({
      message: 'Quotation request submitted successfully',
      quotation: result.rows[0],
    });
  } catch (error) {
    console.error('Create quotation error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

