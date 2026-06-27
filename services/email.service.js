const nodemailer = require('nodemailer');
require('dotenv').config();

let transporter = null;

function init() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    console.warn('⚠️  SMTP not configured — emails disabled');
    return;
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  console.log('✅ Email service ready');
}

async function sendWelcomeEmail(user) {
  if (!transporter) return false;
  try {
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border:1px solid #ddd;border-radius:8px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;padding:30px;text-align:center;">
          <h1 style="margin:0;">📦 FIMS</h1>
          <p style="margin:5px 0 0;">Formulation & Inventory Management System</p>
        </div>
        <div style="padding:30px;">
          <h2>Welcome, ${user.name}!</h2>
          <p>Your account has been successfully created.</p>
          <table style="width:100%;border-collapse:collapse;margin:20px 0;">
            <tr><td style="padding:8px;border-bottom:1px solid #eee;"><strong>Organization:</strong></td><td style="padding:8px;border-bottom:1px solid #eee;">${user.orgName}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;"><strong>Username:</strong></td><td style="padding:8px;border-bottom:1px solid #eee;">${user.username}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;"><strong>Email:</strong></td><td style="padding:8px;border-bottom:1px solid #eee;">${user.email}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;"><strong>Department:</strong></td><td style="padding:8px;border-bottom:1px solid #eee;">${user.department}</td></tr>
          </table>
          <p style="background:#fffbea;padding:15px;border-left:4px solid #f39c12;">
            <strong>⚠️ Important:</strong> Your data is isolated to your organization. You can only view and access information within <strong>${user.orgName}</strong>.
          </p>
          <p>If you did not register for this account, please contact your administrator immediately.</p>
        </div>
        <div style="background:#f8f9fa;padding:15px;text-align:center;font-size:12px;color:#7f8c8d;">
          © ${new Date().getFullYear()} FIMS System. All rights reserved.
        </div>
      </div>`;

    await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: user.email,
      subject: `✅ Welcome to FIMS — ${user.orgName}`,
      html,
    });

    // Also notify admin
    if (process.env.ADMIN_EMAIL) {
      await transporter.sendMail({
        from: process.env.MAIL_FROM,
        to: process.env.ADMIN_EMAIL,
        subject: `🆕 New Registration: ${user.username} (${user.orgName})`,
        text: `New user registered:\n\nName: ${user.name}\nUsername: ${user.username}\nEmail: ${user.email}\nOrg: ${user.orgName}\nDept: ${user.department}`,
      });
    }
    return true;
  } catch (err) {
    console.error('Email send error:', err.message);
    return false;
  }
}
// Add this function to the existing email.service.js
async function sendInviteEmail(data) {
  if (!transporter) return false;
  try {
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border:1px solid #ddd;border-radius:8px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;padding:30px;text-align:center;">
          <h1 style="margin:0;">📨 You're Invited!</h1>
        </div>
        <div style="padding:30px;">
          <p>Hi,</p>
          <p><strong>${data.invitedByName}</strong> has invited you to join <strong>${data.orgName}</strong> on FIMS as a member of the <strong>${data.department}</strong> department.</p>
          <div style="text-align:center;margin:30px 0;">
            <a href="${data.acceptLink}" style="background:#667eea;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;">Accept Invitation</a>
          </div>
          <p style="font-size:13px;color:#7f8c8d;">This invitation expires on ${new Date(data.expiresAt).toLocaleString()}. If the button doesn't work, copy this link:<br><code style="word-break:break-all;">${data.acceptLink}</code></p>
        </div>
      </div>`;
    await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: data.email,
      subject: `📨 Invitation to join ${data.orgName} on FIMS`,
      html
    });
    return true;
  } catch (err) {
    console.error('Invite email error:', err);
    return false;
  }
}

async function sendOtpEmail(data) {
  if (!transporter) return false;
  try {
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border:1px solid #ddd;border-radius:8px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#e74c3c,#c0392b);color:#fff;padding:30px;text-align:center;">
          <h1 style="margin:0;">🔐 Password Reset Request</h1>
        </div>
        <div style="padding:30px;">
          <p>Hi <strong>${data.userName}</strong>,</p>
          <p>We received a request to reset your password for your <strong>${data.orgName}</strong> account.</p>
          
          <div style="background:#f8f9fa;border:2px dashed #667eea;border-radius:8px;padding:25px;text-align:center;margin:25px 0;">
            <div style="font-size:13px;color:#7f8c8d;margin-bottom:8px;">Your One-Time Password (OTP)</div>
            <div style="font-size:36px;font-weight:700;letter-spacing:8px;color:#667eea;font-family:monospace;">${data.otp}</div>
            <div style="font-size:12px;color:#e74c3c;margin-top:10px;">⏰ Expires in 15 minutes</div>
          </div>

          <div style="background:#fffbea;border-left:4px solid #f39c12;padding:15px;margin:20px 0;">
            <strong>⚠️ Security Notice:</strong>
            <ul style="margin:8px 0 0 20px;line-height:1.8;">
              <li>Do NOT share this code with anyone</li>
              <li>FIMS staff will NEVER ask for your OTP</li>
              <li>If you didn't request this, ignore this email</li>
            </ul>
          </div>

          <p style="font-size:13px;color:#7f8c8d;">
            <strong>Request Details:</strong><br>
            🌐 IP Address: ${data.ipAddress || 'Unknown'}<br>
            🖥️ Device: ${data.userAgent || 'Unknown'}<br>
            🕐 Time: ${new Date().toLocaleString()}
          </p>
        </div>
        <div style="background:#f8f9fa;padding:15px;text-align:center;font-size:12px;color:#7f8c8d;">
          © ${new Date().getFullYear()} FIMS System. This is an automated message.
        </div>
      </div>`;

    await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: data.email,
      subject: `🔐 Your FIMS Password Reset OTP — ${data.orgName}`,
      html
    });
    return true;
  } catch (err) {
    console.error('OTP email error:', err);
    return false;
  }
}

async function sendPasswordResetConfirmation(data) {
  if (!transporter) return false;
  try {
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border:1px solid #ddd;border-radius:8px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#27ae60,#16a085);color:#fff;padding:30px;text-align:center;">
          <h1 style="margin:0;">✅ Password Changed Successfully</h1>
        </div>
        <div style="padding:30px;">
          <p>Hi <strong>${data.userName}</strong>,</p>
          <p>Your password for <strong>${data.orgName}</strong> has been successfully changed.</p>
          <p style="background:#fffbea;padding:15px;border-left:4px solid #f39c12;">
            <strong>⚠️ Didn't make this change?</strong><br>
            If you did not reset your password, your account may be compromised. 
            Please contact your administrator immediately.
          </p>
          <p style="font-size:13px;color:#7f8c8d;">
            Changed at: ${new Date().toLocaleString()}<br>
            IP: ${data.ipAddress || 'Unknown'}
          </p>
        </div>
      </div>`;

    await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to: data.email,
      subject: `✅ Password Changed — ${data.orgName}`,
      html
    });
    return true;
  } catch (err) {
    console.error('Confirmation email error:', err);
    return false;
  }
}

// Update exports
module.exports = { init, sendWelcomeEmail, sendInviteEmail, sendOtpEmail, sendPasswordResetConfirmation };
