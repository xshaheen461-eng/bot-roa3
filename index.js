
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys')
const pino = require('pino')
const express = require('express')
const fs = require('fs')
const qrcode = require('qrcode')

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
let whitelist = load('whitelist.json', [])
let blacklist = load('blacklist.json', [])
let reports = load('report-history.json', {})
let bannedWords = load('banned.json', [])

const ALLOWED_CODES = ['218','20','212','213','216','222','249','211','252','253','269','967','966','971','974','965','973','968','962','961','963','964','970']

function getLastDigits(jid) {
  if (!jid) return ''
  let d = jid.replace(/\D/g, '')
  return d.slice(-9)
}
function isOwner(jid) {
  if (!jid) return false
  if (OWNER_LID && jid.includes(OWNER_LID)) return true
  if (jid.includes('@lid')) return false
  let d = jid.replace(/\D/g, '')
  if (!OWNER_NUMBER) return false
  return d.includes(OWNER_NUMBER) || d.endsWith(OWNER_NUMBER.slice(-9))
}
// ===== جديد: يطلع كل الارقام من الرسالة =====
function getNums(text) {
  if (!text) return []
  // يطلع اي مجموعة ارقام من 9 ل 15 رقم
  let matches = text.match(/\d{9,15}/g) || []
  // ناخد اخر 9 ارقام من كل رقم، ونحيد التكرار
  let out = [...new Set(matches.map(n => n.slice(-9)))]
  // نحيد الارقام اللي هي اوامر او قصيرة
  return out.filter(n => n.length === 9)
}
function getNum(text) {
  let all = getNums(text)
  return all[0] || ''
}
function isAllowedNumber(jid) {
  if (!jid) return false
  if (jid.includes('@lid')) return true
  let d = jid.replace(/\D/g, '')
  for (let c of ALLOWED_CODES) { if (d.startsWith(c)) return true }
  return false
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

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
          if (p.includes(BOT_NUMBER) || getLastDigits(p) === BOT_NUMBER.slice(-9)) {
            let actor = anu.author || ''
            if (!isOwner(actor)) {
              await sock.groupParticipantsUpdate(groupId, [actor], 'remove')
            }
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
            try {
              await sock.groupSettingUpdate(groupId, 'not_announcement')
              await sock.groupRevokeInvite(groupId)
            } catch(e){}
          }, 5 * 60 * 1000)
          joins = []
          return
        }
        for (let user of participants) {
          if (blacklist.includes(getLastDigits(user)) || blacklist.includes(user)) {
            doKick(groupId, user, 'بلاك')
            continue
          }
          if (whitelist.includes(getLastDigits(user))) continue
          let d = getLastDigits(user)
          if (reports[d] && reports[d] >= 4) {
            doKick(groupId, user, 'بلاغات قديمة')
            continue
          }
          if (!isAllowedNumber(user)) {
            doKick(groupId, user, 'دولة غير مسموحة')
            continue
          }
          try {
            let pp = await sock.profilePictureUrl(user, 'image').catch(() => null)
            if (!pp) {
              doKick(groupId, user, 'بدون صورة')
              continue
            }
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
      if (sender.includes('@lid') && msg.key.remoteJidAlt) sender = msg.key.remoteJidAlt
      if (msg.key.participant && msg.key.participant.includes('@lid')) {
        sender = msg.key.participant
        if (msg.key.remoteJidAlt && !msg.key.remoteJidAlt.includes('@lid')) sender = msg.key.remoteJidAlt
      }

      let text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || ''
      if (!text) return
      text = text.trim()

      // لو رديت على رسالة فيها ارقام، خود الارقام من الرسالة الاصلية
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
      if (lower.includes('.band') || text.includes('تبنيد') || text.includes('باند') || text.includes('فنش') || text.includes('تفجير') || bannedWords.some(w => lower.includes(w.toLowerCase()))) {
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

      // ===== حظر جماعي =====
      if (text.includes('.حظر') || text.includes('.حضر')) {
        let nums = getNums(text)
        if (nums.length > 0) {
          let added = 0
          for (let last of nums) {
            if (!blacklist.includes(last)) { blacklist.push(last); added++ }
            // لو كان في البيضاء نحيه منها
            whitelist = whitelist.filter(x => x !== last)
            if (isGroup) doKick(from, last + '@s.whatsapp.net', 'حظر جماعي')
          }
          save('blacklist.json', blacklist)
          save('whitelist.json', whitelist)
          await sock.sendMessage(from, { text: '⛔ تم حظر ' + added + ' رقم\n' + nums.join(', ') })
        } else {
          await sock.sendMessage(from, { text: 'مافيش ارقام، ابعت الارقام مع .حظر في نفس الرسالة' })
        }
        return
      }

      // ===== فك حظر جماعي =====
      if (text.includes('.فك')) {
        let nums = getNums(text)
        if (nums.length > 0) {
          for (let last of nums) blacklist = blacklist.filter(x => x !== last)
          save('blacklist.json', blacklist)
          await sock.sendMessage(from, { text: 'تم فك ' + nums.length + ' رقم' })
        }
        return
      }

      // ===== بيضاء جماعي =====
      if (text.includes('.ابيض') || text.includes('.الغاء_ابيض')) {
        let nums = getNums(text)
        if (nums.length > 0) {
          if (text.includes('.الغاء_ابيض')) {
            for (let last of nums) whitelist = whitelist.filter(x => x !== last)
            save('whitelist.json', whitelist)
            await sock.sendMessage(from, { text: 'تم الغاء ' + nums.length + ' من البيضاء' })
          } else {
            let added = 0
            for (let last of nums) {
              if (!whitelist.includes(last)) { whitelist.push(last); added++ }
              // لو كان في البلاك نحيه
              blacklist = blacklist.filter(x => x !== last)
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

      // ===== القائمة الكاملة =====
      if (text === '.قائمة' || text === '.قائمه' || text === '.list' || text === '.بيضاء' || text === 'بيضاء') {
        let white = whitelist.length > 0 ? whitelist.join(', ') : 'فاضية'
        let black = blacklist.length > 0 ? blacklist.join(', ') : 'فاضية'
        let banned = bannedWords.length > 0 ? bannedWords.join(', ') : 'فاضية'
        let rep = Object.keys(reports).length > 0 ? Object.entries(reports).map(([k,v]) => k + ' (' + v + ')').join(', ') : 'فاضية'
        await sock.sendMessage(from, { text: '📋 *القوائم*\n\n✅ *بيضاء:*\n' + white + '\n\n⛔ *بلاك:*\n' + black + '\n\n🚫 *كلمات تبنيد:*\n' + banned + '\n\n⚠️ *بلاغات:*\n' + rep })
        return
      }

      if (text === 'بلاك') {
        await sock.sendMessage(from, { text: 'البلاك: ' + blacklist.join(', ') })
        return
      }

      if (text.startsWith('.ابلاغ')) {
        if (!isGroup) return
        let nums = getNums(text)
        for (let last of nums) {
          reports[last] = (reports[last] || 0) + 1
          if (reports[last] >= 4) doKick(from, last + '@s.whatsapp.net', '4 بلاغات')
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
      let groups = await sock.groupFetchAllParticipating()
      for (let gid in groups) {
        let g = groups[gid]
        let parts = g.participants || []
        for (let p of parts) {
          let id = p.id || p
          let last = getLastDigits(id)
          if (blacklist.includes(last) || (reports[last] && reports[last] >= 4)) {
            if (!whitelist.includes(last) && !isOwner(id)) {
              doKick(gid, id, 'تنظيف دوري')
            }
          }
        }
      }
    } catch(e){}
  }, 30 * 60 * 1000)
}

startBot()
