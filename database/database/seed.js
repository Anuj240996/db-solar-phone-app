const pool = require('./db');
const bcrypt = require('bcryptjs');

async function seed() {
  try {
    console.log('Seeding database...');

    // Create admin user
    const adminPassword = await bcrypt.hash('admin123', 10);
    await pool.query(
      `INSERT INTO users (name, email, phone, password_hash, role)
       VALUES ('Admin User', 'admin@dbsolar.com', '+1234567890', $1, 'admin')
       ON CONFLICT (email) DO NOTHING`,
      [adminPassword]
    );

    // Create sample FAQs
    const faqs = [
      {
        question: 'How do I monitor my solar plant performance?',
        answer: 'You can monitor your solar plant performance through the dashboard. It shows daily, monthly, and yearly generation data along with system health metrics.',
        category: 'General',
      },
      {
        question: 'What should I do if my plant is not generating power?',
        answer: 'If your plant is not generating power, please check the system status in the app. If the issue persists, raise a complaint through the complaints section or contact support.',
        category: 'Technical',
      },
      {
        question: 'How can I track installation progress?',
        answer: 'You can track your installation progress in the Progress section. It shows step-by-step milestones and estimated completion date.',
        category: 'Installation',
      },
      {
        question: 'How do I request maintenance?',
        answer: 'You can request maintenance by raising a complaint in the Complaints section. Select "Maintenance Request" as the category.',
        category: 'Maintenance',
      },
    ];

    for (const faq of faqs) {
      await pool.query(
        `INSERT INTO faqs (question, answer, category)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [faq.question, faq.answer, faq.category]
      );
    }

    console.log('Database seeding completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Seeding error:', error);
    process.exit(1);
  }
}

seed();

