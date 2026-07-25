const fs = require('fs');

function patchFile(path, check, startMarker, insertBlock) {
  let s = fs.readFileSync(path, 'utf8');
  if (s.includes(check)) {
    console.log('skip', path);
    return;
  }
  // normalize for search but write with original - use indexOf on startMarker only
  const idx = s.indexOf(startMarker);
  if (idx < 0) {
    console.error('missing marker in', path, startMarker);
    process.exit(1);
  }
  // insert after "try {\n" following the route definition
  const tryIdx = s.indexOf('try {', idx);
  const afterTry = s.indexOf('\n', tryIdx) + 1;
  s = s.slice(0, afterTry) + insertBlock + s.slice(afterTry);
  fs.writeFileSync(path, s);
  console.log('ok', path);
}

const projectsInsert = `    try {
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
`;

patchFile(
  'E:/Production Project Backup/Hostinger Project/db-solar-phone-app/routes/projects.js',
  "consumerGet(req, '/api/v1/projects/'",
  "// Get all projects for authenticated customer",
  projectsInsert
);

const complaintsListInsert = `    try {
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
`;

patchFile(
  'E:/Production Project Backup/Hostinger Project/db-solar-phone-app/routes/complaints.js',
  "consumerGet(req, '/api/v1/complaints/'",
  "router.get('/', authenticate, async (req, res) => {",
  complaintsListInsert
);

const complaintsCreateInsert = `    try {
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
    }
`;

patchFile(
  'E:/Production Project Backup/Hostinger Project/db-solar-phone-app/routes/complaints.js',
  "consumerPost(req, '/api/v1/complaints/create/'",
  'router.post(\'/\', authenticate, optionalComplaintUpload, async (req, res) => {',
  complaintsCreateInsert
);

const servicesListInsert = `    try {
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
`;

patchFile(
  'E:/Production Project Backup/Hostinger Project/db-solar-phone-app/routes/services.js',
  "consumerGet(req, '/api/v1/services/'",
  "router.get('/', authenticate, async (req, res) => {",
  servicesListInsert
);

// services create - last post('/')
{
  const path = 'E:/Production Project Backup/Hostinger Project/db-solar-phone-app/routes/services.js';
  let s = fs.readFileSync(path, 'utf8');
  if (!s.includes("consumerPost(req, '/api/v1/services/create/'")) {
    const marker = "router.post('/', authenticate, async (req, res) => {";
    const idx = s.lastIndexOf(marker);
    if (idx < 0) throw new Error('services create marker missing');
    const tryIdx = s.indexOf('try {', idx);
    const afterTry = s.indexOf('\n', tryIdx) + 1;
    const insert = `    try {
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
    s = s.slice(0, afterTry) + insert + s.slice(afterTry);
    fs.writeFileSync(path, s);
    console.log('ok services create');
  } else console.log('skip services create');
}

const remarksInsert = `    try {
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

patchFile(
  'E:/Production Project Backup/Hostinger Project/db-solar-phone-app/routes/services.js',
  "consumerGet(req, '/api/v1/services/remarks/'",
  "router.get('/remarks', authenticate, async (req, res) => {",
  remarksInsert
);

console.log('done');
