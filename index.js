const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode');
const fs = require('fs');
const pino = require('pino');
const OWNER_NUMBER = (process.env.OWNER_NUMBER || '218920972444').replace(/[^0-9]/g,'');
const CONTROL_GROUP = '120363430679974162@g.us';
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
const extractAllNumbers = (text) => {
  if (!text) return [];
  let clean = text.replace(/https?:\/\/\S+/g,'').replace(/chat\.whatsapp\.com\/\S+/g,'');
  let matches = clean.match(/\d{7,15}/g) || [];
  let out = [];
  for (let n of matches) {
    if (n.startsWith('12036')) continue;
    if (n.length < 7) continue;
    if (!out.includes(n)) out.push(n);
  }
  return out;
};
const isOwner = n => norm(n) === OWNER_NUMBER;
const isWhite = n => whiteList.includes(norm(n));
const isBlack = n => blackList.includes(norm(n));
let linkCount = {};
let stickerCount = {};
let floodCount = {};
let joinTimes = {};

// --- جديد: يجيب اسم القروب بدل الـ ID ---
let groupNameCache = {};
async function getGroupName(jid) {
  if (!jid || !jid.endsWith('@g.us')) return jid;
  if (groupNameCache[jid]) return groupNameCache[jid];
  try {
    const meta = await sock.groupMetadata(jid);
    groupNameCache[jid] = meta.subject || jid;
    return groupNameCache[jid];
  } catch { return jid; }
}
async function notifyOwner(text) {
  if (!sock) return;
  try {
    // يدور على أي ID قروب في الرسالة ويبدله باسمه
    let finalText = text;
    let ids = text.match(/\d+@g\.us/g) || [];
    for (let id of ids) {
      let name = await getGroupName(id);
      finalText = finalText.replaceAll(id, '📌 ' + name);
    }
    await sock.sendMessage(CONTROL_GROUP, { text: finalText });
  } catch {}
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
    if (u.connection === 'open') { qrCode = ''; console.log('Bot connected'); notifyOwner('✅ البوت متصل - يخدم في كل القروبات'); }
    if (u.connection === 'close') {
      const should = (u.lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      if (should) startBot();
    }
  });
  sock.ev.on('group-participants.update', async (u) => {
    try {
      if (u.action !== 'add') return;
      const jid = u.id;
      if (jid === CONTROL_GROUP) return;
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
        await notifyOwner('🚨 هجوم بوتات في قروب ' + jid + '! سكرت القروب وطردتهم بصمت');
        joinTimes[jid] = [];
      }
    } catch (e) { console.log('Raid Error:', e.message); }
  });
  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const m of messages) {
      try {
        if (!m.message) continue;
        if (m.key.fromMe) continue;
        const from = m.key.remoteJid;
        const isGroup = from?.endsWith('@g.us');
        const sender = m.key.participant || m.key.remoteJid;
        const senderNum = norm(sender);
        if (sock && sender === sock.user?.id) continue;
        const isOwnerSender = isOwner(senderNum) || sender === OWNER_NUMBER + '@s.whatsapp.net';
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
          if (lower === '.ping') { await reply(from, '✅ Bot online - يخدم في كل القروبات'); continue; }
          if (lower === '.ادوات') {
            let menu = '╭─── 🍷 ───╮\n';
            menu += '│ 🤍 البيضاء: ' + whiteList.length + '\n';
            menu += '│ 🚫 البلاك: ' + blackList.length + '\n';
            menu += '│ 🔗 الروابط: ' + (lockLinks ? 'مقفولة' : 'مفتوحة') + '\n';
            menu += '│ 👻 الوضع: يخدم في كل القروبات\n';
            menu += '╰─── 🍷 ───╯\n\n';
            menu += '⚙️ اوامر ⚙️\n';
            menu += '• .ايدي\n• حظر جماعي: الصق أرقام + كلمة الأمر في الأخير\n• ابيض جماعي: الصق أرقام + كلمة الأمر في الأخير\n• فك حظر جماعي: الصق أرقام + كلمة الأمر في الأخير\n• .بيضاء / .بلاك / .قائمة\n• .حذف - رد على رسالة\n• .حذف بلاك\n• .فتح / .سكر\n• .قفل الروابط / .فتح الروابط\n• .طرد - رد على رسالة\n• .معلومات\n• .ping';
            await reply(from, menu); continue;
          }
          if (lower === '.معلومات' && isGroup) {
            let meta = await sock.groupMetadata(from);
            let admins = meta.participants.filter(p => p.admin).length;
            let info = '╭─── 🍷 ───╮\n│ 📛 القروب: ' + meta.subject + '\n│ 👥 الأعضاء: ' + meta.participants.length + '\n│ 🛡️ المشرفين: ' + admins + '\n╰─── 🍷 ───╯';
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
            if (quotedKey) { await deleteMsg(from, quotedKey); await notifyOwner('✅ تم الحذف في قروب ' + from); }
            else { await reply(from, '⚠️ رد على الرسالة اللي تبي تحذفها'); }
            continue;
          }
          if (lower === '.حذف القوائم' || lower === '.حذف الكل') { whiteList = []; blackList = []; saveLists(); await reply(from, '✅ مسحت البيضاء والبلاك كلهم'); continue; }
          if (lower === '.حذف ابيض') { whiteList = []; saveLists(); await reply(from, '✅ مسحت البيضاء كلها'); continue; }
          if (lower === '.حذف بلاك') { blackList = []; saveLists(); await reply(from, '✅ مسحت البلاك كله'); continue; }
          if (lower.startsWith('.طرد')) {
            if (!isGroup) { await reply(from, '⚠️ الطرد يخدم في القروب بس'); continue; }
            let target = null;
            if (quotedParticipant) target = quotedParticipant;
            else { let nums = extractAllNumbers(text); if (nums.length) target = nums[0] + '@s.whatsapp.net'; }
            if (target) {
              await kickUser(from, target);
              if (!blackList.includes(norm(target))) { blackList.push(norm(target)); saveLists(); }
              await notifyOwner('🚨 طردت ' + target.split('@')[0] + ' من قروب ' + from);
            } else { await reply(from, '⚠️ رد على رسالة الشخص'); }
            continue;
          }
          if (lower.includes('.حظر') || lower.includes('.اضف بلاك')) {
            let nums = [];
            if (quotedParticipant) nums = [norm(quotedParticipant)];
            else nums = extractAllNumbers(text);
            if (nums.length) {
              for (let n of nums) { if (!blackList.includes(n)) blackList.push(n); }
              saveLists();
              await reply(from, '🚫 حظرت ' + nums.length + ' رقم\nتم اضافتهم للبلاك، توا أي واحد منهم يخش أي قروب ينطرد بروحه');
            } else { await reply(from, '⚠️ ابعت رقم ولا قائمة أرقام، وحط كلمة الأمر في الأخير'); }
            continue;
          }
          if (lower.includes('.فك حظر') || lower.includes('.الغاء حظر') || lower.includes('.الغاء بلاك')) {
            let nums = [];
            if (quotedParticipant) nums = [norm(quotedParticipant)];
            else nums = extractAllNumbers(text);
            if (nums.length) {
              for (let n of nums) blackList = blackList.filter(x => x !== n);
              saveLists();
              await reply(from, '✅ فكيت الحظر على ' + nums.length + ' رقم');
            } else { await reply(from, '⚠️ ابعت رقم مع أمر فك الحظر'); }
            continue;
          }
          if (lower.includes('.ابيض')) {
            let nums = extractAllNumbers(text);
            if (nums.length) {
              for (let n of nums) { if (!whiteList.includes(n)) whiteList.push(n); }
              saveLists();
              await reply(from, '✅ ضفت ' + nums.length + ' رقم للبيضاء');
            }
            continue;
          }
          if (lower.includes('.الغاء ابيض')) {
            let nums = extractAllNumbers(text);
            for (let n of nums) whiteList = whiteList.filter(x => x !== n);
            saveLists();
            await reply(from, '✅ نحيت ' + nums.length + ' رقم من البيضاء');
            continue;
          }
          continue;
        }
        if (!isGroup) continue;
        if (from === CONTROL_GROUP) continue;
        if (isWhiteSender) continue;
        if (isBlackSender) { await deleteMsg(from, m.key); await kickUser(from, sender); await notifyOwner('🚨 طردت ' + senderNum + ' من قروب ' + from + '\nالسبب: في البلاك'); continue; }
        if (BAN_WORDS.some(w => lower.includes(w))) {
          await deleteMsg(from, m.key);
          if (!blackList.includes(senderNum)) { blackList.push(senderNum); saveLists(); }
          await kickUser(from, sender);
          await notifyOwner('🚨 طردت ' + senderNum + ' من قروب ' + from + '\nالسبب: كلمة تبنيد / تخريب / هكر');
          continue;
        }
        if (isForward) {
          await deleteMsg(from, m.key);
          await kickUser(from, sender);
          await notifyOwner('🚨 طردت ' + senderNum + ' من قروب ' + from + '\nالسبب: إعادة توجيه');
          continue;
        }
        if (hasLink(text)) {
          if (lockLinks) {
            await deleteMsg(from, m.key);
            await kickUser(from, sender);
            await notifyOwner('🚨 طردت ' + senderNum + ' من قروب ' + from + '\nالسبب: الروابط مقفولة');
            continue;
          }
          await deleteMsg(from, m.key);
          linkCount[senderNum] = (linkCount[senderNum] || 0) + 1;
          if (linkCount[senderNum] >= 2) {
            await kickUser(from, sender);
            await notifyOwner('🚨 طردت ' + senderNum + ' من قروب ' + from + '\nالسبب: رابط مكرر');
            linkCount[senderNum] = 0;
          } else {
            await lockGroup(from);
            await notifyOwner('🔒 سكرت القروب ' + from + ' 5 دقايق\nالسبب: ' + senderNum + ' بعت رابط');
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
            await notifyOwner('🧹 حذفت ملصق سبام من ' + senderNum + ' في قروب ' + from);
            continue;
          }
        }
        let now2 = Date.now();
        if (!floodCount[senderNum]) floodCount[senderNum] = [];
        floodCount[senderNum] = floodCount[senderNum].filter(t => now2 - t < 5000);
        floodCount[senderNum].push(now2);
        if (floodCount[senderNum].length > 5) {
          await deleteMsg(from, m.key);
          await notifyOwner('🧹 حذفت فيضان من ' + senderNum + ' في قروب ' + from);
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
app.listen(process.env.PORT || 100
