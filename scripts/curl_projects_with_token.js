require('dotenv').config();
const jwt = require('jsonwebtoken');
const http = require('http');

const token = jwt.sign(
  { userId: '4', email: 'aa@gmail.com', source: 'user_app' },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);

const options = {
  hostname: '127.0.0.1',
  port: 3000,
  path: '/api/projects',
  method: 'GET',
  headers: {
    Authorization: `Bearer ${token}`,
  },
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    console.log('status', res.statusCode);
    try {
      const parsed = JSON.parse(data);
      console.log(JSON.stringify(parsed, null, 2));
    } catch {
      console.log(data);
    }
  });
});

req.on('error', (e) => console.error(e));
req.end();
