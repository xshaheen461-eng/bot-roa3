// Bot Protection - Silent + Private Report + Anti Modified Link
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

const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys')
const pino = require('pino')
const express = require('express')
const fs = require('fs')
const qrcode = require('qrcode')
const app = express()
let qrCode = ''
app.get('/', (req,res)=>res.send('Bot Online'))
app.get('/qr', async (req,res)=>{ if(!qrCode) return res.send('No QR'); const img = await qrcode.toDataURL(qrCode); res.send('<img src="'+img+'" style="width:300px">') })
app.listen(process.env.PORT || 3000, ()=>console.log('Server on'))

const OWNER_NUM = (process.env.OWNER_NUMBER || "920972444").replace(/\D/g,'')
const OWNER_LID = (process.env.OWNER_LID || "").trim()
const BOT_NUMBER = (process.env.BOT_NUMBER || "").replace(/\D/g,'')

function isOwner(jid){
  if(!jid) return false
  if(OWNER_LID && String(jid).includes(OWNER_LID)) return true
  let d = String(jid).replace(/\D/g,'')
  return d.includes(OWNER_NUM) || d.endsWith(OWNER_NUM.slice(-9))
}
function getLastDigits(jid){ return jid ? String(jid).replace(/\D/g,'').slice(-9) : "" }
function getNums(text){
  if(!text) return []
  let cleaned = String(text).replace(/\+/g,'')
  for(let i=0;i<5;i++){ cleaned = cleaned.replace(/(\d)[\s\-]+(?=\d)/g,'$1') }
  let matches = cleaned.match(/\d{8,15}/g) || []
  let out = []
  for(let m of matches){ if(!out.includes(m) && m.length>7) out.push(m) }
  return out
}
function hasLink(t){
  if(!t) return false
  let raw = String(t).toLowerCase()
  let l = raw.replace(/[\s\u200b\u200c\u200d]+/g, '')
              .replace(/\[dot\]/g, '.').replace(/\(dot\)/g, '.').replace(/ dot /g, '.')
              .replace(/hxxps/g, 'https').replace(/hxxp/g, 'http')
              .replace(/\[.\]/g, '.').replace(/\(.\)/g, '.')
              .replace(/،/g, '.').replace(/٫/g, '.')
  if(l.includes('http://') || l.includes('https://') || l.includes('www.') || l.includes('wa.me') || l.includes('chat.whatsapp.com') || l.includes('t.me') || l.includes('telegram.me') || l.includes('instagram.com') || l.includes('facebook.com') || l.includes('youtube.com') || l.includes('bit.ly') || l.includes('.com') || l.includes('.ly') || l.includes('.net') || l.includes('.me/') || l.includes('chat.whatsapp')) return true
  if(/[a-z0-9-]+\.(com|net|org|ly|me|io|co|xyz|top|shop|link|site|online)\b/.test(l)) return true
  return false
}
const BAN_WORDS = [".band",".ban","تفنيش","فنش","تفجير","باند","تبنيد"]
function load(f, def){ try{ if(fs.existsSync(f)) return JSON.parse(fs.readFileSync(f)) }catch(e){} return def }
function save(f, d){ try{ fs.writeFileSync(f, JSON.stringify(d)) }catch(e){} }

let whiteList = new Map()
try{
  let data = load('whitelist.json', [])
  if(Array.isArray(data)){
    if(data.length>0 && typeof data[0]==='string') data.forEach(j=>whiteList.set(j,{name:"old",time:""}))
    else whiteList = new Map(data)
  }
}catch{}
function saveWhite(){ save('whitelist.json', [...whiteList]) }
function isWhite(jid){ if(!jid) return false; if(whiteList.has(jid)) return true; let d=getLastDigits(jid); for(let [w] of whiteList){ if(getLastDigits(w)===d) return true } return false }

let blackList = new Map()
try{ if(fs.existsSync('blacklist.json')) blackList = new Map(load('blacklist.json', [])) }catch{}
function saveBlack(){ save('blacklist.json', [...blackList]) }
function isBlack(jid){ if(!jid) return false; if(blackList.has(jid)) return true; let d=getLastDigits(jid); for(let [b] of blackList){ if(getLastDigits(b)===d) return true } return false }
function addBlack(jid, name){
  if(!jid || isWhite(jid) || isOwner(jid)) return
  if(!blackList.has(jid)) blackList.set(jid, {name: name||"kick", time: new Date().toLocaleString()})
  saveBlack()
}
function findBlack(jid){ let d=getLastDigits(jid); for(let [b] of blackList){ if(b===jid || getLastDigits(b)===d) return b } return null }

let linkCount = {}
let stickerCount = {}
let recentJoins = new Map()
let lockedGroups = new Set()
let reportsMap = new Map()

