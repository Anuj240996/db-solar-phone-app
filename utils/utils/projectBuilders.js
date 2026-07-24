const pool = require('../database/db');
const {
  fetchCustomerResultForCustomer,
  computeProjectStatusFromResult,
} = require('./customerResult');

const CUSTOMER_SELECT = `cust_id, consumer, first_name, last_name, middle_name,
  email, phone, address, city, state, comp_name, new_customer_id, plant_capacity, qunt_solar,
  cust_type, project_type, po_date, solar_pump`;

/** Map DB cust_type / project_type (incl. typos) → media filename key. */
function resolveCustTypeKey(customer = {}) {
  const tokens = [
    customer.cust_type,
    customer.custType,
    customer.project_type,
    customer.projectType,
  ]
    .filter(Boolean)
    .map((v) => String(v).trim().toLowerCase());

  for (const value of tokens) {
    if (!value || value === 'null' || value === 'n/a' || value === 'na') continue;
    if (value.includes('industr')) return 'industrial';
    if (value.includes('commer') || value.includes('commers')) return 'commercial';
    if (value.includes('resid')) return 'residential';
    if (value.includes('govern') || value.includes('goverment')) return 'government';
    if (
      value.includes('water') ||
      value.includes('pump') ||
      value.includes('agricultur') ||
      value.includes('agri') ||
      value.includes('farm')
    ) {
      return 'water_pump';
    }
    if (value.includes('rooftop')) return 'residential';
  }

  const solarPump = customer.solar_pump;
  if (solarPump != null) {
    const s = String(solarPump).trim().toLowerCase();
    if (s && s !== '0' && s !== 'false' && s !== 'null' && s !== 'n') {
      return 'water_pump';
    }
  }

  return null;
}

/** Absolute or path URL for project-type image served from /media/project_types/. */
function buildProjectTypeImageUrl(customer) {
  const key = resolveCustTypeKey(customer);
  if (!key) return null;
  const relative = `/media/project_types/${key}.jpg`;
  const base = (process.env.MEDIA_BASE_URL || process.env.PUBLIC_BASE_URL || '')
    .toString()
    .trim()
    .replace(/\/$/, '');
  return base ? `${base}${relative}` : relative;
}

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
    city: customer.city || null,
    state: customer.state || null,
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
    cust_type: customer.cust_type || null,
    custType: customer.cust_type || null,
    project_type: customer.project_type || null,
    projectType: customer.project_type || null,
    solar_pump: customer.solar_pump || null,
    po_date: customer.po_date || null,
    poDate: customer.po_date || null,
    customerId: customer.cust_id,
    totalGeneration: null,
    todayGeneration: null,
    projectImage: buildProjectTypeImageUrl(customer),
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
  resolveCustTypeKey,
  buildProjectTypeImageUrl,
};
