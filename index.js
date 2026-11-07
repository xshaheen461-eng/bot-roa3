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
try { whiteList = JSON.parse(fs.readFileSync('whitelist.json')); } catch {}
try { blackList = JSON.parse(fs.readFileSync('blacklist.json')); } catch {}
const saveLists = () => {
  fs.writeFileSync('whitelist.json', JSON.stringify(whiteList));
  fs.writeFileSync('blacklist.json', JSON.stringify(blackList));
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
    if (u.connection === 'open') { qrCode = ''; console.log('Bot connected'); notifyOwner('Bot connected OK'); }
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
        await notifyOwner('Raid attack! Locked group and kicked');
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
          if (lower === '.ping') { await notifyOwner('Bot online OK'); continue; }
          if (lower === '.white' || lower === '.بيضاء') { await notifyOwner('White: ' + (whiteList.length ? whiteList.join(',') : 'empty')); continue; }
          if (lower === '.black' || lower === '.بلاك') { await notifyOwner('Black: ' + (blackList.length ? blackList.join(',') : 'empty')); continue; }
          if (lower === '.list' || lower === '.قائمة') { await notifyOwner('White: ' + whiteList.length + '\nBlack: ' + blackList.length); continue; }
          if (lower.startsWith('.addwhite') || lower.startsWith('.ابيض')) { let n = norm(text); if 👎 { if (!whiteList.includes(n)) whiteList.push(n); saveLists(); await notifyOwner('Added white: ' + n); } continue; }
          if (lower.startsWith('.delwhite') || lower.startsWith('.الغاء ابيض')) { let n = norm(text); whiteList = whiteList.filter(x => x !== n); saveLists(); await notifyOwner('Removed white: ' + n); continue; }
          if (lower.startsWith('.addblack') || lower.startsWith('.بلاك اضف') || lower.startsWith('.اضف بلاك')) { let n = norm(text); if 👎 { if (!blackList.includes(n)) blackList.push(n); saveLists(); await notifyOwner('Added black: ' + n); } continue; }
          if (lower.startsWith('.delblack') || lower.startsWith('.الغاء بلاك')) { let n = norm(text); blackList = blackList.filter(x => x !== n); saveLists(); await notifyOwner('Removed black: ' + n); continue; }
          if (lower.startsWith('.clearwhite') || lower.startsWith('.حذف ابيض')) { whiteList = []; saveLists(); await notifyOwner('Cleared white'); continue; }
          if (lower.startsWith('.clearblack') || lower.startsWith('.حذف بلاك')) { blackList = []; saveLists(); await notifyOwner('Cleared black'); continue; }
          continue;
        }
        if (isWhiteSender) continue;
        if (BAN_WORDS.some(w => lower.includes(w))) {
          await deleteMsg(from, m.key);
          if (!blackList.includes(senderNum)) { blackList.push(senderNum); saveLists(); }
          await kickUser(from, sender);
          await notifyOwner('Kicked ban word: ' + senderNum);
          continue;
        }
        if (isForward) {
          await deleteMsg(from, m.key);
          await kickUser(from, sender);
          await notifyOwner('Kicked forward: ' + senderNum);
          continue;
        }
        if (hasLink(text)) {
          await deleteMsg(from, m.key);
          linkCount[senderNum] = (linkCount[senderNum] || 0) + 1;
          if (linkCount[senderNum] >= 2) {
            await kickUser(from, sender);
            await notifyOwner('Kicked link: ' + senderNum);
            linkCount[senderNum] = 0;
          } else {
            await lockGroup(from);
            await notifyOwner('Locked group link from: ' + senderNum);
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
            await notifyOwner('Deleted sticker spam: ' + senderNum);
            continue;
          }
        }
        let now2 = Date.now();
        if (!floodCount[senderNum]) floodCount[senderNum] = [];
        floodCount[senderNum] = floodCount[senderNum].filter(t => now2 - t < 5000);
        floodCount[senderNum].push(now2);
        if (floodCount[senderNum].length > 5) {
          await deleteMsg(from, m.key);
          await notifyOwner('Deleted flood: ' + senderNum);
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
