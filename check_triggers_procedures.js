// Check for triggers and stored procedures on firereport_firereport table
const pool = require('./database/db');

async function checkDatabaseObjects() {
  try {
    console.log('🔍 Checking for triggers and procedures on firereport_firereport...\n');
    
    // Check for triggers
    const triggersResult = await pool.query(`
      SELECT 
        trigger_name,
        event_manipulation,
        event_object_table,
        action_statement,
        action_timing
      FROM information_schema.triggers
      WHERE event_object_table = 'firereport_firereport'
      ORDER BY trigger_name
    `);
    
    console.log('📋 Triggers on firereport_firereport:');
    if (triggersResult.rows.length === 0) {
      console.log('  No triggers found');
    } else {
      triggersResult.rows.forEach((trigger, idx) => {
        console.log(`  ${idx + 1}. ${trigger.trigger_name}`);
        console.log(`     Event: ${trigger.event_manipulation}`);
        console.log(`     Timing: ${trigger.action_timing}`);
        console.log(`     Statement: ${trigger.action_statement?.substring(0, 100)}...`);
      });
    }
    console.log('');
    
    // Check for stored procedures/functions
    const functionsResult = await pool.query(`
      SELECT 
        routine_name,
        routine_type,
        routine_definition
      FROM information_schema.routines
      WHERE routine_schema = 'public'
      AND (
        routine_definition LIKE '%firereport_firereport%'
        OR routine_name LIKE '%firereport%'
      )
      ORDER BY routine_name
    `);
    
    console.log('📋 Functions/Procedures related to firereport_firereport:');
    if (functionsResult.rows.length === 0) {
      console.log('  No functions/procedures found');
    } else {
      functionsResult.rows.forEach((func, idx) => {
        console.log(`  ${idx + 1}. ${func.routine_name} (${func.routine_type})`);
        if (func.routine_definition) {
          const def = func.routine_definition.substring(0, 200);
          console.log(`     Definition: ${def}...`);
          // Check for ? placeholders
          if (func.routine_definition.includes('?')) {
            console.log(`     ⚠️  WARNING: Contains ? placeholders!`);
          }
        }
      });
    }
    console.log('');
    
    // Check for rules
    const rulesResult = await pool.query(`
      SELECT 
        rule_name,
        event_manipulation,
        event_object_table,
        action_statement
      FROM information_schema.rules
      WHERE event_object_table = 'firereport_firereport'
      ORDER BY rule_name
    `);
    
    console.log('📋 Rules on firereport_firereport:');
    if (rulesResult.rows.length === 0) {
      console.log('  No rules found');
    } else {
      rulesResult.rows.forEach((rule, idx) => {
        console.log(`  ${idx + 1}. ${rule.rule_name}`);
        console.log(`     Event: ${rule.event_manipulation}`);
        console.log(`     Statement: ${rule.action_statement?.substring(0, 100)}...`);
      });
    }
    console.log('');
    
    // Check for views that might have triggers
    const viewsResult = await pool.query(`
      SELECT 
        table_name,
        view_definition
      FROM information_schema.views
      WHERE table_schema = 'public'
      AND view_definition LIKE '%firereport_firereport%'
      ORDER BY table_name
    `);
    
    console.log('📋 Views related to firereport_firereport:');
    if (viewsResult.rows.length === 0) {
      console.log('  No views found');
    } else {
      viewsResult.rows.forEach((view, idx) => {
        console.log(`  ${idx + 1}. ${view.table_name}`);
      });
    }
    
    console.log('\n✅ Check complete!');
    console.log('\n💡 If you see triggers/functions with ? placeholders,');
    console.log('   those need to be updated to use $1, $2, etc. for PostgreSQL.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    await pool.end();
  }
}

checkDatabaseObjects();
