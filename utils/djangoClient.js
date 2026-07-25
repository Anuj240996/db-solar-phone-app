const axios = require('axios');

const DJANGO_BASE_URL = String(process.env.DJANGO_BASE_URL || '')
  .trim()
  .replace(/\/+$/, '');
const DJANGO_INTERNAL_API_KEY = String(process.env.DJANGO_INTERNAL_API_KEY || '').trim();

function djangoEnabled() {
  return Boolean(DJANGO_BASE_URL);
}

function djangoClient(extraHeaders = {}) {
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
      ...extraHeaders,
    },
    validateStatus: () => true,
  });
}

function sessionHeadersFromReq(req) {
  const source = String(
    req.user?.auth_source || req.user?.jwt_source || ''
  ).toLowerCase();
  const userId =
    req.user?.jwt_user_id ??
    req.user?.auth_user_id ??
    req.user?.id ??
    req.user?.userId;
  const headers = {};
  if (source) headers['X-Auth-Source'] = source;
  if (userId != null) headers['X-Auth-User-Id'] = String(userId);
  if (source === 'user_app' && userId != null) {
    headers['X-App-User-Id'] = String(userId);
  }
  return headers;
}

async function associateLogin(username, password) {
  const client = djangoClient();
  const res = await client.post('/api/v1/associate/login/', { username, password });
  return { status: res.status, data: res.data };
}

async function associateGet(path, authUserId, query = {}) {
  const client = djangoClient({ 'X-Auth-User-Id': String(authUserId) });
  const res = await client.get(path, { params: query });
  return { status: res.status, data: res.data };
}

async function consumerLogin(username, password) {
  const client = djangoClient();
  const res = await client.post('/api/v1/auth/login/', { username, password });
  return { status: res.status, data: res.data };
}

async function consumerSignup(payload) {
  const client = djangoClient();
  const res = await client.post('/api/v1/auth/signup/', payload);
  return { status: res.status, data: res.data };
}

async function consumerGet(req, path, query = {}) {
  const client = djangoClient(sessionHeadersFromReq(req));
  const res = await client.get(path, { params: query });
  return { status: res.status, data: res.data };
}

async function consumerPost(req, path, body = {}) {
  const client = djangoClient(sessionHeadersFromReq(req));
  const res = await client.post(path, body);
  return { status: res.status, data: res.data };
}

module.exports = {
  djangoEnabled,
  djangoClient,
  associateLogin,
  associateGet,
  consumerLogin,
  consumerSignup,
  consumerGet,
  consumerPost,
  sessionHeadersFromReq,
  DJANGO_BASE_URL,
};
