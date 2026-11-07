const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys')
const pino = require('pino')
const express = require('express')
const fs = require('fs')
const qrcode = require('qrcode')

process.on('uncaughtException', e => console.log('uncaught', e.message))
process.on('unhandledRejection', e => console.log('unhandled', e.message))

const app = express()
let qrCode = ''
let sock = null

app.get('/', (req, res) => res.send('Bot Online'))
app.get('/qr', async (req, res) => {
  if (!qrCode) return res.send('لا يوجد QR الان، البوت مربوط او انتظر...')
  const img = await qrcode.toDataURL(qrCode)
  res.send('<img src="' + img + '" style="width:300px">')
})
app.listen(process.env.PORT || 3000, () => console.log('Server on'))

const OWNER_NUMBER = (process.env.OWNER_NUMBER || "").replace(/\D/g, '')
const OWNER_LID = (process.env.OWNER_LID || "").trim()
const BOT_NUMBER = (process.env.BOT_NUMBER || "").replace(/\D/g, '')

function load(f, def) { try { if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f)) } catch(e){} return def }
function save(f, d) { fs.writeFileSync(f, JSON.stringify(d)) }

// ===== تصليح مهم: حول كل شي لنص باش slice ما يطيحش =====
function normalizeList(arr) {
  if (!Array.isArray(arr)) return []
  return [...new Set(arr.map(x => String(x).replace(/\D/g, '')).filter(x => x.length >= 8))]
}
let whitelist = normalizeList(load('whitelist.json', []))
let blacklist = normalizeList(load('blacklist.json', []))
let reports = load('report-history.json', {})
let bannedWords = load('banned.json', [])

const ALLOWED_CODES = ['218','20','212','213','216','222','249','211','252','253','269','967','966','971','974','965','973','968','962','961','963','964','970']

