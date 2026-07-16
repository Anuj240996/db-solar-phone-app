const nodemailer = require('nodemailer');

function smtpConfigured() {
  return Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      !String(process.env.SMTP_PASS).includes('your-app-password') &&
      !String(process.env.SMTP_USER).includes('your-email@')
  );
}

function createTransport() {
  const port = Number(process.env.SMTP_PORT || 587);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

/**
 * Send a plain/HTML email via SMTP (.env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS).
 * Optional: SMTP_FROM (defaults to SMTP_USER).
 */
async function sendMail({ to, subject, text, html }) {
  if (!smtpConfigured()) {
    const err = new Error(
      'Email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in backend .env'
    );
    err.code = 'SMTP_NOT_CONFIGURED';
    throw err;
  }

  const from =
    process.env.SMTP_FROM ||
    `"DB Solar" <${process.env.SMTP_USER}>`;

  const transporter = createTransport();
  const info = await transporter.sendMail({ from, to, subject, text, html });
  console.log(`📧 Email sent to ${to}: ${info.messageId}`);
  return info;
}

async function sendPasswordResetOtp({ to, name, otp }) {
  const displayName = name || 'User';
  const subject = 'DB Solar — Password reset code';
  const text = [
    `Hello ${displayName},`,
    '',
    `Your DB Solar password reset code is: ${otp}`,
    '',
    'This code expires in 1 hour.',
    'If you did not request a password reset, you can ignore this email.',
    '',
    '— DB Solar',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a">
      <h2 style="color:#1e3a5f">DB Solar</h2>
      <p>Hello ${displayName},</p>
      <p>Your password reset code is:</p>
      <p style="font-size:28px;font-weight:bold;letter-spacing:6px;color:#1e3a5f">${otp}</p>
      <p style="color:#666">This code expires in <strong>1 hour</strong>.</p>
      <p style="color:#666">If you did not request this, you can ignore this email.</p>
    </div>
  `;

  return sendMail({ to, subject, text, html });
}

module.exports = {
  smtpConfigured,
  sendMail,
  sendPasswordResetOtp,
};
