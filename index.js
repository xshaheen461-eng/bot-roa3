const express = require('express')
const app = express()
app.get('/', (req,res) => res.send('BOT LIVE'))
app.listen(process.env.PORT || 3000)

const { default: makeWASocket, useMultiFileAuthState, delay, Browsers } = require('@whiskeysockets/baileys')
const P = require('pino')

async function startBot(){
const { state, saveCreds } = await useMultiFileAuthState('./session')
const sock = makeWASocket({
  auth: state, 
  logger: P({ level: 'silent' }),
  browser: Browsers.macOS('Desktop'),
  printQRInTerminal: false
})
sock.ev.on('creds.update', saveCreds)

if (!sock.authState.creds.registered){
  await delay(5000)
  let code = await sock.requestPairingCode("218920972444")
  console.log("==========")
  console.log("كود الربط النهائي: " + code)
  console.log("عندك 3 دقايق باش تربط")
  console.log("==========")
  // معاش نعاود نطلب، نستنى بس
  return
}

sock.ev.on('connection.update', (u)=>{
  if(u.connection==='open') console.log("✅ تم الربط بنجاح!")
})
}
startBot()
