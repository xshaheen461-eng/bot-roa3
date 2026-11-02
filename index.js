const express = require('express')
const app = express()
app.get('/', (req,res) => res.send('BOT LIVE'))
app.listen(process.env.PORT || 3000)

const { default: makeWASocket, useMultiFileAuthState, delay, Browsers } = require('@whiskeysockets/baileys')
const P = require('pino')
const fs = require('fs')

if (fs.existsSync('./session/creds.json')) {
  try {
    let creds = JSON.parse(fs.readFileSync('./session/creds.json'))
    if (!creds.registered) {
      fs.rmSync('./session', {recursive:true, force:true})
    }
  } catch { fs.rmSync('./session', {recursive:true, force:true}) }
}

async function startBot(){
const { state, saveCreds } = await useMultiFileAuthState('./session')
const sock = makeWASocket({
  auth: state, 
  logger: P({ level: 'silent' }),
  browser: Browsers.macOS('Safari'),
})

sock.ev.on('creds.update', saveCreds)

// يبعت كود جديد كل 40 ثانية بروحه لين تربط
if (!sock.authState.creds.registered){
  setInterval(async () => {
    if (!sock.authState.creds.registered) {
      try {
        let code = await sock.requestPairingCode("218920972444")
        console.log("كود الربط الجديد: " + code)
      } catch(e){}
    }
  }, 40000) // كل 40 ثانية

  // اول كود طول
  await delay(5000)
  let code = await sock.requestPairingCode("218920972444")
  console.log("كود الربط: " + code)
}

sock.ev.on('connection.update', async (u)=>{
  if(u.connection==='open'){ console.log("✅ اشتغل بنجاح") }
  if(u.connection==='close'){
    let code = u.lastDisconnect?.error?.output?.statusCode
    if(code!==401) setTimeout(()=>startBot(),5000)
  }
})
}
startBot()
