const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode');
const fs = require('fs');
const pino = require('pino');
const OWNER_NUMBER = (process.env.OWNER_NUMBER || '218920972444').replace(/[^0-9]/g,'');
const CONTROL_GROUP = '120363430679974162@g.us';
const QR_SECRET = process.env.QR_SECRET || 'فتاك1234';
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
  let clean = text.replace(/\+/g,'').replace(/-/g,'');
  clean = clean.replace(/(\d)[\s\n]+(\d)/g, '$1$2');
  clean = clean.replace(/(\d)[\s\n]+(\d)/g, '$1$2');
  clean = clean.replace(/https?:\/\/\S+/g,'').replace(/chat\.whatsapp\.com\/\S+/g,'');
  let matches = clean.match(/[0-9]{9,15}/g) || [];
  let out = [];
  for (let n of matches) {
    if (n.indexOf('12036') === 0) continue;
    if (n.length < 9) continue;
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
let lidMap = {};
function linkLidToPhone(lid, phone) {
  if (!lid || !phone) return;
  lid = getNum(lid); phone = getNum(phone);
  if (lid === phone) return;
  lidMap[lid] = phone;
}
function getTargets(text, ctx, quotedParticipant) {
  let nums = [];
  let add = (n) => { n = getNum(n); if (n && nums.indexOf(n) === -1) nums.push(n); };
  if (quotedParticipant) add(quotedParticipant);
  if (ctx && ctx.mentionedJid) for (let j of ctx.mentionedJid) add(j);
  for (let n of extractAllNumbers(text)) add(n);
  return nums;
}
let linkCount = {};
let stickerCount = {};
let floodCount = {};
let joinTimes = {};
let groupNameCache = {};
let lastKickNotify = {};
let groupBaseName = {};
let lastRename = {};
let forwardedLocked = {};
async function getGroupName(jid) {
  if (!jid) return jid;
  if (groupNameCache[jid]) return groupNameCache[jid];
  try {
    const meta = await sock.groupMetadata(jid);
    groupNameCache[jid] = meta.subject || jid;
    return groupNameCache[jid];
  } catch(e) { return jid; }
}
async function rotateGroupNameOnKick(jid) {
  try {
    if (!jid || jid === CONTROL_GROUP) return;
    let now = Date.now();
    if (lastRename[jid] && now - lastRename[jid] < 5*60*1000) return;
    lastRename[jid] = now;
    const meta = await sock.groupMetadata(jid);
    let current = meta.subject || '';
    if (!groupBaseName[jid]) {
      groupBaseName[jid] = current.split(' | ')[0].replace(/🛡️/g,'').replace(/🔒/g,'').trim();
    }
    let base = groupBaseName[jid];
    let nowD = new Date();
    let suffix = nowD.getHours() + ':' + nowD.getMinutes() + ':' + nowD.getSeconds();
    let newName = base + ' | 🛡️ ' + suffix;
    await sock.groupUpdateSubject(jid, newName);
    groupNameCache[jid] = newName;
    console.log('تم تغيير اسم القروب بعد طرد مبند: ' + newName);
  } catch(e) { console.log('فشل تغيير الاسم:', e.message); }
}
async function notifyOwner(text) {
  if (!sock) return;
  try {
    let key = text.split('\n')[0];
    let now = Date.now();
    if (lastKickNotify[key] && now - lastKickNotify[key] < 60000) return;
    lastKickNotify[key] = now;
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
  try { await sock.groupParticipantsUpdate(jid, [user], 'remove'); return true; } catch(e) { return false; }
}
async function kickAndRename(jid, user, reason) {
  let ok = await kickUser(jid, user);
  if (ok) { await rotateGroupNameOnKick(jid); }
  return ok;
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
          if (p.phoneNumber) linkLidToPhone(p.id, p.phoneNumber);
          if (p.admin) continue;
          if (isWhiteParticipant(p)) continue;
          if (isBlack(n) && !isOwner(n)) {
            let ok = await kickAndRename(jid, p.id, 'بلاك');
            if (ok) {
              kicked++;
              await notifyOwner('🚨 طردت ' + n + ' من قروب ' + jid + '\nالسبب: في البلاك - طرد تلقائي\n🔄 تم تغيير اسم القروب');
            }
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
const DANGEROUS_COMMANDS = ['.ban', 'ban(', 'add3', '.add3', '.تشخيص', '.ادوات', '.ايدي', '.قائمة', '.بيضاء', '.بلاك'];
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({ version, auth: state, logger: pino({ level: 'silent' }), printQRInTerminal: false, syncFullHistory: false });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', (u) => {
    if (u.qr) { qrCode = u.qr; console.log('QR READY'); }
    if (u.connection === 'open') {
      qrCode = ''; console.log('Bot connected');
      notifyOwner('✅ البوت متصل - الثغرة مسكرة - يخدم في كل القروبات');
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
      for (let p of u.participants) {
        let n = getNum(p);
        if (isBlack(n) && !isOwner(n) && !isWhite(n)) {
          await kickAndRename(jid, p, 'بلاك دخل');
          await notifyOwner('🚫 طردت بوت / مبند ' + n + ' اول ما خش لقروب ' + jid + '\n🔄 تم تغيير اسم القروب');
          continue;
        }
      }
      if (!joinTimes[jid]) joinTimes[jid] = [];
      let now = Date.now();
      joinTimes[jid] = joinTimes[jid].filter((t) => now - t < 30000);
      u.participants.forEach(() => joinTimes[jid].push(now));
      if (joinTimes[jid].length >= 3) {
        await lockGroup(jid);
        for (const p of u.participants) {
          if (isWhiteParticipant(p)) continue;
          if (!isOwner(getNum(p)) && !isWhite(getNum(p))) {
            await kickAndRename(jid, p, 'هجوم');
            if (blackList.indexOf(getNum(p)) === -1) blackList.push(getNum(p));
          }
        }
        saveLists();
        await notifyOwner('🚨 هجوم بوتات في قروب ' + jid + '! سكرت القروب وطردتهم بصمت + غيرت الاسم');
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
        if (senderPn && sender && senderPn !== sender) linkLidToPhone(sender, senderPn);
        const text = m.message.conversation || (m.message.extendedTextMessage && m.message.extendedTextMessage.text) || (m.message.imageMessage && m.message.imageMessage.caption) || (m.message.videoMessage && m.message.videoMessage.caption) || '';
        const isContact = !!m.message.contactMessage || !!m.message.contactsArrayMessage || !!m.message.contactMessageV2;
        if (m.key.fromMe) {
          let t = text.trim();
          if (t.indexOf('✅') === 0 || t.indexOf('🚫') === 0 || t.indexOf('🤍') === 0 || t.indexOf('🔒') === 0 || t.indexOf('🔗') === 0 || t.indexOf('╭') === 0 || t.indexOf('⚠️') === 0 || t.indexOf('🧹') === 0 || t.indexOf('📌') === 0 || t.indexOf('🚨') === 0) continue;
        }
        const isOwnerSender = isOwner(senderNum) || m.key.fromMe;
        const isWhiteSender = isWhite(senderNum) || isWhite(senderLid) || (lidMap[senderLid] && isWhite(lidMap[senderLid]));
        const isBlackSender = isBlack(senderNum) || isBlack(senderLid);
        const lower = text.toLowerCase().trim().replace(/_/g,' ');

        const isDangerous = DANGEROUS_COMMANDS.some(cmd => lower.includes(cmd));
        if (isDangerous && !isOwnerSender) {
          if (blackList.indexOf(senderNum) === -1) { blackList.push(senderNum); saveLists(); }
          await notifyOwner('🛡️ محاولة استغلال ثغرة .ban من ' + senderNum + ' في ' + (isGroup ? 'قروب ' + from : 'الخاص') + '\nتم حظره تلقائيا ولم يتم ارسال قائمة القروبات');
          if (isGroup) {
            try { await deleteMsg(from, m.key); } catch(e) {}
            await kickAndRename(from, sender, 'محاولة ثغرة ban');
          }
          continue;
        }

        // ===== مضاد اعادة التوجيه الجديد - يطرد الكل الا البيضاء + يقفل القروب من اول مرة =====
        const isForward = (m.message.extendedTextMessage && m.message.extendedTextMessage.contextInfo && m.message.extendedTextMessage.contextInfo.isForwarded) || (m.message.imageMessage && m.message.imageMessage.contextInfo && m.message.imageMessage.contextInfo.isForwarded) || (m.message.videoMessage && m.message.videoMessage.contextInfo && m.message.videoMessage.contextInfo.isForwarded) || (m.message.stickerMessage && m.message.stickerMessage.contextInfo && m.message.stickerMessage.contextInfo.isForwarded) || (m.message.documentMessage && m.message.documentMessage.contextInfo && m.message.documentMessage.contextInfo.isForwarded);
        const isSticker = !!m.message.stickerMessage;
        const ctx = m.message.extendedTextMessage ? m.message.extendedTextMessage.contextInfo : null;
        const quotedParticipant = ctx ? (ctx.participantPn || ctx.participant) : null;
        const quotedKey = (ctx && ctx.stanzaId) ? { remoteJid: from, id: ctx.stanzaId, participant: quotedParticipant, fromMe: false } : null;
        let isAdminSender = false;
        if (isGroup && !isOwnerSender) {
          try {
            let meta = await sock.groupMetadata(from);
            let p = meta.participants.find((x) => getNum(x.id) === senderLid || (x.phoneNumber && getNum(x.phoneNumber) === senderNum));
            if (p && p.admin) isAdminSender = true;
          } catch(e) {}
        }
        if (isOwnerSender) {
          if (lower === '.ايدي') { await reply(from, 'ID متع القروب:\n' + from); continue; }
          if (lower === '.ping') { await reply(from, '✅ Bot online - الثغرة مسكرة'); continue; }
          if (lower === '.تشخيص') {
            if (from !== CONTROL_GROUP && isGroup) { await reply(from, '⚠️ التشخيص في قروب التحكم بس'); continue; }
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
              let msg = '🔍 تشخيص:\nرقمي: ' + OWNER_NUMBER + '\nمجموع القروبات: ' + total + '\nأدمن في: ' + adminList.length + '\nبيضاء: ' + whiteList.length + '\nبلاك: ' + blackList.length;
              await reply(from, msg);
            } catch(e) { await reply(from, 'خطأ تشخيص: ' + e.message); }
            continue;
          }
          if (lower === '.ادوات') {
            let menu = '╭─── 🍷 ───╮\n';
            menu += '│ 🤍 البيضاء: ' + whiteList.length + '\n';
            menu += '│ 🚫 البلاك: ' + blackList.length + '\n';
            menu += '│ 🔗 الروابط: ' + (lockLinks ? 'مقفولة' : 'مفتوحة') + '\n';
            menu += '│ 👻 الوضع: الثغرة مسكرة\n';
            menu += '╰─── 🍷 ───╯\n\n';
            menu += '⚙️ اوامر ⚙️\n';
            menu += '• .ايدي\n• .تشخيص\n• رد على رسالة + .ابيض / .حظر / .طرد / .فك حظر\n• تاق @ + .ابيض / .حظر\n• ارقام + .ابيض / .حظر\n• .بيضاء / .بلاك / .قائمة\n• .حذف - رد على رسالة\n• .حذف بلاك\n• .فتح / .سكر\n• .قفل الروابط / .فتح الروابط\n• .معلومات\n• .ping';
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
          if (lower === '.حذف' && isGroup) {
            if (quotedParticipant && isWhite(getNum(quotedParticipant))) { await reply(from, '🤍 هذا في البيضاء - ما نقدرش نحذف رسايله'); continue; }
            if (quotedKey) { await deleteMsg(from, quotedKey); await notifyOwner('✅ تم الحذف في قروب ' + from); }
            else { await reply(from, '⚠️ رد على الرسالة اللي تبي تحذفها'); }
            continue;
          }
          if (lower === '.حذف القوائم' || lower === '.حذف الكل') { whiteList = []; blackList = []; saveLists(); await reply(from, '✅ مسحت البيضاء والبلاك كلهم'); continue; }
          if (lower === '.حذف ابيض') { whiteList = []; saveLists(); await reply(from, '✅ مسحت البيضاء كلها'); continue; }
          if (lower === '.حذف بلاك') { blackList = []; saveLists(); await reply(from, '✅ مسحت البلاك كله'); continue; }
          if (lower.indexOf('.طرد') === 0) {
            if (!isGroup) { await reply(from, '⚠️ الطرد يخدم في القروب بس'); continue; }
            let targets = getTargets(text, ctx, quotedParticipant);
            if (targets.length) {
              let target = targets[0];
              if (isWhite(target)) { await reply(from, '🤍 تعذر، لأنه في القائمة البيضاء'); continue; }
              await kickAndRename(from, target + '@s.whatsapp.net', 'طرد يدوي');
              if (blackList.indexOf(target) === -1) { blackList.push(target); saveLists(); }
              await notifyOwner('🚨 طردت ' + target + ' من قروب ' + from + '\n🔄 تم تغيير اسم القروب');
            } else { await reply(from, '⚠️ رد على رسالة الشخص ولا تاقيه ولا ابعث رقمه'); }
            continue;
          }
          if (lower.indexOf('.فك حظر') !== -1 || lower.indexOf('.الغاء حظر') !== -1 || lower.indexOf('.الغاء بلاك') !== -1) {
            let nums = getTargets(text, ctx, quotedParticipant);
            if (nums.length) {
              for (let n of nums) blackList = blackList.filter((x) => x !== n);
              saveLists();
              await reply(from, '✅ فكيت الحظر على ' + nums.length + ' رقم');
            } else { await reply(from, '⚠️ رد على رسالته ولا تاقيه ولا ابعث رقمه'); }
            continue;
          }
          if (lower.indexOf('.الغاء ابيض') !== -1) {
            let nums = getTargets(text, ctx, quotedParticipant);
            for (let n of nums) whiteList = whiteList.filter((x) => x !== n);
            saveLists();
            await reply(from, '✅ نحيت ' + nums.length + ' رقم من البيضاء');
            continue;
          }
          if (lower.indexOf('.حظر') !== -1 || lower.indexOf('.اضف بلاك') !== -1) {
            let nums = getTargets(text, ctx, quotedParticipant);
            let inWhite = nums.filter((n) => isWhite(n));
            let toBan = nums.filter((n) => !isWhite(n));
            if (inWhite.length) { await reply(from, '⛔ تعذر، لأنه في القائمة البيضاء:\n' + inWhite.join('\n') + '\nديرله .الغاء ابيض قبل بعدين حظره'); continue; }
            if (toBan.length) {
              for (let n of toBan) { if (blackList.indexOf(n) === -1) blackList.push(n); }
              saveLists();
              await reply(from, '🚫 حظرت ' + toBan.length + ' رقم\nتوا بنطردهم من كل القروبات اللي انت مشرف فيها');
              let k = await kickBlacklistedFromAllGroups();
              if (k > 0) await reply(from, '✅ طردت ' + k + ' واحد منهم كان قاعد جوا القروبات + غيرت اسماء القروبات');
              else await reply(from, 'ℹ️ ما لقيت حد منهم قاعد جوا القروبات توا، بس لو خش أي قروب بينطرد بروحه + بيتغير الاسم');
            } else { await reply(from, '⚠️ رد على رسالته ولا تاقيه ولا ابعث رقمه + .حظر'); }
            continue;
          }
          if (lower.indexOf('.ابيض') !== -1) {
            let nums = getTargets(text, ctx, quotedParticipant);
            if (nums.length) {
              let inBlack = nums.filter((n) => isBlack(n));
              let toAdd = nums.filter((n) => !isBlack(n));
              if (inBlack.length) { await reply(from, '⛔ تعذر، لأنه في القائمة السوداء:\n' + inBlack.join('\n') + '\nديرله .فك حظر قبل بعدين ضيفه ابيض'); continue; }
              for (let n of toAdd) { if (whiteList.indexOf(n) === -1) whiteList.push(n); }
              saveLists();
              await reply(from, '✅ ضفت ' + toAdd.length + ' رقم للبيضاء');
            } else { await reply(from, '⚠️ رد على رسالته ولا تاقيه ولا ابعث رقمه + .ابيض'); }
            continue;
          }
          continue;
        }
        if (!isGroup) continue;
        if (from === CONTROL_GROUP) continue;
        if (isWhiteSender) continue;
        if (isAdminSender) continue;
        if (isBlackSender) { await deleteMsg(from, m.key); await kickAndRename(from, sender, 'بلاك'); await notifyOwner('🚨 طردت ' + senderNum + ' من قروب ' + from + '\nالسبب: في البلاك\n🔄 تم تغيير اسم القروب'); continue; }
        if (isContact) {
          await deleteMsg(from, m.key);
          await notifyOwner('🧹 حذفت جهة اتصال من ' + senderNum + ' في قروب ' + from);
          continue;
        }
        if (BAN_WORDS.some((w) => lower.indexOf(w) !== -1)) {
          await deleteMsg(from, m.key);
          if (blackList.indexOf(senderNum) === -1) { blackList.push(senderNum); saveLists(); }
          await kickAndRename(from, sender, 'كلمة تبنيد');
          await notifyOwner('🚨 طردت ' + senderNum + ' من قروب ' + from + '\nالسبب: كلمة تبنيد / تخريب / هكر\n🔄 تم تغيير اسم القروب');
          continue;
        }
        // ===== هنا التعديل الجديد: اعادة التوجيه تقفل القروب من اول مرة =====
        if (isForward) {
          await deleteMsg(from, m.key);
          if (!forwardedLocked[from]) {
            forwardedLocked[from] = true;
            await sock.groupSettingUpdate(from, 'announcement').catch(()=>{});
            await sock.groupRevokeInvite(from).catch(()=>{});
            await notifyOwner('🚨 اعادة توجيه من ' + senderNum + ' في قروب ' + from + ' - سكرت القروب والغيت الرابط');
            setTimeout(async () => { try { await sock.groupSettingUpdate(from, 'not_announcement'); } catch(e) {} forwardedLocked[from] = false; }, 3*60*1000);
          }
          if (blackList.indexOf(senderNum) === -1) { blackList.push(senderNum); saveLists(); }
          await kickAndRename(from, sender, 'فوروارد - محاولة تبنيد');
          await notifyOwner('🚨 طردت ' + senderNum + ' من قروب ' + from + '\nالسبب: إعادة توجيه\n🔄 تم تغيير اسم القروب');
          continue;
        }
        if (hasLink(text)) {
          if (lockLinks) {
            await deleteMsg(from, m.key);
            await kickAndRename(from, sender, 'رابط');
            await notifyOwner('🚨 طردت ' + senderNum + ' من قروب ' + from + '\nالسبب: الروابط مقفولة\n🔄 تم تغيير اسم القروب');
            continue;
          }
          await deleteMsg(from, m.key);
          linkCount[senderNum] = (linkCount[senderNum] || 0) + 1;
          if (linkCount[senderNum] >= 2) {
            await kickAndRename(from, sender, 'رابط مكرر');
            await notifyOwner('🚨 طردت ' + senderNum + ' من قروب ' + from + '\nالسبب: رابط مكرر\n🔄 تم تغيير اسم القروب');
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
  if (req.query.key !== QR_SECRET) return res.send('ممنوع - حط key');
  if (!qrCode) return res.send('No QR - Already connected');
  const img = await qrcode.toDataURL(qrCode);
  res.send('<img src="' + img + '"><h2>Scan QR</h2>');
});
app.listen(process.env.PORT || 10000);
startBot();
