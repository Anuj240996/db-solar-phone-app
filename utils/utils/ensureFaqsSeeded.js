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
  // Troubleshooting — solar system
  {
    question: 'Why is my solar generation lower than usual?',
    answer:
      'Common causes: cloudy weather, dust/dirt on panels, partial shading from trees or buildings, inverter derating in high heat, or a tripped AC/DC breaker. Clean panels safely, remove shade if possible, and check inverter status lights. If generation stays low for several sunny days, raise a ticket.',
    category: 'Troubleshooting',
    order_index: 10,
  },
  {
    question: 'Inverter shows fault / error / red light — what should I do?',
    answer:
      'Note the fault code on the inverter display (or Growatt/app status). Check that AC and DC isolators are ON, grid supply is available, and no wire is loose. Do not open the inverter yourself. Power-cycle only if the manufacturer guide allows it. Raise a ticket with the fault code and a photo of the display.',
    category: 'Troubleshooting',
    order_index: 11,
  },
  {
    question: 'Zero generation but inverter is ON — how to troubleshoot?',
    answer:
      '1) Confirm daytime and clear sky. 2) Check DC isolator and string fuses. 3) Check AC MCB/RCCB in the distribution board. 4) Confirm net meter / grid is live. 5) Look for inverter isolation or grid-loss alarms. If still zero, create a service request from Services with plant name and photos.',
    category: 'Troubleshooting',
    order_index: 12,
  },
  {
    question: 'My electricity bill did not reduce after solar — why?',
    answer:
      'Bill may stay high if: net metering is not activated, export readings are wrong, plant capacity is smaller than consumption, heavy night-time load, or MSEB billing cycle delay. Verify net meter status in project Details (MSEB / Net Meter). Share last 2 bills and plant capacity with Support for review.',
    category: 'Troubleshooting',
    order_index: 13,
  },
  {
    question: 'Net meter or bidirectional meter reading looks wrong',
    answer:
      'Compare import/export units on the meter with the app or bill. If readings jump unusually, note meter serial number and take a clear photo of the display. Contact Support or raise a ticket — do not open or tamper with the sealed meter.',
    category: 'Troubleshooting',
    order_index: 14,
  },
  {
    question: 'App plant data is not updating / shows offline',
    answer:
      'Check phone internet, pull to refresh Dashboard, and confirm the plant is linked under My Projects. For Growatt-linked plants, verify plant credentials and Wi-Fi/dongle status at site. If the physical plant is generating but the app is stale, raise a Support query with plant name and last update time.',
    category: 'Troubleshooting',
    order_index: 15,
  },
  {
    question: 'Panels are dirty or covered — cleaning tips',
    answer:
      'Clean early morning or evening with soft water and a non-abrasive cloth/mop. Avoid harsh chemicals and standing on fragile roofs. Never clean during peak heat or when the system is unsafe to access. For height/roof risk, request a paid cleaning service via Services.',
    category: 'Troubleshooting',
    order_index: 16,
  },
  {
    question: 'Strange noise, smell, or sparking near inverter / ACDB',
    answer:
      'Switch off AC isolator / MCB if safe, keep clear of the equipment, and do not touch connections. Call Support immediately or raise an urgent ticket. Mention smell/noise/spark and whether the inverter still runs.',
    category: 'Troubleshooting',
    order_index: 17,
  },
];

/**
 * Ensure default + troubleshooting FAQs exist (inserts any missing by question).
 */
async function ensureFaqsSeeded() {
  try {
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
