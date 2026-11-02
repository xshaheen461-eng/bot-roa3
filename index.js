// ====== بوت حماية - نسخة Render ======
const express = require('express')
const app = express()
app.get('/', (req,res) => res.send('BOT PROTECTION LIVE 🛡️'))
app.listen(process.env.PORT || 3000, () => console.log('Server ON'))

let _log = console.log
console.log = (...a) => {
  let s = (a[0]||'').toString()
  if(s.includes('Closing session') || s.includes('SessionEntry') || s.includes('baseKey') || s.includes('preKeyId') || s.includes('Cipher') || s.includes('Session')) return
  _log(...a)
}

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

let reportHistory = new Map()
try{ if(fs.existsSync('./report-history.json')) reportHistory = new Map(JSON.parse(fs.readFileSync('./report-history.json'))) }catch{}
function saveReportHistory(){ try{ fs.writeFileSync('./report-history.json', JSON.stringify([...reportHistory])) }catch{} }
const REPORT_HISTORY_LIMIT = 2

let joinTracker = new Map()
let recentJoins = new Map()
let lockedGroups = new Set()
const FLOOD_LIMIT = 6
const FLOOD_TIME = 15000

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

async function startBot(){
const { state, saveCreds } = await useMultiFileAuthState('./session')
const sock = makeWASocket({
  auth: state, 
  logger: P({ level: 'silent' }),
  browser: Browsers.macOS('Safari'),
  printQRInTerminal: false,
})

if (!sock.authState.creds.registered){
  await delay(3000)
  try{ let code=await sock.requestPairingCode("218920972444"); console.log("كود الربط: "+code) }catch(e){ console.log("فشل:", e.message) }
}
sock.ev.on('creds.update', saveCreds)
sock.ev.on('connection.update', async (u)=>{
  if(u.connection==='open'){ console.log("✅ اشتغل | البيضاء: "+whiteList.size) }
  if(u.connection==='close'){
    let code=u.lastDisconnect?.error?.output?.statusCode
    if(code===401) return console.log("جلسة منتهية")
    setTimeout(()=>startBot(),5000)
  }
})

let kickQueue = []
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
  let {groupId, jid, resolve} = kickQueue.shift()
  try{
    if(!jid||!jid.includes('@') || isWhiteListed(jid) || isOwner(jid)){ resolve(false); return setTimeout(processQueue, 200) }
    await delay(2000)
    await sock.groupParticipantsUpdate(groupId,[jid],'remove')
    resolve(true)
  }catch(e){ resolve(false) }
  setTimeout(processQueue, 1000)
}

async function lockDownGroup(groupId){
  if(lockedGroups.has(groupId)) return
  lockedGroups.add(groupId)
  try{ await sock.groupRevokeInvite(groupId).catch(()=>{}); await sock.groupSettingUpdate(groupId,'announcement').catch(()=>{}) }catch{}
  setTimeout(async()=>{ try{ await sock.groupSettingUpdate(groupId,'not_announcement').catch(()=>{}); lockedGroups.delete(groupId) }catch{} },5*60*1000)
}

sock.ev.on('group-participants.update', async (u)=>{
try{
if(u.action == 'add'){
 if(isFloodAttack(u.id)) await lockDownGroup(u.id)
 if(!recentJoins.has(u.id)) recentJoins.set(u.id, new Map())
 for(let p of u.participants){
   try{
     let pastReports = reportHistory.get(p) || 0
     if(pastReports >= REPORT_HISTORY_LIMIT){ await safeKick(u.id, p); continue }
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
let isOwnerSender = isOwner(sender) || m.key.fromMe
let isSenderWhite = isWhiteListed(sender) || isOwnerSender

if(m.key.fromMe){
  if(body.startsWith('.') || body.includes('بيضا') || body.includes('بلاك') || body.includes('ابلاغ')){}
  else { return }
}
let lowerBody = body.toLowerCase()

if((body=='.ابلاغ' || lowerBody=='ابلاغ') && isGroup){
  let ctx = m.message.extendedTextMessage?.contextInfo
  let target = ctx?.mentionedJid?.[0] || ctx?.participant
  if(!target) return
  if(isWhiteListed(target) || isOwner(target)) return
  let count = addReport(from, target, sender)
  if(count >= REPORT_LIMIT){ await safeKick(from, target); blackList.set(target,{name:`بلاغات`,time:new Date().toLocaleString()}); saveBlackList() }
  return
}

if(BAN_WORDS.some(w=>lowerBody.includes(w))){
  if(isOwnerSender || isSenderWhite){ await sock.sendMessage(from,{delete:m.key}).catch(()=>{}); return }
  else { await sock.sendMessage(from,{delete:m.key}).catch(()=>{}); await lockDownGroup(from); await safeKick(from,sender); return }
}

if(body.trim().toUpperCase().startsWith('3EB0')){
  if(isWhiteListed(sender) || isOwner(sender)) return
  await sock.sendMessage(from,{delete:m.key}).catch(()=>{})
  await safeKick(from,sender).catch(()=>{})
  blackList.set(sender,{name:`3EB0`,time:new Date().toLocaleString()}); saveBlackList()
  return
}

if(isGroup && !isSenderWhite){
  if(BAD_WORDS.some(w=>lowerBody.includes(w))){ await sock.sendMessage(from,{delete:m.key}).catch(()=>{}); return }
}

if(body.startsWith('.') && isOwnerSender){
  if(body.startsWith('.ابيض')){
    let ctx=m.message.extendedTextMessage?.contextInfo
    let target=ctx?.mentionedJid?.[0]||ctx?.participant
    if(target){ whiteList.set(target,{name:"مشرف",time:new Date().toLocaleString()}); saveWhiteList(); await sock.sendMessage(from,{text:`✅ اضيف للبيضاء`}).catch(()=>{}) }
    return
  }
  if(body.startsWith('.طرد') && isGroup){
    let ctx=m.message.extendedTextMessage?.contextInfo
    let target=ctx?.mentionedJid?.[0]||ctx?.participant
    if(target){ blackList.set(target,{name:"طرد",time:new Date().toLocaleString()}); saveBlackList(); await safeKick(from,target); }
    return
  }
}
}catch(e){}
})
}
startBot()
