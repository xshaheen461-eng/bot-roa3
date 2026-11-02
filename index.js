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
  browser: Browsers.macOS('Safari'),
  printQRInTerminal: false
})

sock.ev.on('creds.update', saveCreds)

if (!sock.authState.creds.registered){
  await delay(4000)
  try{ 
    let code = await sock.requestPairingCode("218920972444")
    console.log("كود الربط: " + code)
  }catch(e){ 
    console.log("فشل الطلب، نعاود المحاولة... " + e.message)
    setTimeout(()=>startBot(), 10000)
    return
  }
}

sock.ev.on('connection.update', async (u)=>{
  if(u.connection==='open'){ console.log("✅ اشتغل بنجاح") }
  if(u.connection==='close'){
    let reason = u.lastDisconnect?.error?.output?.statusCode
    if(reason !== 401) {
      console.log("اعادة تشغيل...")
      setTimeout(()=>startBot(),5000)
    }
  }
})
}
startBot()

// باش ما يطيحش البوت مع اي خطا
process.on('uncaughtException', (e)=>{ console.log("خطا: " + e.message) })
process.on('unhandledRejection', (e)=>{ console.log("رفض: " + e.message) })
