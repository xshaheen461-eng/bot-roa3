const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode');
const fs = require('fs');
const pino = require('pino');
const OWNER_NUMBER = (process.env.OWNER_NUMBER || '218920972444').replace(/[^0-9]/g,'');
const app = express();
let qrCode = '';
let sock = null;
let whiteList = [];
let blackList = [];
let lockLinks = false;
try { whiteList = JSON.parse(fs.readFileSync('whitelist.json')); } catch {}
try { blackList = JSON.parse(fs.readFileSync('blacklist.json')); } catch {}
try { lockLinks = JSON.parse(fs.readFileSync('settings.json')).lockLinks || false; } catch {}
const saveLists = () => {
  fs.writeFileSync('whitelist.json', JSON.stringify(whiteList));
  fs.writeFileSync('blacklist.json', JSON.stringify(blackList));
  fs.writeFileSync('settings.json', JSON.stringify({ lockLinks }));
};
const norm = s => (s||'').replace(/[^0-9]/g,'');
const isOwner = n => norm(n) === OWNER_NUMBER;
const isWhite = n => whiteList.includes(norm(n));
const isBlack = n => blackList.includes(norm(n));
let linkCount = {};
let stickerCount = {};
let floodCount = {};
let joinTimes = {};
async function notifyOwner(text) {
  if (!sock) return;
  try { await sock.sendMessage(OWNER_NUMBER + '@s.whatsapp.net', { text }); } catch {}
}
async function reply(jid, text) {
  try { await sock.sendMessage(jid, { text }); } catch {}
}
async function lockGroup(jid) {
  try { await sock.groupSettingUpdate(jid, 'announcement'); } catch {}
  setTimeout(async () => { try { await sock.groupSettingUpdate(jid, 'not_announcement'); } catch {} }, 5*60*1000);
}
async function kickUser(jid, user) {
  try { await sock.groupParticipantsUpdate(jid, [user], 'remove'); } catch {}
}
async function deleteMsg(jid, key) {
  try { await sock.sendMessage(jid, { delete: key }); } catch {}
}
const hasLink = (t) => {
  if (!t) return false;
  let clean = t.toLowerCase().replace(/\s+/g,'').replace(/[:;]/g,':');
  return /(https?:\/\/|www\.|t\.me\/|telegram\.me\/|wa\.me\/|whatsapp\.com\/|discord\.gg\/|instagram\.com\/|facebook\.com\/|youtube\.com\/|tiktok\.com\/|\.com|\.net|\.org|\.ly|\.io)/.test(clean);
};
const BAN_WORDS = ['.ban', 'تبنيد', 'تخريب', 'هكر'];
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({ version, auth: state, logger: pino({ level: 'silent' }), printQRInTerminal: false, syncFullHistory: false });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', (u) => {
    if (u.qr) { qrCode = u.qr; console.log('QR READY'); }
    if (u.connection === 'open') { qrCode = ''; console.log('Bot connected'); notifyOwner('✅ البوت متصل'); }
    if (u.connection === 'close') {
      const should = (u.lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      if (should) startBot();
    }
  });
  sock.ev.on('group-participants.update', async (u) => {
    try {
      if (u.action !== 'add') return;
      const jid = u.id;
      if (!joinTimes[jid]) joinTimes[jid] = [];
      let now = Date.now();
      joinTimes[jid] = joinTimes[jid].filter(t => now - t < 30000);
      u.participants.forEach(() => joinTimes[jid].push(now));
      if (joinTimes[jid].length >= 3) {
        await lockGroup(jid);
        for (const p of u.participants) {
          if (!isOwner(norm(p)) && !isWhite(norm(p))) {
            await kickUser(jid, p);
            if (!blackList.includes(norm(p))) blackList.push(norm(p));
          }
        }
        saveLists();
        await reply(jid, '🚨 هجوم بوتات! سكرت القروب وطردتهم');
        await notifyOwner('🚨 هجوم بوتات! سكرت القروب وطردتهم');
        joinTimes[jid] = [];
      }
    } catch (e) { console.log('Raid Error:', e.message); }
  });
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const m of messages) {
      try {
        if (!m.message) continue;
        const from = m.key.remoteJid;
        if (!from?.endsWith('@g.us')) continue;
        const sender = m.key.participant || m.key.remoteJid;
        const senderNum = norm(sender);
        const isOwnerSender = isOwner(senderNum) || m.key.fromMe;
        const isWhiteSender = isWhite(senderNum);
        const isBlackSender = isBlack(senderNum);
        const text = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || m.message.videoMessage?.caption || '';
        const lower = text.toLowerCase().trim();
        const isForward = m.message.extendedTextMessage?.contextInfo?.isForwarded || m.message.imageMessage?.contextInfo?.isForwarded || m.message.videoMessage?.contextInfo?.isForwarded;
        const isSticker = !!m.message.stickerMessage;
        if (isBlackSender && !isOwnerSender) { await deleteMsg(from, m.key); await kickUser(from, sender); continue; }
        if (isOwnerSender) {
          if (lower === '.ping') { await reply(from, '✅ Bot online'); continue; }
          if (lower === '.ادوات') {
            let meta = await sock.groupMetadata(from);
            let admins = meta.participants.filter(p => p.admin).length;
            let menu = '╭─── 🍷 ───╮\n';
            menu += '│ 🤍 البيضاء: ' + whiteList.length + '\n';
            menu += '│ 🚫 البلاك: ' + blackList.length + '\n';
            menu += '│ 👥 الأعضاء: ' + meta.participants.length + '\n';
            menu += '│ 🛡️ المشرفين: ' + admins + '\n';
            menu += '│ 🔗 الروابط: ' + (lockLinks ? 'مقفولة' : 'مفتوحة') + '\n';
            menu += '│ 📌 الحالة: مفتوح\n';
            menu += '╰─── 🍷 ───╯\n\n';
            menu += '⚙️ ادوات اضافية ⚙️\n';
            menu += '• .ابيض + رقم\n• .الغاء ابيض + رقم\n• .اضف بلاك + رقم\n• .الغاء بلاك + رقم\n• .بيضاء\n• .بلاك\n• .قائمة\n• .حذف / .حذف ابيض / .حذف بلاك\n• .فتح / .سكر\n• .قفل الروابط / .فتح الروابط\n• .معلومات\n• .ping\n\nMADE BY RAYMON';
            await reply(from, menu); continue;
          }
          if (lower === '.معلومات') {
            let meta = await sock.groupMetadata(from);
            let admins = meta.participants.filter(p => p.admin).length;
            let info = '╭─── 🍷 ───╮\n';
            info += '│ 📛 القروب: ' + meta.subject + '\n';
            info += '│ 👥 الأعضاء: ' + meta.participants.length + '\n';
            info += '│ 🛡️ المشرفين: ' + admins + '\n';
            info += '│ 🔓 الحالة: مفتوح\n';
            info += '│ 📅 التاريخ: ' + new Date().toLocaleString('ar-LY') + '\n';
            info += '╰─── 🍷 ───╯\nMADE BY RAYMON';
            await reply(from, info); continue;
          }
          if (lower === '.بيضاء') { await reply(from, '🤍 البيضاء:\n' + (whiteList.length ? whiteList.join('\n') : 'فاضية')); continue; }
          if (lower === '.بلاك') { await reply(from, '🚫 البلاك:\n' + (blackList.length ? blackList.join('\n') : 'فاضي')); continue; }
          if (lower === '.قائمة') { await reply(from, '🤍 بيضاء: ' + whiteList.length + '\n🚫 بلاك: ' + blackList.length); continue; }
          if (lower === '.فتح') { try { await sock.groupSettingUpdate(from, 'not_announcement'); await reply(from, '✅ فتحت القروب'); } catch {} continue; }
          if (lower === '.سكر' || lower === '.قفل') { try { await sock.groupSettingUpdate(from, 'announcement'); await reply(from, '🔒 سكرت القروب'); } catch {} continue; }
          if (lower === '.قفل الروابط') { lockLinks = true; saveLists(); await reply(from, '🔗 قفلت الروابط'); continue; }
          if (lower === '.فتح الروابط') { lockLinks = false; saveLists(); await reply(from, '🔗 فتحت الروابط'); continue; }
          if (lower === '.حذف') { whiteList = []; blackList = []; saveLists(); await reply(from, '✅ مسحت البيضاء والبلاك كلهم'); continue; }
          if (lower.startsWith('.ابيض')) { let n = norm(text); if (n) { if (!whiteList.includes(n)) whiteList.push(n); saveLists(); await reply(from, '✅ ضفته للبيضاء: ' + n); } continue; }
          if (lower.startsWith('.الغاء ابيض')) { let n = norm(text); whiteList = whiteList.filter(x => x !== n); saveLists(); await reply(from, '✅ نحيته من البيضاء: ' + n); continue; }
          if (lower.startsWith('.اضف بلاك')) { let n = norm(text); if (n) { if (!blackList.includes(n)) blackList.push(n); saveLists(); await reply(from, '✅ ضفته للبلاك: ' + n); } continue; }
          if (lower.startsWith('.الغاء بلاك')) { let n = norm(text); blackList = blackList.filter(x => x !== n); saveLists(); await reply(from, '✅ نحيته من البلاك: ' + n); continue; }
          if (lower.startsWith('.حذف ابيض')) { whiteList = []; saveLists(); await reply(from, '✅ مسحت البيضاء كلها'); continue; }
          if (lower.startsWith('.حذف بلاك')) { blackList = []; saveLists(); await reply(from, '✅ مسحت البلاك كله'); continue; }
          continue;
        }
        if (isWhiteSender) continue;
        if (BAN_WORDS.some(w => lower.includes(w))) {
          await deleteMsg(from, m.key);
          if (!blackList.includes(senderNum)) { blackList.push(senderNum); saveLists(); }
          await kickUser(from, sender);
          await reply(from, '🚨 طردت ' + senderNum + ' السبب: كلمة تبنيد');
          await notifyOwner('🚨 طردت ' + senderNum + ' السبب: كلمة تبنيد');
          continue;
        }
        if (isForward) {
          await deleteMsg(from, m.key);
          await kickUser(from, sender);
          await reply(from, '🚨 طردت ' + senderNum + ' السبب: إعادة توجيه');
          await notifyOwner('🚨 طردت ' + senderNum + ' السبب: إعادة توجيه');
          continue;
        }
        if (hasLink(text)) {
          if (lockLinks) {
            await deleteMsg(from, m.key);
            await kickUser(from, sender);
            await reply(from, '🚨 طردت ' + senderNum + ' السبب: الروابط مقفولة');
            continue;
          }
          await deleteMsg(from, m.key);
          linkCount[senderNum] = (linkCount[senderNum] || 0) + 1;
          if (linkCount[senderNum] >= 2) {
            await kickUser(from, sender);
            await reply(from, '🚨 طردت ' + senderNum + ' السبب: رابط مكرر');
            linkCount[senderNum] = 0;
          } else {
            await lockGroup(from);
            await reply(from, '🔒 سكرت القروب 5 دقايق - ' + senderNum + ' بعت رابط');
          }
          continue;
        }
        if (isSticker) {
          let now = Date.now();
          if (!stickerCount[senderNum]) stickerCount[senderNum] = [];
          stickerCount[senderNum] = stickerCount[senderNum].filter(t => now - t < 10000);
          stickerCount[senderNum].push(now);
          if (stickerCount[senderNum].length > 2) {
            await deleteMsg(from, m.key);
            await reply(from, '🧹 حذفت ملصق سبام من ' + senderNum);
            continue;
          }
        }
        let now2 = Date.now();
        if (!floodCount[senderNum]) floodCount[senderNum] = [];
        floodCount[senderNum] = floodCount[senderNum].filter(t => now2 - t < 5000);
        floodCount[senderNum].push(now2);
        if (floodCount[senderNum].length > 5) {
          await deleteMsg(from, m.key);
          await reply(from, '🧹 حذفت فيضان من ' + senderNum);
        }
      } catch (e) { console.log('Error:', e.message); }
    }
  });
}
app.get('/', (req, res) => res.send('Bot Running'));
app.get('/qr', async (req, res) => {
  if (!qrCode) return res.send('No QR - Already connected');
  const img = await qrcode.toDataURL(qrCode);
  res.send('<img src="' + img + '"><h2>Scan QR</h2>');
});
app.listen(process.env.PORT || 10000);
startBot();
