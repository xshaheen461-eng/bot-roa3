// === سيرفر QR ===
const express = require('express')
const app = express()
const QRCode = require('qrcode')
let lastQR = ""
app.get('/', (req,res) => res.send('<h1>BOT LIVE ✅</h1><a href="/qr"><h2>QR CODE</h2></a>'))
app.get('/qr', async (req,res) => {
  if(!lastQR) return res.send('<h1>استنى 10 ثواني ودير تحديث...</h1><script>setTimeout(()=>location.reload(),5000)</script>')
  let img = await QRCode.toDataURL(lastQR)
  res.send(`<center><img src="${img}" style="width:350px"><h2>امسح الـ QR من واتساب</h2></center><script>setTimeout(()=>location.reload(),15000)</script>`)
})
app.listen(process.env.PORT || 3000)

// === كود الحماية متاعك كامل ===
let _log = console.log
console.log = (...a) => {
  let s = (a[0]||'').toString()
  if(s.includes('Closing session') || s.includes('SessionEntry') || s.includes('baseKey') || s.includes('preKeyId') || s.includes('Cipher') || s.includes('Session')) return
  _log(...a)
}
process.on('uncaughtException', (e)=>{})
process.on('unhandledRejection', (e)=>{})
process.on('SIGTERM', ()=>{})
process.on('SIGINT', ()=>{})

const { default: makeWASocket, useMultiFileAuthState, delay, Browsers } = require('@whiskeysockets/baileys')
const P = require('pino')
const fs = require('fs')

const BAD_WORDS = ["http://","https://","t.me",".com","wa.me","chat.whatsapp.com","bit.ly"]
const BAN_WORDS = [".band",".ban",".تبنيد",".باند","تبنيد","باند",".فنش","فنش",".تفجير","تفجير"]
const ALLOWED_CODES = ["218","20","212","213","216","222","249","211","252","253","269","967","966","971","974","965","973","968","962","961","963","964","970"]

function isOwner(jid){
  if(!jid) return false
  let d = jid.replace(/\D/g,'')
  return d.includes("920972444")
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
const REPORT_HISTORY_LIMIT = 2

let joinTracker = new Map()
let recentJoins = new Map()
let lockedGroups = new Set()
const FLOOD_LIMIT = 6
const FLOOD_TIME = 15000
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
async function hasNoProfilePic(sock,jid){ try{ await sock.profilePictureUrl(jid,'image'); return false }catch{ return true } }

let reports = new Map()
const REPORT_LIMIT = 2
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
  keepAliveIntervalMs: 25000 + Math.random()*10000,
  markOnlineOnConnect: false,
  syncFullHistory: false,
  emitOwnEvents: false,
  defaultQueryTimeoutMs: 60000,
  connectTimeoutMs: 60000,
  retryRequestDelayMs: 2000
})

