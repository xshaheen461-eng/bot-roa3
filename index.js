// Bot Roa3 - v24 FULL FAST - Hunter بالكاش + طرد فوري من اول رابط
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode');
const fs = require('fs');
const pino = require('pino');
const BOT_VERSION = 'v24-FAST';
const OWNER_NUMBER = (process.env.OWNER_NUMBER || '218920972444').replace(/[^0-9]/g,'');
const CONTROL_GROUP = '120363430679974162@g.us';
const QR_SECRET = process.env.QR_SECRET || 'فتاك1234';
const app = express();
let qrCode = ''; let sock = null;
let whiteList = []; let blackList = []; let mutedList = []; let exemptGroups = [];
let knownBots = ['201155325652','159769176309794','131289315287150','167611182633170','212704208045','212751387401','201140282360'];
let lockLinks = true; let RAID_MODE = false; let raidTimer = null; let contactTimes = [];
let ACCEPT_MODE = false;
let knownMembers = {}; let ANTI_LINKED = true; let seenMsgIds = new Set();
let joinWatch = {}; let AMAN_MODE = {}; let AMAN_SNAPSHOT = {}; let AMAN_START = {};
let STRICT_ADMIN = true;
let CONFIG = { protectLinks:true, protectContacts:true, protectDevices:true, protectFlood:true, safeMode:false, maintenance:false };
try { let c = JSON.parse(fs.readFileSync('config_toka.json')); CONFIG = Object.assign(CONFIG, c); } catch(e){}
let STATS = { kicked:0, deleted:0, banned:0, linksBlocked:0, contactsBlocked:0, startTime: Date.now() };
try { STATS = Object.assign(STATS, JSON.parse(fs.readFileSync('stats.json'))); } catch(e){}
let LOGS = []; try { LOGS = JSON.parse(fs.readFileSync('logs.json')); } catch(e){}
const saveConfig = () => { try { fs.writeFileSync('config_toka.json', JSON.stringify(CONFIG)); fs.writeFileSync('stats.json', JSON.stringify(STATS)); fs.writeFileSync('logs.json', JSON.stringify(LOGS.slice(-100))); } catch(e){} };
let BOT_COMMANDS = ['.حذف','.طرد','.حظر','.ban','.منشن','.ادوات','.فحص','.قائمة','.ايدي','.سرعة','.ping','.صيانة'];
try { whiteList = JSON.parse(fs.readFileSync('whitelist.json')); } catch(e) { whiteList = []; }
try { blackList = JSON.parse(fs.readFileSync('blacklist.json')); } catch(e) { blackList = []; }
try { mutedList = JSON.parse(fs.readFileSync('muted.json')); } catch(e) { mutedList = []; }
try { exemptGroups = JSON.parse(fs.readFileSync('exempt.json')); } catch(e) { exemptGroups = []; }
try { knownBots = JSON.parse(fs.readFileSync('knownbots.json')); } catch(e) {}
try { let s = JSON.parse(fs.readFileSync('settings.json')); lockLinks = true; ANTI_LINKED = s.ANTI_LINKED !== false; STRICT_ADMIN = s.STRICT_ADMIN !== false; } catch(e) {}
let lidMap = {}; try { lidMap = JSON.parse(fs.readFileSync('lidmap.json')) || {}; } catch(e) { lidMap = {}; }
const saveLists = () => { try { fs.writeFileSync('whitelist.json', JSON.stringify(whiteList)); fs.writeFileSync('blacklist.json', JSON.stringify(blackList)); fs.writeFileSync('muted.json', JSON.stringify(mutedList)); fs.writeFileSync('exempt.json', JSON.stringify(exemptGroups)); fs.writeFileSync('knownbots.json', JSON.stringify(knownBots)); fs.writeFileSync('settings.json', JSON.stringify({ lockLinks, ANTI_LINKED, STRICT_ADMIN })); fs.writeFileSync('lidmap.json', JSON.stringify(lidMap)); } catch(e) {} };
const isExempt = (jid) => exemptGroups.indexOf(jid) !== -1;
const norm = (s) => (s || '').replace(/[^0-9]/g,'');
const getNum = (id) => norm((id || '').split(':')[0].split('@')[0]);
const extractAllNumbers = (text) => { if (!text) return []; let raw = String(text).replace(/@/g,' ').replace(/:/g,' ').replace(/;/g,' ').replace(/,/g,' '); raw = raw.replace(/https?:\/\/\S+/g,' ').replace(/chat\.whatsapp\.com\/\S+/g,' '); let lines = raw.split('\n'); let out = []; for (let line of lines) { line = line.trim(); if (!line) continue; let clean = line.replace(/\+/g,' ').replace(/-/g,' '); clean = clean.replace(/(\d)\s+(\d)/g, '$1$2'); clean = clean.replace(/(\d)\s+(\d)/g, '$1$2'); clean = clean.replace(/(\d)\s+(\d)/g, '$1$2'); let matches = clean.match(/[0-9]{9,15}/g) || []; for (let n of matches) { if (n.indexOf('12036') === 0) continue; if (out.indexOf(n) === -1) out.push(n); } } return out; };
const isOwner = (n) => norm(n) === OWNER_NUMBER;
const isWhite = (n) => whiteList.indexOf(norm(n)) !== -1;
const isBlack = (n) => blackList.indexOf(norm(n)) !== -1;
const isMuted = (n) => mutedList.indexOf(norm(n)) !== -1;
const isKnownBotNum = (n) => knownBots.indexOf(norm(n)) !== -1;
function getDeviceNum(idStr){ if(!idStr||!idStr.includes(':')) return '0'; return idStr.split(':')[1].split('@')[0]||'0'; }
function isLinkedDevice(p){ let idStr = typeof p==='string'?p:(p&&p.id?p.id:''); if(!idStr.includes(':')) return false; return getDeviceNum(idStr)!=='0'; }
function detectMultiDeviceBots(meta){
  let map = {};
  for(let p of meta.participants){
    let phone = p.phoneNumber ? getNum(p.phoneNumber) : getNum(p.id);
    let jid = p.id;
    if(!map[phone]) map[phone]={devices:new Set(), parts:[]};
    map[phone].devices.add(jid);
    map[phone].parts.push(p);
    if(p.phoneNumber) linkLidToPhone(p.id, p.phoneNumber);
  }
  let bots=[];
  for(let phone in map){
    if(isWhite(phone)) continue;
    let isOwnerPhone = isOwner(phone);
    if(map[phone].devices.size > 1) bots.push({phone, parts: map[phone].parts, reason: 'multiple devices', isOwner: isOwnerPhone});
    else if(isKnownBotNum(phone)) bots.push({phone, parts: map[phone].parts, reason: 'known bot', isOwner: isOwnerPhone});
    else if(map[phone].parts.some(x=>isLinkedDevice(x.id))) bots.push({phone, parts: map[phone].parts, reason: 'linked device', isOwner: isOwnerPhone});
  }
  return bots;
}
async function kickAfter10Sec(jid, bots, groupName){
  if(!bots.length) return;
  let toKick = bots.filter(b=>!b.isOwner);
  let allNames = []; let mentions = [];
  for(let b of bots){ for(let p of b.parts){ mentions.push(p.id); allNames.push('@'+getNum(p.id)); } }
  if(!toKick.length){
    await sock.sendMessage(jid, { text: '⚠️ Bot Detection Alert!\n\nThe following members have bots (multiple devices):\n\n'+allNames.join('\n')+'\n\n✅ هذا انت (المالك)، كشفتك بس ما نطردكش.', mentions });
    return;
  }
  await sock.sendMessage(jid, { text: '⚠️ Bot Detection Alert!\n\nThe following members have bots (multiple devices):\n\n'+allNames.join('\n')+'\n\n⏳ Waiting 10 seconds...\nAfter 10 seconds, all detected bots will be kicked.', mentions });
  await sock.sendMessage(CONTROL_GROUP, { text: '🤖 كشفت بوتات في '+(groupName||jid)+':\n'+toKick.map(b=>'+'+b.phone+' - '+b.reason).join('\n') });
  setTimeout(async ()=>{
    for(let b of toKick){
      for(let p of b.parts){ try{ await sock.groupParticipantsUpdate(jid, [p.id], 'remove'); }catch(e){} }
      if(blackList.indexOf(b.phone)===-1) blackList.push(b.phone);
      if(knownBots.indexOf(b.phone)===-1) knownBots.push(b.phone);
      STATS.kicked++; STATS.banned++;
    }
    saveLists(); saveConfig();
    await sock.sendMessage(CONTROL_GROUP, { text: '✅ طردت '+toKick.length+' بوت' });
  }, 10000);
}
function checkBotFiles(){
  let files = []; try{ files = fs.readdirSync('.').filter(f=>f.endsWith('.js')||f.endsWith('.json')); }catch(e){ files=['index.js']; }
  let issues = []; let total = files.length;
  try{ let code = fs.readFileSync('index.js','utf8'); let cmds = ['.فحص','.طرد','.حظر','.ابيض','.امان','.ادوات','.صيانة','.منشن','.حذف']; for(let c of cmds){ if(!code.includes(c)) issues.push(c+' - مش موجود'); } }catch(e){ issues.push('index.js - مش لاقيه'); }
  for(let f of ['whitelist.json','blacklist.json','knownbots.json']){ if(!fs.existsSync(f)) issues.push(f+' - مش موجود'); }
  return { total, issues };
}
function isNewAfterAman(jid, num, lid) { if (!AMAN_MODE[jid]) return false; if (!AMAN_SNAPSHOT[jid]) return false; if (AMAN_SNAPSHOT[jid].has(num)) return false; if (lid && AMAN_SNAPSHOT[jid].has(lid)) return false; if (lidMap[num] && AMAN_SNAPSHOT[jid].has(lidMap[num])) return false; return true; }
function getMyIds() { if (!sock || !sock.user) return [OWNER_NUMBER]; let ids = []; if (sock.user.id) ids.push(getNum(sock.user.id)); if (sock.user.lid) ids.push(getNum(sock.user.lid)); ids.push(OWNER_NUMBER); return ids; }
function isMe(p) { let myIds = getMyIds(); let pid = getNum(p.id); let pPhone = p.phoneNumber ? getNum(p.phoneNumber) : ''; let pLid = p.lid ? getNum(p.lid) : ''; return myIds.indexOf(pid) !== -1 || (pPhone && myIds.indexOf(pPhone) !== -1) || (pLid && myIds.indexOf(pLid) !== -1) || p.id === sock.user.id || p.id === sock.user.lid; }
function getParticipantNum(p) { if (typeof p === 'string') return getNum(p); if (p.phoneNumber) return getNum(p.phoneNumber); return getNum(p.id); }
function isWhiteParticipant(p) { if (!p) return false; let nums = []; if (typeof p === 'string') nums.push(getNum(p)); else { if (p.id) nums.push(getNum(p.id)); if (p.phoneNumber) nums.push(getNum(p.phoneNumber)); if (p.lid) nums.push(getNum(p.lid)); } for (let n of nums) if (isWhite(n)) return true; return false; }
function isBlackParticipant(p) { if (!p) return false; let nums = []; if (typeof p === 'string') nums.push(getNum(p)); else { if (p.id) nums.push(getNum(p.id)); if (p.phoneNumber) nums.push(getNum(p.phoneNumber)); if (p.lid) nums.push(getNum(p.lid)); } for (let n of nums) { if (isBlack(n)) return true; if (lidMap[n] && isBlack(lidMap[n])) return true; } return false; }
function isMutedParticipant(p) { if (!p) return false; let nums = []; if (typeof p === 'string') nums.push(getNum(p)); else { if (p.id) nums.push(getNum(p.id)); if (p.phoneNumber) nums.push(getNum(p.phoneNumber)); if (p.lid) nums.push(getNum(p.lid)); } for (let n of nums) { if (isMuted(n)) return true; if (lidMap[n] && isMuted(lidMap[n])) return true; } return false; }
function isGlobalBlack(p) { return isBlackParticipant(p); }
function linkLidToPhone(lid, phone) { if (!lid || !phone) return; lid = getNum(lid); phone = getNum(phone); if (lid === phone) return; if (lidMap[lid] !== phone) { lidMap[lid] = phone; try { fs.writeFileSync('lidmap.json', JSON.stringify(lidMap)); } catch(e) {} } }
function resolvePhone(lid, pn) { let lidN = getNum(lid); let pnN = pn ? getNum(pn) : ''; if (pnN && pnN !== lidN) return pnN; if (lidMap[lidN]) return lidMap[lidN]; return lidN; }
function unwrapMsg(msg) { if (!msg) return {}; let m = msg; for (let i=0;i<5;i++) { if (m.viewOnceMessage && m.viewOnceMessage.message) { m = m.viewOnceMessage.message; continue; } if (m.viewOnceMessageV2 && m.viewOnceMessageV2.message) { m = m.viewOnceMessageV2.message; continue; } if (m.ephemeralMessage && m.ephemeralMessage.message) { m = m.ephemeralMessage.message; continue; } if (m.documentWithCaptionMessage && m.documentWithCaptionMessage.message) { m = m.documentWithCaptionMessage.message; continue; } break; } return m; }
function isContactMsg(msg) { let u = unwrapMsg(msg); return !!(u.contactMessage || u.contactsArrayMessage || u.contactMessageV2); }
function isMediaMsg(m) { if (!m || !m.message) return false; let mm = unwrapMsg(m.message); return !!(mm.stickerMessage || mm.videoMessage || mm.imageMessage || mm.audioMessage || mm.documentMessage); }
function getTargets(text, ctx, quotedParticipant) { let nums = []; let add = (n) => { n = getNum(n); if (n && nums.indexOf(n) === -1) nums.push(n); }; if (quotedParticipant) add(quotedParticipant); if (ctx && ctx.mentionedJid) for (let j of ctx.mentionedJid) add(j); for (let n of extractAllNumbers(text)) add(n); return nums; }
async function expandTargets(nums, from) { let out = []; let add = (n) => { n = getNum(n); if (n && out.indexOf(n) === -1) out.push(n); }; for (let n of nums) add(n); for (let n of [...out]) { if (lidMap[n]) add(lidMap[n]); for (let k in lidMap) { if (lidMap[k] === n) add(k); } } try { if (from && from.endsWith('@g.us')) { let meta = await sock.groupMetadata(from); for (let n of [...out]) { let p = meta.participants.find(x => getNum(x.id) === n || (x.phoneNumber && getNum(x.phoneNumber) === n) || (lidMap[n] && x.phoneNumber && getNum(x.phoneNumber) === lidMap[n])); if (p) { if (p.phoneNumber) { add(getNum(p.phoneNumber)); linkLidToPhone(p.id, p.phoneNumber); } add(getNum(p.id)); if (p.lid) add(getNum(p.lid)); } } } } catch(e) {} return out; }
async function revealPhone(target, ctx, quotedParticipant) { let tLid = getNum(target.id); let tNum = getParticipantNum(target); let tPhone = target.phoneNumber ? getNum(target.phoneNumber) : ''; if (!tPhone || tPhone === tLid) { if (lidMap[tLid]) tPhone = lidMap[tLid]; if (lidMap[tNum]) tPhone = lidMap[tNum]; } if ((!tPhone || tPhone === tLid) && ctx && ctx.participantPn) tPhone = getNum(ctx.participantPn); if ((!tPhone || tPhone === tLid) && quotedParticipant && quotedParticipant.includes('@s.whatsapp.net')) tPhone = getNum(quotedParticipant); try { const all = await sock.groupFetchAllParticipating(); for (let gjid in all) { let gm = all[gjid]; let pp = gm.participants.find(x => getNum(x.id) === tLid || getNum(x.id) === tNum); if (pp && pp.phoneNumber) { tPhone = getNum(pp.phoneNumber); linkLidToPhone(tLid, tPhone); linkLidToPhone(tNum, tPhone); break; } } } catch(e) {} if (tPhone && tPhone !== tLid) return { phone: tPhone, lid: tLid, hidden: false }; return { phone: tLid, lid: tLid, hidden: true }; }
let lastKickNotify = {}; let lastActionPerUser = {}; let adminCache = {}; let joinTimeMap = {}; let oldMembersCache = new Set(); let isLocked = {}; let lockTimer = {};
let lastMsgMap = {}; let trapActive = {}; let trapResponses = {}; let pendingBotConfirm = {};

