/**
 * Force-deploy current backend to VPS phone-app (Easypanel swarm).
 * Uploads key files -> /root/phoneapp_new -> docker build -> service update stop-first
 *
 * Usage: node scripts/deploy_phoneapp_vps.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const HOST = process.env.VPS_HOST || '72.60.98.248';
const USER = process.env.VPS_USER || 'root';
const PASSWORD = process.env.VPS_SSH_PASSWORD || process.env.VPS_PASSWORD || 'Heramb2023';
const BACKEND = path.join(__dirname, '..');
const REMOTE_SRC = '/root/phoneapp_new';
const REMOTE_UPLOAD = '/root/phoneapp_upload';
const EXPECT_VERSION = '1.3.5';
const IMG = 'easypanel/db_solar/phone-app:v135';

const FILES = [
  'server.js',
  'routes/leads.js',
  'routes/faqs.js',
  'utils/ensureFaqsSeeded.js',
  'package.json',
];

function exec(conn, cmd, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, { timeout: timeoutMs }, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      let errOut = '';
      const timer = setTimeout(() => {
        try { stream.close(); } catch (_) {}
        reject(new Error(`Timeout after ${timeoutMs}ms: ${cmd.slice(0, 80)}`));
      }, timeoutMs);
      stream.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error(`Exit ${code}: ${cmd}\n${errOut || out}`));
        else resolve(out);
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

function uploadFile(sftp, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.mkdir(path.posix.dirname(remotePath), { mode: 0o755 }, () => {
      // mkdir may fail if exists — ignore
      const read = fs.createReadStream(localPath);
      const write = sftp.createWriteStream(remotePath);
      write.on('close', resolve);
      write.on('error', reject);
      read.on('error', reject);
      read.pipe(write);
    });
  });
}

async function main() {
  for (const f of FILES) {
    const p = path.join(BACKEND, f);
    if (!fs.existsSync(p)) throw new Error(`Missing ${p}`);
  }

  const privateKeyPath = process.env.VPS_SSH_KEY || path.join(process.env.USERPROFILE || process.env.HOME || '', '.ssh', 'id_rsa');
  const connectOpts = {
    host: HOST,
    port: 22,
    username: USER,
    readyTimeout: 30000,
  };
  if (fs.existsSync(privateKeyPath)) {
    connectOpts.privateKey = fs.readFileSync(privateKeyPath);
    console.log('Using SSH key', privateKeyPath);
  } else {
    connectOpts.password = PASSWORD;
    console.log('Using SSH password');
  }

  const conn = new Client();
  await new Promise((resolve, reject) => {
    conn
      .on('ready', resolve)
      .on('error', reject)
      .connect(connectOpts);
  });
  console.log('SSH connected');

  const sftp = await new Promise((resolve, reject) => {
    conn.sftp((err, s) => (err ? reject(err) : resolve(s)));
  });

  await exec(conn, `mkdir -p ${REMOTE_UPLOAD}/routes ${REMOTE_UPLOAD}/utils ${REMOTE_SRC}/routes ${REMOTE_SRC}/utils`);

  for (const f of FILES) {
    const local = path.join(BACKEND, f);
    const remote = `${REMOTE_UPLOAD}/${f.replace(/\\/g, '/')}`;
    console.log(`Upload ${f} -> ${remote}`);
    await uploadFile(sftp, local, remote);
  }

  const deployScript = `
set -e
SRC="${REMOTE_SRC}"
UP="${REMOTE_UPLOAD}"
IMG="${IMG}"
SERVICE="${SERVICE}"
VER="${EXPECT_VERSION}"

mkdir -p "$SRC/routes" "$SRC/utils"
if [ ! -f "$SRC/server.js" ]; then
  CID=$(docker ps -q -f name=db_solar_phone-app | head -1)
  if [ -n "$CID" ]; then
    echo "Seeding $SRC from container $CID"
    docker cp "$CID:/app/." "$SRC/"
  fi
fi

cp -f "$UP/server.js" "$SRC/server.js"
cp -f "$UP/routes/leads.js" "$SRC/routes/leads.js"
cp -f "$UP/routes/faqs.js" "$SRC/routes/faqs.js"
cp -f "$UP/utils/ensureFaqsSeeded.js" "$SRC/utils/ensureFaqsSeeded.js"
cp -f "$UP/package.json" "$SRC/package.json" 2>/dev/null || true

echo "=== Verify source API_VERSION ==="
grep "API_VERSION" "$SRC/server.js"
grep -n "rooftop_area_unit\\|finance_type\\|Troubleshooting" "$SRC/routes/leads.js" "$SRC/utils/ensureFaqsSeeded.js" | head -20

echo "=== Docker build ==="
docker build --build-arg CACHE_BUST=$(date +%s) -t "$IMG" "$SRC"

echo "=== Service update stop-first ==="
docker service update --update-order stop-first --image "$IMG" --force "$SERVICE"

echo "=== Wait for health $VER ==="
for i in $(seq 1 24); do
  OUT=$(curl -s http://127.0.0.1:8080/api/health || true)
  echo "try $i: $OUT"
  echo "$OUT" | grep -q "$VER" && { echo "DEPLOY OK"; exit 0; }
  sleep 5
done
echo "DEPLOY CHECK FAILED — health did not reach $VER"
exit 1
`;

  console.log('Running remote deploy...');
  await exec(conn, deployScript, 600000);
  conn.end();
  console.log('\nDone.');
}

main().catch((e) => {
  console.error('Deploy failed:', e.message);
  process.exit(1);
});