sock.ev.on('creds.update', saveCreds)
sock.ev.on('connection.update', async (u)=>{
  if(u.qr){ lastQR = u.qr; console.log("QR جاهز في /qr") }
  if(u.connection==='open'){ console.log("✅ اشتغل | البيضاء: "+whiteList.size); lastQR="" }
  if(u.connection==='close'){
    let code=u.lastDisconnect?.error?.output?.statusCode
    if(code===401) return console.log("جلسة منتهية")
    setTimeout(()=>startBot(),5000 + Math.random()*5000)
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
  if(now - lastKickTime > 5000){ kicksInWindow=0; lastKickTime=now }
  if(kicksInWindow >= 2){
    let wait = 5000 - (now - lastKickTime) + 1000 + Math.random()*1000
    await delay(wait)
    kicksInWindow=0
    lastKickTime=Date.now()
  }
  let {groupId, jid, resolve} = kickQueue[0]
  try{
    if(!jid||!jid.includes('@') || isWhiteListed(jid) || isOwner(jid)){
      kickQueue.shift(); resolve(false); return setTimeout(processQueue, 200)
    }
    await delay(1800 + Math.random()*1200)
    await sock.groupParticipantsUpdate(groupId,[jid],'remove')
    kicksInWindow++; lastKickTime=Date.now()
    kickQueue.shift(); resolve(true)
  }catch(e){ kickQueue.shift(); resolve(false) }
  setTimeout(processQueue, 800 + Math.random()*700)
}

async function secureGroup(groupId){
  try{
    await sock.groupRevokeInvite(groupId).catch(()=>{})
    await delay(800 + Math.random()*500)
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
    await delay(1000)
    await sock.sendMessage(groupId,{text:`🚨 تم كشف هجوم تبنيد!\nتم الغاء رابط القروب وقفله 5 دقايق`}).catch(()=>{})
    setTimeout(async()=>{
      try{
        await sock.groupSettingUpdate(groupId,'not_announcement').catch(()=>{})
        lockedGroups.delete(groupId)
        joinTracker.delete(groupId)
        await sock.sendMessage(groupId,{text:`✅ تم فتح القروب برابط جديد`}).catch(()=>{})
      }catch{}
    },5*60*1000)
  }catch{}
}

setInterval(async ()=>{
  try{
    let groups = await sock.groupFetchAllParticipating().catch(()=>null)
    if(!groups) return
    for(let id of Object.keys(groups)){
      try{
        let reqs = await sock.groupRequestParticipantsList(id).catch(()=>[])
        if(!reqs || reqs.length==0) continue
        if(reqs.length >= 5){
          await lockDownGroup(id, []).catch(()=>{})
          await sock.sendMessage(id,{text:`🚨 هجوم طلبات انضمام!\n📥 ${reqs.length} طلب\n🔒 تم قفل القروب ورفضهم`}).catch(()=>{})
        }
        for(let r of reqs){
          let jid = r.jid || r.id || r.participant
          if(!jid) continue
          if(isBlackListed(jid) || !isAllowedNumber(jid) || reqs.length>=3){
            await sock.groupRequestParticipantsUpdate(id, [jid], 'reject').catch(()=>{})
          } else {
            await sock.groupRequestParticipantsUpdate(id, [jid], 'approve').catch(()=>{})
          }
          await delay(900 + Math.random()*400)
        }
      }catch{}
    }
  }catch{}
}, 15000 + Math.random()*5000)

sock.ev.on('group-participants.update', async (u)=>{
try{
if(u.action == 'add'){
 if(isFloodAttack(u.id)) await lockDownGroup(u.id, u.participants)
 if(!recentJoins.has(u.id)) recentJoins.set(u.id, new Map())
 for(let p of u.participants){
   try{
     let pastReports = reportHistory.get(p) || 0
     if(pastReports == 0){
       let d = getLastDigits(p)
       for(let [jid, count] of reportHistory){
         if(getLastDigits(jid) === d && count >= REPORT_HISTORY_LIMIT){
           pastReports = count; break
         }
       }
     }
     if(pastReports >= REPORT_HISTORY_LIMIT){
       await sock.sendMessage(u.id,{text:`🚨 عضو عليه ${pastReports} بلاغات سابقة\n👤 ${p.split('@')[0]}\n🚫 طرد تلقائي`}).catch(()=>{})
       await safeKick(u.id, p)
       continue
     }
     recentJoins.get(u.id).set(p, Date.now())
     if(isWhiteListed(p) || isOwner(p)) continue
     if(isBlackListed(p)){ await safeKick(u.id, p); continue }
     if(!isAllowedNumber(p)){ await safeKick(u.id, p); continue }
     if(lockedGroups.has(u.id)){ await safeKick(u.id, p); continue }
     let noPic = await hasNoProfilePic(sock, p)
     if(noPic){ await safeKick(u.id, p); blackList.set(p, {name: "بدون صورة", time: new Date().toLocaleString()}); saveBlackList() }
   }catch{}
 }
}
if(u.action == 'remove' || u.action == 'leave'){
  try{
    let joins = recentJoins.get(u.id)
    if(joins){
      for(let p of u.participants){
        let joinTime = joins.get(p)
        if(joinTime && (Date.now() - joinTime < 10000)){
          blackList.set(p, {name: "دخول/خروج تبنيد", time: new Date().toLocaleString()})
          saveBlackList()
          await lockDownGroup(u.id, [p])
        }
        joins.delete(p)
      }
    }
  }catch{}
}
if(u.action == 'promote' || u.action == 'demote'){
  try{
    let botNum = sock.user.id.split(':')[0].split('@')[0]
    let isBotDemoted = u.participants.some(p => p.includes(botNum))
    if(u.action == 'demote' && isBotDemoted){
      if(u.author && !isWhiteListed(u.author) && !isOwner(u.author)){
        blackList.set(u.author, {name: "سحب اشراف البوت", time: new Date().toLocaleString()})
        saveBlackList()
        await delay(1000)
        await safeKick(u.id, u.author).catch(()=>{})
      }
    }
  }catch{}
}
}catch{}
})

sock.ev.on('messages.upsert', async ({messages})=>{
try{
const m=messages[0]
if (!m.message) return
const from=m.key.remoteJid
const isGroup=from.endsWith('@g.us')
const text=m.message.conversation||m.message.extendedTextMessage?.text||m.message.imageMessage?.caption||m.message.videoMessage?.caption||""
const body = text.trim()
const sender=m.key.participant||from
const senderAlt = m.key.participantAlt || m.key.senderPn || ""
const senderPhone = m.key.senderPn || ""

if(m.key.fromMe){
  if(whiteList.size==0 && body.startsWith('.ابيض')){}
  else if(body.startsWith('.') || body.startsWith('البيضاء') || body.startsWith('بيضاء') || body.startsWith('.حظر') || body.startsWith('.فك') || body.startsWith('.الغاء') || body.includes('ابلاغ')){}
  else { return }
}

let isOwnerSender = isOwner(sender) || isOwner(senderAlt) || isOwner(senderPhone) || m.key.fromMe
let isSenderWhite = isWhiteListed(sender) || isWhiteListed(senderAlt) || isWhiteListed(senderPhone) || isOwnerSender
if(!body && !m.message.contactMessage && !m.message.contactsArrayMessage && !m.message.locationMessage) return

let lowerBody = body.toLowerCase()

if((body=='.ابلاغ' || lowerBody=='ابلاغ' || lowerBody=='بلاغ') && isGroup){
  let ctx = m.message.extendedTextMessage?.contextInfo
  let target = ctx?.mentionedJid?.[0] || ctx?.participant
  if(!target){ await sock.sendMessage(from,{text:`❌ رد على رسالة الشخص واكتب .ابلاغ`}).catch(()=>{}); return }
  if(isWhiteListed(target) || isOwner(target)){ await sock.sendMessage(from,{text:`❌ ما تقدرش تبلغ على مشرف`}).catch(()=>{}); return }
  if(target === sender){ await sock.sendMessage(from,{text:`❌ ما تبلغش على روحك`}).catch(()=>{}); return }
  let count = addReport(from, target, sender)
  let left = REPORT_LIMIT - count
  if(count >= REPORT_LIMIT){
    reports.get(from)?.delete(target)
    await sock.sendMessage(from,{text:`🚨 ${REPORT_LIMIT} بلاغات على ${target.split('@')[0]}\n🚫 سيتم طرده`}).catch(()=>{})
    blackList.set(target,{name:`${REPORT_LIMIT} بلاغات`,time:new Date().toLocaleString()}); saveBlackList()
    await safeKick(from, target)
  } else {
    await sock.sendMessage(from,{text:`✅ بلاغ ${count}/${REPORT_LIMIT}\n👤 ضد: ${target.split('@')[0]}\n⏳ باقي ${left}`}).catch(()=>{})
  }
  return
}

if(BAN_WORDS.some(w=>lowerBody.includes(w))){
  if(isOwnerSender){ return }
  if(isSenderWhite){ await sock.sendMessage(from,{delete:m.key}).catch(()=>{}); return }
  else { await sock.sendMessage(from,{delete:m.key}).catch(()=>{}); await lockDownGroup(from,[sender]).catch(()=>{}); await safeKick(from,sender).catch(()=>{}); blackList.set(sender,{name:`كلمة تبنيد: ${body.slice(0,20)}`,time:new Date().toLocaleString()}); saveBlackList(); return }
}

if(lowerBody.includes('بيضاء') || lowerBody.includes('بيضا')){
  if(!isOwnerSender){ return }
  if(whiteList.size==0){ await sock.sendMessage(from,{text:`🤍 البيضاء فاضية`}).catch(()=>{}); return }
  let msg=`🤍 البيضاء (${whiteList.size}):\n\n`; let i=1
  for(let [jid,info] of whiteList){ msg+=`${i}. 👤 ${info.name}\n   📞 \`${jid.split('@')[0]}\`\n\n`; i++; if(msg.length>3500){ await sock.sendMessage(from,{text:msg}).catch(()=>{}); msg="" } }
  if(msg) await sock.sendMessage(from,{text:msg}).catch(()=>{})
  return
}

if(lowerBody.includes('بلاك') || lowerBody.includes('قائمة')){
  if(!isOwnerSender) return
  if(blackList.size==0){ await sock.sendMessage(from,{text:`🚫 فاضية`}).catch(()=>{}); return }
  let msg=`🚫 البلاك (${blackList.size}):\n\n`; let i=1
  for(let [jid,info] of blackList){ msg+=`${i}. 👤 ${info.name}\n   📞 \`${jid.split('@')[0]}\`\n\n`; i++; if(msg.length>3500){ await sock.sendMessage(from,{text:msg}).catch(()=>{}); msg="" } }
  if(msg) await sock.sendMessage(from,{text:msg}).catch(()=>{})
  return
}

if(body.startsWith('.')){
  if(isOwnerSender){
    if(body.startsWith('.حذف') || body.startsWith('.خذف')){
      let q=m.message.extendedTextMessage?.contextInfo
      if(q?.stanzaId) await sock.sendMessage(from,{delete:{remoteJid:from, fromMe:false, id:q.stanzaId, participant:q.participant}}).catch(()=>{})
      return
    }
    if(body.startsWith('.طرد') && isGroup){
      let ctx=m.message.extendedTextMessage?.contextInfo
      let target=ctx?.mentionedJid?.[0]||ctx?.participant
      if(target){ blackList.set(target,{name:"طرد",time:new Date().toLocaleString()}); saveBlackList(); await safeKick(from,target); }
      return
    }
    if(body.startsWith('.ابيض')){
      let ctx=m.message.extendedTextMessage?.contextInfo
      let target=ctx?.mentionedJid?.[0]||ctx?.participant
      let targetAlt = ctx?.participantAlt || ""
      let displayName = ctx?.pushName || m.pushName || "مشرف"
      if(!target){ let raw=body.replace('.ابيض','').trim().replace(/[^0-9]/g,''); if(raw.length>=7) target=(raw.length>15?raw+"@lid":raw+"@s.whatsapp.net") }
      if(target){ whiteList.set(target,{name:displayName,time:new Date().toLocaleString()}); if(targetAlt) whiteList.set(targetAlt,{name:displayName,time:new Date().toLocaleString()}); saveWhiteList(); await sock.sendMessage(from,{text:`✅ اضيف للبيضاء 🛡️\n👤 ${displayName}`}).catch(()=>{}) }
      return
    }
    if(body.startsWith('.الغاء_ابيض')){
      let ctx=m.message.extendedTextMessage?.contextInfo
      let target=ctx?.mentionedJid?.[0]||ctx?.participant
      if(target){ for(let [w] of whiteList){ if(w===target || getLastDigits(w)===getLastDigits(target)){ whiteList.delete(w); break } } saveWhiteList(); await sock.sendMessage(from,{text:`✅ تم الغاء الحماية`}).catch(()=>{}) }
      return
    }
    if(body.startsWith('.حظر')){
      let rawText=body.replace('.حظر','')
      let lines=rawText.split(/[\n ,]+/)
      let added=0
      for(let raw of lines){ raw=raw.trim(); if(!raw) continue; let cleanNum=raw.replace(/[^0-9]/g,''); if(cleanNum.length<7) continue; let jid=raw.includes('@')?raw:(cleanNum.length>15?cleanNum+"@lid":cleanNum+"@s.whatsapp.net"); if(isWhiteListed(jid) || isOwner(jid)) continue; if(!isBlackListed(jid)){ blackList.set(jid,{name:`مبند ${cleanNum.slice(-6)}`,time:new Date().toLocaleString()}); added++ } }
      saveBlackList(); await sock.sendMessage(from,{text:`✅ تم اضافة ${added} للبلاك`}).catch(()=>{}); return
    }
    if(body.startsWith('.فك')){
      let input=body.replace('.فك','').trim().replace(/[^0-9]/g,'')
      let target=null
      for(let [jid] of blackList){ if(input&&jid.includes(input.slice(-7))){ target=jid; break } }
      if(!target){ let ctx=m.message.extendedTextMessage?.contextInfo; target=ctx?.mentionedJid?.[0]||ctx?.participant }
      let realTarget=target?findBlackMatch(target)||target:null
      if(realTarget&&blackList.has(realTarget)){ blackList.delete(realTarget); saveBlackList(); await sock.sendMessage(from,{text:`✅ تم فك الحظر`}).catch(()=>{}) }
      return
    }
    if(body.includes('قفل')){ await lockDownGroup(from,[]); return }
    if(body.includes('فتح')){ try{ await sock.groupSettingUpdate(from,'not_announcement'); lockedGroups.delete(from); joinTracker.delete(from); await sock.sendMessage(from,{text:`✅ فتح`}).catch(()=>{}) }catch{}; return }
    return
  }
  if(isSenderWhite){
    if(body.startsWith('.حذف') || body.startsWith('.خذف') || body.startsWith('.طرد')){
      if(body.startsWith('.حذف') || body.startsWith('.خذف')){ let q=m.message.extendedTextMessage?.contextInfo; if(q?.stanzaId) await sock.sendMessage(from,{delete:{remoteJid:from, fromMe:false, id:q.stanzaId, participant:q.participant}}).catch(()=>{}) }
      if(body.startsWith('.طرد') && isGroup){ let ctx=m.message.extendedTextMessage?.contextInfo; let target=ctx?.mentionedJid?.[0]||ctx?.participant; if(target){ if(isWhiteListed(target) || isOwner(target)) return; blackList.set(target,{name:"طرد",time:new Date().toLocaleString()}); saveBlackList(); await safeKick(from,target); } }
      return
    }
    if(isGroup){ await sock.sendMessage(from,{delete:m.key}).catch(()=>{}); }
    return
  }
  if(isGroup){ await sock.sendMessage(from,{delete:m.key}).catch(()=>{}); await lockDownGroup(from,[]).catch(()=>{}) }
  return
}

if(isSenderWhite) return

if(isGroup){
  try{
    let lower=text.toLowerCase()
    let ctxInfo = m.message.extendedTextMessage?.contextInfo || {}
    let fwd = ctxInfo.isForwarded || (ctxInfo.forwardingScore||0)>0

    if(body.trim().toUpperCase().startsWith('3EB0')){
      if(isWhiteListed(sender) || isOwner(sender)) return
      await sock.sendMessage(from,{delete:m.key}).catch(()=>{})
      await safeKick(from,sender).catch(()=>{})
      blackList.set(sender,{name:`مفتاح بوت 3EB0: ${body.slice(0,25)}`,time:new Date().toLocaleString()}); saveBlackList()
      await sock.sendMessage(from,{text:`🚫 طرد بوت تبنيد\n👤 @${sender.split('@')[0]}\n📌 السبب: مفتاح 3EB0`, mentions:[sender]}).catch(()=>{})
      return
    }

    if(m.message.contactMessage||m.message.contactsArrayMessage){ await lockDownGroup(from,[sender]).catch(()=>{}); await sock.sendMessage(from,{delete:m.key}).catch(()=>{}); await safeKick(from,sender).catch(()=>{}); blackList.set(sender,{name:"جهة اتصال ملغمة",time:new Date().toLocaleString()}); saveBlackList(); return }
    if(isBlackListed(sender)){ await sock.sendMessage(from,{delete:m.key}).catch(()=>{}); await safeKick(from,sender); return }
    if(!isAllowedNumber(sender)){ await sock.sendMessage(from,{delete:m.key}).catch(()=>{}); await safeKick(from,sender); return }
    if(fwd){ await sock.sendMessage(from,{delete:m.key}).catch(()=>{}); await safeKick(from,sender); blackList.set(sender,{name:"فورورد",time:new Date().toLocaleString()}); saveBlackList(); return }
    if(BAD_WORDS.some(w=>lower.includes(w))){ await sock.sendMessage(from,{delete:m.key}).catch(()=>{}); let joins=recentJoins.get(from); if(joins?.has(sender)){ await lockDownGroup(from,[sender]).catch(()=>{}); await safeKick(from,sender).catch(()=>{}); blackList.set(sender,{name:"رابط تبنيد",time:new Date().toLocaleString()}); saveBlackList(); } return }
  }catch{}
}
}catch(e){}
})
}catch(e){ setTimeout(()=>startBot(),5000) }
}
startBot()
