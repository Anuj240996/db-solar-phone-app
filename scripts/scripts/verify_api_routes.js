/**
 * Verify production API has required routes (run against VPS URL).
 * Usage: node scripts/verify_api_routes.js http://72.60.98.248:8080
 */
const base = (process.argv[2] || 'http://127.0.0.1:8080').replace(/\/$/, '');

async function check(method, path, body) {
  const url = `${base}${path}`;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function main() {
  console.log('Checking', base);

  const health = await check('GET', '/api/health');
  console.log('\nGET /api/health', health.status, health.data);

  const qr = await check('POST', '/api/projects/import-from-qr', {});
  console.log('\nPOST /api/projects/import-from-qr', qr.status, qr.data);
  const qrOk = qr.status !== 404;

  const verify = await check('POST', '/api/auth/verify-fetch-projects', {
    username: 'test',
    password: 'test',
  });
  console.log('\nPOST /api/auth/verify-fetch-projects', verify.status, verify.data);
  const verifyOk = verify.status !== 404;

  const version = health.data?.apiVersion;
  console.log('\n--- Summary ---');
  console.log('apiVersion:', version || '(missing — old deploy)');
  console.log('import-from-qr:', qrOk ? 'OK (route exists)' : 'MISSING — redeploy phone-app');
  console.log('verify-fetch-projects:', verifyOk ? 'OK' : 'MISSING');

  if (!qrOk || version !== '1.1.0') {
    console.log('\n⚠️  Redeploy backend/phone-app from this repo, then health should show apiVersion 1.1.0');
    process.exit(1);
  }
  console.log('\n✅ API looks up to date');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
