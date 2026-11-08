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
try { whiteList = JSON.parse(fs.readFileSync('whitelist.json')); } catch(e) {}
try { blackList = JSON.parse(fs.readFileSync('blacklist.json')); } catch(e) {}
try { lockLinks = JSON.parse(fs.readFileSync('settings.json')).lockLinks || false; } catch(e) {}
const saveLists = () => {
  fs.writeFileSync('whitelist.json', JSON.stringify(whiteList));
  fs.writeFileSync('blacklist.json', JSON.stringify(blackList));
  fs.writeFileSync('settings.json', JSON.stringify({ lockLinks }));
};
const norm = (s) => (s || '').replace(/[^0-9]/g,'');
const getNum = (id) => norm((id || '').split(':')[0].split('@')[0]);
const extractAllNumbers = (text) => {
  if (!text) return [];
  let clean = text.replace(/https?:\/\/\S+/g,'').replace(/chat\.whatsapp\.com\/\S+/g,'');
  let matches = clean.match(/[0-9]{7,15}/g) || [];
  let out = [];
  for (let n of matches) {
    if (n.indexOf('12036') === 0) continue;
    if (n.length < 7) continue;
    if (out.indexOf(n) === -1) out.push(n);
  }
  return out;
};
const isOwner = (n) => norm(n) === OWNER_NUMBER;
const isWhite = (n) => whiteList.indexOf(norm(n)) !== -1;
const isBlack = (n) => blackList.indexOf(norm(n)) !== -1;
function getMyIds() {
  if (!sock || !sock.user) return [OWNER_NUMBER];
  let ids = [];
  if (sock.user.id) ids.push(getNum(sock.user.id));
  if (sock.user.lid) ids.push(getNum(sock.user.lid));
  ids.push(OWNER_NUMBER);
  return ids;
}
function isMe(p) {
  let myIds = getMyIds();
  let pid = getNum(p.id);
  let pPhone = p.phoneNumber ? getNum(p.phoneNumber) : '';
  let pLid = p.lid ? getNum(p.lid) : '';
  return myIds.indexOf(pid) !== -1 || (pPhone && myIds.indexOf(pPhone) !== -1) || (pLid && myIds.indexOf(pLid) !== -1) || p.id === sock.user.id || p.id === sock.user.lid;
}
function getParticipantNum(p) {
  if (p.phoneNumber) return getNum(p.phoneNumber);
  return getNum(p.id);
}
function isWhiteParticipant(p) {
  if (!p) return false;
  let nums = [];
  if (typeof p === 'string') nums.push(getNum(p));
  else {
    if (p.id) nums.push(getNum(p.id));
    if (p.phoneNumber) nums.push(getNum(p.phoneNumber));
    if (p.lid) nums.push(getNum(p.lid));
  }
  for (let n of nums) if (isWhite(n)) return true;
  return false;
}
let linkCount = {};
let stickerCount = {};
let floodCount = {};
let joinTimes = {};
let groupNameCache = {};
async function getGroupName(jid) {
  if (!jid) return jid;
  if (groupNameCache[jid]) return groupNameCache[jid];
  try {
    const meta = await sock.groupMetadata(jid);
    groupNameCache[jid] = meta.subject || jid;
    return groupNameCache[jid];
  } catch(e) { return jid; }
}
async function notifyOwner(text) {
  if (!sock) return;
  try {
    let finalText = text;
    let matches = text.match(/[0-9]+@g\.us/g) || [];
    for (let jid of matches) {
      let name = await getGroupName(jid);
      finalText = finalText.split(jid).join('📌 ' + name);
    }
    await sock.sendMessage(CONTROL_GROUP, { text: finalText });
  } catch(e) {}
}
async function reply(jid, text) {
  try { await sock.sendMessage(jid, { text }); } catch(e) {}
}
async function lockGroup(jid) {
  try { await sock.groupSettingUpdate(jid, 'announcement'); } catch(e) {}
  setTimeout(async () => { try { await sock.groupSettingUpdate(jid, 'not_announcement'); } catch(e) {} }, 5*60*1000);
}
async function kickUser(jid, user) {
  try { await sock.groupParticipantsUpdate(jid, [user], 'remove'); } catch(e) {}
}
async function deleteMsg(jid, key) {
  try { await sock.sendMessage(jid, { delete: key }); } catch(e) {}
}
async function kickBlacklistedFromAllGroups() {
  if (!sock) return 0;
  let kicked = 0;
  try {
    const groups = await sock.groupFetchAllParticipating();
    for (let jid in groups) {
      if (jid === CONTROL_GROUP) continue;
      try {
        const meta = groups[jid];
        let me = null;
        for (let p of meta.participants) { if (isMe(p)) me = p; }
        if (!me || !me.admin) continue;
        for (let p of meta.participants) {
          let n = getParticipantNum(p);
          if (isWhiteParticipant(p)) continue;
          if (isBlack(n) && !isOwner(n)) {
            await kickUser(jid, p.id);
            kicked++;
            await notifyOwner('🚨 طردت ' + n + ' من قروب ' + jid + '\nالسبب: في البلاك - طرد تلقائي');
          }
        }
      } catch(e) {}
    }
  } catch(e) {}
  return kicked;
}
const hasLink = (t) => {
  if (!t) return false;
  let clean = t.toLowerCase().replace(/\s+/g,'').replace(/[:;]/g,':');
  return /(https?:\/\/|www\.|t\.me\/|telegram\.me\/|wa\.me\/|whatsapp\.com\/|chat\.whatsapp\.com|discord\.gg\/|instagram\.com\/|facebook\.com\/|youtube\.com\/|tiktok\.com\/|vt\.tiktok\.com|finder\.me|\.com|\.net|\.org|\.ly|\.io)/.test(clean);
};
const BAN_WORDS = ['.ban', 'تبنيد', 'تخريب', 'هكر'];
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({ version, auth: state, logger: pino({ level: 'silent' }), printQRInTerminal: false, syncFullHistory: false });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', (u) => {
    if (u.qr) { qrCode = u.qr; console.log('QR READY'); }
    if (u.connection === 'open') {
      qrCode = ''; console.log('Bot connected');
      notifyOwner('✅ البوت متصل - يخدم في كل القروبات');
      setTimeout(() => { kickBlacklistedFromAllGroups(); }, 8000);
      setInterval(() => { kickBlacklistedFromAllGroups(); }, 5*60*1000);
    }
    if (u.connection === 'close') {
      const should = (u.lastDisconnect && u.lastDisconnect.error && u.lastDisconnect.error.output && u.lastDisconnect.error.output.statusCode) !== DisconnectReason.loggedOut;
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
      joinTimes[jid] = joinTimes[jid].filter((t) => now - t < 30000);
      u.participants.forEach(() => joinTimes[jid].push(now));
      if (joinTimes[jid].length >= 3) {
        await lockGroup(jid);
        for (const p of u.participants) {
          if (isWhiteParticipant(p)) continue;
          if (!isOwner(getNum(p)) && !isWhite(getNum(p))) {
            await kickUser(jid, p);
            if (blackList.indexOf(getNum(p)) === -1) blackList.push(getNum(p));
          }
        }
        saveLists();
        await notifyOwner('🚨 هجوم بوتات في قروب ' + jid + '! سكرت القروب وطردتهم بصمت');
        joinTimes[jid] = [];
      }
    } catch(e) { console.log('Raid Error:', e.message); }
  });
  sock.ev.on('messages.upsert', async (up) => {
    let messages = up.messages;
    for (const m of messages) {
      try {
        if (!m.message) continue;
        const from = m.key.remoteJid;
        const isGroup = from && from.endsWith('@g.us');
        const sender = m.key.participant || m.key.remoteJid;
        const senderPn = m.key.participantPn || sender;
        const senderNum = getNum(senderPn);
        const senderLid = getNum(sender);
        const text = m.message.conversation || (m.message.extendedTextMessage && m.message.extendedTextMessage.text) || (m.message.imageMessage && m.message.imageMessage.caption) || (m.message.videoMessage && m.message.videoMessage.caption) || '';
        const isContact = !!m.message.contactMessage || !!m.message.contactsArrayMessage || !!m.message.contactMessageV2;
        if (m.key.fromMe) {
          let t = text.trim();
          if (t.indexOf('✅') === 0 || t.indexOf('🚫') === 0 || t.indexOf('🤍') === 0 || t.indexOf('🔒') === 0 || t.indexOf('🔗') === 0 || t.indexOf('╭') === 0 || t.indexOf('⚠️') === 0 || t.indexOf('🧹') === 0 || t.indexOf('📌') === 0 || t.indexOf('🚨') === 0) continue;
        }
        const isOwnerSender = isOwner(senderNum) || isOwner(senderLid) || m.key.fromMe || sender === OWNER_NUMBER + '@s.whatsapp.net';
        const isWhiteSender = isWhite(senderNum) || isWhite(senderLid);
        const isBlackSender = isBlack(senderNum) || isBlack(senderLid);
        const lower = text.toLowerCase().trim().replace(/_/g,' ');
        const isForward = (m.message.extendedTextMessage && m.message.extendedTextMessage.contextInfo && m.message.extendedTextMessage.contextInfo.isForwarded) || (m.message.imageMessage && m.message.imageMessage.contextInfo && m.message.imageMessage.contextInfo.isForwarded) || (m.message.videoMessage && m.message.videoMessage.contextInfo && m.message.videoMessage.contextInfo.isForwarded);
        const isSticker = !!m.message.stickerMessage;
        const ctx = m.message.extendedTextMessage ? m.message.extendedTextMessage.contextInfo : null;
        const quotedParticipant = ctx ? (ctx.participantPn || ctx.participant) : null;
        const quotedKey = (ctx && ctx.stanzaId) ? { remoteJid: from, id: ctx.stanzaId, participant: quotedParticipant, fromMe: false } : null;
        if (isOwnerSender) {
          if (lower === '.ايدي') { await reply(from, 'ID متع القروب:\n' + from); continue; }
          if (lower === '.ping') { await reply(from, '✅ Bot online - يخدم في كل القروبات'); continue; }
          if (lower === '.تشخيص') {
            try {
              const groups = await sock.groupFetchAllParticipating();
              let total = Object.keys(groups).length;
              let adminList = [];
              for (let jid in groups) {
                const meta = groups[jid];
                let me2 = null;
                for (let p of meta.participants) { if (isMe(p)) me2 = p; }
                if (me2 && me2.admin) adminList.push(meta.subject || jid);
              }
              let msg = '🔍 تشخيص:\nرقمي: ' + OWNER_NUMBER + '\nLID: ' + (sock.user.lid ? getNum(sock.user.lid) : 'مافيش') + '\nمجموع القروبات: ' + total + '\nأدمن في: ' + adminList.length + '\n' + (adminList.length ? adminList.join('\n') : 'ولا قروب') + '\nبيضاء: ' + whiteList.length + '\nبلاك: ' + blackList.length;
              await reply(from, msg);
            } catch(e) { await reply(from, 'خطأ تشخيص: ' + e.message); }
            continue;
          }
          if (lower === '.ادوات') {
            let menu = '╭─── 🍷 ───╮\n';
            menu += '│ 🤍 البيضاء: ' + whiteList.length + '\n';
            menu += '│ 🚫 البلاك: ' + blackList.length + '\n';
            menu += '│ 🔗 الروابط: ' + (lockLinks ? 'مقفولة' : 'مفتوحة') + '\n';
            menu += '│ 👻 الوضع: يخدم في كل القروبات\n';
            menu += '╰─── 🍷 ───╯\n\n';
            menu += '⚙️ اوامر ⚙️\n';
            menu += '• .ايدي\n• .تشخيص\n• حظر جماعي: الصق أرقام + كلمة الأمر في الأخير\n• ابيض جماعي: الصق أرقام + كلمة الأمر في الأخير\n• فك حظر جماعي: الصق أرقام + كلمة الأمر في الأخير\n• .بيضاء / .بلاك / .قائمة\n• .حذف - رد على رسالة\n• .حذف بلاك\n• .فتح / .سكر\n• .قفل الروابط / .فتح الروابط\n• .طرد - رد على رسالة\n• .معلومات\n• .ping';
            await reply(from, menu); continue;
          }
          if (lower === '.معلومات' && isGroup) {
            let meta = await sock.groupMetadata(from);
            let admins = meta.participants.filter((p) => p.admin).length;
            let info = '╭─── 🍷 ───╮\n│ 📛 القروب: ' + meta.subject + '\n│ 👥 الأعضاء: ' + meta.participants.length + '\n│ 🛡️ المشرفين: ' + admins + '\n╰─── 🍷 ───╯';
            await reply(from, info); continue;
          }
          if (lower === '.بيضاء') { await reply(from, '🤍 البيضاء:\n' + (whiteList.length ? whiteList.join('\n') : 'فاضية')); continue; }
          if (lower === '.بلاك') { await reply(from, '🚫 البلاك:\n' + (blackList.length ? blackList.join('\n') : 'فاضي')); continue; }
          if (lower === '.قائمة') { await reply(from, '🤍 بيضاء: ' + whiteList.length + '\n🚫 بلاك: ' + blackList.length); continue; }
          if (lower === '.فتح' && isGroup) { try { await sock.groupSettingUpdate(from, 'not_announcement'); await reply(from, '✅ فتحت القروب'); } catch(e) {} continue; }
          if ((lower === '.سكر' || lower === '.قفل') && isGroup) { try { await sock.groupSettingUpdate(from, 'announcement'); await reply(from, '🔒 سكرت القروب'); } catch(e) {} continue; }
          if (lower === '.قفل الروابط') { lockLinks = true; saveLists(); await reply(from, '🔗 قفلت الروابط'); continue; }
          if (lower === '.فتح الروابط') { lockLinks = false; saveLists(); await reply(from, '🔗 فتحت الروابط'); continue; }
          // --- جديد: .حذف ما يمسش البيضاء ---
          if (lower === '.حذف' && isGroup) {
            if (quotedParticipant && isWhite(getNum(quotedParticipant))) { await reply(from, '🤍 هذا في البيضاء - ما نقدرش نحذف رسايله'); continue; }
            if (quotedKey) { await deleteMsg(from, quotedKey); await notifyOwner('✅ تم الحذف في قروب ' + from); }
            else { await reply(from, '⚠️ رد على الرسالة اللي تبي تحذفها'); }
            continue;
          }
          if (lower === '.حذف القوائم' || lower === '.حذف الكل') { whiteList = []; blackList = []; saveLists(); await reply(from, '✅ مسحت البيضاء والبلاك كلهم'); continue; }
          if (lower === '.حذف ابيض') { whiteList = []; saveLists(); await reply(from, '✅ مسحت البيضاء كلها'); continue; }
          if (lower === '.حذف بلاك') { blackList = []; saveLists(); await reply(from, '✅ مسحت البلاك كله'); continue; }
          // --- جديد: .طرد ما يطردش البيضاء ---
          if (lower.indexOf('.طرد') === 0) {
            if (!isGroup) { await reply(from, '⚠️ الطرد يخدم في القروب بس'); continue; }
            let target = null;
            if (quotedParticipant) target = quotedParticipant;
            else { let nums = extractAllNumbers(text); if (nums.length) target = nums[0] + '@s.whatsapp.net'; }
            if (target) {
              if (isWhite(getNum(target))) { await reply(from, '🤍 هذا في البيضاء - ما نقدرش نطرده'); continue; }
              await kickUser(from, target);
              if (blackList.indexOf(getNum(target)) === -1) { blackList.push(getNum(target)); saveLists(); }
              await notifyOwner('🚨 طردت ' + getNum(target) + ' من قروب ' + from);
            } else { await reply(from, '⚠️ رد على رسالة الشخص'); }
            continue;
          }
          if (lower.indexOf('.حظر') !== -1 || lower.indexOf('.اضف بلاك') !== -1) {
            let nums = [];
            if (quotedParticipant) nums = [getNum(quotedParticipant)];
            else nums = extractAllNumbers(text);
            // --- جديد: نحي البيضاء من الحظر ---
            let toBan = nums.filter((n) => !isWhite(n));
            let blockedWhite = nums.filter((n) => isWhite(n));
            if (blockedWhite.length && !toBan.length) { await reply(from, '🤍 هادم في البيضاء - ما نقدرش نحظرهم'); continue; }
            if (toBan.length) {
              for (let n of toBan) { if (blackList.indexOf(n) === -1) blackList.push(n); }
              saveLists();
              await reply(from, '🚫 حظرت ' + toBan.length + ' رقم' + (blockedWhite.length ? '\n🤍 تجاهلت ' + blockedWhite.length + ' لأنهم في البيضاء' : '') + '\nتوا بنطردهم من كل القروبات اللي انت مشرف فيها');
              let k = await kickBlacklistedFromAllGroups();
              if (k > 0) await reply(from, '✅ طردت ' + k + ' واحد منهم كان قاعد جوا القروبات');
              else await reply(from, 'ℹ️ ما لقيت حد منهم قاعد جوا القروبات توا، بس لو خش أي قروب بينطرد بروحه');
            } else { await reply(from, '⚠️ ابعت رقم ولا قائمة أرقام، وحط كلمة الأمر في الأخير'); }
            continue;
          }
          if (lower.indexOf('.فك حظر') !== -1 || lower.indexOf('.الغاء حظر') !== -1 || lower.indexOf('.الغاء بلاك') !== -1) {
            let nums = [];
            if (quotedParticipant) nums = [getNum(quotedParticipant)];
            else nums = extractAllNumbers(text);
            if (nums.length) {
              for (let n of nums) blackList = blackList.filter((x) => x !== n);
              saveLists();
              await reply(from, '✅ فكيت الحظر على ' + nums.length + ' رقم');
            } else { await reply(from, '⚠️ ابعت رقم مع أمر فك الحظر'); }
            continue;
          }
          if (lower.indexOf('.ابيض') !== -1) {
            let nums = extractAllNumbers(text);
            if (nums.length) {
              for (let n of nums) {
                if (whiteList.indexOf(n) === -1) whiteList.push(n);
                blackList = blackList.filter((x) => x !== n);
              }
              saveLists();
              await reply(from, '✅ ضفت ' + nums.length + ' رقم للبيضاء');
            }
            continue;
          }
          if (lower.indexOf('.الغاء ابيض') !== -1) {
            let nums = extractAllNumbers(text);
            for (let n of nums) whiteList = whiteList.filter((x) => x !== n);
            saveLists();
            await reply(from, '✅ نحيت ' + nums.length + ' رقم من البيضاء');
            continue;
          }
          continue;
        }
        if (!isGroup) continue;
        if (from === CONTROL_GROUP) continue;
        // --- البيضاء: لا حذف ولا طرد ولا أي عقوبة ---
        if (isWhiteSender) continue;
        if (isBlackSender) { await deleteMsg(from, m.key); await kickUser(from, sender); await notifyOwner('🚨 طردت ' + senderNum + ' من قروب ' + from + '\nالسبب: في البلاك'); continue; }
        if (isContact) {
          await deleteMsg(from, m.key);
          await notifyOwner('🧹 حذفت جهة اتصال من ' + senderNum + ' في قروب ' + from);
          continue;
        }
        if (BAN_WORDS.some((w) => lower.indexOf(w) !== -1)) {
          await deleteMsg(from, m.key);
          if (blackList.indexOf(senderNum) === -1) { blackList.push(senderNum); saveLists(); }
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
          stickerCount[senderNum] = stickerCount[senderNum].filter((t) => now - t < 10000);
          stickerCount[senderNum].push(now);
          if (stickerCount[senderNum].length > 1) {
            await deleteMsg(from, m.key);
            await notifyOwner('🧹 حذفت ملصق سبام من ' + senderNum + ' في قروب ' + from);
            continue;
          }
        }
        let now2 = Date.now();
        if (!floodCount[senderNum]) floodCount[senderNum] = [];
        floodCount[senderNum] = floodCount[senderNum].filter((t) => now2 - t < 5000);
        floodCount[senderNum].push(now2);
        if (floodCount[senderNum].length > 5) {
          await deleteMsg(from, m.key);
          await notifyOwner('🧹 حذفت فيضان من ' + senderNum + ' في قروب ' + from);
        }
      } catch(e) { console.log('Error:', e.message); }
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
