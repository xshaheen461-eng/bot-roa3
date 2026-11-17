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
let mutedList = [];
let exemptGroups = [];
let knownBots = ['201155325652','159769176309794','218920972444','131289315287150','167611182633170','212704208045'];
let lockLinks = false;
let CASTLE_MODE = false;
let RAID_MODE = false;
let raidTimer = null;
let contactTimes = [];
let ACCEPT_MODE = false;
let acceptTimer = null;
let knownMembers = {};
let reportedMembers = new Set();
let ANTI_LINKED = true;
let seenMsgIds = new Set();
let joinWatch = {};
let BOT_COMMANDS = ['.حذف','.طرد','.حظر','.بان','.kick','.ban','.tagall','.منشن','.ادوات','.فحص','.قلعة','.قائمة','.ايدي','.سرعة','.ping','.help','.menu'];
try { whiteList = JSON.parse(fs.readFileSync('whitelist.json')); } catch(e) { whiteList = []; }
try { blackList = JSON.parse(fs.readFileSync('blacklist.json')); } catch(e) { blackList = []; }
try { mutedList = JSON.parse(fs.readFileSync('muted.json')); } catch(e) { mutedList = []; }
try { exemptGroups = JSON.parse(fs.readFileSync('exempt.json')); } catch(e) { exemptGroups = []; }
try { knownBots = JSON.parse(fs.readFileSync('knownbots.json')); if(!knownBots.includes('201155325652')) knownBots.push('201155325652'); if(!knownBots.includes('212704208045')) knownBots.push('212704208045'); } catch(e) { knownBots = ['201155325652','159769176309794','218920972444','131289315287150','167611182633170','212704208045']; }
try { let s = JSON.parse(fs.readFileSync('settings.json')); lockLinks = s.lockLinks || false; CASTLE_MODE = false; ANTI_LINKED = s.ANTI_LINKED !== false; } catch(e) {}
let lidMap = {};
try { lidMap = JSON.parse(fs.readFileSync('lidmap.json')) || {}; } catch(e) { lidMap = {}; }
const saveLists = () => {
  try {
    fs.writeFileSync('whitelist.json', JSON.stringify(whiteList));
    fs.writeFileSync('blacklist.json', JSON.stringify(blackList));
    fs.writeFileSync('muted.json', JSON.stringify(mutedList));
    fs.writeFileSync('exempt.json', JSON.stringify(exemptGroups));
    fs.writeFileSync('knownbots.json', JSON.stringify(knownBots));
    fs.writeFileSync('settings.json', JSON.stringify({ lockLinks, ANTI_LINKED }));
    fs.writeFileSync('lidmap.json', JSON.stringify(lidMap));
  } catch(e) {}
};
const isExempt = (jid) => exemptGroups.indexOf(jid) !== -1;
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
const isMuted = (n) => mutedList.indexOf(norm(n)) !== -1;
const isKnownBotNum = (n) => knownBots.indexOf(norm(n)) !== -1;
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
function isBlackParticipant(p) {
  if (!p) return false;
  let nums = [];
  if (typeof p === 'string') nums.push(getNum(p));
  else {
    if (p.id) nums.push(getNum(p.id));
    if (p.phoneNumber) nums.push(getNum(p.phoneNumber));
    if (p.lid) nums.push(getNum(p.lid));
  }
  for (let n of nums) {
    if (isBlack(n)) return true;
    if (lidMap[n] && isBlack(lidMap[n])) return true;
  }
  return false;
}
function isMutedParticipant(p) {
  if (!p) return false;
  let nums = [];
  if (typeof p === 'string') nums.push(getNum(p));
  else {
    if (p.id) nums.push(getNum(p.id));
    if (p.phoneNumber) nums.push(getNum(p.phoneNumber));
    if (p.lid) nums.push(getNum(p.lid));
  }
  for (let n of nums) {
    if (isMuted(n)) return true;
    if (lidMap[n] && isMuted(lidMap[n])) return true;
  }
  return false;
}
function isGlobalBlack(p) { return isBlackParticipant(p); }
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
async function expandTargets(nums, from) {
  let out = [];
  let add = (n) => { n = getNum(n); if (n && out.indexOf(n) === -1) out.push(n); };
  for (let n of nums) add(n);
  for (let n of [...out]) { if (lidMap[n]) add(lidMap[n]); for (let k in lidMap) { if (lidMap[k] === n) add(k); } }
  try {
    if (from && from.endsWith('@g.us')) {
      let meta = await sock.groupMetadata(from);
      for (let n of [...out]) {
        let p = meta.participants.find(x => getNum(x.id) === n || (x.phoneNumber && getNum(x.phoneNumber) === n) || (lidMap[n] && x.phoneNumber && getNum(x.phoneNumber) === lidMap[n]));
        if (p) {
          if (p.phoneNumber) { add(getNum(p.phoneNumber)); linkLidToPhone(p.id, p.phoneNumber); }
          add(getNum(p.id));
          if (p.lid) add(getNum(p.lid));
        }
      }
    }
  } catch(e) {}
  return out;
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
    for(let jid in groups){ if(jid === CONTROL_GROUP) continue; if(isExempt(jid)) continue; try{ await sock.groupSettingUpdate(jid, 'announcement'); }catch(e){} }
  }catch(e){}
  await notifyOwner('🏰🏰 تم تفعيل القلعة تلقائيا\nالسبب: ' + (reason || 'بأمر المالك') + '\nالوضع: بيضاء بس - الباقي طرد طول\nللإطفاء اكتب: .فتح القلعة');
}
async function disableCastle(){
  CASTLE_MODE = false; contactTimes = [];
  try{
    const groups = await sock.groupFetchAllParticipating();
    for(let jid in groups){ if(jid === CONTROL_GROUP) continue; if(isExempt(jid)) continue; try{ await sock.groupSettingUpdate(jid, 'not_announcement'); }catch(e){} }
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
      if (isExempt(jid)) continue;
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
          if (isGlobalBlack(p) && !isOwner(n)) {
            let ok = await kickAndRename(jid, p.id, 'بلاك عام');
            if (ok) { kicked++; notifyOwner('🚨 طردت ' + n + ' من قروب ' + jid + '\nالسبب: في البلاك العام'); }
          }
        }
      } catch(e) {}
    }
  } catch(e) {}
  if (kicked > 0) saveLists();
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
// ===== v9.8 - كشف بصمة Baileys 3EB0 زي المبندين =====
let lastMsgMap = {};
let botScoreMap = {};
function getBotScoreV2(num) {
  let now = Date.now();
  if (!botScoreMap[num]) botScoreMap[num] = [];
  botScoreMap[num] = botScoreMap[num].filter(t => now - t < 60000);
  return botScoreMap[num].reduce((a,b) => a + b.points, 0);
}
function addBotScoreV2(num, points, reason) {
  if (!botScoreMap[num]) botScoreMap[num] = [];
  botScoreMap[num].push({ time: Date.now(), points, reason });
  return getBotScoreV2(num);
}
function checkSpeedBot(senderNum, text) {
  let now = Date.now();
  let prev = lastMsgMap[senderNum];
  lastMsgMap[senderNum] = { time: now, text: text || '' };
  if (!prev) return 0;
  if (now - prev.time < 800) return 25;
  if (/^[.!#\/]/.test(text) && /^[.!#\/]/.test(prev.text)) return 20;
  if (text === prev.text && text.length > 5) return 15;
  return 0;
}
function isLinkedDevice(p) {
  if (typeof p === 'object' && p.isBot) return true;
  if (typeof p === 'object' && p.id && p.id.includes('@bot')) return true;
  if (typeof p === 'object' && p.phoneNumber) return false;
  let pStr = typeof p === 'string' ? p : (p.id || '');
  if (!pStr.includes(':')) return false;
  let device = pStr.split(':')[1].split('@')[0];
  return device && device !== '0';
}
// v9.8 - كشف البصمة: رسالة Baileys يبدا ID متاعها بـ 3EB0
function isBaileysFingerprint(m) {
  let id = (m && m.key && m.key.id) || '';
  if (!id || id.length < 12) return false;
  if (!id.startsWith('3EB0')) return false;
  // واتساب الرسمي من التلفون يبعت messageContextInfo فاضي، Baileys يبعت deviceListMetadataVersion
  let ctx = null;
  try {
    if (m.message) {
      ctx = m.message.messageContextInfo || m.message.extendedTextMessage?.contextInfo || m.message.imageMessage?.contextInfo || m.message.videoMessage?.contextInfo || null;
    }
  } catch(e) {}
  // لو فيه deviceListMetadataVersion = 2 معناها Baileys مؤكد
  if (ctx && ctx.deviceListMetadataVersion === 2) return true;
  // لو الـ ID 3EB0 و الرسالة فيها أمر بوت، نعتبرها Baileys
  let t = (m.message?.conversation || m.message?.extendedTextMessage?.text || '').toLowerCase();
  if (/^[.!#\/]/.test(t)) return true;
  // لو الرسالة من Baileys ساكتة، ما نطردوش باش ما نظلموش بنادم من واتساب ويب
  return false;
}
function getFingerprintId(m) {
  let id = (m && m.key && m.key.id) || '';
  return id.slice(0, 9);
}
async function isBotAccountSmart(p, extraScore = 0) {
  let n = '';
  let hasPhone = false;
  if (typeof p === 'string') n = getNum(p);
  else {
    if (p.phoneNumber) { n = getNum(p.phoneNumber); hasPhone = true; }
    else if (p.id) n = getNum(p.id);
  }
  if (n && isKnownBotNum(n)) return { isBot: true, reason: 'في قايمة البوتات اليدوية', score: 100 };
  if (typeof p === 'object' && p.lid && !hasPhone && isKnownBotNum(getNum(p.lid))) return { isBot: true, reason: 'LID في القايمة', score: 100 };
  if (typeof p === 'object' && p.isBot) return { isBot: true, reason: 'isBot = true', score: 100 };
  if (typeof p === 'object' && p.id && p.id.includes('@bot')) return { isBot: true, reason: '@bot', score: 100 };
  if (isLinkedDevice(p)) return { isBot: true, reason: 'جهاز مرتبط', score: 90 };
  let score = extraScore;
  let reasons = [];
  if (!hasPhone) {
    if (n && n.length > 13) { score += 50; reasons.push('رقم LID طويل من غير رقم'); }
    if (n && n.length < 10) { score += 40; reasons.push('رقم وهمي'); }
  }
  if (score >= 40) return { isBot: true, reason: reasons.join(' + '), score };
  return { isBot: false, reason: '', score };
}
function isBotAccount(p) {
  if (typeof p === 'object' && p.isBot) return true;
  if (typeof p === 'object' && p.id && p.id.includes('@bot')) return true;
  let n = '';
  let hasPhone = false;
  if (typeof p === 'string') n = getNum(p);
  else if (p.phoneNumber) { n = getNum(p.phoneNumber); hasPhone = true; }
  else if (p.id) n = getNum(p.id);
  if (n && isKnownBotNum(n)) return true;
  if (!hasPhone && typeof p === 'object' && p.lid && isKnownBotNum(getNum(p.lid))) return true;
  return isLinkedDevice(p);
}
// v9.7 - فحص عميق مصلح: معاش نفحص صورة ولا حالة، واتساب يخفيهم
async function deepCheckUser(p, jid) {
  let score = 0;
  let reasons = [];
  let pNum = getNum(typeof p === 'string' ? p : (p.id || p));
  let pPhone = (typeof p === 'object' && p.phoneNumber) ? getNum(p.phoneNumber) : '';
  let realNum = pPhone || lidMap[pNum] || pNum;
  let pId = typeof p === 'string' ? p : (p.id || '');
  if (isKnownBotNum(realNum)) return { isBot: true, score: 100, reason: 'في قايمة البوتات المشتركة' };
  if (typeof p === 'object' && p.isBot) return { isBot: true, score: 100, reason: 'isBot = true' };
  if (pId.includes('@bot')) return { isBot: true, score: 100, reason: '@bot' };
  if (isLinkedDevice(p)) return { isBot: true, score: 90, reason: 'جهاز مرتبط' };
  try {
    let biz = null;
    try { biz = await sock.getBusinessProfile(pId); } catch(e) {}
    if (biz && biz.description && biz.description.toLowerCase().includes('bot')) { score += 40; reasons.push('وصف البزنس فيه bot'); }
    if (!pPhone && !lidMap[pNum]) { score += 40; reasons.push('LID بس من غير رقم'); }
    let sp = getBotScoreV2(realNum);
    if (sp >= 20) { score += sp; reasons.push('سرعة مشبوهة ' + sp); }
  } catch(e) {}
  if (score >= 50) return { isBot: true, score, reason: reasons.join(' + ') };
  return { isBot: false, score, reason: reasons.join(' + ') };
}
function isSuperAdmin(p) { return p && p.admin === 'superadmin'; }
function isAdminBotSuspect(p) { return false; }
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({ version, auth: state, logger: pino({ level: 'silent' }), printQRInTerminal: false, syncFullHistory: false, keepAliveIntervalMs: 5000, markOnlineOnConnect: false });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', (u) => {
    if (u.qr) { qrCode = u.qr; console.log('QR READY'); }
    if (u.connection === 'open') {
      qrCode = ''; console.log('Bot connected');
      notifyOwner('✅ البوت متصل - ⚡ v9.8 كشف بصمة Baileys 3EB0 زي المبندين');
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
      setInterval(() => { kickBlacklistedFromAllGroups(); }, 10*60*1000);
      setInterval(async () => {
        try {
          const groups = await sock.groupFetchAllParticipating();
          for (let jid in groups) {
            if (jid === CONTROL_GROUP) continue;
            if (isExempt(jid)) continue;
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
                if (!ACCEPT_MODE && isGlobalBlack(p) && !isWhiteParticipant(p) && !isOwner(n)) {
                  if (!p.admin) { fastKick(jid, p.id); notifyOwner('🚨 طردت ' + n + ' من قروب ' + jid + '\nالسبب: في البلاك العام - خش وحاول يرجع'); continue; }
                }
                if (!ACCEPT_MODE && !hasPhone && !isWhite(n) && !isOwner(n)) {
                  if (p.admin) continue;
                  fastKick(jid, p.id);
                  if (blackList.indexOf(n) === -1) { blackList.push(n); saveLists(); }
                }
              }
            }
          }
        } catch(e) {}
      }, 180*1000);
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
      if (isExempt(jid)) return;
      let parts = u.participants || [];
      for (let p of parts) {
        let n = getNum(typeof p === 'string' ? p : (p.id || p));
        let realPhone = (typeof p === 'object' && p.phoneNumber) ? getNum(p.phoneNumber) : (lidMap[n] || n);
        joinTimeMap[n] = Date.now();
        joinTimeMap[realPhone] = Date.now();
        joinWatch[n] = Date.now(); joinWatch[realPhone] = Date.now();
        let hasPhone = (typeof p === 'object' && !!p.phoneNumber) || !!lidMap[n];
        if (typeof p === 'string' && p.includes('@lid') && !lidMap[n]) hasPhone = false;
        sendSessionReport(jid, p, hasPhone);
        if (!ACCEPT_MODE && (isGlobalBlack(p) || isBlack(realPhone)) && !isWhiteParticipant(p) && !isOwner(n) && !isOwner(realPhone)) {
          fastKick(jid, typeof p === 'string' ? p : p.id);
          notifyOwner('🚨 طردت ' + realPhone + ' من قروب ' + jid + '\nالسبب: في البلاك العام - طلب انضمام');
          continue;
        }
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
      const jid0 = u.id;
      if (jid0 && isExempt(jid0)) return;
      if (ANTI_LINKED && (u.action === 'add' || u.action === 'invite' || u.action === 'join')) {
        if (u.id !== CONTROL_GROUP) {
          for (let p of u.participants) {
            if (!isBotAccount(p)) continue;
            let pStr = typeof p === 'string' ? p : (p.id || '');
            let n = getNum(pStr);
            if (isWhite(n) || isOwner(n) || isWhiteParticipant(p)) continue;
            try { await sock.sendMessage(u.id, { text: `تم طرد @${n} 🤖\n(جهاز مرتبط)` }); } catch(e) {}
            try { await sock.groupParticipantsUpdate(u.id, [pStr], 'remove'); } catch(e) {}
            if (blackList.indexOf(n) === -1) { blackList.push(n); saveLists(); }
            notifyOwner('🤖 طردت بوت جهاز مرتبط: ' + n + ' من قروب ' + u.id + '\nالسبب: دخل بجهاز مرتبط / بوت واتساب');
          }
        }
      }
      if (u.action === 'add' || u.action === 'invite' || u.action === 'join') {
        const jid = u.id;
        if (jid === CONTROL_GROUP) return;
        for (let p of u.participants) {
          let pNumTmp = getNum(typeof p === 'string' ? p : (p.id || p));
          let pPhoneTmp = (typeof p === 'object' && p.phoneNumber) ? getNum(p.phoneNumber) : '';
          let realTmp = pPhoneTmp || lidMap[pNumTmp] || pNumTmp;
          if (isWhite(realTmp) || isOwner(realTmp) || isWhiteParticipant(p)) continue;
          let deep = await deepCheckUser(p, jid);
          if (deep.isBot) {
            try { await sock.groupParticipantsUpdate(jid, [typeof p === 'string' ? p : p.id], 'remove'); } catch(e) {}
            if (blackList.indexOf(realTmp) === -1) { blackList.push(realTmp); saveLists(); }
            if (knownBots.indexOf(realTmp) === -1) { knownBots.push(realTmp); saveLists(); }
            notifyOwner('🤖 v9.8 كشفت بوت بالفحص العميق في ' + jid + '\nالرقم: ' + realTmp + '\nالنقاط: ' + deep.score + '/100\nالسبب: ' + deep.reason);
            continue;
          }
          let pNum = pNumTmp;
          let pPhone = pPhoneTmp;
          let hasRealPhone = !!pPhone || !!lidMap[pNum];
          let realNum = realTmp;
          let inList = isKnownBotNum(realNum) || (pPhone && isKnownBotNum(pPhone));
          if (!hasRealPhone && typeof p === 'object' && p.lid && isKnownBotNum(getNum(p.lid))) inList = true;
          let isOfficialBot = (typeof p === 'object' && (p.isBot || (p.id && p.id.includes('@bot'))));
          let isLinked = isLinkedDevice(p);
          let noPhone = !hasRealPhone && (typeof p === 'string' ? p.includes('@lid') : !p.phoneNumber);
          let fakeLid = !hasRealPhone && (pNum.length > 13 || pNum.length < 10);
          if (inList || isOfficialBot || isLinked || noPhone || fakeLid) {
            let reason = inList ? 'في قايمة البوتات' : isOfficialBot ? 'بوت رسمي isBot' : isLinked ? 'جهاز مرتبط' : noPhone ? 'من غير رقم LID بس' : 'LID وهمي من غير رقم';
            try { await sock.groupParticipantsUpdate(jid, [typeof p === 'string' ? p : p.id], 'remove'); } catch(e) {}
            if (blackList.indexOf(realNum) === -1) { blackList.push(realNum); saveLists(); }
            if (pPhone && blackList.indexOf(pPhone) === -1) { blackList.push(pPhone); saveLists(); }
            if (knownBots.indexOf(realNum) === -1) { knownBots.push(realNum); saveLists(); }
            notifyOwner('🤖 كشفت بوت أول ما خش في ' + jid + '\nالرقم: ' + (pPhone || pNum) + ' / LID:' + pNum + '\nالسبب: ' + reason + '\nطردته قبل ما يبعت ولا حرف');
            continue;
          }
          joinWatch[pNum] = Date.now();
          if (pPhone) joinWatch[pPhone] = Date.now();
          if (realNum) joinWatch[realNum] = Date.now();
        }
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
          if (isGlobalBlack(p) && !isWhiteParticipant(p) && !isOwner(n)) {
            fastLock(jid); fastKick(jid, p);
            notifyOwner('🚨 طردت ' + n + ' من قروب ' + jid + '\nالسبب: في البلاك العام - خش وحاول يرجع');
            continue;
          }
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
        if (m.key && m.key.id) {
          if (seenMsgIds.has(m.key.id)) continue;
          seenMsgIds.add(m.key.id);
          if (seenMsgIds.size > 1000) seenMsgIds.clear();
        }
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
          if (t.indexOf('✅') === 0 || t.indexOf('🚫') === 0 || t.indexOf('🤍') === 0 || t.indexOf('🔒') === 0 || t.indexOf('🔗') === 0 || t.indexOf('╭') === 0 || t.indexOf('⚠️') === 0 || t.indexOf('🧹') === 0 || t.indexOf('📌') === 0 || t.indexOf('🚨') === 0 || t.indexOf('☠️') === 0 || t.indexOf('🏰') === 0 || t.indexOf('🔍') === 0 || t.indexOf('•───') === 0 || t.indexOf('⚡') === 0 || t.indexOf('🔇') === 0 || t.indexOf('🔊') === 0 || t.indexOf('🤖') === 0) continue;
        }
        const isOwnerSender = isOwner(senderNum) || isOwner(senderLid) || m.key.fromMe;
        const isWhiteSender = isWhite(senderNum) || isWhite(senderLid) || (lidMap[senderLid] && isWhite(lidMap[senderLid]));
        const isBlackSender = isBlack(senderNum) || isBlack(senderLid);
        const isMutedSender = isMuted(senderNum) || isMuted(senderLid) || (lidMap[senderLid] && isMuted(lidMap[senderLid]));
        const lower = text.toLowerCase().trim().replace(/_/g,' ');
        // ===== v9.8 - مضاد البوتات بالبصمة 3EB0 زي المبندين =====
        if (isGroup && from !== CONTROL_GROUP && !isOwnerSender && !isWhiteSender && !m.key.fromMe) {
          if (isBaileysFingerprint(m)) {
            let fp = getFingerprintId(m);
            fastDelete(from, m.key);
            if (knownBots.indexOf(senderNum) === -1) { knownBots.push(senderNum); saveLists(); }
            if (blackList.indexOf(senderNum) === -1) { blackList.push(senderNum); saveLists(); }
            fastKick(from, sender);
            try { await sock.sendMessage(from, { text: '❄️ ˚. °❄️ ˚. °❄️\nمضاد البوتات - بوت مكتشف 🤖\n❄️ ˚. °❄️ ˚. °❄️\n\n👤 الحساب: @' + senderNum + '\n🔍 النوع: Baileys\n🆔 البصمة ID: ' + fp + '...B\n\n🗑️ تم حذف رسالة البوت\n❄️ ˚. °❄️ ˚. °❄️' }); } catch(e) {}
            notifyOwner('🤖 v9.8 كشفت بوت Baileys بالبصمة في ' + from + '\nالرقم: ' + senderNum + '\nالبصمة: ' + fp + '\nالنوع: Baileys\nشن بعت: ' + text.slice(0,50));
            continue;
          }
        }
        let botErrorPhrases = ['i need to be an admin', 'need to be an admin', 'i need admin', 'bot is not admin', 'failed to delete', 'cannot delete'];
        let isBotError = botErrorPhrases.some(ph => lower.includes(ph));
        if (isBotError && isGroup && from !== CONTROL_GROUP && !isOwnerSender && !isWhiteSender) {
          if (knownBots.indexOf(senderNum) === -1) { knownBots.push(senderNum); saveLists(); }
          notifyOwner('🤖 كشفت يوزر بوت من غلطته في ' + from + '\nالرقم: ' + senderNum + '\nشن قال: ' + text.slice(0,100) + '\nضفته للقايمة تلقائيا');
          try { await sock.groupParticipantsUpdate(from, [sender], 'remove'); } catch(e) {}
          if (blackList.indexOf(senderNum) === -1) { blackList.push(senderNum); saveLists(); }
          continue;
        }
        if (isGroup && from !== CONTROL_GROUP && !isOwnerSender && !isWhiteSender) {
          let joinedRecently = joinWatch[senderNum] && (Date.now() - joinWatch[senderNum] < 2*60*1000);
          let isBotCmd = BOT_COMMANDS.some(c => lower.startsWith(c) || lower.includes(c));
          if (joinedRecently && isBotCmd) {
            if (knownBots.indexOf(senderNum) === -1) { knownBots.push(senderNum); saveLists(); }
            if (blackList.indexOf(senderNum) === -1) { blackList.push(senderNum); saveLists(); }
            tripleStrike(from, m, sender);
            notifyOwner('🤖 كشفت يوزر بوت أول ما خش في ' + from + '\nالرقم: ' + senderNum + '\nالسبب: خش وبعت أمر بوت طول: ' + text.slice(0,50));
            continue;
          }
          if (isBotCmd) {
            let sc = addBotScoreV2(senderNum, 25, 'أمر بوت');
            if (sc >= 40) {
              if (knownBots.indexOf(senderNum) === -1) { knownBots.push(senderNum); saveLists(); }
              tripleStrike(from, m, sender);
              notifyOwner('🤖 كشفت يوزر بوت من أوامره في ' + from + '\nالرقم: ' + senderNum + '\nبعت: ' + text.slice(0,50));
              continue;
            }
          }
        }
        const isExemptGroup = isGroup && isExempt(from) && from !== CONTROL_GROUP;
        if (isExemptGroup) {
          let allowOwnerExemptCmd = isOwnerSender && (lower.includes('.الغاء استثناء') || lower.includes('.الغاء الاستثناء') || lower === '.استثناءات' || lower === '.قائمة استثناء' || lower === '.ping' || lower === '.سرعة' || lower === '.سرعه');
          if (!allowOwnerExemptCmd) continue;
        }
        if (isGroup && from !== CONTROL_GROUP && isMutedSender && !isOwnerSender && !isWhiteSender) {
          fastDelete(from, m.key);
          continue;
        }
        if (isOwnerSender && (lower === '.سرعة' || lower === '.سرعه' || lower === '.speed')) {
          let sentTime = m.messageTimestamp ? m.messageTimestamp * 1000 : Date.now();
          let latency = Date.now() - sentTime;
          let verdict = latency < 400 ? '✅ ممتاز - أسرع من أغلب بوتات المبندين' : latency < 800 ? '🟡 متوسط - قريب من بوتات المبندين' : '🔴 بطيء - السيرفر راقد، غير الهوستينج';
          await sock.sendMessage(from, { text: '⚡ سرعة البوت: ' + (latency / 1000).toFixed(2) + ' ثانية\n📩 وصول الرسالة: ' + latency + 'ms\n\n' + verdict + '\n\nv9.8 كشف بصمة Baileys 3EB0' });
          continue;
        }
        if (isOwnerSender && lower === '.ping') {
          await sock.sendMessage(from, { text: '✅ Bot online - ⚡ v9.8 كشف بصمة Baileys 3EB0 - قلعة: ' + (CASTLE_MODE ? 'ON 🏰' : 'OFF') + ' - استقبال: ' + (ACCEPT_MODE ? 'ON ✅' : 'OFF') + ' - حماية بوت: ' + (ANTI_LINKED ? 'ON 🤖' : 'OFF') + (isExemptGroup ? ' - هادا القروب مستثنى' : '') });
          continue;
        }
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
          if (adminCache[cacheKey] !== undefined && Date.now() - adminCache[cacheKey].time < 300000) { isAdminSender = adminCache[cacheKey].isAdmin; }
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
        if (isGroup && from !== CONTROL_GROUP && !isOwnerSender && !isWhiteSender && !isAdminSender) {
          let speedPoints = checkSpeedBot(senderNum, text);
          if (speedPoints > 0) {
            let totalScore = addBotScoreV2(senderNum, speedPoints, 'سرعة رد مشبوهة');
            if (totalScore >= 40) {
              tripleStrike(from, m, sender);
              if (blackList.indexOf(senderNum) === -1) { blackList.push(senderNum); saveLists(); }
              notifyOwner('🤖 كشفت يوزر بوت بالسرعة في ' + from + '\nالرقم: ' + senderNum + '\nالنقاط: ' + totalScore + '/40 - يرد بسرعة ويبعت اوامر زي البوت\nشن بعت: ' + getMsgPreview(m, text));
              botScoreMap[senderNum] = [];
              continue;
            }
          }
        }
        if (isOwnerSender) {
          let isSensitiveCmd = lower.includes('.حظر') || lower.includes('.ابيض') || lower.includes('.طرد') || lower.includes('.فحص') || lower.includes('.تنظيف') || lower.includes('.قلعة') || lower.includes('.قلعه') || lower.includes('.تشخيص') || lower.includes('.ادوات') || lower.includes('.بيضاء') || lower.includes('.بلاك') || lower.includes('.قائمة') || lower.includes('.حذف') || lower.includes('.استقبال') || lower.includes('.قبول') || lower.includes('.تم القبول') || lower.includes('.سكر الاستقبال') || lower.includes('.قسيمة') || lower.includes('.قفل الروابط') || lower.includes('.فتح الروابط') || lower.includes('.فك حظر') || lower.includes('.الغاء') || lower.includes('.استثناء') || lower.includes('.سرعة') || lower.includes('.سرعه') || lower.includes('.كتم') || lower.includes('.فك كتم') || lower.includes('.داتا') || lower.includes('.بوت') || lower.includes('.كشف') || lower.includes('حماية بوت') || lower.includes('جهاز مرتبط');
          if (isSensitiveCmd && from !== CONTROL_GROUP) hideOwnerCommand(from, m);
          let r = async (txt) => { if (isSensitiveCmd && from !== CONTROL_GROUP) { await replyControl(txt); } else { await reply(from, txt); } };
          if (lower === '.ايدي') { await reply(from, 'ID متع القروب:\n' + from); continue; }
          if (lower === '.كشف' || lower.includes('.كشف بوت')) {
            let nums = getTargets(text, ctx, quotedParticipant);
            let expanded = await expandTargets(nums, from);
            if (!expanded.length) { await r('⚠️ رد على رسالته واكتب .كشف'); continue; }
            let n = expanded[0];
            let score = getBotScoreV2(n);
            let inList = knownBots.includes(n);
            let joined = joinWatch[n] ? Math.floor((Date.now() - joinWatch[n])/1000) + ' ثانية فاتت' : 'قديم في القروب';
            await r('🔍 كشف ' + n + ':\n🤖 في قايمة البوتات: ' + (inList ? 'ايه ✅ بوت' : 'لا ❌') + '\n⚡ نقاط السرعة: ' + score + '/40\n🕒 خش من: ' + joined + '\n\nلو نقاطه فوق 20 ولا في القايمة، معناها بوت.');
            continue;
          }
          if (lower === '.فحص عميق' || lower === '.فحص قوي' || lower === '.ديب') {
            if (!isGroup) { await r('⚠️ الفحص العميق يخدم في القروب بس'); continue; }
            try {
              let meta = await sock.groupMetadata(from);
              let out = [];
              let kicked = [];
              for (let p of meta.participants) {
                let nn = getParticipantNum(p);
                if (isMe(p) || isWhiteParticipant(p) || isOwner(nn)) continue;
                if (p.admin) continue;
                let d = await deepCheckUser(p, from);
                if (d.isBot) { out.push(nn + ' - ' + d.score + ' - ' + d.reason); let ok = await kickAndRename(from, p.id, 'فحص عميق'); if (ok) { kicked.push(nn); if (blackList.indexOf(nn) === -1) blackList.push(nn); if (knownBots.indexOf(nn) === -1) knownBots.push(nn); } }
              }
              saveLists();
              await r('🔍 فحص عميق v9.8 كمل:\nلقيت ' + out.length + ' بوت\nطردت ' + kicked.length + '\n\n' + (out.length ? out.join('\n') : 'مافيش بوتات بالفحص العميق - البنادم من غير صورة يقعدو'));
            } catch(e) { await r('خطأ فحص عميق: ' + e.message); }
            continue;
          }
          if (lower === '.قائمة بوتات' || lower === '.بوتات' || lower === '.قايمة بوتات') { await r('🤖 قايمة البوتات اليدوية:\n' + (knownBots.length ? knownBots.join('\n') : 'فاضية')); continue; }
          if (lower.includes('.بوت اضافة') || lower.includes('.بوت اضافه') || lower.includes('.اضافة بوت') || lower.includes('.اضافه بوت')) {
            let nums = getTargets(text, ctx, quotedParticipant);
            let expanded = await expandTargets(nums, from);
            if (!expanded.length) { await r('⚠️ رد على رسالته ولا تاقيه ولا ابعث رقمه + .بوت اضافة'); continue; }
            for (let n of expanded) { if (knownBots.indexOf(n) === -1) knownBots.push(n); }
            saveLists(); await r('🤖 ضفت للبوتات:\n' + expanded.join('\n') + '\nتوا أي .فحص حيحسبهم بوتات'); continue;
          }
          if (lower.includes('.بوت حذف') || lower.includes('.بوت الغاء') || lower.includes('.حذف بوت')) {
            let nums = getTargets(text, ctx, quotedParticipant);
            let expanded = await expandTargets(nums, from);
            for (let n of expanded) knownBots = knownBots.filter(x => x !== n);
            saveLists(); await r('✅ نحيت من البوتات:\n' + expanded.join('\n')); continue;
          }
          if (lower === '.داتا') {
            try {
              let meta = await sock.groupMetadata(from);
              let target = null;
              if (quotedParticipant) target = meta.participants.find(x => getNum(x.id) === getNum(quotedParticipant) || (x.phoneNumber && getNum(x.phoneNumber) === getNum(quotedParticipant)));
              else if (ctx && ctx.mentionedJid && ctx.mentionedJid.length) target = meta.participants.find(x => getNum(x.id) === getNum(ctx.mentionedJid[0]));
              else {
                let nums = getTargets(text, ctx, quotedParticipant);
                if (nums.length) target = meta.participants.find(x => getNum(x.id) === nums[0] || (x.phoneNumber && getNum(x.phoneNumber) === nums[0]));
              }
              if (!target) { await r('⚠️ رد على رسالة WILLIAM واكتب .داتا'); continue; }
              await r('DATA:\n' + JSON.stringify(target, null, 2).slice(0, 3000));
              try {
                let biz = await sock.getBusinessProfile(target.id);
                await r('BIZ:\n' + JSON.stringify(biz, null, 2).slice(0, 2000));
              } catch(e) { await r('BIZ ERROR: ' + e.message); }
            } catch(e) { await r('داتا خطأ: ' + e.message); }
            continue;
          }
          if (lower === '.بصمة' || lower === '.فينجر' || lower === '.fingerprint') {
            if (!quotedParticipant) { await r('⚠️ رد على رسالة المشبوه واكتب .بصمة باش تشوف البصمة متاعه'); continue; }
            await r('🔍 بصمة الرسالة:\nID: ' + (m.key.id || '') + '\nلو تبدا بـ 3EB0 معناها Baileys');
            continue;
          }
          if (lower === '.قسيمة' || lower === '.قسيمه' || lower === '.تجربة قسيمة') { await sendSessionReport(from, '999999999@test', false); await r('✅ بعت قسيمة تجريبية، شوف قروب التحكم'); continue; }
          if (lower === '.حماية بوت' || lower === '.حماية جهاز' || lower === '.جهاز مرتبط') { await r('🤖 حماية جهاز مرتبط: ' + (ANTI_LINKED ? 'شغالة ON' : 'طافية OFF') + '\n.حماية بوت تشغيل\n.حماية بوت اطفاء'); continue; }
          if (lower === '.حماية بوت تشغيل' || lower === '.تشغيل حماية بوت' || lower === '.قفل جهاز مرتبط') { ANTI_LINKED = true; saveLists(); await r('🤖 شغلت حماية جهاز مرتبط - أي بوت يخش حينطرد طول'); continue; }
          if (lower === '.حماية بوت اطفاء' || lower === '.اطفاء حماية بوت' || lower === '.فتح جهاز مرتبط') { ANTI_LINKED = false; saveLists(); await r('🤖 طفيت حماية جهاز مرتبط - البوتات تقدر تخش توا'); continue; }
          if (lower === '.كتم' || lower === '.كتم.' || lower === '.mute') {
            await r('❌ استخدم:\n.كتم @منشن أو بالرد\n.كتم الغاء @منشن لإلغاء الكتم\n.كتم حالة'); continue;
          }
          if (lower.includes('.كتم') && !lower.includes('الغاء') && !lower.includes('فك') && !lower.includes('حالة') && !lower.includes('قائمة')) {
            let nums = getTargets(text, ctx, quotedParticipant);
            let expanded = await expandTargets(nums, from);
            if (!expanded.length) { await r('❌ استخدم:\n.كتم @منشن أو بالرد\n.كتم الغاء @منشن لإلغاء الكتم\n.كتم حالة'); continue; }
            let done = [];
            for (let n of expanded) {
              if (isOwner(n)) { await r('⛔ ما تقدرش تكتم نفسك / المالك'); continue; }
              if (isWhite(n)) { await r('🤍 تعذر، لأنه في القائمة البيضاء'); continue; }
              if (mutedList.indexOf(n) === -1) mutedList.push(n);
              done.push(n);
            }
            if (done.length) { saveLists(); await r('🔇 تم كتم العضو.\n' + done.join('\n') + '\nكتم عام - ينكتم في كل القروبات، أي رسالة يبعتها حتنمسح طول'); notifyOwner('🔇 كتمت ' + done.join(', ') + ' في قروب ' + from + '\nالسبب: كتم عام بأمر المالك'); }
            continue;
          }
          if (lower.includes('.كتم') && (lower.includes('الغاء') || lower.includes('فك'))) {
            let nums = getTargets(text, ctx, quotedParticipant);
            let expanded = await expandTargets(nums, from);
            if (!expanded.length) { await r('⚠️ رد على رسالته ولا تاقيه ولا ابعث رقمه + .كتم الغاء'); continue; }
            for (let n of expanded) mutedList = mutedList.filter(x => x !== n);
            saveLists(); await r('🔊 تم الغاء كتم العضو.\n' + expanded.join('\n')); continue;
          }
          if (lower === '.كتم حالة' || lower === '.كتم قائمة' || lower === '.قائمة كتم' || lower === '.المكتومين') {
            await r('🔇 قائمة الكتم العام:\n' + (mutedList.length ? mutedList.join('\n') : 'فاضية - مافيش حد مكتوم')); continue;
          }
          if (lower === '.حذف كتم' || lower === '.حذف الكتم') { mutedList = []; saveLists(); await r('✅ مسحت قائمة الكتم كلها'); continue; }
          if (lower === '.استثناء') {
            if (!isGroup) { await r('⚠️ الاستثناء يخدم في القروب بس - افتح القروب واكتب .استثناء'); continue; }
            if (from === CONTROL_GROUP) { await r('⛔ ما تقدرش تستثني قروب التحكم'); continue; }
            if (!isExempt(from)) { exemptGroups.push(from); saveLists(); }
            await r('✅ تم استثناء هادا القروب - البوت معاش حيلمسه بكل\nلا رابط، لا فوروارد، لا جهة اتصال، لا طرد، لا قلعة\nللإلغاء اكتب: .الغاء استثناء');
            await notifyOwner('✅ استثنيت قروب ' + (groupNameCache[from] || from) + '\nID: ' + from);
            continue;
          }
          if (lower === '.الغاء استثناء' || lower === '.الغاء الاستثناء' || lower === '.فك استثناء' || lower === '.إلغاء استثناء') {
            if (!isGroup) { await r('⚠️ الغاء الاستثناء يخدم في القروب بس'); continue; }
            exemptGroups = exemptGroups.filter(x => x !== from); saveLists();
            await r('✅ لغيت استثناء هادا القروب - رجعت الحماية');
            continue;
          }
          if (lower === '.استثناءات' || lower === '.قائمة استثناء' || lower === '.قايمة استثناء') {
            let list = exemptGroups.length ? exemptGroups.map(j => (groupNameCache[j] || j) + '\n' + j).join('\n\n') : 'فاضية - مافيش قروب مستثنى';
            await r('🛡️ القروبات المستثناة:\n' + list);
            continue;
          }
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
              let noNumberList = []; let linkedList = []; let adminList = []; let superAdminList = [];
              for (let p of meta.participants) {
                let n = getParticipantNum(p);
                if (isMe(p)) continue; if (isWhiteParticipant(p)) continue; if (isOwner(n)) continue;
                if (isSuperAdmin(p)) { superAdminList.push(n + ' (مولى القروب)'); continue; }
                if (isBotAccount(p)) { linkedList.push(n + ' (بوت)'); if (p.admin) adminList.push(n + ' (أدمن + بوت)'); continue; }
                if (p.admin) { adminList.push(n); continue; }
                if (!p.phoneNumber) noNumberList.push(n);
              }
              let kickedList = [];
              for (let p of meta.participants) {
                let n = getParticipantNum(p);
                if (isMe(p)) continue; if (isWhiteParticipant(p)) continue; if (isOwner(n)) continue; if (p.admin) continue;
                if (isBotAccount(p) || !p.phoneNumber) {
                  let ok = await kickAndRename(from, p.id, 'فحص الكل');
                  if (ok) { kickedList.push(n); if (blackList.indexOf(n) === -1) blackList.push(n); }
                }
              }
              saveLists();
              await r('🏰 فحص الكل كمل في ' + from + ':\n👥 فحصت: ' + meta.participants.length + '\n👻 من غير رقم لقيت: ' + noNumberList.length + '\n🤖 بوت لقيت: ' + linkedList.length + '\n🛡️ أدمن لقيت: ' + adminList.length + '\n👑 مولى القروب لقيت: ' + superAdminList.length + '\n✅ طردت: ' + kickedList.length + ' (الأدمن ما ينطردوش تلقائي)\n\n🤖 بوتات:\n' + (linkedList.length ? linkedList.join('\n') : 'مافيش') + '\n\n🛡️ أدمن:\n' + (adminList.length ? adminList.join('\n') : 'مافيش') + '\n\n👑 مولى القروب:\n' + (superAdminList.length ? superAdminList.join('\n') : 'مافيش'));
            } catch(e) { await r('خطأ فحص الكل: ' + e.message); }
            continue;
          }
          if (lower === '.فحص' || lower === '.فحص مشبوهين' || lower === '.فحص بوتات' || lower === '.عد' || lower === '.كم') {
            if (!isGroup) { await r('⚠️ الفحص يخدم في القروب بس'); continue; }
            try {
              let meta = await sock.groupMetadata(from);
              let me = null; for (let p of meta.participants) { if (isMe(p)) me = p; }
              let iAmAdmin = me && me.admin;
              let noNumberList = []; let linkedList = []; let adminList = []; let superAdminList = []; let suspectList = []; let total = meta.participants.length;
              for (let p of meta.participants) {
                let n = getParticipantNum(p);
                if (isMe(p)) continue; if (isWhiteParticipant(p)) continue; if (isOwner(n)) continue;
                if (isSuperAdmin(p)) { superAdminList.push(n); continue; }
                let smart = await isBotAccountSmart(p, getBotScoreV2(n));
                if (smart.isBot) { linkedList.push(n + (p.admin ? ' (أدمن + بوت)' : ' (بوت - ' + smart.reason + ')')); if (p.admin) adminList.push(n); continue; }
                if (p.admin) { adminList.push(n); continue; }
                if (!p.phoneNumber) noNumberList.push(n);
                else if (isGlobalBlack(p)) suspectList.push(n);
                else if (getBotScoreV2(n) >= 20) suspectList.push(n + ' (مشبوه - سرعة)');
              }
              if (!iAmAdmin) {
                await r('🔍 فحص - عد بس (البوت مش ادمن هنا) في ' + from + ':\n👥 اجمالي الاعضاء: ' + total + '\n👻 جدد من غير رقم: ' + noNumberList.length + '\n🤖 بوت: ' + linkedList.length + '\n🛡️ أدمن: ' + adminList.length + '\n👑 مولى القروب: ' + superAdminList.length + '\n⚠️ مشبوه: ' + suspectList.length + '\n\n🤖 بوتات:\n' + (linkedList.length ? linkedList.join('\n') : 'مافيش') + '\n\n⚠️ مشبوه:\n' + (suspectList.length ? suspectList.join('\n') : 'مافيش'));
                continue;
              }
              let kickedList = [];
              for (let p of meta.participants) {
                let n = getParticipantNum(p);
                if (isMe(p)) continue; if (isWhiteParticipant(p)) continue; if (isOwner(n)) continue; if (p.admin) continue;
                let smart = await isBotAccountSmart(p, getBotScoreV2(n));
                if (smart.isBot || !p.phoneNumber) {
                  let ok = await kickAndRename(from, p.id, 'فحص ذكي v9.8');
                  if (ok) { kickedList.push(n); if (blackList.indexOf(n) === -1) blackList.push(n); }
                }
              }
              saveLists();
              await r('🏰 فحص v9.8 كمل في ' + from + ':\n👥 فحصت: ' + total + '\n👻 جدد من غير رقم لقيت: ' + noNumberList.length + '\n🤖 بوت لقيت: ' + linkedList.length + '\n🛡️ أدمن لقيت: ' + adminList.length + '\n👑 مولى القروب لقيت: ' + superAdminList.length + '\n✅ طردت: ' + kickedList.length + ' (الأدمن ما ينطردوش تلقائي)\n\n🤖 بوتات:\n' + (linkedList.length ? linkedList.join('\n') : 'مافيش') + '\n\n✅ طردت:\n' + (kickedList.length ? kickedList.join('\n') : 'مافيش'));
              notifyOwner('🏰 فحص في ' + from + ' - لقيت ' + noNumberList.length + ' جدد من غير رقم و ' + linkedList.length + ' بوت و ' + adminList.length + ' أدمن و ' + superAdminList.length + ' مولى قروب وطردت ' + kickedList.length);
            } catch(e) { await r('خطأ فحص: ' + e.message); }
            continue;
          }
          if (lower === '.تشخيص') {
            if (from !== CONTROL_GROUP && isGroup) { await r('⚠️ التشخيص في قروب التحكم بس'); continue; }
            try {
              const groups = await sock.groupFetchAllParticipating();
              let total = Object.keys(groups).length; let adminList = [];
              for (let jid in groups) { const meta = groups[jid]; let me2 = null; for (let p of meta.participants) { if (isMe(p)) me2 = p; } if (me2 && me2.admin) adminList.push(meta.subject || jid); }
              let msg = '🔍 تشخيص:\nرقمي: ' + OWNER_NUMBER + '\nمجموع القروبات: ' + total + '\nأدمن في: ' + adminList.length + '\nبيضاء: ' + whiteList.length + '\nبلاك عام: ' + blackList.length + '\nمكتومين: ' + mutedList.length + '\nبوتات معروفة: ' + knownBots.length + '\nمستثنى: ' + exemptGroups.length + '\nقلعة: ' + (CASTLE_MODE ? 'ON' : 'OFF') + '\nحماية بوت: ' + (ANTI_LINKED ? 'ON' : 'OFF');
              await r(msg);
            } catch(e) { await r('خطأ تشخيص: ' + e.message); }
            continue;
          }
          if (lower === '.ادوات') {
            let menu = '╭─── 🍷 ───╮\n';
            menu += '│ 🤍 البيضاء: ' + whiteList.length + '\n';
            menu += '│ 🚫 البلاك العام: ' + blackList.length + '\n';
            menu += '│ 🔇 المكتومين: ' + mutedList.length + '\n';
            menu += '│ 🤖 بوتات معروفة: ' + knownBots.length + '\n';
            menu += '│ 🛡️ مستثنى: ' + exemptGroups.length + '\n';
            menu += '│ 🔗 الروابط: ' + (lockLinks ? 'مقفولة' : 'مفتوحة') + '\n';
            menu += '│ ⚡ السرعة: v9.8 كشف بصمة Baileys 3EB0\n';
            menu += '│ 💣 حماية ملغّمة: شغالة - النص محجوب\n';
            menu += '│ 🏰 القلعة: ' + (CASTLE_MODE ? 'مفعلة ON' : 'طافية OFF') + '\n';
            menu += '│ 🤖 حماية بوت: ' + (ANTI_LINKED ? 'شغالة ON' : 'طافية OFF') + '\n';
            menu += '│ 📥 استقبال: ' + (ACCEPT_MODE ? 'شغال ON ✅' : 'طافي OFF') + '\n';
            menu += '╰─── 🍷 ───╯\n\n';
            menu += '⚙️ اوامر ⚙️\n';
            menu += '• .ايدي\n• .داتا - رد على رسالة WILLIAM\n• .تشخيص\n• .قسيمة\n• .سرعة\n• .كشف - رد على رسالة المشبوه\n• .فحص عميق - يفحص بس اشياء مؤكدة، الصورة والحالة ملغية\n• .بصمة - رد على رسالة المشبوه\n• .حماية بوت / .حماية بوت تشغيل / .حماية بوت اطفاء\n• .استقبال / .تم القبول\n• .استثناء / .الغاء استثناء / .استثناءات\n• .فحص / .فحص الكل / .فحص بوتات\n• .قائمة بوتات / .بوت اضافة / .بوت حذف\n• رد + .ابيض / .حظر / .طرد / .فك حظر / .كتم / .كتم الغاء\n• منشن + .حظر / .طرد / .ابيض / .كتم\n• .حظر جماعي\n• .بيضاء / .بلاك / .قائمة / .قائمة كتم\n• .حذف - رد على رسالة\n• .حذف بلاك / .حذف كتم\n• .فتح / .سكر\n• .قفل الروابط / .فتح الروابط\n• .معلومات\n• .قلعة / .فتح القلعة / .حالة القلعة\n• .ping';
            await r(menu); continue;
          }
          if (lower === '.معلومات' && isGroup) {
            let meta = await sock.groupMetadata(from);
            let admins = meta.participants.filter((p) => p.admin).length;
            let info = '╭─── 🍷 ───╮\n│ 📛 القروب: ' + meta.subject + '\n│ 👥 الأعضاء: ' + meta.participants.length + '\n│ 🛡️ المشرفين: ' + admins + '\n│ 🛡️ مستثنى: ' + (isExempt(from) ? 'ايه ✅' : 'لا') + '\n╰─── 🍷 ───╯';
            await reply(from, info); continue;
          }
          if (lower === '.بيضاء') { await r('🤍 البيضاء:\n' + (whiteList.length ? whiteList.join('\n') : 'فاضية')); continue; }
          if (lower === '.بلاك') { await r('🚫 البلاك العام - يخدم في كل القروبات:\n' + (blackList.length ? blackList.join('\n') : 'فاضي')); continue; }
          if (lower === '.قائمة') { await r('🤍 بيضاء: ' + whiteList.length + '\n🚫 بلاك عام: ' + blackList.length + '\n🔇 مكتومين: ' + mutedList.length + '\n🤖 بوتات معروفة: ' + knownBots.length + '\n🛡️ مستثنى: ' + exemptGroups.length + '\n🏰 قلعة: ' + (CASTLE_MODE ? 'ON' : 'OFF') + '\n🤖 حماية بوت: ' + (ANTI_LINKED ? 'ON' : 'OFF')); continue; }
          if (lower === '.فتح' && isGroup) { try { await sock.groupSettingUpdate(from, 'not_announcement'); await reply(from, '✅ فتحت القروب'); } catch(e) {} continue; }
          if ((lower === '.سكر' || lower === '.قفل') && isGroup) { try { await sock.groupSettingUpdate(from, 'announcement'); await reply(from, '🔒 سكرت القروب'); } catch(e) {} continue; }
          if (lower === '.قفل الروابط') { lockLinks = true; saveLists(); await r('🔗 قفلت الروابط'); continue; }
          if (lower === '.فتح الروابط') { lockLinks = false; saveLists(); await r('🔗 فتحت الروابط'); continue; }
          if (lower === '.حذف' && isGroup) {
            if (quotedKey) { fastDelete(from, quotedKey); notifyOwner('✅ تم الحذف في قروب ' + from + '\nشن بعت: ' + getMsgPreview(m, text)); }
            else { await r('⚠️ رد على الرسالة اللي تبي تحذفها'); }
            continue;
          }
          if (lower === '.حذف القوائم' || lower === '.حذف الكل') { whiteList = []; blackList = []; mutedList = []; saveLists(); await r('✅ مسحت البيضاء والبلاك والكتم كلهم'); continue; }
          if (lower === '.حذف ابيض') { whiteList = []; saveLists(); await r('✅ مسحت البيضاء كلها'); continue; }
          if (lower === '.حذف بلاك') { blackList = []; saveLists(); await r('✅ مسحت البلاك العام كله'); continue; }
          if (lower.includes('.طرد')) {
            if (!isGroup) { await r('⚠️ الطرد يخدم في القروب بس'); continue; }
            let targetJid = null;
            if (quotedParticipant) targetJid = quotedParticipant;
            else if (ctx && ctx.mentionedJid && ctx.mentionedJid.length) targetJid = ctx.mentionedJid[0];
            else { let tgs = getTargets(text, ctx, quotedParticipant); if (tgs.length) targetJid = tgs[0] + '@s.whatsapp.net'; }
            if (!targetJid) { await r('⚠️ رد على رسالة الشخص ولا تاقيه ولا ابعث رقمه'); continue; }
            let targetNum = getNum(targetJid);
            if (isWhite(targetNum)) { await r('🤍 تعذر، لأنه في القائمة البيضاء'); continue; }
            let candidates = [targetJid];
            if (targetJid.includes('@s.whatsapp.net')) candidates.push(targetNum + '@lid');
            if (targetJid.includes('@lid')) candidates.push(targetNum + '@s.whatsapp.net');
            try {
              let meta = await sock.groupMetadata(from);
              let p = meta.participants.find(x => getNum(x.id) === targetNum || (x.phoneNumber && getNum(x.phoneNumber) === targetNum) || (lidMap[targetNum] && x.phoneNumber && getNum(x.phoneNumber) === lidMap[targetNum]));
              if (p) candidates.unshift(p.id);
            } catch(e) {}
            let ok = false; let tried = new Set(); let usedJid = targetJid;
            for (let cand of candidates) {
              if (tried.has(cand)) continue; tried.add(cand);
              try { ok = await kickAndRename(from, cand, 'طرد يدوي'); } catch(e) {}
              if (ok) { usedJid = cand; break; }
            }
            if (ok) {
              if (blackList.indexOf(targetNum) === -1) { blackList.push(targetNum); saveLists(); }
              notifyOwner('🚨 طردت ' + targetNum + ' من قروب ' + from + '\nالسبب: طرد يدوي بأمر المالك\nشن بعت: ' + getMsgPreview(m, text));
            } else { await r('❌ فشل الطرد - تأكد ان البوت أدمن، والشخص مش أدمن، وجرب ترد على رسالته مباشرة'); }
            continue;
          }
          if (lower.includes('.فك حظر') || lower.includes('.الغاء حظر') || lower.includes('.الغاء بلاك')) {
            let nums = getTargets(text, ctx, quotedParticipant);
            let expanded = await expandTargets(nums, from);
            if (expanded.length) { for (let n of expanded) blackList = blackList.filter((x) => x !== n); saveLists(); await r('✅ فكيت الحظر العام على ' + expanded.length + ' رقم - يقدر يخش لأي قروب توا'); }
            else { await r('⚠️ رد على رسالته ولا تاقيه ولا ابعث رقمه'); }
            continue;
          }
          if (lower.includes('.الغاء ابيض')) {
            let nums = getTargets(text, ctx, quotedParticipant);
            let expanded = await expandTargets(nums, from);
            for (let n of expanded) whiteList = whiteList.filter((x) => x !== n);
            saveLists(); await r('✅ نحيت ' + expanded.length + ' رقم من البيضاء'); continue;
          }
          if (lower.includes('.حظر الكل') || lower.includes('.حظر جماعي') || lower.includes('.حظر') || lower.includes('.اضف بلاك')) {
            let nums = getTargets(text, ctx, quotedParticipant);
            let expanded = await expandTargets(nums, from);
            let inWhite = expanded.filter((n) => isWhite(n));
            let toBan = expanded.filter((n) => !isWhite(n));
            if (inWhite.length && toBan.length === 0) { await r('⛔ تعذر، لأنه في القائمة البيضاء'); continue; }
            if (toBan.length) {
              for (let n of toBan) { if (blackList.indexOf(n) === -1) blackList.push(n); }
              saveLists();
              await r('🚫 حظرت ' + toBan.length + ' رقم في البلاك العام\nينحظر من كل القروبات، مش من قروب ' + from + ' بس' + (inWhite.length ? '\n⚠️ تخطيت ' + inWhite.length + ' من البيضاء' : ''));
              let k = await kickBlacklistedFromAllGroups();
              if (k > 0) await r('✅ طردت ' + k + ' واحد من كل القروبات');
              else await r('✅ ما لقيتاش داخل في أي قروب توا، لكن لو حاول يخش لأي قروب، حينطرد طول');
              if (toBan.length >= 10) await notifyOwner('🚨 حظر جماعي عام: ' + toBan.length + ' رقم\nفي قروب ' + from + '\nالسبب: حظر جماعي عام بأمر المالك');
            } else { await r('⚠️ رد على رسالته ولا تاقيه ولا ابعث رقمه + .حظر\nأو الصق قايمة أرقام واكتب .حظر'); }
            continue;
          }
          if (lower.includes('.ابيض')) {
            let nums = getTargets(text, ctx, quotedParticipant);
            let expanded = await expandTargets(nums, from);
            if (expanded.length) {
              let inBlack = expanded.filter((n) => isBlack(n));
              let toAdd = expanded.filter((n) => !isBlack(n));
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
          notifyOwner('🚨 طردت ' + senderNum + ' من قروب ' + from + '\nالسبب: في البلاك العام\nشن بعت: ' + getMsgPreview(m, text));
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
app.get('/', (req, res) => res.send('Bot Running - v9.8 - Baileys Fingerprint 3EB0'));
app.get('/qr', async (req, res) => {
  if (req.query.key !== QR_SECRET) return res.send('ممنوع - حط key');
  if (!qrCode) return res.send('No QR - Already connected');
  const img = await qrcode.toDataURL(qrCode);
  res.send('<img src="' + img + '"><h2>Scan QR</h2>');
});
app.listen(process.env.PORT || 10000);
startBot();
