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

// ===== الارقام =====
const OWNER_NUMBER = (process.env.OWNER_NUMBER || "").replace(/\D/g, '')
const OWNER_LID = (process.env.OWNER_LID || "").trim()
const BOT_NUMBER = (process.env.BOT_NUMBER || "").replace(/\D/g, '')

// ===== ملفات =====
function load(f, def) { try { if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f)) } catch(e){} return def }
function save(f, d) { fs.writeFileSync(f, JSON.stringify(d)) }
let whitelist = load('whitelist.json', [])
let blacklist = load('blacklist.json', [])
let reports = load('report-history.json', {})
let bannedWords = load('banned.json', [])

// ===== فلتر الدول - العربية بس =====
const ALLOWED_CODES = ['218','20','212','213','216','222','249','211','252','253','269','967','966','971','974','965','973','968','962','961','963','964','970']

// ===== دوال مساعدة =====
function getLastDigits(jid) {
  if (!jid) return ''
  let d = jid.replace(/\D/g, '')
  return d.slice(-9)
}
function isOwner(jid) {
  if (!jid) return false
  if (OWNER_LID && jid.includes(OWNER_LID)) return true
  // لو LID وما عندناش LID محفوظ، ما نعرفوش
  if (jid.includes('@lid')) return false
  let d = jid.replace(/\D/g, '')
  if (!OWNER_NUMBER) return false
  return d.includes(OWNER_NUMBER) || d.endsWith(OWNER_NUMBER.slice(-9))
}
function getNum(text) {
  if (!text) return ''
  let m = text.replace(/\D/g, '')
  return m
}
function isAllowedNumber(jid) {
  if (!jid) return false
  if (jid.includes('@lid')) return true // LID نخليه لين نتأكد، ما نطردوش بالغلط
  let d = jid.replace(/\D/g, '')
  for (let c of ALLOWED_CODES) { if (d.startsWith(c)) return true }
  // لو رقم قصير (LID) نعتبره مسموح مبدئيا
  return false
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// ===== طرد بطيء ضد الباند =====
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
    await sleep(8000) // واحد كل 8 ثواني
  }
  kicking = false
}

