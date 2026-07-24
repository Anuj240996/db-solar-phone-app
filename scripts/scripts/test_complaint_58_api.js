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
  path: '/api/complaints/58',
  method: 'GET',
  headers: { Authorization: `Bearer ${token}` },
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (c) => (data += c));
  res.on('end', () => {
    console.log('status', res.statusCode);
    try {
      const parsed = JSON.parse(data);
      console.log('engineer', JSON.stringify(parsed.complaint?.engineer, null, 2));
      console.log('requestHistory', JSON.stringify(parsed.complaint?.requestHistory, null, 2));
      console.log('status', parsed.complaint?.status);
    } catch {
      console.log(data);
    }
  });
});
req.on('error', console.error);
req.end();
