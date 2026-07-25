const fs = require('fs');

function insertAfter(haystack, needle, block, fromIndex = 0) {
  const idx = haystack.indexOf(needle, fromIndex);
  if (idx < 0) throw new Error('needle not found: ' + needle.slice(0, 60));
  const insertAt = idx + needle.length;
  if (haystack.includes(block.slice(0, 40))) return haystack;
  return haystack.slice(0, insertAt) + block + haystack.slice(insertAt);
}

// --- auth.js consumer login ---
{
  const p = 'E:/Production Project Backup/Hostinger Project/db-solar-phone-app/routes/auth.js';
  let s = fs.readFileSync(p, 'utf8');
  if (!s.includes('Consumer login via Django')) {
    const appLogin = s.indexOf('// App Login: user_app first');
    if (appLogin < 0) throw new Error('App Login section missing');
    const marker = "const loginId = String(username).trim();";
    const idx = s.indexOf(marker, appLogin);
    if (idx < 0) throw new Error('loginId marker missing');
    let lineEnd = s.indexOf('\n', idx);
    // skip following console.log line too
    const nextLineStart = lineEnd + 1;
    const nextLineEnd = s.indexOf('\n', nextLineStart);
    const nextLine = s.slice(nextLineStart, nextLineEnd);
    const insertAt = nextLine.includes('console.log') ? nextLineEnd + 1 : nextLineStart;
    const block = `
    // Option A path
    try {
      const { djangoEnabled, consumerLogin } = require('../utils/djangoClient');
      if (djangoEnabled()) {
        const djangoRes = await consumerLogin(loginId, password);
        if (djangoRes.status === 200 && djangoRes.data?.success && djangoRes.data?.data?.user) {
          const u = djangoRes.data.data.user;
          const source = u.source || 'user_app';
          const token = jwt.sign(
            { userId: String(u.id), email: u.email || loginId, source, role: u.role || 'customer' },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
          );
          console.log('Consumer login via Django id=', u.id, 'source=', source);
          return res.json(buildLoginResponse(token, {
            id: u.id, name: u.name, email: u.email, phone: u.phone || '',
            role: u.role || 'customer', address: u.address || '', createdAt: u.createdAt,
          }));
        }
        if (djangoRes.status === 401) {
          return res.status(401).json({ success: false, message: djangoRes.data?.message || 'Invalid credentials' });
        }
        console.warn('Django consumer-login unexpected', djangoRes.status, djangoRes.data);
      }
    } catch (djangoErr) {
      console.warn('Django consumer-login failed, falling back:', djangoErr.message);
    }
`;
    s = s.slice(0, insertAt) + block + s.slice(insertAt);
    fs.writeFileSync(p, s);
    console.log('patched auth.js');
  } else {
    console.log('auth.js already patched');
  }
}

// --- projects.js list ---
{
  const p = 'E:/Production Project Backup/Hostinger Project/db-solar-phone-app/routes/projects.js';
  let s = fs.readFileSync(p, 'utf8');
  if (!s.includes("consumerGet(req, '/api/v1/projects/'")) {
    const needle = "router.get('/', authenticate, async (req, res) => {\n  try {\n    // Disable caching for project lists";
    const block = `router.get('/', authenticate, async (req, res) => {
  try {
    try {
      const { djangoEnabled, consumerGet } = require('../utils/djangoClient');
      if (djangoEnabled()) {
        const djangoRes = await consumerGet(req, '/api/v1/projects/');
        if (djangoRes.status >= 200 && djangoRes.status < 300) {
          res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
          return res.status(djangoRes.status).json(djangoRes.data);
        }
        console.warn('Django projects list status', djangoRes.status, djangoRes.data);
      }
    } catch (djangoErr) {
      console.warn('Django projects list failed, falling back:', djangoErr.message);
    }
    // Disable caching for project lists`;
    if (!s.includes(needle)) throw new Error('projects list needle missing');
    s = s.replace(needle, block);
    fs.writeFileSync(p, s);
    console.log('patched projects.js');
  } else console.log('projects.js already patched');
}

