const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode');
const fs = require('fs');
const pino = require('pino');
const OWNER_NUMBER = (process.env.OWNER_NUMBER || '218920972444').replace(/[^0-9]/g,'');
// حط هنا ID تجريبي و ID لوحة تحكم بعد ما تجيبهم بـ .ايدي
const ALLOWED_GROUP = 'حط هنا ID تجريبي';
const CONTROL_GROUP = 'حط هنا ID لوحة تحكم';
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
  // التنبيهات التلقائية تمشي للوحة تحكم بس، مش للتجريبي، باش يكون مخفي
  if (!sock) return;
  const target = (CONTROL_GROUP && !CONTROL_GROUP.includes('حط هنا')) ? CONTROL_GROUP : ALLOWED_GROUP;
  try { await sock.sendMessage(target, { text }); } catch {}
}
async function reply(jid, text) {
  // رد أوامرك يجي في نفس المكان اللي بعت منه، ويطلع باسم "انت"
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
    if (u.connection === 'open') { qrCode = ''; console.log('Bot connected'); notifyOwner('✅ البوت متصل - يخدم في تجريبي بس'); }
    if (u.connection === 'close') {
      const should = (u.lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      if (should) startBot();
    }
  });
  sock.ev.on('group-participants.update', async (u) => {
    try {
      if (u.action !== 'add') return;
      const jid = u.id;
      if (jid !== ALLOWED_GROUP) return;
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
        await notifyOwner('🚨 هجوم بوتات في تجريبي! سكرت القروب وطردتهم بصمت');
        joinTimes[jid] = [];
      }
    } catch (e) { console.log('Raid Error:', e.message); }
  });
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const m of messages) {
      try {
        if (!m.message) continue;
        const from = m.key.remoteJid;
        const isGroup = from?.endsWith('@g.us');
        // البوت يخدم في تجريبي ولوحة تحكم بس
        if (isGroup && from !== ALLOWED_GROUP && from !== CONTROL_GROUP) continue;
        const sender = m.key.participant || m.key.remoteJid;
        const senderNum = norm(sender);
        const isOwnerSender = isOwner(senderNum) || m.key.fromMe || sender === OWNER_NUMBER + '@s.whatsapp.net';
        const isWhiteSender = isWhite(senderNum);
        const isBlackSender = isBlack(senderNum);
        const text = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || m.message.videoMessage?.caption || '';
        const lower = text.toLowerCase().trim().replace(/_/g,' ');
        const isForward = m.message.extendedTextMessage?.contextInfo?.isForwarded || m.message.imageMessage?.contextInfo?.isForwarded || m.message.videoMessage?.contextInfo?.isForwarded;
        const isSticker = !!m.message.stickerMessage;
        const ctx = m.message.extendedTextMessage?.contextInfo;
        const quotedParticipant = ctx?.participant;
        const quotedKey = ctx?.stanzaId ? { remoteJid: from, id: ctx.stanzaId, participant: quotedParticipant, fromMe: false } : null;
        if (isOwnerSender) {
          if (lower === '.ايدي') { await reply(from, 'ID متع القروب:\n' + from); continue; }
          if (lower === '.ping') { await reply(from, '✅ Bot online - يخدم في تجريبي بس'); continue; }
          if (lower === '.ادوات') {
            let menu = '╭─── 🍷 ───╮\n';
            menu += '│ 🤍 البيضاء: ' + whiteList.length + '\n';
            menu += '│ 🚫 البلاك: ' + blackList.length + '\n';
            menu += '│ 🔗 الروابط: ' + (lockLinks ? 'مقفولة' : 'مفتوحة') + '\n';
            menu += '│ 👻 الوضع: مخفي - يخدم في تجريبي بس\n';
            menu += '╰─── 🍷 ───╯\n\n';
            menu += '⚙️ اوامر ⚙️\n';
            menu += '• .ايدي - يطلع ID القروب\n';
            menu += '• .ابيض + رقم\n• .الغاء ابيض + رقم\n';
            menu += '• .حظر - بالرد على رسالة\n• .فك حظر + رقم\n';
            menu += '• .بيضاء / .بلاك / .قائمة\n';
            menu += '• .حذف - رد على رسالة تحذفها\n• .حذف القوائم\n• .فتح / .سكر\n• .قفل الروابط / .فتح الروابط\n• .طرد - رد على رسالة\n• .معلومات\n• .ping';
            await reply(from, menu); continue;
          }
          if (lower === '.معلومات' && isGroup) {
            let meta = await sock.groupMetadata(from);
            let admins = meta.participants.filter(p => p.admin).length;
            let info = '╭─── 🍷 ───╮\n';
            info += '│ 📛 القروب: ' + meta.subject + '\n';
            info += '│ 👥 الأعضاء: ' + meta.participants.length + '\n';
            info += '│ 🛡️ المشرفين: ' + admins + '\n';
            info += '│ 📅 التاريخ: ' + new Date().toLocaleString('ar-LY') + '\n';
            info += '╰─── 🍷 ───╯';
            await reply(from, info); continue;
          }
          if (lower === '.بيضاء') { await reply(from, '🤍 البيضاء:\n' + (whiteList.length ? whiteList.join('\n') : 'فاضية')); continue; }
          if (lower === '.بلاك') { await reply(from, '🚫 البلاك:\n' + (blackList.length ? blackList.join('\n') : 'فاضي')); continue; }
          if (lower === '.قائمة') { await reply(from, '🤍 بيضاء: ' + whiteList.length + '\n🚫 بلاك: ' + blackList.length); continue; }
          if (lower === '.فتح' && isGroup) { try { await sock.groupSettingUpdate(from, 'not_announcement'); await reply(from, '✅ فتحت القروب'); } catch {} continue; }
          if ((lower === '.سكر' || lower === '.قفل') && isGroup) { try { await sock.groupSettingUpdate(from, 'announcement'); await reply(from, '🔒 سكرت القروب'); } catch {} continue; }
          if (lower === '.قفل الروابط') { lockLinks = true; saveLists(); await reply(from, '🔗 قفلت الروابط'); continue; }
          if (lower === '.فتح الروابط') { lockLinks = false; saveLists(); await reply(from, '🔗 فتحت الروابط'); continue; }
          if (lower === '.حذف' && isGroup) {
            if (quotedKey) { await deleteMsg(from, quotedKey); await notifyOwner('✅ تم الحذف - حذفت الرسالة بصمت'); }
            else { await reply(from, '⚠️ رد على الرسالة اللي تبي تحذفها واكتب .حذف'); }
            continue;
          }
          if (lower === '.حذف القوائم' || lower === '.حذف الكل') { whiteList = []; blackList = []; saveLists(); await reply(from, '✅ مسحت البيضاء والبلاك كلهم'); continue; }
          if (lower === '.حذف ابيض') { whiteList = []; saveLists(); await reply(from, '✅ مسحت البيضاء كلها'); continue; }
          if (lower === '.حذف بلاك') { blackList = []; saveLists(); await reply(from, '✅ مسحت البلاك كله'); continue; }
          if (lower.startsWith('.طرد')) {
            if (!isGroup) { await reply(from, '⚠️ .طرد يخدم في القروب بس'); continue; }
            let target = null;
            if (quotedParticipant) target = quotedParticipant;
            else { let n = norm(text); if (n && n.length > 5) target = n + '@s.whatsapp.net'; }
            if (target) {
              await kickUser(from, target);
              if (!blackList.includes(norm(target))) { blackList.push(norm(target)); saveLists(); }
              await notifyOwner('🚨 طردت ' + target.split('@')[0] + '\nالسبب: أمر منك .طرد');
            } else { await reply(from, '⚠️ رد على رسالة الشخص واكتب .طرد'); }
            continue;
          }
          if (lower.startsWith('.حظر')) {
            let n = norm(text);
            if (quotedParticipant) n = norm(quotedParticipant);
            if (n) {
              if (!blackList.includes(n)) blackList.push(n);
              saveLists();
              await reply(from, '🚫 حظرت: ' + n);
            } else { await reply(from, '⚠️ اكتب .حظر + رقم، ولا رد على رسالته واكتب .حظر'); }
            continue;
          }
          if (lower.startsWith('.فك حظر') || lower.startsWith('.الغاء حظر') || lower.startsWith('.الغاء بلاك') || lower === '.فك' || lower.startsWith('.فك ')) {
            let targetNum = norm(text);
            if (quotedParticipant) targetNum = norm(quotedParticipant);
            if (targetNum) {
              blackList = blackList.filter(x => x !== targetNum);
              saveLists();
              await reply(from, '✅ فكيت الحظر على: ' + targetNum);
            } else { await reply(from, '⚠️ اكتب .فك حظر + رقم'); }
            continue;
          }
          if (lower.startsWith('.ابيض')) { let n = norm(text); if (n) { if (!whiteList.includes(n)) whiteList.push(n); saveLists(); await reply(from, '✅ ضفته للبيضاء: ' + n); } continue; }
          if (lower.startsWith('.الغاء ابيض')) { let n = norm(text); whiteList = whiteList.filter(x => x !== n); saveLists(); await reply(from, '✅ نحيته من البيضاء: ' + n); continue; }
          if (lower.startsWith('.اضف بلاك')) { let n = norm(text); if (n) { if (!blackList.includes(n)) blackList.push(n); saveLists(); await reply(from, '✅ ضفته للبلاك: ' + n); } continue; }
          continue;
        }
        if (!isGroup) continue;
        if (from !== ALLOWED_GROUP) continue;
        if (isWhiteSender) continue;
        if (isBlackSender) { await deleteMsg(from, m.key); await kickUser(from, sender); await notifyOwner('🚨 طردت ' + senderNum + '\nالسبب: في البلاك'); continue; }
        if (BAN_WORDS.some(w => lower.includes(w))) {
          await deleteMsg(from, m.key);
          if (!blackList.includes(senderNum)) { blackList.push(senderNum); saveLists(); }
          await kickUser(from, sender);
          await notifyOwner('🚨 طردت ' + senderNum + '\nالسبب: كلمة تبنيد / تخريب / هكر');
          continue;
        }
        if (isForward) {
          await deleteMsg(from, m.key);
          await kickUser(from, sender);
          await notifyOwner('🚨 طردت ' + senderNum + '\nالسبب: إعادة توجيه');
          continue;
        }
        if (hasLink(text)) {
          if (lockLinks) {
            await deleteMsg(from, m.key);
            await kickUser(from, sender);
            await notifyOwner('🚨 طردت ' + senderNum + '\nالسبب: الروابط مقفولة');
            continue;
          }
          await deleteMsg(from, m.key);
          linkCount[senderNum] = (linkCount[senderNum] || 0) + 1;
          if (linkCount[senderNum] >= 2) {
            await kickUser(from, sender);
            await notifyOwner('🚨 طردت ' + senderNum + '\nالسبب: رابط مكرر');
            linkCount[senderNum] = 0;
          } else {
            await lockGroup(from);
            await notifyOwner('🔒 سكرت القروب 5 دقايق\nالسبب: ' + senderNum + ' بعت رابط');
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
            await notifyOwner('🧹 حذفت ملصق سبام من ' + senderNum);
            continue;
          }
        }
        let now2 = Date.now();
        if (!floodCount[senderNum]) floodCount[senderNum] = [];
        floodCount[senderNum] = floodCount[senderNum].filter(t => now2 - t < 5000);
        floodCount[senderNum].push(now2);
        if (floodCount[senderNum].length > 5) {
          await deleteMsg(from, m.key);
          await notifyOwner('🧹 حذفت فيضان من ' + senderNum);
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
