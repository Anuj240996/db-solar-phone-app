const pool = require('../database/db');

function bitToBoolean(bitValue) {
  if (bitValue === null || bitValue === undefined) return false;
  if (typeof bitValue === 'boolean') return bitValue;
  if (typeof bitValue === 'string') {
    return bitValue === '1' || bitValue.toLowerCase() === 'true';
  }
  if (typeof bitValue === 'number') return bitValue === 1;
  return false;
}

const RESULT_COLUMNS =
  'solar_panel, inverter, net_meter, mseb, inspection_report, consumer_id_id';

/**
 * Load the latest customer_result row for a customer record.
 * Tries consumer_id_id, consumer_id (if column exists), then consumer text / comp_name.
 */
async function fetchCustomerResultForCustomer(customer) {
  if (!customer) return null;

  const custId = customer.cust_id;
  const consumer = customer.consumer != null ? String(customer.consumer).trim() : '';
  const compName = customer.comp_name != null ? String(customer.comp_name).trim() : '';

  if (custId != null) {
    try {
      const byCust = await pool.query(
        `SELECT ${RESULT_COLUMNS}
         FROM customer_result
         WHERE consumer_id_id = $1
         ORDER BY id DESC
         LIMIT 1`,
        [custId]
      );
      if (byCust.rows.length > 0) return byCust.rows[0];
    } catch (e) {
      console.log('customer_result lookup by consumer_id_id failed:', e.message);
    }

    try {
      const byConsumerId = await pool.query(
        `SELECT ${RESULT_COLUMNS}
         FROM customer_result
         WHERE consumer_id = $1
         ORDER BY id DESC
         LIMIT 1`,
        [custId]
      );
      if (byConsumerId.rows.length > 0) return byConsumerId.rows[0];
    } catch (_) {
      // consumer_id column may not exist
    }
  }

  const textCandidates = [...new Set([consumer, compName].filter(Boolean))];
  for (const text of textCandidates) {
    try {
      const byText = await pool.query(
        `SELECT ${RESULT_COLUMNS}
         FROM customer_result
         WHERE TRIM(consumer::text) = TRIM($1::text)
         ORDER BY id DESC
         LIMIT 1`,
        [text]
      );
      if (byText.rows.length > 0) return byText.rows[0];
    } catch (e) {
      console.log('customer_result lookup by consumer text failed:', e.message);
    }
  }

  return null;
}

/** Project list / details status from customer_result flags. */
function computeProjectStatusFromResult(customerResultData) {
  if (!customerResultData) return 'Pending';

  const solarPanel = bitToBoolean(customerResultData.solar_panel);
  const inverter = bitToBoolean(customerResultData.inverter);
  const netMeter = bitToBoolean(customerResultData.net_meter);
  const mseb = bitToBoolean(customerResultData.mseb);
  const inspectionReport = bitToBoolean(customerResultData.inspection_report);

  if (inspectionReport) return 'Completed';
  if (solarPanel && inverter && netMeter && mseb) return 'Completed';
  return 'Pending';
}

module.exports = {
  bitToBoolean,
  fetchCustomerResultForCustomer,
  computeProjectStatusFromResult,
};
