const express = require('express')
const app = express()
const QRCode = require('qrcode')
let lastQR = ""

app.get('/', (req,res) => res.send('<h1>BOT LIVE</h1><a href="/qr">شوف الـ QR</a>'))
app.get('/qr', async (req,res) => {
  if(!lastQR) return res.send('استنى 10 ثواني ودير تحديث...')
  let img = await QRCode.toDataURL(lastQR)
  res.send(`<img src="${img}" style="width:300px"><br><br><h2>افتح واتساب > الاجهزة المرتبطة > ربط جهاز > امسح هذا</h2><script>setTimeout(()=>location.reload(),15000)</script>`)
})
app.listen(process.env.PORT || 3000)

const { default: makeWASocket, useMultiFileAuthState, Browsers } = require('@whiskeysockets/baileys')
const P = require('pino')

async function startBot(){
const { state, saveCreds } = await useMultiFileAuthState('./session')
const sock = makeWASocket({
  auth: state, logger: P({ level: 'silent' }),
  browser: Browsers.macOS('Safari'),
  printQRInTerminal: false
})
sock.ev.on('creds.update', saveCreds)

sock.ev.on('connection.update', async (u)=>{
  if(u.qr){ lastQR = u.qr; console.log("فيه QR جديد، خش على موقعك وشوفه") }
  if(u.connection==='open'){ console.log("✅ تم الربط بنجاح!"); lastQR="" }
  if(u.connection==='close'){ setTimeout(()=>startBot(),3000) }
})
}
startBot()
