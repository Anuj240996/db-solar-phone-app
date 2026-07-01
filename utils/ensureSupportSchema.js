const pool = require('../database/db');

let schemaReady = false;

async function ensureSupportSchema() {
  if (schemaReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_support_queries (
      id BIGSERIAL PRIMARY KEY,
      app_user_id BIGINT,
      auth_user_id INTEGER,
      subject VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      status VARCHAR(20) DEFAULT 'open',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);

  schemaReady = true;
}

module.exports = { ensureSupportSchema };