// ===== Hunter FAST - بالكاش، من غير groupMetadata كل رسالة =====
const WAIT_SECONDS = 10; const SPAM_LIMIT = 8; const REPEAT_LIMIT = 3;
let hunterHistory = {}; let hunterPending = new Set();
function hunterIsAdminFast(jid, senderLid){
  let key = jid + '-' + senderLid;
  if (adminCache[key] && Date.now() - adminCache[key].time < 600000) return adminCache[key].isAdmin;
  return false; // لو مافيش كاش، نعتبره مش ادمن باش ما نوقفش الرسالة، الكاش يتعبى بعدين
}
async function hunterRemove(jid, senderJid){ try{ await sock.groupParticipantsUpdate(jid, [senderJid], 'remove'); return true; }catch(e){ return false; } }
async function warnAndRemove(jid, senderJid, senderNum, reason){
  let key = jid + '|' + senderNum;
  if (hunterPending.has(key)) return;
  hunterPending.add(key);
  try{
    await sock.sendMessage(jid, { text: '⚠️ Bot Detection Alert!\n\nالعضو: @' + senderNum + '\nالسبب: ' + reason + '\n\n⏳ الانتظار ' + WAIT_SECONDS + ' ثوانٍ...\nسيتم طرد العضو بعد انتهاء المهلة.', mentions: [senderJid] });
    await new Promise(r=>setTimeout(r, WAIT_SECONDS*1000));
    try{ let meta = await sock.groupMetadata(jid); let still = meta.participants.some(x=>getNum(x.id)===senderNum || (x.phoneNumber && getNum(x.phoneNumber)===senderNum)); if(!still){ hunterPending.delete(key); return; } }catch(e){}
    if (await hunterRemove(jid, senderJid)){
      await sock.sendMessage(jid, { text: '🚫 تم طرد العضو: @' + senderNum + '\nالسبب: ' + reason, mentions: [senderJid] });
      if(blackList.indexOf(senderNum)===-1) blackList.push(senderNum);
      if(knownBots.indexOf(senderNum)===-1) knownBots.push(senderNum);
      saveLists(); STATS.kicked++; STATS.banned++; saveConfig();
    }
  }catch(e){ console.log('Hunter error:', e.message); }
  finally{ hunterPending.delete(key); }
}
function hunterCheckFast(jid, senderJid, senderNum, senderLid, text){
  if (!text || isOwner(senderNum) || isWhite(senderNum)) return;
  if (hunterIsAdminFast(jid, senderLid)) return;
  let key = jid + '|' + senderNum;
  if (hunterPending.has(key)) return;
  if (!hunterHistory[key]) hunterHistory[key] = { messages:[], texts:[] };
  let data = hunterHistory[key]; let now = Date.now()/1000; let low = text.trim().toLowerCase();
  data.messages.push(now); data.texts.push([now, low]);
  data.messages = data.messages.filter(t=>now - t <= 10);
  data.texts = data.texts.filter(([t])=>now - t <= 30);
  if (data.messages.length >= SPAM_LIMIT){ warnAndRemove(jid, senderJid, senderNum, 'إرسال عدد كبير من الرسائل خلال وقت قصير'); return; }
  let repeated = data.texts.filter(([t,txt])=>txt===low).length;
  if (repeated >= REPEAT_LIMIT){ warnAndRemove(jid, senderJid, senderNum, 'تكرار الرسائل بشكل غير طبيعي'); return; }
}