// ===== الفيضان =====
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

  // ===== دخول وخروج =====
  sock.ev.on('group-participants.update', async (anu) => {
    try {
      let groupId = anu.id
      let action = anu.action
      let participants = anu.participants || []

      // حماية سحب الاشراف
      if (action === 'demote') {
        for (let p of participants) {
          if (p.includes(BOT_NUMBER) || getLastDigits(p) === BOT_NUMBER.slice(-9)) {
            let actor = anu.author || ''
            console.log('حد سحب الاشراف من البوت:', actor)
            if (!isOwner(actor)) {
              await sock.groupParticipantsUpdate(groupId, [actor], 'remove')
            }
          }
        }
        return
      }

      if (action === 'add') {
        // فيضان: 10 دخول في 20 ثانية
        let now = Date.now()
        joins.push(now)
        joins = joins.filter(t => now - t < 20000)
        if (joins.length >= 10) {
          await sock.sendMessage(groupId, { text: 'تم اكتشاف فيضان، القروب تقفل 5 دقايق' })
          await sock.groupSettingUpdate(groupId, 'announcement')
          setTimeout(async () => {
            try {
              await sock.groupSettingUpdate(groupId, 'not_announcement')
              let code = await sock.groupInviteCode(groupId)
              await sock.groupRevokeInvite(groupId)
              console.log('تم فتح القروب وتغيير الرابط')
            } catch(e){}
          }, 5 * 60 * 1000)
          joins = []
          return
        }

        for (let user of participants) {
          // لو في البلاك
          if (blacklist.includes(getLastDigits(user)) || blacklist.includes(user)) {
            doKick(groupId, user, 'بلاك')
            continue
          }
          // لو في البيضاء
          if (whitelist.includes(getLastDigits(user))) continue

          // لو بلاغات قديمة 4+
          let d = getLastDigits(user)
          if (reports[d] && reports[d] >= 4) {
            doKick(groupId, user, 'بلاغات قديمة')
            continue
          }

          // فلتر الدول
          if (!isAllowedNumber(user)) {
            doKick(groupId, user, 'دولة غير مسموحة')
            continue
          }

          // بدون صورة
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

  // ===== الرسائل =====
  sock.ev.on('messages.upsert', async (m) => {
    try {
      let msg = m.messages[0]
      if (!msg.message) return
      if (msg.key.fromMe) return

      let from = msg.key.remoteJid
      let isGroup = from.endsWith('@g.us')
      // هنا التصليح: ناخد LID ونحاول نجيب الرقم الحقيقي من remoteJidAlt
      let sender = msg.key.participant || msg.key.remoteJidAlt || msg.key.remoteJid
      // لو المشارك LID، جرب البديل
      if (sender.includes('@lid') && msg.key.remoteJidAlt) {
        sender = msg.key.remoteJidAlt
      }
      // لو مازال LID، خلي الاصلي باش نقارنه بـ OWNER_LID
      if (msg.key.participant && msg.key.participant.includes('@lid')) {
        sender = msg.key.participant
        if (msg.key.remoteJidAlt && !msg.key.remoteJidAlt.includes('@lid')) {
          sender = msg.key.remoteJidAlt
        }
      }

      let text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || ''
      if (!text) return
      text = text.trim()

      // لمعرفة LID متاعك - ابعت .ping وشوف Logs
      if (text === '.ping') console.log('PING من:', msg.key.participant, 'Alt:', msg.key.remoteJidAlt, 'Sender:', sender)

      // مفتاح 3EB0 - طرد بوت تبنيد
      if (text.startsWith('3EB0')) {
        if (isGroup) {
          await sock.sendMessage(from, { text: 'تم اكتشاف بوت تبنيد' })
          doKick(from, sender, '3EB0')
        }
        return
      }

      // كلمات التبنيد
      let lower = text.toLowerCase()
      if (lower.includes('.band') || text.includes('تبنيد') || text.includes('باند') || text.includes('فنش') || text.includes('تفجير') || bannedWords.some(w => lower.includes(w.toLowerCase()))) {
        if (isGroup && !isOwner(sender)) {
          try { await sock.sendMessage(from, { delete: msg.key }) } catch(e){}
          doKick(from, sender, 'كلمة تبنيد')
          await sock.groupSettingUpdate(from, 'announcement')
          setTimeout(() => sock.groupSettingUpdate(from, 'not_announcement'), 30000)
          return
        }
      }

      // اوامر المالك فقط
      if (!isOwner(sender)) return

      // ===== اوامر المالك =====
      if (text === '.ping') {
        await sock.sendMessage(from, { text: 'البوت شغال' })
        return
      }

      if (text.startsWith('.طرد')) {
        if (!isGroup) return
        let num = getNum(text)
        let target = num + '@s.whatsapp.net'
        doKick(from, target, 'امر مالك')
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

      if (text.startsWith('.حظر') || text.startsWith('.حضر')) {
        let num = getNum(text)
        if (num) {
          let last = num.slice(-9)
          if (!blacklist.includes(last)) blacklist.push(last)
          save('blacklist.json', blacklist)
          await sock.sendMessage(from, { text: 'تم حظر ' + num })
          if (isGroup) doKick(from, num + '@s.whatsapp.net', 'حظر')
        }
        return
      }

      if (text.startsWith('.فك')) {
        let num = getNum(text)
        if (num) {
          let last = num.slice(-9)
          blacklist = blacklist.filter(x => x !== last && x !== num)
          save('blacklist.json', blacklist)
          await sock.sendMessage(from, { text: 'تم فك ' + num })
        }
        return
      }

      if (text.startsWith('.ابيض') || text.startsWith('.الغاء_ابيض') || text === 'بيضاء') {
        let num = getNum(text)
        if (text === 'بيضاء') {
          await sock.sendMessage(from, { text: 'القائمة البيضاء: ' + whitelist.join(', ') })
          return
        }
        if (num) {
          let last = num.slice(-9)
          if (text.startsWith('.الغاء_ابيض')) {
            whitelist = whitelist.filter(x => x !== last)
            await sock.sendMessage(from, { text: 'تم الغاء من البيضاء ' + num })
          } else {
            if (!whitelist.includes(last)) whitelist.push(last)
            await sock.sendMessage(from, { text: 'تم اضافة للبيضاء ' + num })
          }
          save('whitelist.json', whitelist)
        }
        return
      }

      if (text === 'بلاك') {
        await sock.sendMessage(from, { text: 'البلاك: ' + blacklist.join(', ') })
        return
      }

      if (text.startsWith('.ابلاغ')) {
        if (!isGroup) return
        let num = getNum(text)
        if (num) {
          let last = num.slice(-9)
          reports[last] = (reports[last] || 0) + 1
          save('report-history.json', reports)
          await sock.sendMessage(from, { text: 'تم الابلاغ عن ' + num + ' عدد البلاغات: ' + reports[last] })
          if (reports[last] >= 4) {
            doKick(from, num + '@s.whatsapp.net', '4 بلاغات')
          }
        }
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

  // ===== فحص كل 10 دقايق =====
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
  }, 10 * 60 * 1000)
}

startBot()
