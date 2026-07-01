/**
 * Deploy backend to VPS phone-app container via SSH + docker cp.
 * Usage: node scripts/remote_deploy.js
 */
require('dotenv').config();
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const HOST = process.env.VPS_HOST || '72.60.98.248';
const USER = process.env.VPS_USER || 'root';
const PASSWORD = process.env.VPS_SSH_PASSWORD || process.env.VPS_PASSWORD || 'Heramb2023';
const CONTAINER = process.env.VPS_CONTAINER || 'db_solar_phone-app';
const ZIP = path.join(__dirname, '..', 'backend-deploy.zip');
const REMOTE_ZIP = '/root/backend-deploy.zip';
const REMOTE_DIR = '/root/db_solar_backend';

function exec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      let errOut = '';
      stream.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Command failed (${code}): ${cmd}\n${errOut || out}`));
        } else {
          resolve(out);
        }
      });
      stream.on('data', (d) => {
        out += d.toString();
        process.stdout.write(d);
      });
      stream.stderr.on('data', (d) => {
        errOut += d.toString();
        process.stderr.write(d);
      });
    });
  });
}

function upload(conn, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      const read = fs.createReadStream(localPath);
      const write = sftp.createWriteStream(remotePath);
      write.on('close', () => resolve());
      write.on('error', reject);
      read.on('error', reject);
      read.pipe(write);
    });
  });
}

async function main() {
  if (!fs.existsSync(ZIP)) {
    throw new Error(`Missing ${ZIP} — run pack_for_vps.ps1 first`);
  }

  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn
      .on('ready', resolve)
      .on('error', reject)
      .connect({
        host: HOST,
        port: 22,
        username: USER,
        password: PASSWORD,
        readyTimeout: 20000,
      });
  });

  console.log('SSH connected. Uploading zip...');
  await upload(conn, ZIP, REMOTE_ZIP);

  const script = `
set -e
mkdir -p ${REMOTE_DIR}
unzip -o ${REMOTE_ZIP} -d ${REMOTE_DIR}
cd ${REMOTE_DIR}
npm ci --omit=dev
docker cp ${REMOTE_DIR}/. ${CONTAINER}:/app/
docker restart ${CONTAINER}
sleep 4
echo "--- health ---"
curl -s http://127.0.0.1:8080/api/health || true
echo ""
echo "--- services status ---"
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/api/services || true
echo ""
`;

  console.log('Deploying into container...');
  await exec(conn, script);
  conn.end();
  console.log('\nDeploy finished.');
}

main().catch((e) => {
  console.error('Deploy failed:', e.message);
  process.exit(1);
});