async function lockGroup5Min(jid) { if (isLocked[jid]) return; isLocked[jid] = true; try { await sock.groupSettingUpdate(jid, 'announcement'); } catch(e) {} clearTimeout(lockTimer[jid]); lockTimer[jid] = setTimeout(async () => { try { await sock.groupSettingUpdate(jid, 'not_announcement'); } catch(e) {} isLocked[jid] = false; }, 5*60*1000); }
function canActOnUser(key) { let now = Date.now(); if (lastActionPerUser[key] && now - lastActionPerUser[key] < 200) return false; lastActionPerUser[key] = now; return true; }
function fastDelete(jid, key) { sock.sendMessage(jid, { delete: key }).catch(()=>{}); }
function fastKick(jid, user) { sock.groupParticipantsUpdate(jid, [user], 'remove').catch(()=>{}); }
async function safeKick(jid, user) { try { await sock.groupParticipantsUpdate(jid, [user], 'remove'); return true; } catch(e) { return false; } }
async function safeDemote(jid, user) { try { await sock.groupParticipantsUpdate(jid, [user], 'demote'); return true; } catch(e) { return false; } }
async function safeLock(jid, minutes) { try { await sock.groupSettingUpdate(jid, 'announcement'); } catch(e) {} if (minutes) setTimeout(() => { fastUnlock(jid); }, minutes*60*1000); }
function fastUnlock(jid) { sock.groupSettingUpdate(jid, 'not_announcement').catch(()=>{}); }
function tripleStrike(jid, m, sender) { Promise.allSettled([sock.sendMessage(jid, { delete: m.key }).catch(()=>{}), sock.groupParticipantsUpdate(jid, [sender], 'remove').catch(()=>{}), sock.groupSettingUpdate(jid, 'announcement').catch(()=>{})]); setTimeout(() => { fastUnlock(jid); }, 5000); }
function tripleStrikeLock5(jid, m, sender) { Promise.allSettled([sock.sendMessage(jid, { delete: m.key }).catch(()=>{}), sock.groupParticipantsUpdate(jid, [sender], 'remove').catch(()=>{})]); lockGroup5Min(jid); }
async function punishAdminStrict(jid, senderJid, senderNum, reason, m) { try { await sock.sendMessage(jid, { delete: m.key }).catch(()=>{}); } catch(e) {} try { await sock.groupParticipantsUpdate(jid, [senderJid], 'demote').catch(()=>{}); } catch(e) {} await new Promise(r => setTimeout(r, 400)); let ok = await safeKick(jid, senderJid); if (blackList.indexOf(senderNum) === -1) { blackList.push(senderNum); saveLists(); } STATS.kicked++; STATS.banned++; saveConfig(); notifyOwner('🚨 طردت ادمن - وضع صارم\nالرقم: +' + senderNum + '\nالقروب: ' + (groupNameCache[jid] || jid) + '\nالسبب: ' + reason); return ok; }
function isMaliciousLink(t, m) { if (!t && !m) return false; if (m && m.message && m.message.reactionMessage) return false; if (m && m.message && m.message.protocolMessage) return false; if (m && m.message && m.message.pollUpdateMessage) return false; if (isMediaMsg(m)) return false; let full = (t || ''); if (!full) return false; if (full.length > 700) return true; let enc = full.match(/%[0-9A-Fa-f]{2}/g); if (enc && enc.length > 25) return true; if (full.includes('wa.me') && full.length > 150) return true; if (full.includes('chat.whatsapp.com') && full.length > 150) return true; if (/(.)\1{150,}/.test(full)) return true; return false; }
async function handleMalicious(jid, m, sender, senderNum) { fastDelete(jid, m.key); fastKick(jid, sender); if (blackList.indexOf(senderNum) === -1) { blackList.push(senderNum); saveLists(); } STATS.kicked++; saveConfig(); notifyOwner('🚨 رابط ملغم من ' + senderNum + ' في ' + (groupNameCache[jid] || jid)); }
let linkCount = {}; let groupNameCache = {}; let forwardedLocked = {}; let joinTimes = {};
async function getGroupName(jid) { if (!jid) return jid; if (groupNameCache[jid]) return groupNameCache[jid]; if (sock) { sock.groupMetadata(jid).then(meta => { groupNameCache[jid] = meta.subject || jid; }).catch(()=>{}); } return jid; }
async function notifyOwner(text) { if (!sock) return; try { let key = text.split('\n')[0].substring(0,30); let now = Date.now(); if (lastKickNotify[key] && now - lastKickNotify[key] < 3000) return; lastKickNotify[key] = now; sock.sendMessage(CONTROL_GROUP, { text }).catch(()=>{}); } catch(e) {} }
async function reply(jid, text) { try { await sock.sendMessage(jid, { text }); } catch(e) {} }
async function replyControl(text) { try { await sock.sendMessage(CONTROL_GROUP, { text }); } catch(e) {} }
function hideOwnerCommand(from, m) { if (from && from !== CONTROL_GROUP) fastDelete(from, m.key); }
async function kickAndRename(jid, user) { let ok = await safeKick(jid, user); if(ok){ STATS.kicked++; saveConfig(); } return ok; }
async function sendSessionReport(jid, participant, isClean) { try { let d = new Date(); let time = d.toLocaleTimeString('en-GB') + ',' + d.toLocaleDateString('en-GB'); let groupName = await getGroupName(jid); let num = getNum(typeof participant === 'string' ? participant : (participant.id || participant)); let phone = ''; if (typeof participant === 'object' && participant.phoneNumber) phone = getNum(participant.phoneNumber); if (phone && phone !== num) num = phone + ' / LID:' + num; let report = '🪶 اسم الجروب: ' + groupName + '\n📌 الحالة: رصد طلب انضمام جديد\n📱 الرقم: ' + num + '\n' + (isClean ? '✅ حساب نظيف' : '⚠️ حساب مشبوه') + '\n🕐 ' + time; await sock.sendMessage(CONTROL_GROUP, { text: report }); } catch(e) {} }
async function enableAman(jid) { try { let meta = await sock.groupMetadata(jid); let snap = new Set(); for (let p of meta.participants) { snap.add(getNum(p.id)); if (p.phoneNumber) snap.add(getNum(p.phoneNumber)); if (p.lid) snap.add(getNum(p.lid)); } AMAN_SNAPSHOT[jid] = snap; AMAN_MODE[jid] = true; AMAN_START[jid] = Date.now(); contactTimes = []; await sock.sendMessage(CONTROL_GROUP, { text: '🛡️ تم تفعيل الامان في ' + meta.subject }); } catch(e) {} }
async function disableAman(jid) { delete AMAN_MODE[jid]; delete AMAN_SNAPSHOT[jid]; delete AMAN_START[jid]; await replyControl('🛡️ تم الغاء الامان'); }
async function kickBlacklistedFromAllGroups() { if (!sock) return 0; let kicked = 0; try { const groups = await sock.groupFetchAllParticipating(); for (let jid in groups) { if (jid === CONTROL_GROUP) continue; if (isExempt(jid)) continue; try { const meta = groups[jid]; let me = null; for (let p of meta.participants) { if (isMe(p)) me = p; } if (!me || !me.admin) continue; for (let p of meta.participants) { let n = getParticipantNum(p); if (p.phoneNumber) linkLidToPhone(p.id, p.phoneNumber); if (isWhiteParticipant(p)) continue; if (isSuperAdmin(p)) continue; if (STRICT_ADMIN && p.admin) { if (isGlobalBlack(p) && !isOwner(n)) { await safeDemote(jid, p.id); await new Promise(r => setTimeout(r, 300)); let ok = await kickAndRename(jid, p.id); if (ok) kicked++; continue; } if (isBotAccount(p) && !isOwner(n)) { await safeDemote(jid, p.id); await new Promise(r => setTimeout(r, 300)); let ok = await kickAndRename(jid, p.id); if (ok) kicked++; continue; } continue; } if (p.admin) continue; if (isGlobalBlack(p) && !isOwner(n)) { let ok = await kickAndRename(jid, p.id); if (ok) kicked++; } } } catch(e) {} } } catch(e) {} if (kicked > 0) saveLists(); return kicked; }
const hasLink = (t) => { if (!t) return false; let clean = t.toLowerCase().replace(/\s+/g,'').replace(/[:;]/g,':'); return /(https?:\/\/|www\.|t\.me\/|wa\.me\/|chat\.whatsapp\.com|discord\.gg\/|instagram\.com\/|facebook\.com\/|youtube\.com\/|tiktok\.com\/|\.com|\.net|\.org|\.ly|\.io)/.test(clean); };
function isBotAccount(p) { if (!p) return false; let idStr = typeof p === 'string' ? p : (p.id || ''); let n = getNum(idStr); if (isOwner(n)) return false; if (n && knownBots.indexOf(n) !== -1) return true; if (typeof p === 'object' && p.isBot) return true; if (idStr.includes('@bot')) return true; return false; }
async function calcBotPercent(p, qText, qId) { let ql = (qText || '').toLowerCase(); if (qId && qId.startsWith('3EB0') && (!ql || ql.length < 10)) return { percent: 95, reasons: ['ID 3EB0'], strong: true }; if (ql.includes('william') || ql.includes('coming')) return { percent: 95, reasons: ['بصمة WILLIAM'], strong: true }; if (ql.includes('bot studio')) return { percent: 100, reasons: ['Bot Studio'], strong: true }; if (ql.includes('baileys')) return { percent: 100, reasons: ['مكتبة بوت'], strong: true }; let score = 0; let reasons = []; let n = ''; if (typeof p === 'string') { n = getNum(p); } else { if (p.phoneNumber) n = getNum(p.phoneNumber); else if (p.id) n = getNum(p.id); } if (isKnownBotNum(n)) return { percent: 100, reasons: ['في قايمة البوتات'], strong: true }; if (isLinkedDevice(p)) return { percent: 90, reasons: ['جهاز مرتبط'], strong: true }; if (qText && BOT_COMMANDS.some(c => qText.toLowerCase().includes(c))) { score += 40; reasons.push('بعت امر بوت'); } if (qId && qId.startsWith('3EB0')) { score += 60; reasons.push('ID 3EB0'); } if (score > 100) score = 100; return { percent: score, reasons, strong: score >= 90 }; }
async function deepCheckUser(p, jid) { let r = await calcBotPercent(p, '', ''); if (r.strong) return { isBot: true, score: r.percent, reason: r.reasons.join(' + ') }; if (r.percent >= 40) return { isBot: false, score: r.percent, reason: r.reasons.join(' + '), needsConfirm: true }; return { isBot: false, score: r.percent, reason: r.reasons.join(' + ') }; }
function isSuperAdmin(p) { return p && p.admin === 'superadmin'; }
function cleanCmd(s) { let x = (s || '').toLowerCase().trim().split('_').join(' '); x = x.split('.ال').join('.'); x = x.split('.أ').join('.ا'); x = x.split('.إ').join('.ا'); return x; }
async function checkBotLikeTelegram(jid, participant){
  let pObj = typeof participant === 'string' ? { id: participant } : participant;
  let phone = getParticipantNum(pObj);
  if (isOwner(phone) || isWhite(phone)) return false;
  let isBot = false; let reason = '';
  if (isLinkedDevice(pObj)) { isBot = true; reason = 'linked device'; }
  if (isKnownBotNum(phone)) { isBot = true; reason = 'known bot'; }
  let lm = (lastMsgMap[phone] || '').toLowerCase();
  if (lm.includes('ترقية مستوى') || lm.includes('makima') || lm.includes('aura') || lm.includes('by |') || lm.includes('فحص الأوامر')) { isBot = true; reason = 'bot message'; }
  if (!isBot) return false;
  let jidForMention = pObj.id || (phone + '@s.whatsapp.net');
  await sock.sendMessage(jid, { text: '⚠️ تم اكتشاف بوت!\nالعضو: @' + phone + '\nالسبب: ' + reason + '\n\n⏳ Waiting 10 seconds...\nAfter 10 seconds, all detected bots will be kicked.', mentions: [jidForMention] });
  setTimeout(async () => {
    try { await sock.groupParticipantsUpdate(jid, [jidForMention], 'remove'); } catch(e) {}
    if (blackList.indexOf(phone) === -1) blackList.push(phone);
    if (knownBots.indexOf(phone) === -1) knownBots.push(phone);
    saveLists();
    await sock.sendMessage(CONTROL_GROUP, { text: '✅ طردت بوت (زي كود تيليجرام): +' + phone });
  }, 10000);
  return true;
}
async function runAutoTrapCheck(from){
  let probe = '.فحص_وهمي_' + Math.floor(Math.random()*99999);
  trapActive[from] = { time: Date.now(), probe };
  trapResponses[from] = [];
  await sock.sendMessage(from, { text: probe });
  await replyControl('🪤 بعت فخ: '+probe+' في '+from+'، نستنى 10 ثواني...');
  setTimeout(async ()=>{
    try{
      let meta = await sock.groupMetadata(from);
      let bots = detectMultiDeviceBots(meta);
      let responders = trapResponses[from] || [];
      for(let rn of responders){
        let p = meta.participants.find(x=>getParticipantNum(x)===rn || getNum(x.id)===rn);
        if(p && !bots.some(b=>b.phone===rn) && !isOwner(rn) && !isWhite(rn)){ bots.push({ phone: rn, parts:[p], reason:'رد على الفخ', isOwner:false }); }
      }
      for(let p of meta.participants){
        let ph = getParticipantNum(p);
        if(isOwner(ph)||isWhite(ph)) continue;
        let lm = (lastMsgMap[ph]||'').toLowerCase();
        if(lm.includes('ترقية مستوى')||lm.includes('المستوى:')||lm.includes('تهانينا')||lm.includes('لقبك')||lm.includes('by |')||lm.includes('makima')||lm.includes('aura')||lm.includes('فحص الأوامر')||lm.includes('استخدم .تسجيل')){
          if(!bots.some(b=>b.phone===ph)) bots.push({phone:ph, parts:[p], reason:'رسالة بوت جاهزة', isOwner:false});
        }
      }
      trapActive[from] = null; trapResponses[from] = [];
      if(!bots.length){ await sock.sendMessage(CONTROL_GROUP, { text: '🔍 فحص حقيقي v24 🔍\n🤖 بوتات في القروب: 0\nنظيف 🤍\n(الفخ ما رد عليه حد)' }); }
      else { await kickAfter10Sec(from, bots, meta.subject); }
    }catch(e){ await replyControl('خطأ في الفحص: '+e.message); }
  }, 10000);
}
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({ version, auth: state, logger: pino({ level: 'silent' }), printQRInTerminal: false, syncFullHistory: false, keepAliveIntervalMs: 10000, markOnlineOnConnect: false });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', (u) => {
    if (u.qr) { qrCode = u.qr; console.log('QR READY'); }
    if (u.connection === 'open') { qrCode = ''; console.log('Bot connected'); notifyOwner('✅ البوت متصل - ' + BOT_VERSION); setTimeout(() => { kickBlacklistedFromAllGroups(); }, 8000); setInterval(() => { kickBlacklistedFromAllGroups(); }, 10*60*1000); }
    if (u.connection === 'close') { const should = (u.lastDisconnect && u.lastDisconnect.error && u.lastDisconnect.error.output && u.lastDisconnect.error.output.statusCode) !== DisconnectReason.loggedOut; if (should) startBot(); }
  });
  const handleMembershipApproval = async (u) => { try { const jid = u.id; if (!jid || jid === CONTROL_GROUP) return; if (isExempt(jid)) return; for (let p of (u.participants || [])) { let n = getNum(typeof p === 'string' ? p : (p.id || p)); let realPhone = (typeof p === 'object' && p.phoneNumber) ? getNum(p.phoneNumber) : (lidMap[n] || n); joinTimeMap[n] = Date.now(); joinWatch[n] = Date.now(); let hasPhone = (typeof p === 'object' && !!p.phoneNumber) || !!lidMap[n]; sendSessionReport(jid, p, hasPhone); if (!ACCEPT_MODE && (isGlobalBlack(p) || isBlack(realPhone)) && !isWhiteParticipant(p) && !isOwner(n)) { fastKick(jid, typeof p === 'string' ? p : p.id); notifyOwner('🚨 طردت ' + realPhone + ' - بلاك'); } } } catch(e) {} };
  sock.ev.on('group-membership.update', handleMembershipApproval);
  sock.ev.on('group.join-request', handleMembershipApproval);
  sock.ev.on('group-participants.update', async (u) => { try {
        if ((u.action === 'add' || u.action === 'join') && u.id !== CONTROL_GROUP && !isExempt(u.id)) {
          for (let p of u.participants) { await checkBotLikeTelegram(u.id, p); }
          try{ let metaFull = await sock.groupMetadata(u.id); let bots = detectMultiDeviceBots(metaFull); let newBots = bots.filter(b => u.participants.some(pp => getNum(typeof pp==='string'?pp:pp.id)===b.phone || (typeof pp==='object'&&pp.phoneNumber&&getNum(pp.phoneNumber)===b.phone))); if(newBots.length) await kickAfter10Sec(u.id, newBots, metaFull.subject); }catch(e){}
        }
        if (u.id && isExempt(u.id)) return;
        if (u.action === 'add' || u.action === 'invite' || u.action === 'join') { const jid = u.id; if (jid === CONTROL_GROUP) return; for (let p of u.participants) { let pNumTmp = getNum(typeof p === 'string' ? p : (p.id || p)); let pPhoneTmp = (typeof p === 'object' && p.phoneNumber) ? getNum(p.phoneNumber) : ''; let realTmp = pPhoneTmp || lidMap[pNumTmp] || pNumTmp; if (isWhite(realTmp) || isOwner(realTmp) || isWhiteParticipant(p)) continue; if (AMAN_MODE[jid] && !isNewAfterAman(jid, realTmp, pNumTmp)) continue; let deep = await deepCheckUser(p, jid); if (deep.isBot) { if (p.admin) { pendingBotConfirm[realTmp] = { jid, senderJid: typeof p === 'string' ? p : p.id, score: deep.score, reasons: deep.reason, time: Date.now() }; notifyOwner('🤖 بوت ادمن: ' + realTmp); continue; } try { await sock.groupParticipantsUpdate(jid, [typeof p === 'string' ? p : p.id], 'remove'); } catch(e) {} if (blackList.indexOf(realTmp) === -1) { blackList.push(realTmp); saveLists(); } if (knownBots.indexOf(realTmp) === -1) { knownBots.push(realTmp); saveLists(); } notifyOwner('🤖 كشفت بوت: ' + realTmp); continue; } if (deep.needsConfirm) { pendingBotConfirm[realTmp] = { jid, senderJid: typeof p === 'string' ? p : p.id, score: deep.score, reasons: deep.reason, time: Date.now() }; notifyOwner('⚠️ شاك فيه بوت: ' + realTmp); continue; } joinWatch[pNumTmp] = Date.now(); } let now = Date.now(); for (let p of u.participants) joinTimeMap[getNum(p)] = now; if (ACCEPT_MODE) { for (let p of u.participants) sendSessionReport(jid, p, !!(typeof p === 'object' && p.phoneNumber)); return; } if (!joinTimes[jid]) joinTimes[jid] = []; joinTimes[jid] = joinTimes[jid].filter((t) => now - t < 60000); u.participants.forEach(() => joinTimes[jid].push(now)); if (joinTimes[jid].length >= 10) { RAID_MODE = true; await safeLock(jid, 10); for (const p of u.participants) { if (isWhiteParticipant(p)) continue; if (!isOwner(getNum(p))) { kickAndRename(jid, p); if (blackList.indexOf(getNum(p)) === -1) blackList.push(getNum(p)); } } saveLists(); notifyOwner('🚨 هجوم منسق على ' + jid); joinTimes[jid] = []; clearTimeout(raidTimer); raidTimer = setTimeout(()=>{ RAID_MODE = false; }, 10*60*1000); return; } for (let p of u.participants) { let n = getNum(p); sendSessionReport(jid, p, !!(typeof p === 'object' && p.phoneNumber)); if (isGlobalBlack(p) && !isWhiteParticipant(p) && !isOwner(n)) { fastKick(jid, p); } } return; } if (u.action === 'remove') { for (let p of u.participants) { let n = getNum(p); if (knownMembers[u.id]) knownMembers[u.id].delete(n); } } } catch(e) {} });
  sock.ev.on('messages.upsert', async (up) => { for (const m of up.messages) { try {
        if (m.message && isContactMsg(m.message)) { const _from = m.key.remoteJid; const _sender = m.key.participant || m.key.remoteJid; const _senderPn = m.key.participantPn || _sender; const _senderLidFast = getNum(_sender); const _senderNumFast = resolvePhone(_sender, _senderPn); const _isGroupFast = _from && _from.endsWith('@g.us'); if (_isGroupFast && _from !== CONTROL_GROUP) { const _isOwnerFast = _senderNumFast === OWNER_NUMBER || _senderLidFast === OWNER_NUMBER || m.key.fromMe; const _isWhiteFast = whiteList.indexOf(_senderNumFast) !== -1 || whiteList.indexOf(_senderLidFast) !== -1; if (!_isOwnerFast && !_isWhiteFast) { Promise.allSettled([ sock.sendMessage(_from, { delete: m.key }).catch(()=>{}), sock.groupParticipantsUpdate(_from, [_sender], 'remove').catch(()=>{}), sock.groupSettingUpdate(_from, 'announcement').catch(()=>{}) ]); if (blackList.indexOf(_senderNumFast) === -1) { blackList.push(_senderNumFast); saveLists(); } if (!isLocked[_from]) { isLocked[_from] = true; clearTimeout(lockTimer[_from]); lockTimer[_from] = setTimeout(async () => { try { await sock.groupSettingUpdate(_from, 'not_announcement'); } catch(e) {} isLocked[_from] = false; }, 5*60*1000); } notifyOwner('📞 جهة اتصال من ' + _senderNumFast); continue; } } }
        if (m.key && m.key.id) { if (seenMsgIds.has(m.key.id)) continue; seenMsgIds.add(m.key.id); if (seenMsgIds.size > 1000) seenMsgIds.clear(); } if (m.message && m.message.reactionMessage) continue; if (m.message && m.message.protocolMessage) continue; if (m.message && m.message.pollUpdateMessage) continue; if (m.message && m.message.senderKeyDistributionMessage) continue; if (m.messageStubType) continue; if (!m.message) continue; if (m.messageTimestamp && (Date.now()/1000 - m.messageTimestamp > 30)) continue;
        const from = m.key.remoteJid; const isGroup = from && from.endsWith('@g.us'); const sender = m.key.participant || m.key.remoteJid; const senderPn = m.key.participantPn || sender; const senderLid = getNum(sender); if (senderPn && sender && senderPn !== sender) linkLidToPhone(sender, senderPn); const senderNum = resolvePhone(sender, senderPn);
        const text = m.message.conversation || (m.message.extendedTextMessage && m.message.extendedTextMessage.text) || (m.message.imageMessage && m.message.imageMessage.caption) || (m.message.videoMessage && m.message.videoMessage.caption) || '';
        lastMsgMap[senderNum] = text;
        const isSticker = !!(m.message.stickerMessage); const isImage = !!(m.message.imageMessage); const isVideo = !!(m.message.videoMessage); const isAudio = !!(m.message.audioMessage);
        const isSoundSticker = isSticker || isVideo || isAudio || isImage;
        if (isGroup && from !== CONTROL_GROUP) oldMembersCache.add(senderNum);
        const isOwnerSender = isOwner(senderNum) || isOwner(senderLid) || m.key.fromMe; const isWhiteSender = isWhite(senderNum) || isWhite(senderLid) || (lidMap[senderLid] && isWhite(lidMap[senderLid])); const isBlackSender = isBlack(senderNum) || isBlack(senderLid); const isMutedSender = isMuted(senderNum) || isMuted(senderLid) || (lidMap[senderLid] && isMuted(lidMap[senderLid]));
        let lower = cleanCmd(text);
        // ===== FAST: .سرعة و .ping قبل Hunter باش يرد في 0.11 =====
        if (isOwnerSender && (lower === '.سرعة' || lower === '.سرعه')) { let sentTime = m.messageTimestamp ? m.messageTimestamp * 1000 : Date.now(); let latency = Date.now() - sentTime; if (from !== CONTROL_GROUP) { hideOwnerCommand(from, m); await replyControl('⚡ سرعة البوت: ' + (latency / 1000).toFixed(2) + ' ثانية\n' + BOT_VERSION); } else { await sock.sendMessage(from, { text: '⚡ سرعة البوت: ' + (latency / 1000).toFixed(2) + ' ثانية\n' + BOT_VERSION }); } continue; }
        if (isOwnerSender && lower === '.ping') { if (from !== CONTROL_GROUP) { hideOwnerCommand(from, m); await replyControl('✅ Bot online - ' + BOT_VERSION); } else { await sock.sendMessage(from, { text: '✅ Bot online - ' + BOT_VERSION }); } continue; }
        // ===== FAST: رابط = طرد فوري من اول رابط، من غير انتظار =====
        if (isGroup && from !== CONTROL_GROUP && !isOwnerSender && !isWhiteSender && hasLink(text) && CONFIG.protectLinks && !isSoundSticker) {
          if (canActOnUser('link-'+senderNum)) {
            // ادمن سوبر ما نطردوش، بس نحذف
            let ck = from + '-' + senderLid; let isAdm = adminCache[ck] ? adminCache[ck].isAdmin : false;
            if (isAdm && STRICT_ADMIN) { fastDelete(from, m.key); continue; }
            tripleStrikeLock5(from, m, sender);
            if (blackList.indexOf(senderNum) === -1) { blackList.push(senderNum); saveLists(); }
            STATS.linksBlocked++; STATS.kicked++; saveConfig();
            notifyOwner('🔗 رابط من ' + senderNum + ' - طرد فوري');
          }
          continue;
        }
        // ===== Hunter FAST: سبام + تكرار بس، من غير groupMetadata =====
        if (isGroup && from !== CONTROL_GROUP && !isOwnerSender && !isWhiteSender && text) { hunterCheckFast(from, sender, senderNum, senderLid, text); }
        if (isOwnerSender && isGroup && from !== CONTROL_GROUP && !lower.startsWith('.') && !text.trim().startsWith('.')) { continue; }
        if (CONFIG.maintenance && !isOwnerSender) continue;
        if (isGroup && trapActive[from] && !isOwnerSender && !m.key.fromMe) {
          let trap = trapActive[from];
          if (Date.now() - trap.time < 15000) {
            if (text.includes(trap.probe) || BOT_COMMANDS.some(c => lower.includes(c)) || text.toLowerCase().includes('امر غير معروف') || text.toLowerCase().includes('unknown command') || text.length < 200) {
              if (!trapResponses[from]) trapResponses[from] = [];
              if (trapResponses[from].indexOf(senderNum) === -1) trapResponses[from].push(senderNum);
              notifyOwner('🪤 وقع في الفخ: ' + senderNum + ' - رد: ' + text.slice(0,80));
            }
          }
        }
        const isExemptGroup = isGroup && isExempt(from) && from !== CONTROL_GROUP; if (isExemptGroup) { let allow = isOwnerSender && (lower.includes('.الغاء استثناء') || lower === '.استثناءات' || lower === '.ping' || lower === '.سرعة'); if (!allow) continue; }
        if (isGroup && from !== CONTROL_GROUP && isMutedSender && !isOwnerSender && !isWhiteSender) { fastDelete(from, m.key); continue; }
        const _ctxEarly = m.message.extendedTextMessage ? m.message.extendedTextMessage.contextInfo : null; const _quotedParticipantEarly = _ctxEarly ? (_ctxEarly.participantPn || _ctxEarly.participant) : null; const _quotedKeyEarly = (_ctxEarly && _ctxEarly.stanzaId) ? { remoteJid: from, id: _ctxEarly.stanzaId, participant: _quotedParticipantEarly, fromMe: false } : null;
        if (isOwnerSender && isGroup && lower === '.حذف' && _quotedKeyEarly) { fastDelete(from, _quotedKeyEarly); fastDelete(from, m.key); continue; }
        const ctx = m.message.extendedTextMessage ? m.message.extendedTextMessage.contextInfo : null; const quotedParticipant = ctx ? (ctx.participantPn || ctx.participant) : null; const quotedKey = (ctx && ctx.stanzaId) ? { remoteJid: from, id: ctx.stanzaId, participant: quotedParticipant, fromMe: false } : null;
        const isForward = (m.message.extendedTextMessage && m.message.extendedTextMessage.contextInfo && m.message.extendedTextMessage.contextInfo.isForwarded) || (m.message.imageMessage && m.message.imageMessage.contextInfo && m.message.imageMessage.contextInfo.isForwarded) || (m.message.videoMessage && m.message.videoMessage.contextInfo && m.message.videoMessage.contextInfo.isForwarded) || (m.message.stickerMessage && m.message.stickerMessage.contextInfo && m.message.stickerMessage.contextInfo.isForwarded) || (m.message.documentMessage && m.message.documentMessage.contextInfo && m.message.documentMessage.contextInfo.isForwarded);
        let isAdminSender = false; let isSuperAdminSender = false; if (isGroup && !isOwnerSender) { let cacheKey = from + '-' + senderLid; if (adminCache[cacheKey] !== undefined && Date.now() - adminCache[cacheKey].time < 600000) { isAdminSender = adminCache[cacheKey].isAdmin; isSuperAdminSender = adminCache[cacheKey].isSuper || false; } else { try { let meta = await sock.groupMetadata(from); let p = meta.participants.find((x) => getNum(x.id) === senderLid || (x.phoneNumber && getNum(x.phoneNumber) === senderNum)); if (p && p.admin) { isAdminSender = true; if (p.admin === 'superadmin') isSuperAdminSender = true; } adminCache[cacheKey] = { isAdmin: isAdminSender, isSuper: isSuperAdminSender, time: Date.now() }; } catch(e) {} } }
        let isRealAdmin = isAdminSender; if (STRICT_ADMIN) isAdminSender = isSuperAdminSender ? true : false;
        if (isOwnerSender) {
          if (from !== CONTROL_GROUP && lower.startsWith('.')) hideOwnerCommand(from, m);
          let r = async (txt) => { if (from !== CONTROL_GROUP) { await replyControl(txt); } else { await reply(from, txt); } };
          if (lower === '.وضع صارم') { STRICT_ADMIN = true; saveLists(); adminCache = {}; await r('👑 الوضع الصارم ON'); continue; }
          if (lower === '.وضع عادي') { STRICT_ADMIN = false; saveLists(); adminCache = {}; await r('👑 الوضع العادي'); continue; }
          if (lower === '.وضع استقبال') { ACCEPT_MODE = true; await r('🍷 استقبال ON'); continue; }
          if (lower === '.الغاء استقبال') { ACCEPT_MODE = false; await r('🍷 استقبال OFF'); continue; }
          if (lower === '.وضع فخ') { if (!isGroup) { await r('في القروب بس'); continue; } trapActive[from] = { time: Date.now(), probe: '.فحص_وهمي' }; trapResponses[from] = []; await r('🪤 فخ شغال'); continue; }
          if (lower === '.منشن') { if (!isGroup) { await r('في القروب بس'); continue; } try { let meta = await sock.groupMetadata(from); let mentions = meta.participants.map(p => p.id); await sock.sendMessage(from, { text: '📢 منشن الكل\n' + meta.participants.map(p => '@' + getParticipantNum(p)).join(' '), mentions: mentions }); } catch(e) { await r('خطأ'); } continue; }
          if (lower === '.معلومات') { if (!isGroup) { await r('في القروب بس'); continue; } let meta = await sock.groupMetadata(from); await r('🏷️ الاسم: ' + meta.subject + '\n👥 العدد: ' + meta.participants.length + '\n👑 الادمن: ' + meta.participants.filter(p => p.admin).length); continue; }
          if (lower.startsWith('.حماية الروابط')) { CONFIG.protectLinks = lower.includes('تشغيل'); lockLinks = CONFIG.protectLinks; saveLists(); saveConfig(); await r('🔗 حماية الروابط: '+(CONFIG.protectLinks?'تشغيل ✅':'ايقاف ❌')); continue; }
          if (lower.startsWith('.حماية جهات الاتصال')) { CONFIG.protectContacts = lower.includes('تشغيل'); saveConfig(); await r('📞 حماية جهات: '+(CONFIG.protectContacts?'تشغيل ✅':'ايقاف ❌')); continue; }
          if (lower.startsWith('.فحص الاجهزة')) { CONFIG.protectDevices = lower.includes('تشغيل'); ANTI_LINKED = CONFIG.protectDevices; saveLists(); saveConfig(); await r('🤖 فحص الاجهزة: '+(CONFIG.protectDevices?'تشغيل ✅':'ايقاف ❌')); continue; }
          if (lower.startsWith('.وضع الامان')) { CONFIG.safeMode = lower.includes('تشغيل'); if(CONFIG.safeMode && isGroup) await enableAman(from); if(!CONFIG.safeMode && isGroup) await disableAman(from); saveConfig(); await r('🛡️ وضع الامان: '+(CONFIG.safeMode?'تشغيل ✅':'ايقاف ❌')); continue; }
          if (lower === '.صيانة') { let chk = checkBotFiles(); let msg = '🔧 فحص الأوامر - .صيانة\n\n✅ تم فحص البوت\n📁 إجمالي الملفات: '+chk.total+'\n⚠️ تم العثور على '+chk.issues.length+' مشكلة\n\n'; if(chk.issues.length) msg += chk.issues.map((x,i)=>(i+1)+'. '+x+'\n').join(''); else msg += 'مافيش مشاكل ✅\n'; msg += '\n💡 لو تبي تصلح، قولي'; await r(msg); continue; }
          if (lower.startsWith('.صيانة')) { CONFIG.maintenance = lower.includes('تشغيل'); saveConfig(); await r('🛠️ الصيانة: '+(CONFIG.maintenance?'تشغيل ✅':'ايقاف ❌')); continue; }
          if (lower === '.احصائيات') { let up = ((Date.now()-STATS.startTime)/3600000).toFixed(1); await r('📊 الاحصائيات 📊\n🦵 طرد: '+STATS.kicked+'\n🚫 حظر: '+STATS.banned+'\n🔗 روابط: '+STATS.linksBlocked+'\n📞 جهات: '+STATS.contactsBlocked+'\n⏰ شغال: '+up+' ساعة'); continue; }
          if (lower === '.سجل') { await r('📜 اخر سجل:\n'+(LOGS.slice(-10).join('\n')||'فاضي')); continue; }
          if (lower === '.تحديث') { let t='📊 تقرير طرد: '+STATS.kicked+' | حظر: '+STATS.banned; STATS={kicked:0,deleted:0,banned:0,linksBlocked:0,contactsBlocked:0,startTime:Date.now()}; saveConfig(); await r(t+'\n✅ صفرت'); continue; }
          if (lower === '.تصدير') { if(!isGroup){ await r('في القروب بس'); continue; } try{ let meta=await sock.groupMetadata(from); let txt='قروب: '+meta.subject+'\nالعدد: '+meta.participants.length+'\n\n'+meta.participants.map(p=>'+'+getParticipantNum(p)+' | '+(p.admin?'ادمن':'عضو')).join('\n'); await sock.sendMessage(CONTROL_GROUP,{document:Buffer.from(txt), fileName:'members.txt', mimetype:'text/plain'}); await r('✅ بعت التصدير في التحكم'); }catch(e){ await r('خطأ: '+e.message); } continue; }
          if (lower === '.نسخة احتياطية') { try{ let b={CONFIG, whiteList, blackList, mutedList, knownBots, exemptGroups, STATS}; await sock.sendMessage(CONTROL_GROUP,{document:Buffer.from(JSON.stringify(b,null,2)), fileName:'backup.json', mimetype:'application/json'}); await r('✅ بعت النسخة في التحكم'); }catch(e){ await r('خطأ: '+e.message); } continue; }
          if (lower === '.اقبل') { if(!isGroup){ await r('في القروب بس'); continue; } try{ let pending = await sock.groupRequestParticipantsList(from); if(!pending || pending.length===0){ await r('مافيش طلبات معلقة'); continue; } for(let p of pending){ let jid = p.jid || p.id; await sock.groupRequestParticipantsUpdate(from, [jid], 'approve'); } await r('✅ قبلت كل الطلبات: '+pending.length); }catch(e){ await r('خطأ: '+e.message); } continue; }
          if (lower === '.حالة' || lower === '.status') { await r('🛡 Anti-Bot Hunter\n\n✅ كشف البوتات الرسمية\n✅ مراقبة السبام\n✅ كشف التكرار\n✅ مراقبة الروابط - طرد فوري من اول رابط\n✅ مراقبة سرعة الرسائل\n✅ إنذار 10 ثوانٍ\n✅ الطرد التلقائي\n\nالحالة: يعمل - ' + BOT_VERSION); continue; }
          if (lower === '.ايدي') { await r('🆔 ID:\n' + from); continue; }
          if (lower === '.امان') { if (!isGroup) { await r('في القروب بس'); continue; } await enableAman(from); continue; }
          if (lower === '.الغاء امان') { if (!isGroup) { await r('في القروب بس'); continue; } await disableAman(from); continue; }
          if (lower.startsWith('.تأكيد')) { let nums = getTargets(text, ctx, quotedParticipant); let expanded = await expandTargets(nums, from); for (let n of expanded) { let pend = pendingBotConfirm[n]; if (!pend) continue; let ok = await kickAndRename(pend.jid, pend.senderJid); if (ok) { if (blackList.indexOf(n) === -1) blackList.push(n); if (knownBots.indexOf(n) === -1) knownBots.push(n); saveLists(); delete pendingBotConfirm[n]; await r('✅ طردت ' + n); } } continue; }
          if (lower.startsWith('.تجاهل')) { let nums = getTargets(text, ctx, quotedParticipant); let expanded = await expandTargets(nums, from); for (let n of expanded) { delete pendingBotConfirm[n]; if (whiteList.indexOf(n) === -1) whiteList.push(n); } saveLists(); await r('🤍 تجاهلته'); continue; }
          if (lower === '.فخ') { if (!isGroup) { await r('في القروب بس'); continue; } let trapText = '.فحص_وهمي_' + Math.floor(Math.random()*9999); trapActive[from] = { time: Date.now(), probe: trapText }; trapResponses[from] = []; await replyControl('🪤 فخ: ' + trapText + ' في ' + from); await r('🪤 فخ: ' + trapText); continue; }
          if (lower === '.كشف') { let nums = getTargets(text, ctx, quotedParticipant); let expanded = await expandTargets(nums, from); if (!expanded.length) { await r('رد عليه واكتب .كشف'); continue; } await r('🔍 كشف ' + expanded[0] + '\nبوت: ' + (knownBots.includes(expanded[0]) ? 'ايه 🤖' : 'لا 🤍')); continue; }
          if (lower === '.فحص عميق') { if (!isGroup) { await r('في القروب بس'); continue; } await runAutoTrapCheck(from); continue; }
          if (lower === '.قائمة بوتات' || lower === '.بوتات') { await r('🤖 بوتات:\n' + (knownBots.length ? knownBots.join('\n') : 'فاضية')); continue; }
          if (lower.includes('.بوت اضافة')) { let nums = getTargets(text, ctx, quotedParticipant); let expanded = await expandTargets(nums, from); for (let n of expanded) { if (knownBots.indexOf(n) === -1) knownBots.push(n); } saveLists(); await r('✅ ضفت للبوتات'); continue; }
          if (lower.includes('.بوت حذف')) { let nums = getTargets(text, ctx, quotedParticipant); let expanded = await expandTargets(nums, from); for (let n of expanded) knownBots = knownBots.filter(x => x !== n); saveLists(); await r('✅ نحيت'); continue; }
          if (lower === '.داتا') { try { if (!isGroup) { await r('في القروب بس'); continue; } let meta = await sock.groupMetadata(from); let target = null; if (quotedParticipant) target = meta.participants.find(x => getNum(x.id) === getNum(quotedParticipant)); if (!target) { await r('رد عليه واكتب .داتا'); continue; } await r('📊 DATA:\n' + JSON.stringify(target, null, 2).slice(0, 3000)); let rev = await revealPhone(target, ctx, quotedParticipant); await r('📞 الرقم: ' + (rev.hidden ? 'مخفي 🕵️' : rev.phone)); } catch(e) { await r('خطأ: ' + e.message); } continue; }
          if (lower === '.بصمة') { if (!ctx || !ctx.stanzaId) { await r('رد عليه واكتب .بصمة'); continue; } let qId = ctx.stanzaId || ''; let qText = (ctx.quotedMessage && ctx.quotedMessage.conversation) || (ctx.quotedMessage && ctx.quotedMessage.extendedTextMessage && ctx.quotedMessage.extendedTextMessage.text) || ''; qText = qText.toLowerCase(); let calc = await calcBotPercent({ id: quotedParticipant, phoneNumber: ctx.participantPn }, qText, qId); await r('👣 بصمة: ' + calc.percent + '%\n' + calc.reasons.join(' + ')); continue; }
          if (lower === '.قسيمة') { await sendSessionReport(from, '999999999@test', false); await r('✅ بعت قسيمة'); continue; }
          if (lower === '.حماية بوت') { await r('🤖 حماية جهاز: ' + (ANTI_LINKED ? 'ON ✅' : 'OFF ❌') + ' - v24'); continue; }
          if (lower.includes('.كتم') && !lower.includes('الغاء')) { let nums = getTargets(text, ctx, quotedParticipant); let expanded = await expandTargets(nums, from); for (let n of expanded) { if (mutedList.indexOf(n) === -1) mutedList.push(n); } saveLists(); await r('📡 تم كتم'); continue; }
          if (lower.includes('.كتم') && lower.includes('الغاء')) { let nums = getTargets(text, ctx, quotedParticipant); let expanded = await expandTargets(nums, from); for (let n of expanded) mutedList = mutedList.filter(x => x !== n); saveLists(); await r('✅ الغاء كتم'); continue; }
          if (lower === '.استثناء') { if (!isGroup) { await r('في القروب بس'); continue; } if (!isExempt(from)) { exemptGroups.push(from); saveLists(); } await r('🛡️ تم استثناء'); continue; }
          if (lower === '.الغاء استثناء') { exemptGroups = exemptGroups.filter(x => x !== from); saveLists(); await r('✅ لغيت استثناء'); continue; }
          if (lower === '.استثناءات') { await r('🛡️ المستثناة:\n' + (exemptGroups.length ? exemptGroups.join('\n') : 'فاضية')); continue; }
          if (lower === '.فحص الكل') { if (!isGroup) { await r('في القروب بس'); continue; } await runAutoTrapCheck(from); continue; }
          if (lower === '.فحص') { if (!isGroup) { await r('في القروب بس'); continue; } await runAutoTrapCheck(from); continue; }
          if (lower === '.تشخيص') { try { const groups = await sock.groupFetchAllParticipating(); await r('🔍 تشخيص\nقروبات: ' + Object.keys(groups).length + '\nبيضاء: ' + whiteList.length + '\nبلاك: ' + blackList.length + '\nبوتات: ' + knownBots.length); } catch(e) { await r('خطأ'); } continue; }
          if (lower === '.ادوات') { await r('🍷 الادوات 🍷\n.فحص / .صيانة / .امان / .ابيض / .حظر / .طرد / .منشن / .معلومات / .سرعة / .ping / .حالة / .داتا / .بصمة / .كشف / .فخ'); continue; }
          if (lower === '.بيضاء') { await r('🤍 البيضاء 🤍\n' + (whiteList.length ? whiteList.map(n => '• +' + n).join('\n') : 'فاضية')); continue; }
          if (lower === '.بلاك') { await r('🚫 البلاك 🚫\n' + (blackList.length ? blackList.map(n => '• +' + n).join('\n') : 'فاضي')); continue; }
          if (lower === '.قائمة') { await r('بيضاء: ' + whiteList.length + '\nبلاك: ' + blackList.length + '\nمكتومين: ' + mutedList.length + '\nبوتات: ' + knownBots.length); continue; }
          if (lower === '.فتح' && isGroup) { try { isLocked[from] = false; clearTimeout(lockTimer[from]); await sock.groupSettingUpdate(from, 'not_announcement'); await r('🔓 فتحت'); } catch(e) {} continue; }
          if ((lower === '.سكر' || lower === '.قفل') && isGroup) { try { await lockGroup5Min(from); await r('🔒 سكرت 5 دقايق'); } catch(e) {} continue; }
          if (lower === '.قفل الروابط') { lockLinks = true; CONFIG.protectLinks = true; saveLists(); saveConfig(); await r('🔗 قفلت الروابط'); continue; }
          if (lower === '.فتح الروابط') { lockLinks = false; CONFIG.protectLinks = false; saveLists(); saveConfig(); await r('🔓 فتحت الروابط'); continue; }
          if (lower === '.حذف' && isGroup) { if (quotedKey) { fastDelete(from, quotedKey); } else { await r('رد على الرسالة'); } continue; }
          if (lower === '.حذف القوائم') { whiteList = []; blackList = []; mutedList = []; saveLists(); await r('🗑️ مسحت القوائم'); continue; }
          if (lower === '.حذف ابيض') { whiteList = []; saveLists(); await r('🗑️ مسحت البيضاء'); continue; }
          if (lower === '.حذف بلاك') { blackList = []; saveLists(); await r('🗑️ مسحت البلاك'); continue; }
          if (lower.includes('.طرد')) { if (!isGroup) { await r('في القروب بس'); continue; } let targetJid = null; if (quotedParticipant) targetJid = quotedParticipant; else if (ctx && ctx.mentionedJid && ctx.mentionedJid.length) targetJid = ctx.mentionedJid[0]; else { let tgs = getTargets(text, ctx, quotedParticipant); if (tgs.length) targetJid = tgs[0] + '@s.whatsapp.net'; } if (!targetJid) { await r('رد عليه'); continue; } let targetNum = getNum(targetJid); if (isWhite(targetNum)) { await r('🤍 في البيضاء'); continue; } let ok = await kickAndRename(from, targetJid); if (ok) { if (blackList.indexOf(targetNum) === -1) { blackList.push(targetNum); saveLists(); } } else { await r('❌ فشل الطرد'); } continue; }
          if (lower.includes('.الغاء حظر')) { let nums = getTargets(text, ctx, quotedParticipant); let expanded = await expandTargets(nums, from); for (let n of expanded) blackList = blackList.filter((x) => x !== n); saveLists(); await r('✅ الغيت الحظر'); continue; }
          if (lower.includes('.الغاء ابيض')) { let nums = getTargets(text, ctx, quotedParticipant); let expanded = await expandTargets(nums, from); for (let n of expanded) whiteList = whiteList.filter((x) => x !== n); saveLists(); await r('✅ الغيت الابيض'); continue; }
          if (lower.includes('.حظر')) { let nums = getTargets(text, ctx, quotedParticipant); let expanded = await expandTargets(nums, from); for (let n of expanded) { if (!isWhite(n) && blackList.indexOf(n) === -1) blackList.push(n); } saveLists(); await r('🚫 حظرت ' + expanded.length); let k = await kickBlacklistedFromAllGroups(); if (k > 0) await r('🦵 طردت ' + k); continue; }
          if (lower.includes('.ابيض')) { let nums = getTargets(text, ctx, quotedParticipant); let expanded = await expandTargets(nums, from); for (let n of expanded) { if (whiteList.indexOf(n) === -1) whiteList.push(n); } saveLists(); await r('🤍 ضفت للبيضاء'); continue; }
          continue;
        }
        if (isOwnerSender) continue;
        if (!isGroup) continue; if (from === CONTROL_GROUP) continue; if (isWhiteSender) continue; if (isSuperAdminSender) continue; if (isAdminSender && !STRICT_ADMIN) continue;
        if (AMAN_MODE[from] && !isNewAfterAman(from, senderNum, senderLid)) { if (isBlackSender) { if (!canActOnUser('black-'+senderNum)) continue; tripleStrike(from, m, sender); continue; } if (!isSoundSticker && isMaliciousLink(text, m)) { handleMalicious(from, m, sender, senderNum); continue; } continue; }
        if (RAID_MODE) { if (canActOnUser('raid-'+senderNum)) { tripleStrike(from, m, sender); if (blackList.indexOf(senderNum) === -1) { blackList.push(senderNum); saveLists(); } } continue; }
        if (isBlackSender) { if (!canActOnUser('black-'+senderNum)) continue; if (isRealAdmin && STRICT_ADMIN && !isSuperAdminSender) { await punishAdminStrict(from, sender, senderNum, 'بلاك', m); } else { tripleStrike(from, m, sender); } notifyOwner('🚨 طردت ' + senderNum + ' - بلاك'); continue; }
        if (isForward && !isSoundSticker && !isOwnerSender) { if (!canActOnUser('fwd-'+senderNum)) continue; tripleStrikeLock5(from, m, sender); if (!forwardedLocked[from]) { forwardedLocked[from] = true; notifyOwner('↪️ فوروارد من ' + senderNum); setTimeout(()=>{ forwardedLocked[from] = false; }, 3*60*1000); } if (blackList.indexOf(senderNum) === -1) { blackList.push(senderNum); saveLists(); } continue; }
      } catch(e) { console.log('Error:', e.message); }
    }
  });
}
app.get('/', (req, res) => res.send('Bot Running - ' + BOT_VERSION));
app.get('/qr', async (req, res) => { if (req.query.key !== QR_SECRET) return res.send('ممنوع'); if (!qrCode) return res.send('No QR'); const img = await qrcode.toDataURL(qrCode); res.send('<img src="' + img + '"><h2>Scan QR</h2>'); });
app.get('/keepalive', (req, res) => res.send('alive'));
setInterval(() => { fetch('http://localhost:' + (process.env.PORT || 10000) + '/keepalive').catch(()=>{}); }, 4*60*1000);
app.listen(process.env.PORT || 10000);
startBot();
