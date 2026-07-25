const fs = require('fs');

function patchOnce(path, check, find, replace) {
  let s = fs.readFileSync(path, 'utf8');
  if (s.includes(check)) {
    console.log('skip (already):', path);
    return;
  }
  if (!s.includes(find)) {
    throw new Error('find missing in ' + path + ': ' + JSON.stringify(find.slice(0, 80)));
  }
  s = s.replace(find, replace);
  fs.writeFileSync(path, s);
  console.log('patched:', path);
}

patchOnce(
  'E:/Production Project Backup/Hostinger Project/db-solar-phone-app/routes/projects.js',
  "consumerGet(req, '/api/v1/projects/'",
  `router.get('/', authenticate, async (req, res) => {
  try {
    // Disable caching for project lists to avoid 304 Not Modified responses
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const ctx = await getAppAccessContext(req);`,
  `router.get('/', authenticate, async (req, res) => {
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
    // Disable caching for project lists to avoid 304 Not Modified responses
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const ctx = await getAppAccessContext(req);`
);

patchOnce(
  'E:/Production Project Backup/Hostinger Project/db-solar-phone-app/routes/complaints.js',
  "consumerGet(req, '/api/v1/complaints/'",
  `router.get('/', authenticate, async (req, res) => {
  try {
    const ctx = await getAppAccessContext(req);
    if (!ctx) {
      return res.status(401).json({ message: 'Could not identify user' });
    }`,
  `router.get('/', authenticate, async (req, res) => {
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
    const ctx = await getAppAccessContext(req);
    if (!ctx) {
      return res.status(401).json({ message: 'Could not identify user' });
    }`
);

patchOnce(
  'E:/Production Project Backup/Hostinger Project/db-solar-phone-app/routes/complaints.js',
  "consumerPost(req, '/api/v1/complaints/create/'",
  `router.post('/', authenticate, optionalComplaintUpload, async (req, res) => {
  try {`,
  `router.post('/', authenticate, optionalComplaintUpload, async (req, res) => {
  try {
    try {
      const { djangoEnabled, consumerPost } = require('../utils/djangoClient');
      if (djangoEnabled() && !(req.files && req.files.length)) {
        const djangoRes = await consumerPost(req, '/api/v1/complaints/create/', { ...req.body });
        if (djangoRes.status >= 200 && djangoRes.status < 300) {
          return res.status(djangoRes.status).json(djangoRes.data);
        }
        console.warn('Django complaints create status', djangoRes.status, djangoRes.data);
      }
    } catch (djangoErr) {
      console.warn('Django complaints create failed, falling back:', djangoErr.message);
    }`
);

patchOnce(
  'E:/Production Project Backup/Hostinger Project/db-solar-phone-app/routes/services.js',
  "consumerGet(req, '/api/v1/services/'",
  `router.get('/', authenticate, async (req, res) => {
  try {
    const ctx = await getAppAccessContext(req);
    if (!ctx) {
      return res.status(401).json({ message: 'Could not identify user' });
    }`,
  `router.get('/', authenticate, async (req, res) => {
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
    const ctx = await getAppAccessContext(req);
    if (!ctx) {
      return res.status(401).json({ message: 'Could not identify user' });
    }`
);

patchOnce(
  'E:/Production Project Backup/Hostinger Project/db-solar-phone-app/routes/services.js',
  "consumerPost(req, '/api/v1/services/create/'",
  `router.post('/', authenticate, async (req, res) => {
  try {
    const ctx = await getAppAccessContext(req);
    if (!ctx) {
      return res.status(401).json({ message: 'Could not identify user' });
    }`,
  `router.post('/', authenticate, async (req, res) => {
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
    const ctx = await getAppAccessContext(req);
    if (!ctx) {
      return res.status(401).json({ message: 'Could not identify user' });
    }`
);

patchOnce(
  'E:/Production Project Backup/Hostinger Project/db-solar-phone-app/routes/services.js',
  "consumerGet(req, '/api/v1/services/remarks/'",
  `router.get('/remarks', authenticate, async (req, res) => {
  try {
    const result = await pool.query(`,
  `router.get('/remarks', authenticate, async (req, res) => {
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
    const result = await pool.query(`
);

console.log('all patches done');