async function startBot(){
  const { state, saveCreds } = await useMultiFileAuthState('session')
  const ver = await fetchLatestBaileysVersion()
  const sock = makeWASocket({ version: ver.version, logger: pino({level:'silent'}), auth: state, printQRInTerminal: false, syncFullHistory: false, markOnlineOnConnect: false })
  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('connection.update', (u)=>{
    if(u.qr) qrCode = u.qr
    if(u.connection==='open'){ qrCode=''; console.log('Bot Online') }
    if(u.connection==='close'){ setTimeout(()=>startBot(), 5000) }
  })

  async function notifyOwner(text){
    try{ await sock.sendMessage(OWNER_NUM + '@s.whatsapp.net', {text: text}) }catch(e){}
  }
  async function getGroupName(gid){
    try{ let meta = await sock.groupMetadata(gid); return meta.subject || gid }catch(e){ return gid }
  }
  async function reportKick(groupId, jid, reason, extra){
    let gname = await getGroupName(groupId)
    let time = new Date().toLocaleTimeString()
    await notifyOwner(🚨 طردت ${String(jid).split('@')[0]}\n📌 السبب: ${reason}\n👥 القروب: ${gname}\n🕒 ${time}${extra ? '\n📄 '+extra : ''})
  }
  async function reportLock(groupId, reason){
    let gname = await getGroupName(groupId)
    await notifyOwner🔒 سكرت القروب 5 دقايق\n📌 السبب: ${reason}\n👥 القروب: ${gname}`)
  }

  async function doKick(groupId, jid, reason, extra){
    if(!jid || isWhite(jid) || isOwner(jid)) return
    addBlack(jid, reason)
    try{ await sock.groupParticipantsUpdate(groupId, [jid], 'remove') }catch(e){}
    await reportKick(groupId, jid, reason, extra)
  }

  async function lockGroup(groupId, reason){
    if(lockedGroups.has(groupId)) return
    lockedGroups.add(groupId)
    try{ await sock.groupRevokeInvite(groupId).catch(()=>{}) }catch{}
    try{ await sock.groupSettingUpdate(groupId, 'announcement') }catch{}
    await reportLock(groupId, reason)
    setTimeout(async ()=>{
      try{ await sock.groupSettingUpdate(groupId, 'not_announcement') }catch{}
      lockedGroups.delete(groupId)
      await notifyOwner(✅ فتحت القروب\n👥 ${await getGroupName(groupId)})
    }, 5*60*1000)
  }

  sock.ev.on('group-participants.update', async (u)=>{
    try{
      if(u.action==='add'){
        for(let p of u.participants){
          if(!recentJoins.has(u.id)) recentJoins.set(u.id, new Map())
          recentJoins.get(u.id).set(p, Date.now())
          if(isWhite(p) || isOwner(p)) continue
          if(isBlack(p)){ await doKick(u.id, p, 'بلاك دخل القروب'); continue }
        }
      }
      if(u.action==='remove' || u.action==='leave'){
        let joins = recentJoins.get(u.id)
        if(joins){ for(let p of u.participants){ joins.delete(p) } }
      }
      if(u.action==='demote'){
        let botNum = sock.user.id.split(':')[0].split('@')[0]
        let isBot = u.participants.some(p=>p.includes(botNum))
        if(isBot && u.author && !isWhite(u.author) && !isOwner(u.author)){
          await lockGroup(u.id, 'سحب اشراف البوت - هجوم')
          await doKick(u.id, u.author, 'سحب اشراف البوت')
        }
      }
    }catch(e){}
  })

  setInterval(async ()=>{
    try{
      let groups = await sock.groupFetchAllParticipating().catch(()=>null)
      if(!groups) return
      for(let gid of Object.keys(groups)){
        let parts = groups[gid].participants || []
        for(let p of parts){
          let id = p.id || p
          if(isBlack(id) && !isWhite(id) && !isOwner(id)) await doKick(gid, id, 'بلاك')
        }
      }
    }catch(e){}
  }, 30000)

  sock.ev.on('messages.upsert', async ({messages})=>{
    try{
      const m = messages[0]
      if(!m.message) return
      const from = m.key.remoteJid
      const isGroup = from.endsWith('@g.us')
      const sender = m.key.participant || from
      const senderAlt = m.key.participantAlt || m.key.senderPn || ""
      const isOwnerSender = isOwner(sender) || isOwner(senderAlt) || m.key.fromMe
      const isWhiteSender = isWhite(sender) || isWhite(senderAlt) || isOwnerSender
      const text = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || m.message.videoMessage?.caption || ""
      const body = String(text||"").trim()
      const lower = body.toLowerCase()
      const isSticker = !!m.message.stickerMessage
      const ctxInfo = m.message.extendedTextMessage?.contextInfo || {}
      const isForwarded = ctxInfo.isForwarded || (ctxInfo.forwardingScore||0)>0
      const quotedCtx = m.message.extendedTextMessage?.contextInfo || null

      if((body==='ابلاغ' || body==='.ابلاغ' || lower==='بلاغ') && isGroup){
        let target = quotedCtx?.mentionedJid?.[0] || quotedCtx?.participant
        if(!target){ await notifyOwner('❌ .ابلاغ: رد على رسالة الشخص'); return }
        if(isWhite(target) || isOwner(target)){ await notifyOwner('❌ ما تقدرش تبلغ على مشرف'); return }
        if(!reportsMap.has(from)) reportsMap.set(from, new Map())
        let g = reportsMap.get(from)
        if(!g.has(target)) g.set(target, new Set())
        g.get(target).add(sender)
        let count = g.get(target).size
        if(count >= 2){
          await lockGroup(from, '2 بلاغات - هجوم تبنيد')
          await doKick(from, target, '2 بلاغات - هجوم')
          g.delete(target)
        } else {
          await notifyOwner(✅ بلاغ ${count}/2 ضد ${target.split('@')[0]})
        }
        return
      }

      if(isOwnerSender){
        if(body==='.ping'){ await notifyOwner('✅ Bot online\n🤍 البيضاء: '+whiteList.size+'\n🚫 البلاك: '+blackList.size); return }
        if(body==='.حذف' || body==='.خذف'){
          if(quotedCtx?.stanzaId) await sock.sendMessage(from,{delete:{remoteJid:from, fromMe:false, id:quotedCtx.stanzaId, participant:quotedCtx.participant}}).catch(()=>{})
          return
        }
        if(body.startsWith('.طرد') && isGroup){
          let target = quotedCtx?.mentionedJid?.[0] || quotedCtx?.participant
          if(!target){ let n=getNums(body); if(n.length>0) target=n[0]+"@s.whatsapp.net" }
          if(target) await doKick(from, target, 'طرد بأمر المالك')
          return
        }
        if(body.startsWith('.ابيض')){
          let nums = getNums(body)
          let target = quotedCtx?.mentionedJid?.[0] || quotedCtx?.participant
          let name = quotedCtx?.pushName || m.pushName || "مشرف"
          if(target && !nums.length){
            whiteList.set(target,{name,time:new Date().toLocaleString()}); saveWhite()
            await notifyOwner(✅ اضيف للبيضاء\n👤 ${name}\n📞 ${target.split('@')[0]})
            return
          }
          if(nums.length>0){
            for(let n of nums){
              let jid = n+"@s.whatsapp.net"
              whiteList.set(jid,{name,time:new Date().toLocaleString()})
              let bm = findBlack(jid); if(bm) blackList.delete(bm)
            }
            saveWhite(); saveBlack()
            await notifyOwner(✅ اضيف للبيضاء: ${nums.length})
            return
          }
          await notifyOwner('❌ رد على شخص ولا اكتب رقم')
          return
        }
        if(body.startsWith('.حظر')){
          let nums = getNums(body)
          let added=0
          for(let n of nums){
            let jid = n+"@s.whatsapp.net"
            if(isWhite(jid)) continue
            addBlack(jid, 'مبند '+n.slice(-6)); added++
            if(isGroup) await doKick(from, jid, 'حظر بأمر المالك')
          }
          await notifyOwner(✅ تم اضافة ${added} للبلاك)
          return
        }
        if(body.startsWith('.فك')){
          let nums = getNums(body)
          let target = quotedCtx?.mentionedJid?.[0] || quotedCtx?.participant
          if(nums.length>0) target = nums[0]+"@s.whatsapp.net"
          let real = target ? findBlack(target) : null
          if(real){ blackList.delete(real); saveBlack(); await notifyOwner('✅ تم فك الحظر') }
          else await notifyOwner('❌ مش في البلاك')
          return
        }
        if(body.startsWith('.الغاء_ابيض') || body.startsWith('.الغاء ابيض')){
          let nums = getNums(body)
          let target = quotedCtx?.mentionedJid?.[0] || quotedCtx?.participant
          if(nums.length>0) target = nums[0]+"@s.whatsapp.net"
          if(target){
            for(let [w] of whiteList){ if(w===target || getLastDigits(w)===getLastDigits(target)){ whiteList.delete(w); break } }
            saveWhite(); await notifyOwner('✅ تم الغاء من البيضاء')
          }
          return
        }
        if(body==='.بيضاء' || lower==='بيضاء'){
          if(whiteList.size===0){ await notifyOwner('🤍 البيضاء فاضية'); return }
          let msg=`🤍 البيضاء (${whiteList.size}):\n\n`; let i=1
          for(let [jid,info] of whiteList){ msg+=`${i}. 👤 ${info.name}\n   📞 ${jid.split('@')[0]}\n\n`; i++ }
          await notifyOwner(msg)
          return
        }
        if(body==='.بلاك' || lower==='بلاك'){
          if(blackList.size===0){ await notifyOwner('🚫 البلاك فاضية'); return }
          let msg=`🚫 البلاك (${blackList.size}):\n\n`; let i=1
          for(let [jid,info] of blackList){ msg+=`${i}. 👤 ${info.name}\n   📞 ${jid.split('@')[0]}\n\n`; i++ }
          await notifyOwner(msg)
          return
        }
        if(body==='.قائمة' || lower==='قائمة'){
          await notifyOwne📋 القائمة:\n🤍 البيضاء: ${whiteList.size}\n🚫 البلاك: ${blackList.size}}`)
          return
        }
        if(body.startsWith('.')) return
      }

      if(isWhiteSender && !isOwnerSender){
        if(body==='.حذف' || body==='.خذف'){
          if(quotedCtx?.stanzaId) await sock.sendMessage(from,{delete:{remoteJid:from, fromMe:false, id:quotedCtx.stanzaId, participant:quotedCtx.participant}}).catch(()=>{})
          return
        }
        if(body.startsWith('.طرد') && isGroup){
          let target = quotedCtx?.mentionedJid?.[0] || quotedCtx?.participant
          if(target && !isWhite(target) && !isOwner(target)) await doKick(from, target, 'طرد')
          return
        }
        if(body.startsWith('.') && isGroup){ await sock.sendMessage(from,{delete:m.key}).catch(()=>{}); return }
        return
      }

      if(!isGroup) return

      let isBotMsg = body.trim().toUpperCase().startsWith('3EB0') || BAN_WORDS.some(w=>lower.includes(w)) || body.startsWith('.band') || body.startsWith('.ban')
      if(isBotMsg){
        let isAdmin = false
        try{ let meta = await sock.groupMetadata(from).catch(()=>null); if(meta){ let p = meta.participants.find(x=>x.id===sender || x.id===senderAlt); if(p && (p.admin==='admin' || p.admin==='superadmin')) isAdmin = true } }catch{}
        if(isAdmin) return
        await sock.sendMessage(from,{delete:m.key}).catch(()=>{})
        await doKick(from, sender, 'بوت تبنيد', body.slice(0,30))
        return
      }
      if(body.includes('3EB0') || body.includes('EB0')){
        let isAdmin = false
        try{ let meta = await sock.groupMetadata(from).catch(()=>null); if(meta){ let p = meta.participants.find(x=>x.id===sender); if(p && p.admin) isAdmin = true } }catch{}
        if(!isAdmin){ await sock.sendMessage(from,{delete:m.key}).catch(()=>{}); await doKick(from, sender, 'بوت', body.slice(0,30)); return }
      }
      if(body.startsWith('.')){
        await sock.sendMessage(from,{delete:m.key}).catch(()=>{})
        if(BAN_WORDS.some(w=>lower.includes(w))){ await doKick(from, sender, 'كلمة تبنيد: '+body.slice(0,20)) }
        return
      }
      if(hasLink(body)){
        await sock.sendMessage(from,{delete:m.key}).catch(()=>{})
        let key = from+'_'+sender
        linkCount[key] = (linkCount[key]||0)+1
        if(linkCount[key] >= 2){
          await doKick(from, sender, 'رابط مكرر', body.slice(0,40))
          linkCount[key]=0
        } else {
          await lockGroup(from, 'رابط ممنوع - أول مرة')
        }
        return
      }
      if(isForwarded){
        await sock.sendMessage(from,{delete:m.key}).catch(()=>{})
        if(isWhiteSender) return
        await lockGroup(from, 'اعادة توجيه ممنوعة')
        await doKick(from, sender, 'اعادة توجيه')
        return
      }
      if(isSticker){
        let key = from+'_'+sender
        if(!stickerCount[key]) stickerCount[key]=[]
        stickerCount[key].push(Date.now())
        stickerCount[key]=stickerCount[key].filter(t=>Date.now()-t<10000)
        if(stickerCount[key].length > 2){
          await sock.sendMessage(from,{delete:m.key}).catch(()=>{})
          stickerCount[key]=[]
          return
        }
      }
      if(isBlack(sender)){ await sock.sendMessage(from,{delete:m.key}).catch(()=>{}); await doKick(from, sender, 'بلاك'); return }

    }catch(e){}
  })
}
startBot()
