const base = 'http://72.60.98.248:8080';

const paths = [
  '/api/complaints/services',
  '/api/complaints/service-requests',
  '/api/projects/services',
  '/api/firereport/servicerequest',
  '/api/service-requests',
  '/api/servicerequest',
  '/api/servicerequests',
];

async function main() {
  for (const path of paths) {
    try {
      const res = await fetch(base + path, { method: 'GET' });
      console.log(`GET ${path} -> ${res.status}`);
    } catch (e) {
      console.log(`GET ${path} -> ERROR`);
    }
  }
}

main();
