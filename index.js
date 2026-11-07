require('dotenv').config()
const express = require('express');
const qrcode = require('qrcode');
const app = express();
let lastQR = '';
app.get('/qr', async (req, res) => {
  if (!lastQR) return res.send('<h1 style="text-align:center">استنى شوية... QR قاعد يتولد</h1><script>setTimeout(()=>location.reload(),5000)</script>');
  try {
    const img = await qrcode.toDataURL(lastQR);
    res.send('<div style="text-align:center"><h1>امسح الـ QR</h1><img src="' + img + '" width="350"><p>يتغير كل دقيقة - الصفحة تتحدث بروحها</p></div><script>setTimeout(()=>location.reload(),30000)</script>');
  } catch(e){ res.send('خطأ في توليد QR'); }
});
app.get('/', (req,res)=> res.send('البوت يخدم - افتح /qr باش تربط'));
app.listen(process.env.PORT || 10000, ()=> console.log('سيرفر QR يخدم'));
let _log = console.log
console.log = (...a) => {
  let s = (a[0]||'').toString()
  if(s.includes('Closing session') || s.includes('SessionEntry') || s.includes('baseKey') || s.includes('preKeyId') || s.includes('Cipher') || s.includes('Session')) return
  _log(...a)
}
process.on('uncaughtException', ()=>{})
process.on('unhandledRejection', ()=>{})
process.on('SIGTERM', ()=>{})
process.on('SIGINT', ()=>{})
const { default: makeWASocket, useMultiFileAuthState, delay, Browsers } = require('@whiskeysockets/baileys')
const P = require('pino')
const fs = require('fs')
const OWNER_NUMBER = (process.env.OWNER_NUMBER || "").replace(/\D/g,'')
const BOT_NUMBER = (process.env.BOT_NUMBER || "").replace(/\D/g,'')
const BAD_WORDS = ["http://","https://","t.me",".com","wa.me","chat.whatsapp.com","bit.ly"]
const BAN_WORDS = [".band",".ban",".تبنيد",".باند","تبنيد","باند",".فنش","فنش",".تفجير","تفجير"]
const ALLOWED_CODES = ["218","20","212","213","216","222","249","211","252","253","269","967","966","971","974","965","973","968","962","961","963","964","970"]
function isOwner(jid){
  if(!jid) return false
  let d = jid.replace(/\D/g,'')
  if(!OWNER_NUMBER) return false
  return d.includes(OWNER_NUMBER) || d.endsWith(OWNER_NUMBER.slice(-9))
}
let whiteList = new Map()
try{
  let raw = fs.readFileSync('./whitelist.json','utf8')
  let data = JSON.parse(raw)
  if(Array.isArray(data)){
    if(data.length>0 && typeof data[0]==='string'){
      data.forEach(j=>whiteList.set(j,{name:"قديم",time:""}))
    }else{
      whiteList = new Map(data)
    }
  }
}catch{}
function saveWhiteList(){ try{ fs.writeFileSync('./whitelist.json', JSON.stringify([...whiteList])) }catch{} }
function getLastDigits(jid){ return jid ? jid.replace(/\D/g,'').slice(-9) : "" }
function isWhiteListed(jid){ if(!jid) return false; if(whiteList.has(jid)) return true; let d=getLastDigits(jid); if(!d) return false; for(let [w] of whiteList){ if(getLastDigits(w)===d) return true } return false }
let blackList = new Map()
try{ if(fs.existsSync('./blacklist.json')) blackList = new Map(JSON.parse(fs.readFileSync('./blacklist.json'))) }catch{}
function saveBlackList(){ try{ fs.writeFileSync('./blacklist.json', JSON.stringify([...blackList])) }catch{} }
function isBlackListed(jid){ if(!jid) return false; if(blackList.has(jid)) return true; let d=getLastDigits(jid); if(!d) return false; for(let [bJid] of blackList){ if(getLastDigits(bJid)===d) return true } return false }
function findBlackMatch(jid){ let d=getLastDigits(jid); for(let [bJid] of blackList){ if(bJid===jid || getLastDigits(bJid)===d) return bJid } return null }
let reportHistory = new Map()
try{ if(fs.existsSync('./report-history.json')) reportHistory = new Map(JSON.parse(fs.readFileSync('./report-history.json'))) }catch{}
function saveReportHistory(){ try{ fs.writeFileSync('./report-history.json', JSON.stringify([...reportHistory])) }catch{} }
const REPORT_HISTORY_LIMIT = 3
let joinTracker = new Map()
let recentJoins = new Map()
let lockedGroups = new Set()
const FLOOD_LIMIT = 10
const FLOOD_TIME = 20000
setInterval(()=>{ joinTracker.clear(); recentJoins.clear(); if(global.gc) global.gc() }, 60*60*1000)
function isFloodAttack(groupId){
  let now=Date.now()
  let times=joinTracker.get(groupId)||[]
  times=times.filter(t=>now-t<FLOOD_TIME)
  times.push(now)
  joinTracker.set(groupId, times)
  return times.length>=FLOOD_LIMIT
}
function isAllowedNumber(jid){
  if(!jid) return true
  if(isWhiteListed(jid)) return true
  if(isOwner(jid)) return true
  if(jid.includes('@lid')||jid.includes(':')) return true
  let num=jid.split('@')[0]
  if(isNaN(num)) return true
  return ALLOWED_CODES.some(c=>num.startsWith(c))
}
let reports = new Map()
const REPORT_LIMIT = 4
const REPORT_TIME = 10*60*1000
function addReport(groupId, targetJid, reporterJid){
  if(!reports.has(groupId)) reports.set(groupId, new Map())
  let groupReports = reports.get(groupId)
  if(!groupReports.has(targetJid)) groupReports.set(targetJid, {reporters: new Set(), time: Date.now()})
  let data = groupReports.get(targetJid)
  if(Date.now() - data.time > REPORT_TIME){ data.reporters.clear(); data.time = Date.now() }
  data.reporters.add(reporterJid)
  let total = reportHistory.get(targetJid) || 0
  total++
  reportHistory.set(targetJid, total)
  saveReportHistory()
  return data.reporters.size
}
setInterval(()=>{ reports.clear() }, 30*60*1000)
async function startBot(){
try{
const { state, saveCreds } = await useMultiFileAuthState('./session')
const sock = makeWASocket({
  auth: state,
  logger: P({ level: 'silent' }),
  browser: Browsers.macOS('Safari'),
  printQRInTerminal: false,
  keepAliveIntervalMs: 30000 + Math.random()*10000,
  markOnlineOnConnect: false,
  syncFullHistory: false,
  emitOwnEvents: false,
  defaultQueryTimeoutMs: 60000,
  connectTimeoutMs: 60000,
  retryRequestDelayMs: 3000
})
sock.ev.on('creds.update', saveCreds)
sock.ev.on('connection.update', async (u)=>{
  if(u.qr){ lastQR = u.qr; console.log("QR جاهز في /qr"); }
  if(u.connection==='open'){ lastQR=''; console.log("اشتغل | البيضاء: "+whiteList.size+" | البلاك: "+blackList.size) }
  if(u.connection==='close'){
    let code=u.lastDisconnect?.error?.output?.statusCode
    if(code===401) return console.log("جلسة منتهية - امسح session")
    setTimeout(()=>startBot(),10000 + Math.random()*5000)
  }
})
let kickQueue = []
let lastKickTime = 0
let kicksInWindow = 0
let isProcessingQueue = false
async function safeKick(groupId,jid){
  return new Promise((resolve)=>{
    kickQueue.push({groupId, jid, resolve})
    if(!isProcessingQueue) processQueue()
  })
}
async function processQueue(){
  if(kickQueue.length==0){ isProcessingQueue=false; return }
  isProcessingQueue=true
  let now = Date.now()
  if(now - lastKickTime > 8000){ kicksInWindow=0; lastKickTime=now }
  if(kicksInWindow >= 1){
    let wait = 8000 - (now - lastKickTime) + 1000 + Math.random()*1500
    await delay(wait)
    kicksInWindow=0
    lastKickTime=Date.now()
  }
  let {groupId, jid, resolve} = kickQueue[0]
  try{
    if(!jid||!jid.includes('@') || isWhiteListed(jid) || isOwner(jid)){
      kickQueue.shift(); resolve(false); return setTimeout(processQueue, 300)
    }
    await delay(4000 + Math.random()*2000)
    await sock.groupParticipantsUpdate(groupId,[jid],'remove')
    kicksInWindow++; lastKickTime=Date.now()
    kickQueue.shift(); resolve(true)
  }catch(e){ kickQueue.shift(); resolve(false) }
  setTimeout(processQueue, 1200 + Math.random()*800)
}
async function secureGroup(groupId){
  try{
    await sock.groupRevokeInvite(groupId).catch(()=>{})
    await delay(1200 + Math.random()*800)
    await sock.groupSettingUpdate(groupId,'announcement').catch(()=>{})
  }catch{}
}
async function lockDownGroup(groupId,attackers=[]){
  if(lockedGroups.has(groupId)) return
  lockedGroups.add(groupId)
  await secureGroup(groupId)
  for(let jid of attackers){
    try{
      if(isWhiteListed(jid)) continue
      if(isOwner(jid)) continue
      if(!blackList.has(jid)) blackList.set(jid,{name:"هجوم تبنيد",time:new Date().toLocaleString()})
      await safeKick(groupId,jid).catch(()=>{})
    }catch{}
  }
  saveBlackList()
  try{
    await delay(1500)
    await sock.sendMessage(groupId,{text:'تم كشف هجوم تبنيد - تم الغاء رابط القروب وقفله 5 دقايق'}).catch(()=>{})
    setTimeout(async()=>{
      try{
        await sock.groupSettingUpdate(groupId,'not_announcement').catch(()=>{})
        lockedGroups.delete(groupId)
        joinTracker.delete(groupId)
        await sock.sendMessage(groupId,{text:'تم فتح القروب برابط جديد'}).catch(()=>{})
      }catch{}
    },5*60*1000)
  }catch{}
}
setInterval(async ()=>{
  try{
    let groups = await sock.groupFetchAllParticipating().catch(()=>{ return {} })
    for(let gid in groups){
      try{
        let meta = groups[gid]
        let parts = meta.participants || []
        for(let p of parts){
          let jid = p.id
          if(isWhiteListed(jid)) continue
          if(isOwner(jid)) continue
          if(isBlackListed(jid)){ await safeKick(gid, jid).catch(()=>{}); continue }
          if((reportHistory.get(jid) || 0) >= REPORT_HISTORY_LIMIT){
            if(!blackList.has(jid)) blackList.set(jid,{name:'بلاغات قديمة', time:new Date().toLocaleString()})
            await safeKick(gid, jid).catch(()=>{})
          }
        }
      }catch{}
    }
    saveBlackList()
  }catch{}
}, 10*60*1000)
sock.ev.on('group-participants.update', async (anu)=>{
  try{
    let gid = anu.id
    for(let jid of anu.participants){
      if(anu.action === 'demote'){
        if(!isWhiteListed(jid) && !isOwner(jid)){
          blackList.set(jid,{name:'سحب اشراف', time:new Date().toLocaleString()})
          saveBlackList()
          await safeKick(gid, jid).catch(()=>{})
        }
        continue
      }
      if(anu.action === 'add'){
        if(isOwner(jid) || isWhiteListed(jid)) continue
        if(isBlackListed(jid)){ await safeKick(gid, jid).catch(()=>{}); continue }
        if((reportHistory.get(jid) || 0) >= REPORT_HISTORY_LIMIT){ await safeKick(gid, jid).catch(()=>{}); continue }
        if(!isAllowedNumber(jid)){ await safeKick(gid, jid).catch(()=>{}); continue }
        if(isFloodAttack(gid)){ await lockDownGroup(gid, [jid]); continue }
        try{ await sock.profilePictureUrl(jid,'image') }catch{
          blackList.set(jid,{name:'بدون صورة', time:new Date().toLocaleString()})
          saveBlackList()
          await safeKick(gid, jid).catch(()=>{})
          continue
        }
      }
      if(anu.action === 'join_request' && anu.participants.length >= 5){ await lockDownGroup(gid, []) }
    }
  }catch{}
})
sock.ev.on('messages.upsert', async (x)=>{
  try{
    let m = x.messages[0]
    if(!m.message || m.key.fromMe) return
    let from = m.key.remoteJid
    let isGroup = from.endsWith('@g.us')
    let sender = m.key.participant || m.key.remoteJid
    let text = (m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || '').trim()
    let lower = text.toLowerCase()
    if(!text) return
    if(text.startsWith('3EB0')){
      if(isGroup){
        try{ await sock.sendMessage(from,{delete:m.key}) }catch{}
        if(!isWhiteListed(sender) && !isOwner(sender)){
          blackList.set(sender,{name:'بوت تبنيد 3EB0', time:new Date().toLocaleString()})
          saveBlackList()
          await safeKick(from, sender).catch(()=>{})
          await sock.sendMessage(from,{text:'طرد بوت تبنيد'}).catch(()=>{})
        }
      }
      return
    }
    if(isGroup && BAN_WORDS.some(w=>lower.includes(w))){
      if(!isWhiteListed(sender) && !isOwner(sender)){
        try{ await sock.sendMessage(from,{delete:m.key}) }catch{}
        blackList.set(sender,{name:'كلمة تبنيد', time:new Date().toLocaleString()})
        saveBlackList()
        await safeKick(from, sender).catch(()=>{})
        await lockDownGroup(from, [])
        return
      }
    }
    if(isGroup && BAD_WORDS.some(w=>lower.includes(w)) && !isWhiteListed(sender) && !isOwner(sender)){
      try{ await sock.sendMessage(from,{delete:m.key}) }catch{}
      return
    }
    if(isGroup && lower === '.ابلاغ' && m.message.extendedTextMessage?.contextInfo?.participant){
      let target = m.message.extendedTextMessage.contextInfo.participant
      if(isWhiteListed(target) || isOwner(target)) return
      let c = addReport(from, target, sender)
      if(c >= REPORT_LIMIT){
        blackList.set(target,{name:'بلاغات', time:new Date().toLocaleString()})
        saveBlackList()
        await safeKick(from, target).catch(()=>{})
        await sock.sendMessage(from,{text:'تم طرد ' + target.split('@')[0] + ' بعد بلاغات'}).catch(()=>{})
      } else {
        await sock.sendMessage(from,{text:'بلاغ ' + c + '/' + REPORT_LIMIT + ' على ' + target.split('@')[0]}).catch(()=>{})
      }
      return
    }
    if(!isOwner(sender)) return
    let getNum = ()=> text.replace(/\D/g,'')
    if(lower === 'بيضاء' || lower === 'بيضا'){
      return await sock.sendMessage(from,{text:'البيضاء:\n' + [...whiteList.keys()].map(a=>a.split('@')[0]).join('\n')}).catch(()=>{})
    }
    if(lower === 'بلاك' || lower === 'قائمة'){
      return await sock.sendMessage(from,{text:'البلاك:\n' + [...blackList.keys()].map(a=>a.split('@')[0]).join('\n')}).catch(()=>{})
    }
    if(text.startsWith('.ابيض')){
      let n = getNum()
      if(n){ let j = n + '@s.whatsapp.net'; whiteList.set(j,{name:n, time:new Date().toISOString()}); saveWhiteList(); await sock.sendMessage(from,{text:'تمت الاضافة للبيضاء'}).catch(()=>{}) }
    }
    if(text.startsWith('.الغاء_ابيض')){
      let n = getNum(); let j = n + '@s.whatsapp.net'; whiteList.delete(j); saveWhiteList(); await sock.sendMessage(from,{text:'تم الحذف من البيضاء'}).catch(()=>{})
    }
    if(text.startsWith('.حظر')){
      let n = getNum(); if(n){ let j = n + '@s.whatsapp.net'; blackList.set(j,{name:'حظر يدوي', time:new Date().toLocaleString()}); saveBlackList(); await sock.sendMessage(from,{text:'تم الحظر'}).catch(()=>{}) }
    }
    if(text.startsWith('.فك')){
      let n = getNum(); let j = n + '@s.whatsapp.net'; blackList.delete(j); saveBlackList(); await sock.sendMessage(from,{text:'تم فك الحظر'}).catch(()=>{})
    }
    if(text.startsWith('.طرد')){
      let target = m.message.extendedTextMessage?.contextInfo?.participant || (getNum() ? getNum() + '@s.whatsapp.net' : null)
      if(target){ blackList.set(target,{name:'طرد', time:new Date().toLocaleString()}); saveBlackList(); await safeKick(from, target).catch(()=>{}); await sock.sendMessage(from,{text:'تم الطرد'}).catch(()=>{}) }
    }
    if(text.startsWith('.حذف') && m.message.extendedTextMessage?.contextInfo?.stanzaId){
      try{ await sock.sendMessage(from,{delete:{remoteJid:from, fromMe:false, id:m.message.extendedTextMessage.contextInfo.stanzaId, participant:m.message.extendedTextMessage.contextInfo.participant}}) }catch{}
    }
    if(lower === '.قفل'){ await secureGroup(from); await sock.sendMessage(from,{text:'تم القفل'}).catch(()=>{}) }
    if(lower === '.فتح'){ try{ await sock.groupSettingUpdate(from,'not_announcement'); await sock.sendMessage(from,{text:'تم الفتح'}).catch(()=>{}) }catch{} }
    if(lower === '.ping'){ await sock.sendMessage(from,{text:'البوت شغال'}).catch(()=>{}) }
  }catch{}
})
}catch(e){ console.log('خطأ startBot'); setTimeout(()=>startBot(), 10000) }
}
startBot()