function getLastDigits(jid) {
  if (!jid) return ''
  let d = String(jid).replace(/\D/g, '')
  return d.slice(-9)
}
function isOwner(jid) {
  if (!jid) return false
  if (OWNER_LID && String(jid).includes(OWNER_LID)) return true
  if (String(jid).includes('@lid')) return false
  let d = String(jid).replace(/\D/g, '')
  if (!OWNER_NUMBER) return false
  return d.includes(OWNER_NUMBER) || d.endsWith(OWNER_NUMBER.slice(-9))
}
function getNums(text) {
  if (!text) return []
  let matches = String(text).match(/\d{8,15}/g) || []
  let out = [...new Set(matches)]
  return out.filter(n => n.length >= 😎
}
function getNum(text) {
  let all = getNums(text)
  return all[0] || ''
}
function isInList(list, jid) {
  let last = getLastDigits(jid)
  return list.some(x => String(x).slice(-9) === last || last.endsWith(String(x).slice(-9)) || String(x).endsWith(last))
}
function isAllowedNumber(jid) {
  if (!jid) return false
  if (String(jid).includes('@lid')) return true
  let d = String(jid).replace(/\D/g, '')
  for (let c of ALLOWED_CODES) { if (d.startsWith(c)) return true }
  return false
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

function formatBlacklist() {
  if (blacklist.length === 0) return '🚫 البلاك (0):\nفاضية'
  let txt = '🚫 البلاك (' + blacklist.length + '):\n\n'
  blacklist.forEach((n, i) => {
    n = String(n)
    txt += (i+1) + '. 👤 مبند ' + n.slice(-6) + '\n   📞 `' + n + '`\n\n'
  })
  return txt.trim()
}
function formatWhitelist() {
  if (whitelist.length === 0) return '✅ البيضاء (0):\nفاضية'
  let txt = '✅ البيضاء (' + whitelist.length + '):\n\n'
  whitelist.forEach((n, i) => {
    n = String(n)
    txt += (i+1) + '. 👤 مسموح ' + n.slice(-6) + '\n   📞 `' + n + '`\n\n'
  })
  return txt.trim()
}

let kickQueue = []
let kicking = false
async function doKick(groupId, userId, reason) {
  kickQueue.push({ groupId, userId, reason })
  if (kicking) return
  kicking = true
  while (kickQueue.length > 0) {
    let k = kickQueue.shift()
    try {
      await sock.groupParticipantsUpdate(k.groupId, [k.userId], 'remove')
      console.log('طرد:', k.userId, k.reason)
    } catch(e) { console.log('فشل طرد', e.message) }
    await sleep(8000)
  }
  kicking = false
}

let joins = []
let joinRequests = []

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('session')
  const { version } = await fetchLatestBaileysVersion()
  sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    auth: state,
    printQRInTerminal: false,
    syncFullHistory: false
  })
  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', (u) => {
    const { connection, lastDisconnect, qr } = u
    if (qr) qrCode = qr
    if (connection === 'open') { qrCode = ''; console.log('البوت مربوط') }
    if (connection === 'close') {
      let should = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
      console.log('انقطع، نعاود بعد 10 ثواني')
      if (should) setTimeout(() => startBot(), 10000)
    }
  })

  sock.ev.on('group-participants.update', async (anu) => {
    try {
      let groupId = anu.id
      let action = anu.action
      let participants = anu.participants || []
      if (action === 'demote') {
        for (let p of participants) {
          if (String(p).includes(BOT_NUMBER) || getLastDigits(p) === BOT_NUMBER.slice(-9)) {
            let actor = anu.author || ''
            if (!isOwner(actor)) await sock.groupParticipantsUpdate(groupId, [actor], 'remove')
          }
        }
        return
      }
      if (action === 'add') {
        let now = Date.now()
        joins.push(now)
        joins = joins.filter(t => now - t < 20000)
        if (joins.length >= 10) {
          await sock.sendMessage(groupId, { text: 'تم اكتشاف فيضان، القروب تقفل 5 دقايق' })
          await sock.groupSettingUpdate(groupId, 'announcement')
          setTimeout(async () => {
            try { await sock.groupSettingUpdate(groupId, 'not_announcement'); await sock.groupRevokeInvite(groupId) } catch(e){}
          }, 5 * 60 * 1000)
          joins = []
          return
        }
        for (let user of participants) {
          if (isInList(blacklist, user)) { doKick(groupId, user, 'بلاك'); continue }
          if (isInList(whitelist, user)) continue
          let d = getLastDigits(user)
          if (reports[d] && reports[d] >= 4) { doKick(groupId, user, 'بلاغات قديمة'); continue }
          if (!isAllowedNumber(user)) { doKick(groupId, user, 'دولة غير مسموحة'); continue }
          try {
            let pp = await sock.profilePictureUrl(user, 'image').catch(() => null)
            if (!pp) { doKick(groupId, user, 'بدون صورة'); continue }
          } catch(e){}
          await sleep(4000)
        }
      }
      if (action === 'join_request') {
        let now = Date.now()
        joinRequests.push(now)
        joinRequests = joinRequests.filter(t => now - t < 20000)
        if (joinRequests.length >= 5) {
          await sock.groupSettingUpdate(groupId, 'announcement')
          joinRequests = []
        }
      }
    } catch(e) { console.log('خطأ participants', e.message) }
  })

  sock.ev.on('messages.upsert', async (m) => {
    try {
      let msg = m.messages[0]
      if (!msg.message) return
      let isSelf = msg.key.fromMe
      let from = msg.key.remoteJid
      let isGroup = from.endsWith('@g.us')
      let sender = msg.key.participant || msg.key.remoteJidAlt || msg.key.remoteJid
      if (String(sender).includes('@lid') && msg.key.remoteJidAlt) sender = msg.key.remoteJidAlt
      if (msg.key.participant && String(msg.key.participant).includes('@lid')) {
        sender = msg.key.participant
        if (msg.key.remoteJidAlt && !String(msg.key.remoteJidAlt).includes('@lid')) sender = msg.key.remoteJidAlt
      }
      let text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || ''
      if (!text) return
      text = text.trim()
      let quotedText = msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.conversation || msg.message.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.text || ''
      if (quotedText && (text.includes('.ابيض') || text.includes('.حظر') || text.includes('.حضر') || text.includes('.فك'))) {
        text = quotedText + '\n' + text
      }
      if (text === '.ping') console.log('PING من:', sender, 'Self:', isSelf)
      if (text.startsWith('3EB0')) {
        if (isGroup) {
          await sock.sendMessage(from, { text: 'تم اكتشاف بوت تبنيد' })
          doKick(from, sender, '3EB0')
        }
        return
      }
      let lower = text.toLowerCase()
      if (lower.includes('.band') || text.includes('تبنيد') || text.includes('باند') || text.includes('فنش') || text.includes('تفجير') || bannedWords.some(w => lower.includes(String(w).toLowerCase()))) {
        if (isGroup && !isOwner(sender) && !isSelf) {
          try { await sock.sendMessage(from, { delete: msg.key }) } catch(e){}
          doKick(from, sender, 'كلمة تبنيد')
          await sock.groupSettingUpdate(from, 'announcement')
          setTimeout(() => sock.groupSettingUpdate(from, 'not_announcement'), 30000)
          return
        }
      }
      if (!isOwner(sender) && !isSelf) return
      if (text === '.ping') {
        await sock.sendMessage(from, { text: 'البوت شغال' })
        return
      }
      if (text.startsWith('.طرد')) {
        if (!isGroup) return
        let nums = getNums(text)
        for (let n of nums) doKick(from, n + '@s.whatsapp.net', 'امر مالك')
        if (nums.length > 0) await sock.sendMessage(from, { text: 'تم طرد ' + nums.length + ' عضو' })
        return
      }
      if (text.startsWith('.حذف')) {
        if (!isGroup) return
        let quoted = msg.message.extendedTextMessage?.contextInfo?.stanzaId
        if (quoted) {
          let key = { remoteJid: from, id: quoted, participant: msg.message.extendedTextMessage.contextInfo.participant }
          await sock.sendMessage(from, { delete: key })
        }
        return
      }
      if (text === '.قفل') {
        if (!isGroup) return
        await sock.groupSettingUpdate(from, 'announcement')
        await sock.sendMessage(from, { text: 'تم قفل القروب' })
        return
      }
      if (text === '.فتح') {
        if (!isGroup) return
        await sock.groupSettingUpdate(from, 'not_announcement')
        await sock.sendMessage(from, { text: 'تم فتح القروب' })
        return
      }
      if (text.includes('.حظر') || text.includes('.حضر')) {
        let nums = getNums(text)
        if (nums.length > 0) {
          let added = 0
          for (let full of nums) {
            full = String(full)
            if (!blacklist.some(x => String(x).slice(-9) === full.slice(-9))) { blacklist.push(full); added++ }
            whitelist = whitelist.filter(x => String(x).slice(-9) !== full.slice(-9))
            if (isGroup) doKick(from, full + '@s.whatsapp.net', 'حظر جماعي')
          }
          save('blacklist.json', blacklist)
          save('whitelist.json', whitelist)
          await sock.sendMessage(from, { text: '⛔ تم حظر ' + added + ' رقم\n' + nums.join(', ') })
        } else {
          await sock.sendMessage(from, { text: 'مافيش ارقام، ابعت الارقام مع .حظر في نفس الرسالة' })
        }
        return
      }
      if (text.includes('.فك')) {
        let nums = getNums(text)
        if (nums.length > 0) {
          for (let full of nums) blacklist = blacklist.filter(x => String(x).slice(-9) !== String(full).slice(-9))
          save('blacklist.json', blacklist)
          await sock.sendMessage(from, { text: 'تم فك ' + nums.length + ' رقم' })
        }
        return
      }
      if (text.includes('.ابيض') || text.includes('.الغاء_ابيض')) {
        let nums = getNums(text)
        if (nums.length > 0) {
          if (text.includes('.الغاء_ابيض')) {
            for (let full of nums) whitelist = whitelist.filter(x => String(x).slice(-9) !== String(full).slice(-9))
            save('whitelist.json', whitelist)
            await sock.sendMessage(from, { text: 'تم الغاء ' + nums.length + ' من البيضاء' })
          } else {
            let added = 0
            for (let full of nums) {
              full = String(full)
              if (!whitelist.some(x => String(x).slice(-9) === full.slice(-9))) { whitelist.push(full); added++ }
              blacklist = blacklist.filter(x => String(x).slice(-9) !== full.slice(-9))
            }
            save('whitelist.json', whitelist)
            save('blacklist.json', blacklist)
            await sock.sendMessage(from, { text: '✅ تم اضافة ' + added + ' رقم للبيضاء\n' + nums.join(', ') })
          }
        } else {
          await sock.sendMessage(from, { text: 'مافيش ارقام، ابعت الارقام مع .ابيض في نفس الرسالة' })
        }
        return
      }
      if (text === '.قائمة' || text === '.قائمه' || text === '.list' || text === '.بيضاء' || text === 'بيضاء') {
        let banned = bannedWords.length > 0 ? bannedWords.join(', ') : 'فاضية'
        let rep = Object.keys(reports).length > 0 ? Object.entries(reports).map(([k,v]) => k + ' (' + v + ')').join(', ') : 'فاضية'
        let out = formatWhitelist() + '\n\n' + formatBlacklist() + '\n\n🚫 *كلمات تبنيد:*\n' + banned + '\n\n⚠️ *بلاغات:*\n' + rep
        await sock.sendMessage(from, { text: out })
        return
      }
      if (text === 'بلاك' || text === '.بلاك') {
        await sock.sendMessage(from, { text: formatBlacklist() })
        return
      }
      if (text === '.بيضاء_فقط') {
        await sock.sendMessage(from, { text: formatWhitelist() })
        return
      }
      if (text.startsWith('.ابلاغ')) {
        if (!isGroup) return
        let nums = getNums(text)
        for (let full of nums) {
          let last = String(full).slice(-9)
          reports[last] = (reports[last] || 0) + 1
          if (reports[last] >= 4) doKick(from, full + '@s.whatsapp.net', '4 بلاغات')
        }
        save('report-history.json', reports)
        await sock.sendMessage(from, { text: 'تم الابلاغ عن ' + nums.length + ' رقم' })
        return
      }
      if (text.startsWith('.band') || text === 'تبنيد') {
        let word = text.replace('.band', '').trim()
        if (word) {
          bannedWords.push(word)
          save('banned.json', bannedWords)
          await sock.sendMessage(from, { text: 'تم اضافة كلمة تبنيد: ' + word })
        }
        return
      }
    } catch(e) { console.log('خطأ رسالة', e.message) }
  })

  setInterval(async () => {
    try {
      if (!sock) return
      let groups = await sock.groupFetchAllParticipating()
      for (let gid in groups) {
        let g = groups[gid]
        let parts = g.participants || []
        for (let p of parts) {
          let id = p.id || p
          let last = getLastDigits(id)
          if (isInList(blacklist, id) || (reports[last] && reports[last] >= 4)) {
            if (!isInList(whitelist, id) && !isOwner(id)) doKick(gid, id, 'تنظيف دوري')
          }
        }
      }
    } catch(e){ console.log('interval err', e.message) }
  }, 30 * 60 * 1000)
}

startBot()