// --- complaints.js list + create ---
{
  const p = 'E:/Production Project Backup/Hostinger Project/db-solar-phone-app/routes/complaints.js';
  let s = fs.readFileSync(p, 'utf8');
  if (!s.includes("consumerGet(req, '/api/v1/complaints/'")) {
    const needle = "router.get('/', authenticate, async (req, res) => {\n  try {\n    const ctx = await getAppAccessContext(req);";
    const block = `router.get('/', authenticate, async (req, res) => {
  try {
    try {
      const { djangoEnabled, consumerGet } = require('../utils/djangoClient');
      if (djangoEnabled()) {
        const djangoRes = await consumerGet(req, '/api/v1/complaints/', {
          cust_id: req.query.cust_id || undefined,
        });
        if (djangoRes.status >= 200 && djangoRes.status < 300) {
          return res.status(djangoRes.status).json(djangoRes.data);
        }
        console.warn('Django complaints list status', djangoRes.status, djangoRes.data);
      }
    } catch (djangoErr) {
      console.warn('Django complaints list failed, falling back:', djangoErr.message);
    }
    const ctx = await getAppAccessContext(req);`;
    if (!s.includes(needle)) throw new Error('complaints list needle missing');
    s = s.replace(needle, block);
  }
  if (!s.includes("consumerPost(req, '/api/v1/complaints/create/'")) {
    // Find POST '/' handler start after optionalComplaintUpload
    const needle = "router.post('/', authenticate, optionalComplaintUpload, async (req, res) => {\n  try {";
    const block = `router.post('/', authenticate, optionalComplaintUpload, async (req, res) => {
  try {
    try {
      const { djangoEnabled, consumerPost } = require('../utils/djangoClient');
      if (djangoEnabled() && !(req.files && req.files.length)) {
        const body = { ...req.body };
        const djangoRes = await consumerPost(req, '/api/v1/complaints/create/', body);
        if (djangoRes.status >= 200 && djangoRes.status < 300) {
          return res.status(djangoRes.status).json(djangoRes.data);
        }
        console.warn('Django complaints create status', djangoRes.status, djangoRes.data);
      }
    } catch (djangoErr) {
      console.warn('Django complaints create failed, falling back:', djangoErr.message);
    }`;
    if (!s.includes(needle)) throw new Error('complaints create needle missing');
    s = s.replace(needle, block);
  }
  fs.writeFileSync(p, s);
  console.log('patched complaints.js');
}

// --- services.js list + create + remarks ---
{
  const p = 'E:/Production Project Backup/Hostinger Project/db-solar-phone-app/routes/services.js';
  let s = fs.readFileSync(p, 'utf8');
  if (!s.includes("consumerGet(req, '/api/v1/services/'")) {
    const needle = "router.get('/', authenticate, async (req, res) => {\n  try {\n    const ctx = await getAppAccessContext(req);";
    const block = `router.get('/', authenticate, async (req, res) => {
  try {
    try {
      const { djangoEnabled, consumerGet } = require('../utils/djangoClient');
      if (djangoEnabled()) {
        const djangoRes = await consumerGet(req, '/api/v1/services/', {
          cust_id: req.query.cust_id || undefined,
        });
        if (djangoRes.status >= 200 && djangoRes.status < 300) {
          return res.status(djangoRes.status).json(djangoRes.data);
        }
        console.warn('Django services list status', djangoRes.status, djangoRes.data);
      }
    } catch (djangoErr) {
      console.warn('Django services list failed, falling back:', djangoErr.message);
    }
    const ctx = await getAppAccessContext(req);`;
    if (!s.includes(needle)) throw new Error('services list needle missing');
    s = s.replace(needle, block);
  }
  if (!s.includes("consumerPost(req, '/api/v1/services/create/'")) {
    const needle = "router.post('/', authenticate, async (req, res) => {\n  try {";
    // may match first post - find the create one near end by unique nearby ensureServiceRequestSchema after post
    const idx = s.lastIndexOf("router.post('/', authenticate, async (req, res) => {\n  try {");
    if (idx < 0) throw new Error('services create needle missing');
    const block = `router.post('/', authenticate, async (req, res) => {
  try {
    try {
      const { djangoEnabled, consumerPost } = require('../utils/djangoClient');
      if (djangoEnabled()) {
        const djangoRes = await consumerPost(req, '/api/v1/services/create/', req.body || {});
        if (djangoRes.status >= 200 && djangoRes.status < 300) {
          return res.status(djangoRes.status).json(djangoRes.data);
        }
        console.warn('Django services create status', djangoRes.status, djangoRes.data);
      }
    } catch (djangoErr) {
      console.warn('Django services create failed, falling back:', djangoErr.message);
    }
`;
    const end = s.indexOf('\n', s.indexOf('try {', idx)) + 1;
    // safer: replace only the last occurrence
    const before = s.slice(0, idx);
    const after = s.slice(idx);
    const replaced = after.replace(
      "router.post('/', authenticate, async (req, res) => {\n  try {\n",
      block
    );
    s = before + replaced;
  }
  if (!s.includes("consumerGet(req, '/api/v1/services/remarks/'")) {
    const needle = "router.get('/remarks', authenticate, async (req, res) => {\n  try {";
    const block = `router.get('/remarks', authenticate, async (req, res) => {
  try {
    try {
      const { djangoEnabled, consumerGet } = require('../utils/djangoClient');
      if (djangoEnabled()) {
        const djangoRes = await consumerGet(req, '/api/v1/services/remarks/');
        if (djangoRes.status >= 200 && djangoRes.status < 300) {
          return res.status(djangoRes.status).json(djangoRes.data);
        }
      }
    } catch (djangoErr) {
      console.warn('Django services remarks failed, falling back:', djangoErr.message);
    }
`;
    if (!s.includes(needle)) throw new Error('services remarks needle missing');
    s = s.replace(needle, block);
  }
  fs.writeFileSync(p, s);
  console.log('patched services.js');
}

console.log('done');
