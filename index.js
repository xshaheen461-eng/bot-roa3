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
let CASTLE_MODE = false;
let RAID_MODE = false;
let raidTimer = null;
let contactTimes = [];
let ACCEPT_MODE = false;
let acceptTimer = null;
let knownMembers = {};
let reportedMembers = new Set();
try { whiteList = JSON.parse(fs.readFileSync('whitelist.json')); } catch(e) { whiteList = []; }
try { blackList = JSON.parse(fs.readFileSync('blacklist.json')); } catch(e) { blackList = []; }
try { let s = JSON.parse(fs.readFileSync('settings.json')); lockLinks = s.lockLinks || false; CASTLE_MODE = false; } catch(e) {}
let lidMap = {};
try { lidMap = JSON.parse(fs.readFileSync('lidmap.json')) || {}; } catch(e) { lidMap = {}; }
const saveLists = () => {
  try {
    fs.writeFileSync('whitelist.json', JSON.stringify(whiteList));
    fs.writeFileSync('blacklist.json', JSON.stringify(blackList));
    fs.writeFileSync('settings.json', JSON.stringify({ lockLinks }));
    fs.writeFileSync('lidmap.json', JSON.stringify(lidMap));
  } catch(e) {}
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
function linkLidToPhone(lid, phone) {
  if (!lid || !phone) return;
  lid = getNum(lid); phone = getNum(phone);
  if (lid === phone) return;
  if (lidMap[lid] !== phone) { lidMap[lid] = phone; try { fs.writeFileSync('lidmap.json', JSON.stringify(lidMap)); } catch(e) {} }
}
function resolvePhone(lid, pn) {
  let lidN = getNum(lid); let pnN = pn ? getNum(pn) : '';
  if (pnN && pnN !== lidN) return pnN;
  if (lidMap[lidN]) return lidMap[lidN];
  return lidN;
}
function getTargets(text, ctx, quotedParticipant) {
  let nums = [];
  let add = (n) => { n = getNum(n); if (n && nums.indexOf(n) === -1) nums.push(n); };
  if (quotedParticipant) add(quotedParticipant);
  if (ctx && ctx.mentionedJid) for (let j of ctx.mentionedJid) add(j);
  for (let n of extractAllNumbers(text)) add(n);
  return nums;
}
let lastKickNotify = {};
let lastActionPerUser = {};
let adminCache = {};
let warModeUntil = 0;
let maliciousCache = new Set();
let joinTimeMap = {};
let oldMembersCache = new Set();
let STICKER_SPAM_ENABLED = false;
function canActOnUser(key) {
  let now = Date.now();
  if (lastActionPerUser[key] && now - lastActionPerUser[key] < 3000) return false;
  lastActionPerUser[key] = now;
  return true;
}
async function safeDelete(jid, key) {
  try { await sock.sendMessage(jid, { delete: key }); return true; } catch(e) { return false; }
}
function fastDelete(jid, key) { sock.sendMessage(jid, { delete: key }).catch(()=>{}); }
function fastKick(jid, user) { sock.groupParticipantsUpdate(jid, [user], 'remove').catch(()=>{}); }
function fastLock(jid) { sock.groupSettingUpdate(jid, 'announcement').catch(()=>{}); }
function fastUnlock(jid) { sock.groupSettingUpdate(jid, 'not_announcement').catch(()=>{}); }
async function safeKick(jid, user) {
  try { await sock.groupParticipantsUpdate(jid, [user], 'remove'); return true; } catch(e) { return false; }
}
async function safeLock(jid, minutes) {
  try { await sock.groupSettingUpdate(jid, 'announcement'); } catch(e) {}
  if (minutes) setTimeout(() => { if(!CASTLE_MODE) fastUnlock(jid); }, minutes*60*1000);
}
function warLock(jid) {
  warModeUntil = Date.now() + 30000;
  fastLock(jid);
  setTimeout(() => { if(!CASTLE_MODE) fastUnlock(jid); }, 30000);
}
// ✅ v7.7 - ما يستناش، يضرب طول
function tripleStrike(jid, m, sender) {
  sock.sendMessage(jid, { delete: m.key }).catch(()=>{});
  sock.groupParticipantsUpdate(jid, [sender], 'remove').catch(()=>{});
}
function isMaliciousLink(t, m) {
  if (!t && !m) return false;
  if (m && m.message?.reactionMessage) return false;
  if (m && m.message?.protocolMessage) return false;
  if (m && m.message?.pollUpdateMessage) return false;
  if (m && m.messageStubType) return false;
  if (m && m.message?.stickerMessage && !t) return false;
  if (m && m.message?.imageMessage && !t) return false;
  if (m && m.message?.videoMessage && !t) return false;
  let full = (t || '');
  if (maliciousCache.has(full.slice(0,100))) return true;
  if (!full) return false;
  if (full.length > 700) return true;
  if (/[\u202E\u202D\u202A\u202B\u2066\u2067\u2068\u2069\u200B\u200C\u200D\uFEFF\u00AD]{3,}/.test(full)) return true;
  let enc = full.match(/%[0-9A-Fa-f]{2}/g);
  if (enc && enc.length > 25) return true;
  if (full.includes('wa.me') && full.length > 150) return true;
  if (full.includes('chat.whatsapp.com') && full.length > 150) return true;
  if (/(.)\1{150,}/.test(full)) return true;
  let emojiCount = (full.match(/[\u{1F000}-\u{1FAFF}]/gu) || []).length;
  if (emojiCount > 80) return true;
  if (/https?:\/\/\S*[^\x00-\x7F]+\S*/.test(full)) return true;
  let low = full.toLowerCase();
  if (low.includes('crash') && low.includes('http')) return true;
  if (low.includes('wa.me/') && low.includes('%0a')) return true;
  return false;
}
function getMsgPreview(m, text) {
  if (m?.message?.contactMessage || m?.message?.contactsArrayMessage) return '[جهة اتصال - محجوبة للحماية]';
  if (isMaliciousLink(text, m)) return '[نص ملغم - محجوب للحماية]';
  let t = (text || m?.message?.conversation || m?.message?.extendedTextMessage?.text || '').trim();
  if (t) return t.slice(0, 200);
  if (m?.message?.imageMessage) return '[صورة] ' + (m.message.imageMessage.caption || '');
  if (m?.message?.videoMessage) return '[فيديو] ' + (m.message.videoMessage.caption || '');
  if (m?.message?.documentMessage) return '[ملف: ' + (m.message.documentMessage.fileName || '') + ']';
  if (m?.message?.stickerMessage) return '[ملصق]';
  if (m?.message?.pollCreationMessage) return '[استطلاع: ' + (m.message.pollCreationMessage.name || '') + ']';
  return '(بدون نص)';
}
// ✅ v7.7 - احذف واطرد الأول، وبعدين جيب اسم القروب وابعت التقرير
async function handleMalicious(jid, m, sender, senderNum, reason) {
  let safeLen = (m?.message?.conversation || m?.message?.extendedTextMessage?.text || '').length;
  fastDelete(jid, m.key);
  fastKick(jid, sender);
  if (blackList.indexOf(senderNum) === -1) { blackList.push(senderNum); saveLists(); }
  maliciousCache.add((m.message?.conversation || '').slice(0,100));
  let gname = groupNameCache[jid] || jid;
  notifyOwner('💣 رابط ملغم من ' + senderNum + ' في قروب ' + gname + '\nالسبب: ' + reason + '\nطول الرسالة: ' + safeLen + ' حرف - [النص محجوب]\n⚡ حذف + طرد فقط');
}
let linkCount = {};
let stickerCount = {};
let groupNameCache = {};
let forwardedLocked = {};
let joinTimes = {};
let KICK_NO_NUMBER = true;
let botScore = {};
function addBotScore(num, points) {
  let now = Date.now();
  if (!botScore[num]) botScore[num] = [];
  botScore[num] = botScore[num].filter(t => now - t.time < 60000);
  botScore[num].push({ time: now, points: points });
  let total = botScore[num].reduce((a,b) => a + b.points, 0);
  return total;
}
async function getGroupName(jid) {
  if (!jid) return jid;
  if (groupNameCache[jid]) return groupNameCache[jid];
  if (sock) { sock.groupMetadata(jid).then(meta => { groupNameCache[jid] = meta.subject || jid; }).catch(()=>{}); }
  return jid;
}
async function notifyOwner(text) {
  if (!sock) return;
  try {
    let key = text.split('\n')[0].substring(0,30);
    let now = Date.now();
    if (lastKickNotify[key] && now - lastKickNotify[key] < 60*1000) return;
    lastKickNotify[key] = now;
    sock.sendMessage(CONTROL_GROUP, { text }).catch(()=>{});
  } catch(e) {}
}
async function reply(jid, text) { try { await sock.sendMessage(jid, { text }); } catch(e) {} }
async function replyControl(text) { try { await sock.sendMessage(CONTROL_GROUP, { text }); } catch(e) {} }
function hideOwnerCommand(from, m) { if (from && from !== CONTROL_GROUP) fastDelete(from, m.key); }
async function kickAndRename(jid, user, reason) { let ok = await safeKick(jid, user); return ok; }
async function deleteMsg(jid, key) { return await safeDelete(jid, key); }
async function sendSessionReport(jid, participant, isClean) {
  try {
    let d = new Date();
    let time = d.toLocaleTimeString('en-GB') + ',' + d.toLocaleDateString('en-GB');
    let groupName = await getGroupName(jid);
    let num = getNum(typeof participant === 'string' ? participant : (participant.id || participant));
    let phone = '';
    if (typeof participant === 'object' && participant.phoneNumber) phone = getNum(participant.phoneNumber);
    if (phone && phone !== num) num = phone + ' / LID:' + num;
    let report = '';
    report += '•───⊙ ( 🪶 ) ⊙───•\n\n';
    report += '#. | اسم الجروب ~ 『 ' + groupName + ' 』\n';
    report += '#. | الحالة ~ 『 رصد طلب انضمام جديد ⚠️ 』\n\n';
    report += '👤 [ @مستخدم غير معروف ] ،\nقدم طلب انضمام إلى المجموعة.\n\n';
    report += '🔢 الرقم / ID: ' + num + '\n\n';
    if (isClean) { report += '🪶 تقرير فحص الجلسات والأجهزة:\n✅ حساب نظيف (بدون جلسات إضافية مسجلة)\n\n'; }
    else { report += '🪶 تقرير فحص الجلسات والأجهزة:\n⚠️ حساب مشبوه (يوزر بس - بدون رقم - جلسة غير معروفة)\nتم الطرد تلقائيا ☠️\n\n'; }
    report += '•───⊙ ( 🪶 ) ⊙───•\n🕒 ' + time;
    await sock.sendMessage(CONTROL_GROUP, { text: report });
  } catch(e) { console.log('REPORT ERROR:', e.message); }
}
async function enableCastle(reason){
  if (CASTLE_MODE) return;
  CASTLE_MODE = true;
  try{
    const groups = await sock.groupFetchAllParticipating();
    for(let jid in groups){ if(jid === CONTROL_GROUP) continue; try{ await sock.groupSettingUpdate(jid, 'announcement'); }catch(e){} }
  }catch(e){}
  await notifyOwner('🏰🏰 تم تفعيل القلعة تلقائيا\nالسبب: ' + (reason || 'بأمر المالك') + '\nالوضع: بيضاء بس - الباقي طرد طول\nللإطفاء اكتب: .فتح القلعة');
}
async function disableCastle(){
  CASTLE_MODE = false; contactTimes = [];
  try{
    const groups = await sock.groupFetchAllParticipating();
    for(let jid in groups){ if(jid === CONTROL_GROUP) continue; try{ await sock.groupSettingUpdate(jid, 'not_announcement'); }catch(e){} }
  }catch(e){}
  await notifyOwner('🏰 تم فتح القلعة بأمر المالك - رجع الوضع العادي');
}
async function kickBlacklistedFromAllGroups() {
  if (!sock) return 0;
  let kicked = 0;
  try {
    const groups = await sock.groupFetchAllParticipating();
    for (let jid in groups) {
      if (jid === CONTROL_GROUP) continue;
      if (kicked >= 2) break;
      try {
        const meta = groups[jid];
        let me = null;
        for (let p of meta.participants) { if (isMe(p)) me = p; }
        if (!me || !me.admin) continue;
        for (let p of meta.participants) {
          let n = getParticipantNum(p);
          oldMembersCache.add(n);
          if (p.phoneNumber) linkLidToPhone(p.id, p.phoneNumber);
          if (p.admin) continue;
          if (isWhiteParticipant(p)) continue;
          if (CASTLE_MODE) {
            let ok = await kickAndRename(jid, p.id, 'قلعة');
            if (ok) { kicked++; if (blackList.indexOf(n) === -1) blackList.push(n); notifyOwner('🏰 طردت ' + n + ' من قروب ' + jid + '\nالسبب: القلعة مفعلة - مش في البيضاء'); }
            continue;
          }
          if (isBlack(n) && !isOwner(n)) {
            let ok = await kickAndRename(jid, p.id, 'بلاك');
            if (ok) { kicked++; notifyOwner('🚨 طردت ' + n + ' من قروب ' + jid + '\nالسبب: في البلاك'); }
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
const BAN_WORDS = [];
const DANGEROUS_COMMANDS = ['.ban', 'ban(', 'add3', '.add3', '.تشخيص', '.ادوات', '.ايدي', '.قائمة', '.بيضاء', '.بلاك'];
let contactLockTimers = {};
function lockGroupForContact(jid) {
  fastLock(jid);
  if (contactLockTimers[jid]) clearTimeout(contactLockTimers[jid]);
  contactLockTimers[jid] = setTimeout(() => { if(!CASTLE_MODE) fastUnlock(jid); }, 5*60*1000);
}
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({ version, auth: state, logger: pino({ level: 'silent' }), printQRInTerminal: false, syncFullHistory: false, keepAliveIntervalMs: 10000, markOnlineOnConnect: false });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', (u) => {
    if (u.qr) { qrCode = u.qr; console.log('QR READY'); }
    if (u.connection === 'open') {
      qrCode = ''; console.log('Bot connected');
      notifyOwner('✅ البوت متصل - ⚡ v7.7 - حذف فوري / رياكشن ودخول ما ينطردش');
      (async () => {
        try {
          const allGroups = await sock.groupFetchAllParticipating();
          for (let jid in allGroups) {
            knownMembers[jid] = new Set(allGroups[jid].participants.map(p => getNum(p.id)));
            groupNameCache[jid] = allGroups[jid].subject || jid;
            for (let p of allGroups[jid].participants) { if (p.phoneNumber) linkLidToPhone(p.id, p.phoneNumber); }
          }
        } catch(e) {}
      })();
      setTimeout(() => { kickBlacklistedFromAllGroups(); }, 8000);
      setInterval(() => { kickBlacklistedFromAllGroups(); }, 5*60*1000);
      setInterval(async () => {
        try {
          const groups = await sock.groupFetchAllParticipating();
          for (let jid in groups) {
            if (jid === CONTROL_GROUP) continue;
            const meta = groups[jid];
            groupNameCache[jid] = meta.subject || jid;
            for (let p of meta.participants) { if (p.phoneNumber) linkLidToPhone(p.id, p.phoneNumber); }
            if (!knownMembers[jid]) { knownMembers[jid] = new Set(meta.participants.map(p => getNum(p.id))); continue; }
            for (let p of meta.participants) {
              let n = getNum(p.id);
              if (!knownMembers[jid].has(n)) {
                knownMembers[jid].add(n);
                joinTimeMap[n] = Date.now();
                if (p.phoneNumber) joinTimeMap[getNum(p.phoneNumber)] = Date.now();
                let hasPhone = !!p.phoneNumber;
                sendSessionReport(jid, p, hasPhone);
                if (!ACCEPT_MODE && !hasPhone && !isWhite(n) && !isOwner(n)) {
                  if (p.admin) continue;
                  fastKick(jid, p.id);
                  if (blackList.indexOf(n) === -1) { blackList.push(n); saveLists(); }
                }
              }
            }
          }
        } catch(e) {}
      }, 60*1000);
    }
    if (u.connection === 'close') {
      const should = (u.lastDisconnect && u.lastDisconnect.error && u.lastDisconnect.error.output && u.lastDisconnect.error.output.statusCode) !== DisconnectReason.loggedOut;
      if (should) startBot();
    }
  });
  const handleMembershipApproval = async (u) => {
    try {
      const jid = u.id;
      if (!jid || jid === CONTROL_GROUP) return;
      let parts = u.participants || [];
      for (let p of parts) {
        let n = getNum(typeof p === 'string' ? p : (p.id || p));
        joinTimeMap[n] = Date.now();
        let hasPhone = (typeof p === 'object' && !!p.phoneNumber);
        if (typeof p === 'string' && p.includes('@lid')) hasPhone = false;
        sendSessionReport(jid, p, hasPhone);
        if (!ACCEPT_MODE && !hasPhone && !isWhite(n) && !isOwner(n)) {
          fastKick(jid, typeof p === 'string' ? p : p.id);
          if (blackList.indexOf(n) === -1) { blackList.push(n); saveLists(); }
          notifyOwner('☠️ طردت ' + n + ' من قروب ' + jid + '\nالسبب: قبلته من الاستقبال وطلع من غير رقم');
        }
      }
    } catch(e) { console.log('Membership Error:', e.message); }
  };
  sock.ev.on('group-membership.update', handleMembershipApproval);
  sock.ev.on('group.join-request', handleMembershipApproval);
  sock.ev.on('group-participants.update', async (u) => {
    try {
      if (u.action === 'add' || u.action === 'invite' || u.action === 'join') {
        const jid = u.id;
        if (jid === CONTROL_GROUP) return;
        let now = Date.now();
        for (let p of u.participants) joinTimeMap[getNum(p)] = now;
        if (ACCEPT_MODE) {
          for (let p of u.participants) {
            let hasPhone = (typeof p === 'object' && p.phoneNumber) ? true : false;
            if (typeof p === 'string' && p.includes('@lid')) hasPhone = false;
            sendSessionReport(jid, p, hasPhone);
          }
          return;
        }
        if (!joinTimes[jid]) joinTimes[jid] = [];
        joinTimes[jid] = joinTimes[jid].filter((t) => now - t < 60000);
        u.participants.forEach(() => joinTimes[jid].push(now));
        if (joinTimes[jid].length >= 10) {
          RAID_MODE = true;
          await safeLock(jid, 10);
          for (const p of u.participants) {
            if (isWhiteParticipant(p)) continue;
            if (!isOwner(getNum(p)) && !isWhite(getNum(p))) {
              let hasPh = (typeof p === 'object' && p.phoneNumber) ? true : false;
              sendSessionReport(jid, p, hasPh);
              kickAndRename(jid, p, 'هجوم منسق');
              if (blackList.indexOf(getNum(p)) === -1) blackList.push(getNum(p));
            }
          }
          saveLists();
          notifyOwner('🚨🚨 هجوم منسق على قروب ' + jid + ' - دخل ' + joinTimes[jid].length + ' في اقل من دقيقة - سكرت 10 دقايق وطردتهم');
          joinTimes[jid] = [];
          clearTimeout(raidTimer);
          raidTimer = setTimeout(()=>{ RAID_MODE = false; }, 10*60*1000);
          return;
        }
        for (let p of u.participants) {
          let n = getNum(p);
          let hasPhone = (typeof p === 'object' && p.phoneNumber) ? true : false;
          if (typeof p === 'string' && p.includes('@lid')) hasPhone = false;
          sendSessionReport(jid, p, hasPhone);
          if (CASTLE_MODE && !isWhite(n) && !isOwner(n)) {
            fastLock(jid); fastKick(jid, p);
            if (blackList.indexOf(n) === -1) { blackList.push(n); saveLists(); }
            continue;
          }
          if (KICK_NO_NUMBER && !isWhite(n) && !isOwner(n)) {
            if (!hasPhone) {
              if (joinTimeMap[n] && (Date.now() - joinTimeMap[n] < 5*60*1000)) {
                fastLock(jid); fastKick(jid, p);
                if (blackList.indexOf(n) === -1) { blackList.push(n); saveLists(); }
              }
              continue;
            }
          }
          if (isBlack(n) && !isOwner(n) && !isWhite(n)) { fastLock(jid); fastKick(jid, p); continue; }
        }
        return;
      }
      if (u.action === 'remove') {
        for (let p of u.participants) {
          let n = getNum(p);
          if (knownMembers[u.id]) knownMembers[u.id].delete(n);
        }
      }
    } catch(e) { console.log('Raid Error:', e.message); }
  });
  sock.ev.on('messages.upsert', async (up) => {
    let messages = up.messages;
    for (const m of messages) {
      try {
        if (m.message?.reactionMessage) continue;
        if (m.message?.protocolMessage) continue;
        if (m.message?.pollUpdateMessage) continue;
        if (m.message?.senderKeyDistributionMessage) continue;
        if (m.messageStubType) continue;
        if (m.messageStubParameters) continue;
        if (!m.message) continue;
        if (m.messageTimestamp && (Date.now()/1000 - m.messageTimestamp > 30)) continue;
        const from = m.key.remoteJid;
        const isGroup = from && from.endsWith('@g.us');
        const sender = m.key.participant || m.key.remoteJid;
        const senderPn = m.key.participantPn || sender;
        const senderLid = getNum(sender);
        if (senderPn && sender && senderPn !== sender) linkLidToPhone(sender, senderPn);
        const senderNum = resolvePhone(sender, senderPn);
        const text = m.message.conversation || (m.message.extendedTextMessage && m.message.extendedTextMessage.text) || (m.message.imageMessage && m.message.imageMessage.caption) || (m.message.videoMessage && m.message.videoMessage.caption) || '';
        const isContact = !!m.message.contactMessage || !!m.message.contactsArrayMessage || !!m.message.contactMessageV2;
        const isSticker = !!m.message.stickerMessage;
        const isImage = !!m.message.imageMessage;
        const isOnlySticker = isSticker && !text;
        const isOnlyImage = isImage && !text;
        if (isGroup && from !== CONTROL_GROUP) oldMembersCache.add(senderNum);
        if (isOnlySticker || isOnlyImage) continue;
        if (m.key.fromMe) {
          let t = text.trim();
          if (t.indexOf('✅') === 0 || t.indexOf('🚫') === 0 || t.indexOf('🤍') === 0 || t.indexOf('🔒') === 0 || t.indexOf('🔗') === 0 || t.indexOf('╭') === 0 || t.indexOf('⚠️') === 0 || t.indexOf('🧹') === 0 || t.indexOf('📌') === 0 || t.indexOf('🚨') === 0 || t.indexOf('☠️') === 0 || t.indexOf('🏰') === 0 || t.indexOf('🔍') === 0 || t.indexOf('•───') === 0) continue;
        }
        const isOwnerSender = isOwner(senderNum) || isOwner(senderLid) || m.key.fromMe;
        const isWhiteSender = isWhite(senderNum) || isWhite(senderLid) || (lidMap[senderLid] && isWhite(lidMap[senderLid]));
        const isBlackSender = isBlack(senderNum) || isBlack(senderLid);
        const lower = text.toLowerCase().trim().replace(/_/g,' ');
        if (isOwnerSender && lower === '.ping') {
          await sock.sendMessage(from, { text: '✅ Bot online - ⚡ v7.7 - حذف فوري / رياكشن ودخول ما ينطردش - قلعة: ' + (CASTLE_MODE ? 'ON 🏰' : 'OFF') + ' - استقبال: ' + (ACCEPT_MODE ? 'ON ✅' : 'OFF') });
          continue;
        }
        // ✅ v7.7 - فحص سريع لأوامر المالك قبل فحص الأدمن - باش .حذف ما يتأخرش
        const _ctxEarly = m.message.extendedTextMessage ? m.message.extendedTextMessage.contextInfo : null;
        const _quotedParticipantEarly = _ctxEarly ? (_ctxEarly.participantPn || _ctxEarly.participant) : null;
        const _quotedKeyEarly = (_ctxEarly && _ctxEarly.stanzaId) ? { remoteJid: from, id: _ctxEarly.stanzaId, participant: _quotedParticipantEarly, fromMe: false } : null;
        if (isOwnerSender && isGroup && lower === '.حذف' && _quotedKeyEarly) {
          fastDelete(from, _quotedKeyEarly);
          fastDelete(from, m.key);
          if (from !== CONTROL_GROUP) { sock.sendMessage(CONTROL_GROUP, { text: '✅ تم الحذف فوري في قروب ' + (groupNameCache[from] || from) }).catch(()=>{}); }
          continue;
        }
        if (isGroup && from !== CONTROL_GROUP && isContact && !isOwnerSender && !isWhiteSender) {
          lockGroupForContact(from);
          fastDelete(from, m.key);
          if (!canActOnUser('contact-fast-'+senderNum)) continue;
          fastKick(from, sender);
          if (blackList.indexOf(senderNum) === -1) { blackList.push(senderNum); saveLists(); }
          if (senderNum !== senderLid && blackList.indexOf(senderLid) === -1) { blackList.push(senderLid); saveLists(); }
          let nowC = Date.now();
          contactTimes = contactTimes.filter(t => nowC - t < 60000);
          contactTimes.push(nowC);
          if (contactTimes.length >= 2 && !CASTLE_MODE) {
            enableCastle('هجوم جهات اتصال - ' + contactTimes.length + ' جهات في اقل من دقيقة');
            notifyOwner('🏰🏰 القلعة تفعلت بروحها!\nالسبب: ' + contactTimes.length + ' جهات اتصال في دقيقة');
            contactTimes = [];
          } else {
            notifyOwner('🧹 جهة اتصال من ' + senderNum + ' في قروب ' + from + '\nالسبب: جهة اتصال 🧹\nتم: حذف + قفل 5 دقايق + طرد + بلاك - حتى لو قديم');
          }
          continue;
        }
        if (isGroup && from !== CONTROL_GROUP && !isOwnerSender && !isWhiteSender) {
          if (isMaliciousLink(text, m)) { handleMalicious(from, m, sender, senderNum, 'رابط ملغم / تفجير'); continue; }
          if (Date.now() < warModeUntil && isBlackSender) { fastDelete(from, m.key); continue; }
        }
        const isDangerous = lower.trim().startsWith('.') && DANGEROUS_COMMANDS.some(cmd => lower.includes(cmd));
        if (isDangerous && !isOwnerSender) {
          if (blackList.indexOf(senderNum) === -1) { blackList.push(senderNum); saveLists(); }
          notifyOwner('🛡️ محاولة استغلال ثغرة من ' + senderNum + '\nشن بعت: ' + getMsgPreview(m, text));
          if (isGroup) { tripleStrike(from, m, sender); }
          continue;
        }
        const isForward = (m.message.extendedTextMessage && m.message.extendedTextMessage.contextInfo && m.message.extendedTextMessage.contextInfo.isForwarded) || (m.message.imageMessage && m.message.imageMessage.contextInfo && m.message.imageMessage.contextInfo.isForwarded) || (m.message.videoMessage && m.message.videoMessage.contextInfo && m.message.videoMessage.contextInfo.isForwarded) || (m.message.stickerMessage && m.message.stickerMessage.contextInfo && m.message.stickerMessage.contextInfo.isForwarded) || (m.message.documentMessage && m.message.documentMessage.contextInfo && m.message.documentMessage.contextInfo.isForwarded);
        const ctx = m.message.extendedTextMessage ? m.message.extendedTextMessage.contextInfo : null;
        const quotedParticipant = ctx ? (ctx.participantPn || ctx.participant) : null;
        const quotedKey = (ctx && ctx.stanzaId) ? { remoteJid: from, id: ctx.stanzaId, participant: quotedParticipant, fromMe: false } : null;
        let isAdminSender = false;
        if (isGroup && !isOwnerSender) {
          let cacheKey = from + '-' + senderLid;
          if (adminCache[cacheKey] !== undefined && Date.now() - adminCache[cacheKey].time < 60000) { isAdminSender = adminCache[cacheKey].isAdmin; }
          else {
            try {
              let meta = await sock.groupMetadata(from);
              let p = meta.participants.find((x) => getNum(x.id) === senderLid || (x.phoneNumber && getNum(x.phoneNumber) === senderNum));
              if (p && p.admin) isAdminSender = true;
              adminCache[cacheKey] = { isAdmin: isAdminSender, time: Date.now() };
            } catch(e) {}
          }
        }
        if (isAdminSender && isContact) continue;
        if (isOwnerSender) {
          let isSensitiveCmd = lower.includes('.حظر') || lower.includes('.ابيض') || lower.indexOf('.طرد') === 0 || lower.includes('.فحص') || lower.includes('.تنظيف') || lower.includes('.قلعة') || lower.includes('.قلعه') || lower.includes('.تشخيص') || lower.includes('.ادوات') || lower.includes('.بيضاء') || lower.includes('.بلاك') || lower.includes('.قائمة') || lower.includes('.حذف') || lower.includes('.استقبال') || lower.includes('.قبول') || lower.includes('.تم القبول') || lower.includes('.سكر الاستقبال') || lower.includes('.قسيمة') || lower.includes('.قفل الروابط') || lower.includes('.فتح الروابط') || lower.includes('.فك حظر') || lower.includes('.الغاء');
          if (isSensitiveCmd && from !== CONTROL_GROUP) hideOwnerCommand(from, m);
          let r = async (txt) => { if (isSensitiveCmd && from !== CONTROL_GROUP) { await replyControl(txt); } else { await reply(from, txt); } };
          if (lower === '.ايدي') { await reply(from, 'ID متع القروب:\n' + from); continue; }
          if (lower === '.قسيمة' || lower === '.قسيمه' || lower === '.تجربة قسيمة') { await sendSessionReport(from, '999999999@test', false); await r('✅ بعت قسيمة تجريبية، شوف قروب التحكم'); continue; }
          if (lower === '.استقبال' || lower === '.قبول' || lower === '.استقبال شغال') {
            ACCEPT_MODE = true; clearTimeout(acceptTimer);
            acceptTimer = setTimeout(()=>{ ACCEPT_MODE = false; notifyOwner('✅ انتهى وضع الاستقبال - رجعت الحماية'); }, 15*60*1000);
            await r('✅ وضع الاستقبال شغال 15 دقيقة - اقبل اللي تبيه، البوت معاش حيطرد حد على خاطر دخول جماعي، لكن حيبعتلك القسيمة لكل واحد يخش'); continue;
          }
          if (lower === '.تم القبول' || lower === '.سكر الاستقبال' || lower === '.خلاص استقبال' || lower === '.انهاء الاستقبال') { ACCEPT_MODE = false; clearTimeout(acceptTimer); await r('✅ سكرت الاستقبال - رجعت الحماية'); continue; }
          if (lower === '.قلعة' || lower === '.تفعيل القلعة' || lower === '.قلعه') { await enableCastle('بأمر المالك'); await r('🏰 تم تفعيل القلعة بأمرك - بيضاء بس'); continue; }
          if (lower === '.فتح القلعة' || lower === '.فك القلعة' || lower === '.اطفاء القلعة' || lower === '.الغاء القلعة') { await disableCastle(); await r('🏰 تم فتح القلعة بأمرك - رجع الوضع العادي'); continue; }
          if (lower === '.حالة القلعة') { await r('🏰 القلعة: ' + (CASTLE_MODE ? 'مفعلة ON' : 'طافية OFF')); continue; }
          if (lower === '.فحص الكل' || lower === '.فحص كل' || lower === '.تنظيف الكل' || lower === '.تنظيف') {
            if (!isGroup) { await r('⚠️ الفحص يخدم في القروب بس'); continue; }
            try {
              let meta = await sock.groupMetadata(from);
              let me = null; for (let p of meta.participants) { if (isMe(p)) me = p; }
              let iAmAdmin = me && me.admin;
              if (!iAmAdmin) { await r('⚠️ البوت مش أدمن هنا، ما يقدرش يطرد'); continue; }
              let noNumberList = [];
              for (let p of meta.participants) {
                let n = getParticipantNum(p);
                if (p.admin) continue; if (isMe(p)) continue; if (isWhiteParticipant(p)) continue; if (isOwner(n)) continue;
                if (!p.phoneNumber) noNumberList.push(p);
              }
              let kickedList = [];
              for (let p of noNumberList) {
                let ok = await kickAndRename(from, p.id, 'فحص الكل');
                if (ok) { kickedList.push(getParticipantNum(p)); if (blackList.indexOf(getParticipantNum(p)) === -1) blackList.push(getParticipantNum(p)); }
              }
              saveLists();
              await r('🏰 فحص الكل كمل في ' + from + ':\n👥 فحصت: ' + meta.participants.length + '\n👻 من غير رقم لقيت: ' + noNumberList.length + '\n✅ طردت: ' + kickedList.length + '\n\n' + (kickedList.length ? kickedList.join('\n') : '✅ نظيف'));
            } catch(e) { await r('خطأ فحص الكل: ' + e.message); }
            continue;
          }
          if (lower === '.فحص' || lower === '.فحص مشبوهين' || lower === '.فحص بوتات' || lower === '.عد' || lower === '.كم') {
            if (!isGroup) { await r('⚠️ الفحص يخدم في القروب بس'); continue; }
            try {
              let meta = await sock.groupMetadata(from);
              let me = null; for (let p of meta.participants) { if (isMe(p)) me = p; }
              let iAmAdmin = me && me.admin;
              let noNumberList = []; let blackListFound = []; let total = meta.participants.length;
              for (let p of meta.participants) {
                let n = getParticipantNum(p);
                if (p.admin) continue; if (isMe(p)) continue; if (isWhiteParticipant(p)) continue; if (isOwner(n)) continue;
                if (!p.phoneNumber) noNumberList.push(n); else if (isBlack(n)) blackListFound.push(n);
              }
              if (!iAmAdmin) {
                let msg = '🔍 فحص - عد بس (البوت مش ادمن هنا) في ' + from + ':\n';
                msg += '👥 اجمالي الاعضاء: ' + total + '\n👻 جدد من غير رقم: ' + noNumberList.length + '\n🚫 من البلاك: ' + blackListFound.length + '\n';
                if (noNumberList.length) msg += '\n👻 جدد من غير رقم:\n' + noNumberList.join('\n') + '\n';
                if (blackListFound.length) msg += '\n🚫 بلاك:\n' + blackListFound.join('\n');
                if (!noNumberList.length && !blackListFound.length) msg += '✅ القروب نظيف'; else msg += '\n⚠️ خلي البوت ادمن باش يطردهم، توا عد بس';
                await r(msg); continue;
              }
              let kickedList = [];
              for (let n of [...noNumberList, ...blackListFound]) {
                let p = meta.participants.find(x => getParticipantNum(x) === n);
                if (!p) continue;
                let ok = await kickAndRename(from, p.id, 'فحص');
                if (ok) { kickedList.push(n); if (blackList.indexOf(n) === -1) blackList.push(n); }
              }
              saveLists();
              let msg2 = '🏰 فحص كمل في ' + from + ':\n👥 فحصت: ' + total + '\n👻 جدد من غير رقم لقيت: ' + noNumberList.length + '\n🚫 بلاك لقيت: ' + blackListFound.length + '\n✅ طردت: ' + kickedList.length;
              if (kickedList.length) msg2 += '\n\n' + kickedList.join('\n');
              await r(msg2);
              notifyOwner('🏰 فحص في ' + from + ' - لقيت ' + noNumberList.length + ' جدد من غير رقم وطردت ' + kickedList.length);
            } catch(e) { await r('خطأ فحص: ' + e.message); }
            continue;
          }
          if (lower === '.تشخيص') {
            if (from !== CONTROL_GROUP && isGroup) { await r('⚠️ التشخيص في قروب التحكم بس'); continue; }
            try {
              const groups = await sock.groupFetchAllParticipating();
              let total = Object.keys(groups).length; let adminList = [];
              for (let jid in groups) { const meta = groups[jid]; let me2 = null; for (let p of meta.participants) { if (isMe(p)) me2 = p; } if (me2 && me2.admin) adminList.push(meta.subject || jid); }
              let msg = '🔍 تشخيص:\nرقمي: ' + OWNER_NUMBER + '\nمجموع القروبات: ' + total + '\nأدمن في: ' + adminList.length + '\nبيضاء: ' + whiteList.length + '\nبلاك: ' + blackList.length + '\nقلعة: ' + (CASTLE_MODE ? 'ON' : 'OFF');
              await r(msg);
            } catch(e) { await r('خطأ تشخيص: ' + e.message); }
            continue;
          }
          if (lower === '.ادوات') {
            let menu = '╭─── 🍷 ───╮\n';
            menu += '│ 🤍 البيضاء: ' + whiteList.length + '\n';
            menu += '│ 🚫 البلاك: ' + blackList.length + '\n';
            menu += '│ 🔗 الروابط: ' + (lockLinks ? 'مقفولة' : 'مفتوحة') + '\n';
            menu += '│ ⚡ السرعة: v7.7 - حذف فوري / رياكشن ودخول ما ينطردش\n';
            menu += '│ 💣 حماية ملغّمة: شغالة - النص محجوب\n';
            menu += '│ 🏰 القلعة: ' + (CASTLE_MODE ? 'مفعلة ON' : 'طافية OFF') + '\n';
            menu += '│ 📥 استقبال: ' + (ACCEPT_MODE ? 'شغال ON ✅' : 'طافي OFF') + '\n';
            menu += '╰─── 🍷 ───╯\n\n';
            menu += '⚙️ اوامر ⚙️\n';
            menu += '• .ايدي\n• .تشخيص\n• .قسيمة\n• .استقبال / .تم القبول\n• .فحص / .فحص الكل\n• رد + .ابيض / .حظر / .طرد / .فك حظر\n• .حظر جماعي\n• .بيضاء / .بلاك / .قائمة\n• .حذف - رد على رسالة\n• .حذف بلاك\n• .فتح / .سكر\n• .قفل الروابط / .فتح الروابط\n• .معلومات\n• .قلعة / .فتح القلعة / .حالة القلعة\n• .ping';
            await r(menu); continue;
          }
          if (lower === '.معلومات' && isGroup) {
            let meta = await sock.groupMetadata(from);
            let admins = meta.participants.filter((p) => p.admin).length;
            let info = '╭─── 🍷 ───╮\n│ 📛 القروب: ' + meta.subject + '\n│ 👥 الأعضاء: ' + meta.participants.length + '\n│ 🛡️ المشرفين: ' + admins + '\n╰─── 🍷 ───╯';
            await reply(from, info); continue;
          }
          if (lower === '.بيضاء') { await r('🤍 البيضاء:\n' + (whiteList.length ? whiteList.join('\n') : 'فاضية')); continue; }
          if (lower === '.بلاك') { await r('🚫 البلاك:\n' + (blackList.length ? blackList.join('\n') : 'فاضي')); continue; }
          if (lower === '.قائمة') { await r('🤍 بيضاء: ' + whiteList.length + '\n🚫 بلاك: ' + blackList.length + '\n🏰 قلعة: ' + (CASTLE_MODE ? 'ON' : 'OFF')); continue; }
          if (lower === '.فتح' && isGroup) { try { await sock.groupSettingUpdate(from, 'not_announcement'); await reply(from, '✅ فتحت القروب'); } catch(e) {} continue; }
          if ((lower === '.سكر' || lower === '.قفل') && isGroup) { try { await sock.groupSettingUpdate(from, 'announcement'); await reply(from, '🔒 سكرت القروب'); } catch(e) {} continue; }
          if (lower === '.قفل الروابط') { lockLinks = true; saveLists(); await r('🔗 قفلت الروابط'); continue; }
          if (lower === '.فتح الروابط') { lockLinks = false; saveLists(); await r('🔗 فتحت الروابط'); continue; }
          if (lower === '.حذف' && isGroup) {
            if (quotedKey) { fastDelete(from, quotedKey); notifyOwner('✅ تم الحذف في قروب ' + from + '\nشن بعت: ' + getMsgPreview(m, text)); }
            else { await r('⚠️ رد على الرسالة اللي تبي تحذفها'); }
            continue;
          }
          if (lower === '.حذف القوائم' || lower === '.حذف الكل') { whiteList = []; blackList = []; saveLists(); await r('✅ مسحت البيضاء والبلاك كلهم'); continue; }
          if (lower === '.حذف ابيض') { whiteList = []; saveLists(); await r('✅ مسحت البيضاء كلها'); continue; }
          if (lower === '.حذف بلاك') { blackList = []; saveLists(); await r('✅ مسحت البلاك كله'); continue; }
          if (lower.indexOf('.طرد') === 0) {
            if (!isGroup) { await r('⚠️ الطرد يخدم في القروب بس'); continue; }
            let targetJid = null;
            if (quotedParticipant) targetJid = quotedParticipant;
            else if (ctx && ctx.mentionedJid && ctx.mentionedJid.length) targetJid = ctx.mentionedJid[0];
            else { let tgs = getTargets(text, ctx, quotedParticipant); if (tgs.length) targetJid = tgs[0] + '@s.whatsapp.net'; }
            if (!targetJid) { await r('⚠️ رد على رسالة الشخص ولا تاقيه ولا ابعث رقمه'); continue; }
            let targetNum = getNum(targetJid);
            if (isWhite(targetNum)) { await r('🤍 تعذر، لأنه في القائمة البيضاء'); continue; }
            let ok = false;
            try { ok = await kickAndRename(from, targetJid, 'طرد يدوي'); } catch(e) {}
            if (!ok && targetJid.includes('@s.whatsapp.net')) { try { ok = await kickAndRename(from, targetNum + '@lid', 'طرد يدوي LID'); } catch(e) {} }
            if (!ok && targetJid.includes('@lid')) { try { ok = await kickAndRename(from, targetNum + '@s.whatsapp.net', 'طرد يدوي PN'); } catch(e) {} }
            if (ok) {
              if (blackList.indexOf(targetNum) === -1) { blackList.push(targetNum); saveLists(); }
              notifyOwner('🚨 طردت ' + targetNum + ' من قروب ' + from + '\nالسبب: طرد يدوي بأمر المالك\nشن بعت: ' + getMsgPreview(m, text));
            } else { await r('❌ فشل الطرد - تأكد ان البوت أدمن، والشخص مش أدمن، وجرب ترد على رسالته مباشرة'); }
            continue;
          }
          if (lower.indexOf('.فك حظر') !== -1 || lower.indexOf('.الغاء حظر') !== -1 || lower.indexOf('.الغاء بلاك') !== -1) {
            let nums = getTargets(text, ctx, quotedParticipant);
            if (nums.length) { for (let n of nums) blackList = blackList.filter((x) => x !== n); saveLists(); await r('✅ فكيت الحظر على ' + nums.length + ' رقم'); }
            else { await r('⚠️ رد على رسالته ولا تاقيه ولا ابعث رقمه'); }
            continue;
          }
          if (lower.indexOf('.الغاء ابيض') !== -1) {
            let nums = getTargets(text, ctx, quotedParticipant);
            for (let n of nums) whiteList = whiteList.filter((x) => x !== n);
            saveLists(); await r('✅ نحيت ' + nums.length + ' رقم من البيضاء'); continue;
          }
          if (lower.indexOf('.حظر الكل') !== -1 || lower.indexOf('.حظر جماعي') !== -1 || lower.indexOf('.حظر') !== -1 || lower.indexOf('.اضف بلاك') !== -1) {
            let nums = getTargets(text, ctx, quotedParticipant);
            let inWhite = nums.filter((n) => isWhite(n));
            let toBan = nums.filter((n) => !isWhite(n));
            if (inWhite.length && toBan.length === 0) { await r('⛔ تعذر، لأنه في القائمة البيضاء'); continue; }
            if (toBan.length) {
              for (let n of toBan) { if (blackList.indexOf(n) === -1) blackList.push(n); }
              saveLists();
              await r('🚫 حظرت ' + toBan.length + ' رقم في قروب ' + from + (inWhite.length ? '\n⚠️ تخطيت ' + inWhite.length + ' من البيضاء' : ''));
              let k = await kickBlacklistedFromAllGroups();
              if (k > 0) await r('✅ طردت ' + k + ' واحد');
              if (toBan.length >= 10) await notifyOwner('🚨 حظر جماعي: ' + toBan.length + ' رقم\nفي قروب ' + from + '\nالسبب: حظر جماعي بأمر المالك');
            } else { await r('⚠️ رد على رسالته ولا تاقيه ولا ابعث رقمه + .حظر\nأو الصق قايمة أرقام واكتب .حظر'); }
            continue;
          }
          if (lower.indexOf('.ابيض') !== -1) {
            let nums = getTargets(text, ctx, quotedParticipant);
            if (nums.length) {
              let inBlack = nums.filter((n) => isBlack(n));
              let toAdd = nums.filter((n) => !isBlack(n));
              if (inBlack.length) { await r('⛔ تعذر، لأنه في القائمة السوداء'); continue; }
              for (let n of toAdd) { if (whiteList.indexOf(n) === -1) whiteList.push(n); }
              saveLists();
              await r('✅ ضفت ' + toAdd.length + ' رقم للبيضاء من قروب ' + from);
            } else { await r('⚠️ رد على رسالته ولا تاقيه ولا ابعث رقمه + .ابيض'); }
            continue;
          }
          continue;
        }
        if (!isGroup) continue;
        if (from === CONTROL_GROUP) continue;
        if (isWhiteSender) continue;
        if (isAdminSender) continue;
        if (CASTLE_MODE) {
          if (canActOnUser('castle-'+senderNum)) {
            tripleStrike(from, m, sender);
            if (blackList.indexOf(senderNum) === -1) { blackList.push(senderNum); saveLists(); }
            notifyOwner('🏰 طردت ' + senderNum + ' من قروب ' + from + '\nالسبب: القلعة مفعلة - مش في البيضاء\nشن بعت: ' + getMsgPreview(m, text));
          }
          continue;
        }
        if (RAID_MODE) {
          if (canActOnUser('raid-'+senderNum)) {
            tripleStrike(from, m, sender);
            if (blackList.indexOf(senderNum) === -1) { blackList.push(senderNum); saveLists(); }
            notifyOwner('🏰 طردت ' + senderNum + ' من قروب ' + from + '\nالسبب: وضع هجوم منسق\nشن بعت: ' + getMsgPreview(m, text));
          }
          continue;
        }
        if (KICK_NO_NUMBER && isGroup && !isWhiteSender && !isOwnerSender && !isAdminSender) {
          let isNewJoin = (joinTimeMap[senderNum] && (Date.now() - joinTimeMap[senderNum] < 5*60*1000)) || (joinTimeMap[senderLid] && (Date.now() - joinTimeMap[senderLid] < 5*60*1000));
          if (isNewJoin && !isSticker) {
            let hasRealPhone = false;
            try {
              let meta = await sock.groupMetadata(from);
              let p = meta.participants.find((x) => getNum(x.id) === senderLid || (x.phoneNumber && getNum(x.phoneNumber) === senderNum));
              if (p && p.phoneNumber) { hasRealPhone = true; linkLidToPhone(sender, p.phoneNumber); }
            } catch(e) {}
            if (hasRealPhone) {
            } else {
              if (canActOnUser('nonumber-'+senderNum)) {
                tripleStrike(from, m, sender);
                if (blackList.indexOf(senderNum) === -1) { blackList.push(senderNum); saveLists(); }
                if (senderLid && blackList.indexOf(senderLid) === -1) { blackList.push(senderLid); saveLists(); }
                notifyOwner('☠️ طردت جديد من غير رقم ' + senderNum + ' في قروب ' + from + '\nالسبب: جديد دخل توا وتأكدت من القايمة انه فعلا من غير رقم\nشن بعت: ' + getMsgPreview(m, text));
              }
              continue;
            }
          }
        }
        if (isGroup && !isWhiteSender && !isOwnerSender && !isAdminSender && !isSticker) {
          let score = 0; let reason = '';
          if ((joinTimeMap[senderNum] && (Date.now() - joinTimeMap[senderNum] < 3000)) || (joinTimeMap[senderLid] && (Date.now() - joinTimeMap[senderLid] < 3000))) { score += 1; reason += 'خش وبعت طول، '; }
          if (isContact || hasLink(text) || isForward) { score += 2; reason += 'اول رسالة رابط/جهة/فوروارد، '; }
          if (score > 0) {
            let total = addBotScore(senderNum, score);
            if (total >= 3) {
              if (canActOnUser('botdetect-'+senderNum)) {
                tripleStrike(from, m, sender);
                if (blackList.indexOf(senderNum) === -1) { blackList.push(senderNum); saveLists(); }
                notifyOwner('🤖 كشفت بوت في قروب ' + from + '\nالرقم: ' + senderNum + '\nالسبب: ' + reason + '\nالنقاط: ' + total + '/3\nشن بعت: ' + getMsgPreview(m, text));
                botScore[senderNum] = [];
              }
              continue;
            }
          }
        }
        if (isBlackSender) {
          if (!canActOnUser('black-'+senderNum)) continue;
          tripleStrike(from, m, sender);
          notifyOwner('🚨 طردت ' + senderNum + ' من قروب ' + from + '\nالسبب: في البلاك\nشن بعت: ' + getMsgPreview(m, text));
          continue;
        }
        if (isForward && !isSticker) {
          if (!canActOnUser('fwd-'+senderNum)) continue;
          tripleStrike(from, m, sender);
          if (!forwardedLocked[from]) {
            forwardedLocked[from] = true;
            notifyOwner('🚨 فوروارد من ' + senderNum + ' في قروب ' + from + ' - سكرت\nشن بعت: ' + getMsgPreview(m, text));
            setTimeout(()=>{ forwardedLocked[from] = false; }, 3*60*1000);
          }
          if (blackList.indexOf(senderNum) === -1) { blackList.push(senderNum); saveLists(); }
          continue;
        }
        if (hasLink(text)) {
          if (!canActOnUser('link-'+senderNum)) continue;
          if (lockLinks) {
            tripleStrike(from, m, sender);
            notifyOwner('🚨 طردت ' + senderNum + ' من قروب ' + from + '\nالسبب: الروابط مقفولة\nشن بعت: ' + getMsgPreview(m, text));
            continue;
          }
          fastDelete(from, m.key);
          linkCount[senderNum] = (linkCount[senderNum] || 0) + 1;
          if (linkCount[senderNum] >= 2) {
            fastKick(from, sender);
            notifyOwner('🚨 طردت ' + senderNum + ' من قروب ' + from + '\nالسبب: رابط مكرر\nشن بعت: ' + getMsgPreview(m, text));
            linkCount[senderNum] = 0;
          } else {
            fastLock(from);
            setTimeout(()=>{ if(!CASTLE_MODE) fastUnlock(from); }, 60000);
            notifyOwner('🔒 سكرت القروب ' + from + ' 1 دقيقة\nالسبب: ' + senderNum + ' بعت رابط\nشن بعت: ' + getMsgPreview(m, text));
          }
          continue;
        }
        if (STICKER_SPAM_ENABLED && (isSticker || isImage)) {
          let now = Date.now();
          if (!stickerCount[senderNum]) stickerCount[senderNum] = [];
          stickerCount[senderNum] = stickerCount[senderNum].filter((t) => now - t < 10000);
          stickerCount[senderNum].push(now);
          if (stickerCount[senderNum].length >= 5) {
            if (!canActOnUser('spam-'+senderNum)) { stickerCount[senderNum] = []; continue; }
            tripleStrike(from, m, sender);
            if (blackList.indexOf(senderNum) === -1) { blackList.push(senderNum); saveLists(); }
            notifyOwner('🚨 سبام من ' + senderNum + ' في قروب ' + from + ' - بعت 5 ملصقات ورا بعض\nشن بعت: ' + getMsgPreview(m, text));
            stickerCount[senderNum] = [];
            continue;
          }
          continue;
        }
      } catch(e) { console.log('Error:', e.message); }
    }
  });
}
app.get('/', (req, res) => res.send('Bot Running - v7.7 - Control Only - Silent'));
app.get('/qr', async (req, res) => {
  if (req.query.key !== QR_SECRET) return res.send('ممنوع - حط key');
  if (!qrCode) return res.send('No QR - Already connected');
  const img = await qrcode.toDataURL(qrCode);
  res.send('<img src="' + img + '"><h2>Scan QR</h2>');
});
app.listen(process.env.PORT || 10000);
startBot();
