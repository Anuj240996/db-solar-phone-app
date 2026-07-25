const axios = require('axios');

const DJANGO_BASE_URL = String(process.env.DJANGO_BASE_URL || '')
  .trim()
  .replace(/\/+$/, '');
const DJANGO_INTERNAL_API_KEY = String(process.env.DJANGO_INTERNAL_API_KEY || '').trim();

function djangoEnabled() {
  return Boolean(DJANGO_BASE_URL);
}

function djangoClient() {
  if (!DJANGO_BASE_URL) {
    throw new Error('DJANGO_BASE_URL is not configured');
  }
  return axios.create({
    baseURL: DJANGO_BASE_URL,
    timeout: Number(process.env.DJANGO_TIMEOUT_MS || 30000),
    headers: {
      'Content-Type': 'application/json',
      ...(DJANGO_INTERNAL_API_KEY
        ? { 'X-Internal-Key': DJANGO_INTERNAL_API_KEY }
        : {}),
    },
    validateStatus: () => true,
  });
}

async function associateLogin(username, password) {
  const client = djangoClient();
  const res = await client.post('/api/v1/associate/login/', { username, password });
  return { status: res.status, data: res.data };
}

async function associateGet(path, authUserId, query = {}) {
  const client = djangoClient();
  const res = await client.get(path, {
    headers: { 'X-Auth-User-Id': String(authUserId) },
    params: query,
  });
  return { status: res.status, data: res.data };
}

module.exports = {
  djangoEnabled,
  djangoClient,
  associateLogin,
  associateGet,
  DJANGO_BASE_URL,
};
