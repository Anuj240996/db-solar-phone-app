const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Django MEDIA_ROOT (profile_pics/, profile_images/) — set MEDIA_ROOT in .env
const mediaCandidates = [
  process.env.MEDIA_ROOT,
  path.join(__dirname, 'media'),
  path.join(__dirname, '..', 'media'),
].filter(Boolean);

for (const mediaRoot of mediaCandidates) {
  if (mediaRoot && fs.existsSync(mediaRoot)) {
    app.use('/media', express.static(mediaRoot));
    console.log(`Serving /media from ${mediaRoot}`);
    break;
  }
}

// Always serve bundled project-type images (cust_type thumbnails) from this app.
const projectTypesMedia = path.join(__dirname, 'media', 'project_types');
if (fs.existsSync(projectTypesMedia)) {
  app.use('/media/project_types', express.static(projectTypesMedia));
  console.log(`Serving /media/project_types from ${projectTypesMedia}`);
}

// Routes — mount service-requests alias BEFORE complaints router
const servicesRouter = require('./routes/services');
app.use('/api/auth', require('./routes/auth'));
app.use('/api/plants', require('./routes/plants'));
app.use('/api/progress', require('./routes/progress'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/complaints/service-requests', servicesRouter);
app.use('/api/services', servicesRouter);
app.use('/api/complaints', require('./routes/complaints'));
app.use('/api/faqs', require('./routes/faqs'));
app.use('/api/quotations', require('./routes/quotations'));
app.use('/api/leads', require('./routes/leads'));
app.use('/api/associate', require('./routes/associate'));
app.use('/api/support', require('./routes/support'));
app.use('/api/users', require('./routes/users'));
app.use('/api/growatt', require('./routes/growatt'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/stats', require('./routes/stats'));

// Health check — apiVersion confirms phone-app has project-link + QR routes deployed
const API_VERSION = '1.4.4';
const BUILD_STAMP = process.env.BUILD_STAMP || 'local';

async function runStartupMigrations() {
  try {
    const { ensureLeadsLeadSchema } = require('./utils/ensureLeadsLeadSchema');
    const { ensureSupportSchema } = require('./utils/ensureSupportSchema');
    const { ensureAssociateAuthUserColumn } = require('./utils/associateAccess');
    const pool = require('./database/db');
    await ensureLeadsLeadSchema();
    await ensureSupportSchema();
    await ensureAssociateAuthUserColumn();
    await pool.query(
      `ALTER TABLE firereport_firereport ALTER COLUMN assignby DROP NOT NULL`
    ).catch(() => {});
    await pool.query(
      `ALTER TABLE firereport_servicerequest ALTER COLUMN assignby DROP NOT NULL`
    ).catch(() => {});
    await pool.query(
      `ALTER TABLE firereport_servicerequest ADD COLUMN IF NOT EXISTS service_type TEXT`
    );
    await pool.query(
      `ALTER TABLE firereport_servicerequest ADD COLUMN IF NOT EXISTS additional_notes TEXT`
    );
    await pool.query(
      `ALTER TABLE firereport_servicerequest ADD COLUMN IF NOT EXISTS warranty_type TEXT`
    );
    await pool.query(
      `ALTER TABLE firereport_servicerequest ADD COLUMN IF NOT EXISTS app_user_id INTEGER`
    );
    console.log('Startup DB migrations OK');
  } catch (e) {
    console.error('Startup DB migrations failed:', e.message);
  }
}

app.get('/api/health', async (req, res) => {
  let database = null;
  try {
    const pool = require('./database/db');
    const dbRes = await pool.query('SELECT current_database() AS db');
    database = dbRes.rows[0]?.db || null;
  } catch (e) {
    database = `error: ${e.message}`;
  }

  res.json({
    status: 'ok',
    message: 'DB Solar API is running',
    apiVersion: API_VERSION,
    buildStamp: BUILD_STAMP,
    database,
      features: {
      importFromQr: true,
      verifyFetchProjects: true,
      linkedProjectList: true,
      services: true,
      serviceCreateDynamicInsert: true,
      releaseAgreementPdfs: true,
      companyStats: true,
      crmLeadsInsert: true,
      faqAutoSeed: true,
      associateDashboard: true,
    },
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    message: err.message || 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err : {}
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Server running on port ${PORT} (accepts connections from network)`);
  await runStartupMigrations();
});

