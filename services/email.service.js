const nodemailer = require('nodemailer');
require('dotenv').config();
let transporter = null;

function init() {
  if (!process.env.SMTP_HOST) return console.warn('⚠️ SMTP not configured');
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  console.log('✅ Email service ready');
}

async function sendMail(to, subject, html) {
  if (!transporter) return false;
  try {
    await transporter.sendMail({ from: process.env.MAIL_FROM, to, subject, html });
    return true;
  } catch (e) { console.error('Email error:', e.message); return false; }
}

async function sendWelcomeEmail(u) {
  const html = `<h2>Welcome ${u.userName}!</h2><p>Account created for <b>${u.orgName}</b>.</p>`;
  return sendMail(u.email, `Welcome to FIMS - ${u.orgName}`, html);
}

async function sendInviteEmail(d) {
  const html = `<h2>You're Invited!</h2><p>Join <b>${d.orgName}</b> as <b>${d.department}</b>.</p><a href="${d.acceptLink}">Accept Invite</a>`;
  return sendMail(d.email, `Invitation to join ${d.orgName}`, html);
}

async function sendOtpEmail(d) {
  const html = `<h2>Password Reset OTP</h2><h1 style="letter-spacing:5px;">${d.otp}</h1><p>Expires in 15 mins.</p>`;
  return sendMail(d.email, `🔐 FIMS Password Reset OTP`, html);
}

async function sendPasswordResetConfirmation(d) {
  const html = `<h2>Password Changed</h2><p>Your password for <b>${d.orgName}</b> was successfully reset.</p>`;
  return sendMail(d.email, `✅ Password Changed - ${d.orgName}`, html);
}

module.exports = { init, sendWelcomeEmail, sendInviteEmail, sendOtpEmail, sendPasswordResetConfirmation };