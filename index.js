// ====== بوت حماية V2 - نسخة QR + آمنة ضد البند ======
require('dotenv').config()

// ====== سيرفر QR ======
const express = require('express');
const qrcode = require('qrcode');
const app = express();
let lastQR = '';

app.get('/qr', async (req, res) => {
  if (!lastQR) return res.send('<h1 style="text-align:center">استنى شوية... QR قاعد يتولد</h1><script>setTimeout(()=>location.reload(),5000)</script>');
  try {
    const img = await qrcode.toDataURL(lastQR);
    res.send(<div style="text-align:center;font-family:sans-serif"><h1>امسح الـ QR</h1><img src="${img}" width="350"><p>يتغير كل دقيقة - الصفحة تتحدث بروحها</p></div><script>setTimeout(()=>location.reload(),30000)</script>);
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
async function hasNoProfilePic(sock,jid){ try{ await sock.profilePictureUrl(jid,'image'); return false }catch{ return true } }

let reports = new Map()
const REPORT_LIMIT = 4
const REPORT_TIME = 10*60*1000
function addReport(groupId, targetJid, reporterJid){
  if(!reports.has(groupId)) reports.set(groupId, new Map())
  let groupReports = reports.get(groupId)
  if(!groupReports.has(targetJid)) groupReports.set(targetJid, {count:0, reporters:new Set(), firstTime:Date.now()})
  let r = groupReports.get(targetJid)
  if(Date.now() - r.firstTime > REPORT_TIME){ r.count=0; r.reporters.clear(); r.firstTime=Date.now() }
  if(!r.reporters.has(reporterJid)){ r.reporters.add(reporterJid); r.count++ }
  return r.count
}

async function startBot(){
  const { state, saveCreds } = await useMultiFileAuthState('./auth')
  const sock = makeWASocket({
    auth: state,
    logger: P({level:'silent'}),
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false
  })
  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, qr, lastDisconnect } = update
    if(qr){
      lastQR = qr
      console.log('QR جديد تولد - خش على /qr')
    }
    if(connection === 'open'){
      lastQR = ''
      console.log('تم الربط بنجاح ✅')
    }
    if(connection === 'close'){
      let shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401
      if(shouldReconnect){
        await delay(3000)
        startBot()
      } else {
        console.log('تم تسجيل الخروج - امسح auth واربط من جديد')
      }
    }
  })

  // ====== حماية دخول القروب ======
  sock.ev.on('group-participants.update', async (anu) => {
    try{
      const groupId = anu.id
      for(let p of anu.participants){
        if(anu.action === 'add'){
          if(isOwner(p) || isWhiteListed(p)) continue
          if(isBlackListed(p)){
            try{ await sock.groupParticipantsUpdate(groupId, [p], 'remove') }catch{}
            continue
          }
          if(!isAllowedNumber(p)){
            try{ await sock.groupParticipantsUpdate(groupId, [p], 'remove') }catch{}
            continue
          }
          if(isFloodAttack(groupId)){
            try{ await sock.groupParticipantsUpdate(groupId, [p], 'remove') }catch{}
            lockedGroups.add(groupId)
            continue
          }
          if(await hasNoProfilePic(sock, p)){
            // لو تبي تطرد اللي ماعندهمش صورة، فعّل السطر الجاي
            // try{ await sock.groupParticipantsUpdate(groupId, [p], 'remove') }catch{}
          }
        }
      }
    }catch{}
  })

  // ====== رسائل + اوامر ======
  sock.ev.on('messages.upsert', async ({messages}) => {
    try{
      const m = messages[0]
      if(!m.message || m.key.fromMe) return
      const from = m.key.remoteJid
      const isGroup = from.endsWith('@g.us')
      const sender = m.key.participant || m.key.remoteJid
      const text = (m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || '').trim()

      if(!text) return
      const lower = text.toLowerCase()

      // حماية روابط
      if(isGroup && BAD_WORDS.some(w=>lower.includes(w))){
        if(!isOwner(sender) && !isWhiteListed(sender)){
          try{ await sock.sendMessage(from, {delete: m.key}) }catch{}
          return
        }
      }

      // اوامر المالك فقط
      if(!isOwner(sender)) return

      if(lower === '.قائمة بيضاء' || lower === '.whitelist'){
        await sock.sendMessage(from, {text: 'القائمة البيضاء: ' + [...whiteList.keys()].join('\n')})
      }
      if(text.startsWith('.اضافة')){
        let num = text.replace(/\D/g,'')
        if(num){ let jid = num + '@s.whatsapp.net'; whiteList.set(jid,{name:num,time:new Date().toISOString()}); saveWhiteList(); await sock.sendMessage(from,{text:'تمت الاضافة ✅'}) }
      }
      if(text.startsWith('.حظر')){
        let num = text.replace(/\D/g,'')
        if(num){ let jid = num + '@s.whatsapp.net'; blackList.set(jid,{time:Date.now()}); saveBlackList(); await sock.sendMessage(from,{text:'تم الحظر ✅'}) }
      }
      if(lower === '.ping'){
        await sock.sendMessage(from,{text:'البوت شغال ✅'})
      }
    }catch{}
  })
}
startBot()
