const pool = require('../database/db');

const DEFAULT_FAQS = [
  {
    question: 'How do I monitor my solar plant performance?',
    answer:
      'Open the Dashboard to see daily, monthly, and yearly generation along with system health metrics for your linked plants.',
    category: 'General',
    order_index: 1,
  },
  {
    question: 'What should I do if my plant is not generating power?',
    answer:
      'Check plant status on the Dashboard. If generation is still zero, raise a complaint from Raise Ticket or contact Support from FAQ & Support.',
    category: 'Technical',
    order_index: 2,
  },
  {
    question: 'How can I track installation progress?',
    answer:
      'Open My Projects, select your project, then open Details / E-Care to see Solar Panel, Inverter, Net Meter, MSEB, and Release & Agreement progress.',
    category: 'Installation',
    order_index: 3,
  },
  {
    question: 'How do I request maintenance or service?',
    answer:
      'Use Services to create a service request, or Raise Ticket for complaints. Our team will follow up with status updates in the app.',
    category: 'Maintenance',
    order_index: 4,
  },
  {
    question: 'Where can I view Release and Agreement PDFs?',
    answer:
      'For completed projects, open project Details and tap Release & Agreement below MSEB. Only uploaded documents for your consumer are shown.',
    category: 'Documents',
    order_index: 5,
  },
  {
    question: 'How do I get a quotation or finance options?',
    answer:
      'Use Get Quote from the app. Fill project, technical, and finance details. Our team will contact you. 100% finance options may be available.',
    category: 'Sales',
    order_index: 6,
  },
];

/**
 * Ensure default FAQs exist (inserts any missing by question).
 * Removes previously seeded solar Troubleshooting FAQs if present.
 */
async function ensureFaqsSeeded() {
  try {
    await pool.query(
      `DELETE FROM faqs WHERE LOWER(TRIM(category)) = 'troubleshooting'`
    );

    let inserted = 0;
    for (const faq of DEFAULT_FAQS) {
      const existing = await pool.query(
        `SELECT id FROM faqs WHERE LOWER(TRIM(question)) = LOWER(TRIM($1)) LIMIT 1`,
        [faq.question]
      );
      if (existing.rows.length > 0) continue;
      await pool.query(
        `INSERT INTO faqs (question, answer, category, order_index)
         VALUES ($1, $2, $3, $4)`,
        [faq.question, faq.answer, faq.category, faq.order_index]
      );
      inserted += 1;
    }
    const countRes = await pool.query(`SELECT COUNT(*)::int AS n FROM faqs`);
    return { seeded: inserted > 0, inserted, count: countRes.rows[0]?.n || 0 };
  } catch (e) {
    console.warn('ensureFaqsSeeded failed:', e.message);
    return { seeded: false, count: 0, error: e.message };
  }
}

module.exports = { ensureFaqsSeeded, DEFAULT_FAQS };
