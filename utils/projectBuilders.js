const pool = require('../database/db');
const {
  fetchCustomerResultForCustomer,
  computeProjectStatusFromResult,
} = require('./customerResult');

const CUSTOMER_SELECT = `cust_id, consumer, first_name, last_name, middle_name,
  email, phone, address, city, state, comp_name, new_customer_id, plant_capacity, qunt_solar`;

function mapCustomerToProject(customer, authUserId = null) {
  const projectName =
    customer.comp_name ||
    `${customer.first_name || ''} ${customer.middle_name || ''} ${customer.last_name || ''}`.trim() ||
    `AF#${customer.consumer || customer.cust_id}`;

  return {
    id: customer.cust_id,
    projectId: customer.cust_id,
    projectName,
    consumer: customer.consumer,
    location:
      `${customer.city || ''}, ${customer.state || ''}`.trim().replace(/^,\s*/, '').replace(/,\s*$/, '') ||
      customer.address ||
      'N/A',
    plant_capacity: customer.plant_capacity,
    plantCapacity:
      customer.plant_capacity != null && Number(customer.plant_capacity) > 0
        ? String(customer.plant_capacity)
        : '0',
    qunt_solar: customer.qunt_solar,
    quntSolar: customer.qunt_solar,
    customerId: customer.cust_id,
    totalGeneration: null,
    todayGeneration: null,
    projectImage: null,
    ...(authUserId != null ? { originalAuthUserId: authUserId } : {}),
  };
}

async function buildProjectsFromCustomerRows(rows, authUserId = null) {
  return Promise.all(
    rows.map(async (customer) => {
      const customerResultData = await fetchCustomerResultForCustomer(customer);
      const status = computeProjectStatusFromResult(customerResultData);
      return {
        ...mapCustomerToProject(customer, authUserId),
        status,
      };
    })
  );
}

/** Customers owned by one or more auth_user ids (customer.new_customer_id). */
async function queryCustomersByOwnerAuthIds(ownerAuthIds) {
  const ids = ownerAuthIds
    .map((id) => parseInt(id, 10))
    .filter((n) => !isNaN(n));
  if (!ids.length) return [];

  const res = await pool.query(
    `SELECT ${CUSTOMER_SELECT}
     FROM customer
     WHERE new_customer_id::bigint = ANY($1::bigint[])
     ORDER BY cust_id DESC`,
    [ids]
  );
  return res.rows;
}

async function buildProjectsForAuthUserId(authUserId) {
  const authId = parseInt(authUserId, 10);
  if (isNaN(authId)) return [];
  const rows = await queryCustomersByOwnerAuthIds([authId]);
  return buildProjectsFromCustomerRows(rows, authId);
}

module.exports = {
  CUSTOMER_SELECT,
  mapCustomerToProject,
  buildProjectsFromCustomerRows,
  queryCustomersByOwnerAuthIds,
  buildProjectsForAuthUserId,
};
