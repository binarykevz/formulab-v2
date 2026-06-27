const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();
let bot = null;

function init() {
  if (!process.env.TELEGRAM_BOT_TOKEN) return;
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
  console.log('✅ Telegram ready');
}

async function send(msg) {
  if (!bot || !process.env.TELEGRAM_CHAT_ID) return false;
  try { await bot.sendMessage(process.env.TELEGRAM_CHAT_ID, msg, { parse_mode: 'HTML' }); return true; }
  catch (e) { console.error('TG Error:', e.message); return false; }
}

const notifyNewRegistration = (d) => send(`🆕 <b>NEW USER</b>\n${d.userName} (${d.department}) joined ${d.orgName}`);
const notifyNewRequest = (r) => send(`🆕 <b>NEW REQUEST</b>\n${r.id} - ${r.product_name} (₱${r.grand_total})`);
const notifyRequestDecision = (r, by) => send(`${r.status==='APPROVED'?'✅':'❌'} <b>${r.status}</b>\n${r.id} by ${by}`);
const notifyPasswordReset = (d, type) => send(`🔐 <b>PASS RESET ${type}</b>\n${d.userName} (${d.email})`);

module.exports = { init, send, notifyNewRegistration, notifyNewRequest, notifyRequestDecision, notifyPasswordReset };