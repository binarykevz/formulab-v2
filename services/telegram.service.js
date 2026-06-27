const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

let bot = null;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function init() {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.warn('⚠️  Telegram bot token not configured');
    return;
  }
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
  console.log('✅ Telegram service ready');
}

async function send(message) {
  if (!bot || !CHAT_ID) return false;
  try {
    await bot.sendMessage(CHAT_ID, message, { parse_mode: 'HTML' });
    return true;
  } catch (err) {
    console.error('Telegram send error:', err.message);
    return false;
  }
}

async function notifyNewRegistration(data) {
  const msg = `🆕 <b>NEW USER REGISTRATION</b>
━━━━━━━━━━━━━━━━━━━━
🏢 <b>Organization:</b> ${data.orgName || 'N/A'}
👤 <b>Name:</b> ${data.userName}
🔑 <b>Username:</b> ${data.username}
📧 <b>Email:</b> ${data.email}
🏷️ <b>Department:</b> ${data.department}
🌐 <b>IP:</b> ${data.ipAddress || 'N/A'}
🕐 <b>Time:</b> ${new Date().toLocaleString()}
━━━━━━━━━━━━━━━━━━━━`;
  return send(msg);
}

async function notifyNewRequest(req) {
  const msg = `🆕 <b>NEW PURCHASE REQUEST</b>
━━━━━━━━━━━━━━━━━━━━
📌 <b>ID:</b> ${req.id}
🏢 <b>Company:</b> ${req.company_name}
🏷️ <b>Organization:</b> ${req.orgName}
📅 <b>Date:</b> ${req.date}
🧪 <b>Product:</b> ${req.product_name}
🔖 <b>Batch:</b> ${req.batch_no}
👤 <b>Requestor:</b> ${req.requestor_name} (${req.department})
📦 <b>Items:</b> ${req.items?.length || 0}
💰 <b>Total:</b> ₱ ${Number(req.grand_total).toFixed(2)}
━━━━━━━━━━━━━━━━━━━━`;
  return send(msg);
}

async function notifyRequestDecision(req, decidedBy, notes) {
  const emoji = req.status === 'APPROVED' ? '✅' : '❌';
  const msg = `${emoji} <b>REQUEST ${req.status}</b>
━━━━━━━━━━━━━━━━━━━━
📌 <b>ID:</b> ${req.id}
🧪 <b>Product:</b> ${req.product_name}
🏷️ <b>Organization:</b> ${req.orgName}
💰 <b>Total:</b> ₱ ${Number(req.grand_total).toFixed(2)}
👤 <b>Decided by:</b> ${decidedBy}
📝 <b>Notes:</b> ${notes || 'None'}
━━━━━━━━━━━━━━━━━━━━`;
  return send(msg);
}

module.exports = { init, send, notifyNewRegistration, notifyNewRequest, notifyRequestDecision };
