const base = 'http://72.60.98.248:8080';

const paths = [
  'GET /api/health',
  'GET /api/services',
  'GET /api/services/remarks',
  'GET /api/complaints',
  'GET /api/projects',
  'GET /api/leads',
  'POST /api/support/query',
  'GET /api/faqs',
  'GET /api/plants',
];

async function main() {
  for (const item of paths) {
    const [method, path] = item.split(' ');
    const url = base + path;
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify({ subject: 't', message: 't' }) : undefined,
      });
      console.log(`${item} -> ${res.status}`);
    } catch (e) {
      console.log(`${item} -> ERROR ${e.message}`);
    }
  }
}

main();
