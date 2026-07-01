const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function migrate() {
  try {
    console.log('Running database migrations...');
    
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    await pool.query(schema);
    
    console.log('Database migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration error:', error);
    process.exit(1);
  }
}

migrate();

