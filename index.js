const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys')
const pino = require('pino')
const express = require('express')
const fs = require('fs')
const qrcode = require('qrcode')
const app = express()
let qrCode = ''
let sock = null
app.get('/', function(req, res){ res.send('Bot Online') })
app.get('/qr', async function(req, res){
  if(!qrCode) return res.send('No QR')
  const img = await qrcode.toDataURL(qrCode)
  res.send('<img src="' + img + '" style="width:300px">')
})
app.listen(process.env.PORT || 3000, function(){ console.log('Server on') })
const OWNER_NUMBER = (process.env.OWNER_NUMBER || "").replace(/\D/g, '')
const OWNER_LID = (process.env.OWNER_LID || "").trim()
const BOT_NUMBER = (process.env.BOT_NUMBER || "").replace(/\D/g, '')
function load(f, def){ try{ if(fs.existsSync(f)) return JSON.parse(fs.readFileSync(f)) }catch(e){} return def }
function save(f, d){ fs.writeFileSync(f, JSON.stringify(d)) }
function normalizeList(arr){
  if(!Array.isArray(arr)) return []
  let out = []
  for(let i=0;i<arr.length;i++){
    let s = String(arr[i]).replace(/\D/g, '')
    if(s.length > 7 && out.indexOf(s) === -1) out.push(s)
  }
  return out
}
let whitelist = normalizeList(load('whitelist.json', []))
let blacklist = normalizeList(load('blacklist.json', []))
let reports = load('report-history.json', {})
let bannedWords = load('banned.json', [])
const ALLOWED_CODES = ['218','20','212','213','216','222','249','211','252','253','269','967','966','971','974','965','973','968','962','961','963','964','970']
function getLastDigits(jid){
  if(!jid) return ''
  let d = String(jid).replace(/\D/g, '')
  return d.slice(-9)
}
function isOwner(jid){
  if(!jid) return false
  if(OWNER_LID && String(jid).indexOf(OWNER_LID) !== -1) return true
  if(String(jid).indexOf('@lid') !== -1) return false
  let d = String(jid).replace(/\D/g, '')
  if(!OWNER_NUMBER) return false
  return d.indexOf(OWNER_NUMBER) !== -1 || d.endsWith(OWNER_NUMBER.slice(-9))
}
function getNums(text){
  if(!text) return []
  let matches = String(text).match(/\d{8,15}/g) || []
  let out = []
  for(let i=0;i<matches.length;i++){ if(out.indexOf(matches[i]) === -1) out.push(matches[i]) }
  let final = []
  for(let i=0;i<out.length;i++){ if(out[i].length > 7) final.push(out[i]) }
  return final
}
function isInList(list, jid){
  let last = getLastDigits(jid)
  for(let i=0;i<list.length;i++){
    let x = String(list[i])
    if(x.slice(-9) === last) return true
    if(last.endsWith(x.slice(-9))) return true
    if(x.endsWith(last)) return true
  }
  return false
}
function isAllowedNumber(jid){
  if(!jid) return false
  if(String(jid).indexOf('@lid') !== -1) return true
  let d = String(jid).replace(/\D/g, '')
  for(let i=0;i<ALLOWED_CODES.length;i++){ if(d.indexOf(ALLOWED_CODES[i]) === 0) return true }
  return false
}
function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms) }) }
function formatBlacklist(){
  if(blacklist.length === 0) return 'Black (0): empty'
  let txt = 'Black (' + blacklist.length + '):\n\n'
  for(let i=0;i<blacklist.length;i++){
    let n = String(blacklist[i])
    txt += (i+1) + '. Banned ' + n.slice(-6) + '\n   ' + n + '\n\n'
  }
  return txt.trim()
}
function formatWhitelist(){
  if(whitelist.length === 0) return 'White (0): empty'
  let txt = 'White (' + whitelist.length + '):\n\n'
  for(let i=0;i<whitelist.length;i++){
    let n = String(whitelist[i])
    txt += (i+1) + '. Allowed ' + n.slice(-6) + '\n   ' + n + '\n\n'
  }
  return txt.trim()
}
let kickQueue = []
let kicking = false
async function doKick(groupId, userId, reason){
  kickQueue.push({ groupId: groupId, userId: userId, reason: reason })
  if(kicking) return
  kicking = true
  while(kickQueue.length > 0){
    let k = kickQueue.shift()
    try{ await sock.groupParticipantsUpdate(k.groupId, [k.userId], 'remove') }catch(e){ console.log('kick fail') }
    await sleep(8000)
  }
  kicking = false
}
let joins = []
let joinRequests = []
async function startBot(){
  const state2 = await useMultiFileAuthState('session')
  const state = state2.state
  const saveCreds = state2.saveCreds
  const ver = await fetchLatestBaileysVersion()
  sock = makeWASocket({ version: ver.version, logger: pino({ level: 'silent' }), auth: state, printQRInTerminal: false, syncFullHistory: false })
  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('connection.update', function(u){
    const connection = u.connection
    const lastDisconnect = u.lastDisconnect
    const qr = u.qr
    if(qr) qrCode = qr
    if(connection === 'open'){ qrCode = ''; console.log('Connected') }
    if(connection === 'close'){
      let should = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output && lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut
      console.log('Disconnected, retry in 10s')
      if(should) setTimeout(function(){ startBot() }, 10000)
    }
  })
  sock.ev.on('group-participants.update', async function(anu){
    try{
      let groupId = anu.id
      let action = anu.action
      let participants = anu.participants || []
      if(action === 'demote'){
        for(let i=0;i<participants.length;i++){
          let p = participants[i]
          if(String(p).indexOf(BOT_NUMBER) !== -1 || getLastDigits(p) === BOT_NUMBER.slice(-9)){
            let actor = anu.author || ''
            if(!isOwner(actor)) await sock.groupParticipantsUpdate(groupId, [actor], 'remove')
          }
        }
        return
      }
      if(action === 'add'){
        let now = Date.now()
        joins.push(now)
        joins = joins.filter(function(t){ return now - t < 20000 })
        if(joins.length >= 10){
          await sock.sendMessage(groupId, { text: 'Flood detected, locked 5 min' })
          await sock.groupSettingUpdate(groupId, 'announcement')
          setTimeout(async function(){
            try{ await sock.groupSettingUpdate(groupId, 'not_announcement'); await sock.groupRevokeInvite(groupId) }catch(e){}
          }, 5 * 60 * 1000)
          joins = []
          return
        }
        for(let i=0;i<participants.length;i++){
          let user = participants[i]
          if(isInList(blacklist, user)){ doKick(groupId, user, 'black'); continue }
          if(isInList(whitelist, user)) continue
          let d = getLastDigits(user)
          if(reports[d] && reports[d] >= 4){ doKick(groupId, user, 'reports'); continue }
          if(!isAllowedNumber(user)){ doKick(groupId, user, 'country'); continue }
          try{
            let pp = await sock.profilePictureUrl(user, 'image').catch(function(){ return null })
            if(!pp){ doKick(groupId, user, 'no pic'); continue }
          }catch(e){}
          await sleep(4000)
        }
      }
    }catch(e){ console.log('participants err', e.message) }
  })
  sock.ev.on('messages.upsert', async function(m){
    try{
      let msg = m.messages[0]
      if(!msg.message) return
      let isSelf = msg.key.fromMe
      let from = msg.key.remoteJid
      let isGroup = from.endsWith('@g.us')
      let sender = msg.key.participant || msg.key.remoteJidAlt || msg.key.remoteJid
      if(String(sender).indexOf('@lid') !== -1 && msg.key.remoteJidAlt) sender = msg.key.remoteJidAlt
      let text = msg.message.conversation || (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text) || (msg.message.imageMessage && msg.message.imageMessage.caption) || ''
      if(!text) return
      text = text.trim()
      let quotedText = ''
      if(msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo && msg.message.extendedTextMessage.contextInfo.quotedMessage){
        let qm = msg.message.extendedTextMessage.contextInfo.quotedMessage
        quotedText = qm.conversation || (qm.extendedTextMessage && qm.extendedTextMessage.text) || ''
      }
      if(quotedText && (text.indexOf('.ابيض') !== -1 || text.indexOf('.حظر') !== -1 || text.indexOf('.فك') !== -1)){
        text = quotedText + '\n' + text
      }
      if(text.indexOf('3EB0') === 0){
        if(isGroup){ await sock.sendMessage(from, { text: 'Ban bot detected' }); doKick(from, sender, '3EB0') }
        return
      }
      let lower = text.toLowerCase()
      let hasBanned = false
      for(let i=0;i<bannedWords.length;i++){ if(lower.indexOf(String(bannedWords[i]).toLowerCase()) !== -1) hasBanned = true }
      if(lower.indexOf('.band') !== -1 || text.indexOf('تبنيد') !== -1 || text.indexOf('باند') !== -1 || hasBanned){
        if(isGroup && !isOwner(sender) && !isSelf){
          try{ await sock.sendMessage(from, { delete: msg.key }) }catch(e){}
          doKick(from, sender, 'banned word')
          await sock.groupSettingUpdate(from, 'announcement')
          setTimeout(function(){ sock.groupSettingUpdate(from, 'not_announcement') }, 30000)
          return
        }
      }
      if(!isOwner(sender) && !isSelf) return
      if(text === '.ping'){ await sock.sendMessage(from, { text: 'Bot online' }); return }
      if(text.indexOf('.طرد') === 0){
        if(!isGroup) return
        let nums = getNums(text)
        for(let i=0;i<nums.length;i++) doKick(from, nums[i] + '@s.whatsapp.net', 'owner')
        if(nums.length > 0) await sock.sendMessage(from, { text: 'Kicked ' + nums.length })
        return
      }
      if(text === '.قفل'){ if(!isGroup) return; await sock.groupSettingUpdate(from, 'announcement'); await sock.sendMessage(from, { text: 'Locked' }); return }
      if(text === '.فتح'){ if(!isGroup) return; await sock.groupSettingUpdate(from, 'not_announcement'); await sock.sendMessage(from, { text: 'Opened' }); return }
      if(text.indexOf('.حظر') !== -1 || text.indexOf('.حضر') !== -1){
        let nums = getNums(text)
        if(nums.length > 0){
          let added = 0
          for(let i=0;i<nums.length;i++){
            let full = String(nums[i])
            let exists = false
            for(let j=0;j<blacklist.length;j++){ if(String(blacklist[j]).slice(-9) === full.slice(-9)) exists = true }
            if(!exists){ blacklist.push(full); added++ }
            whitelist = whitelist.filter(function(x){ return String(x).slice(-9) !== full.slice(-9) })
            if(isGroup) doKick(from, full + '@s.whatsapp.net', 'bulk ban')
          }
          save('blacklist.json', blacklist)
          save('whitelist.json', whitelist)
          await sock.sendMessage(from, { text: 'Banned ' + added + ' numbers' })
        }
        return
      }
      if(text.indexOf('.فك') !== -1){
        let nums = getNums(text)
        for(let i=0;i<nums.length;i++){ let f = String(nums[i]); blacklist = blacklist.filter(function(x){ return String(x).slice(-9) !== f.slice(-9) }) }
        save('blacklist.json', blacklist)
        await sock.sendMessage(from, { text: 'Unbanned ' + nums.length })
        return
      }
      if(text.indexOf('.ابيض') !== -1){
        let nums = getNums(text)
        if(nums.length > 0){
          let added = 0
          for(let i=0;i<nums.length;i++){
            let full = String(nums[i])
            let exists = false
            for(let j=0;j<whitelist.length;j++){ if(String(whitelist[j]).slice(-9) === full.slice(-9)) exists = true }
            if(!exists){ whitelist.push(full); added++ }
            blacklist = blacklist.filter(function(x){ return String(x).slice(-9) !== full.slice(-9) })
          }
          save('whitelist.json', whitelist)
          save('blacklist.json', blacklist)
          await sock.sendMessage(from, { text: 'Added to white ' + added })
        }
        return
      }
      if(text === '.قائمة' || text === '.قائمه' || text === '.list' || text === '.بيضاء' || text === 'بيضاء'){
        let out = formatWhitelist() + '\n\n' + formatBlacklist()
        await sock.sendMessage(from, { text: out })
        return
      }
      if(text === 'بلاك' || text === '.بلاك'){ await sock.sendMessage(from, { text: formatBlacklist() }); return }
      if(text.indexOf('.ابلاغ') === 0){
        if(!isGroup) return
        let nums = getNums(text)
        for(let i=0;i<nums.length;i++){
          let last = String(nums[i]).slice(-9)
          reports[last] = (reports[last] || 0) + 1
          if(reports[last] >= 4) doKick(from, nums[i] + '@s.whatsapp.net', 'reports')
        }
        save('report-history.json', reports)
        await sock.sendMessage(from, { text: 'Reported ' + nums.length })
        return
      }
    }catch(e){ console.log('msg err', e.message) }
  })
  setInterval(async function(){
    try{
      if(!sock) return
      let groups = await sock.groupFetchAllParticipating()
      for(let gid in groups){
        let g = groups[gid]
        let parts = g.participants || []
        for(let i=0;i<parts.length;i++){
          let id = parts[i].id || parts[i]
          let last = getLastDigits(id)
          if(isInList(blacklist, id) || (reports[last] && reports[last] >= 4)){
            if(!isInList(whitelist, id) && !isOwner(id)) doKick(gid, id, 'clean')
          }
        }
      }
    }catch(e){}
  }, 30 * 60 * 1000)
}
startBot()
