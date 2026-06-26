const twilio = require('twilio')

const client = twilio('AC437af0add95bd954b8f8b4af0b66dd8c', '37c22acb2f3e57d023adf0399dff0bd2')

client.messages.create({
  from: 'whatsapp:+14155238886',
  to: 'whatsapp:+573002396372',
  body: '🎟️ Prueba de WhatsApp desde GANA GANA O GANA ✅'
}).then(m => console.log('✅ Enviado:', m.sid))
  .catch(e => console.error('❌ Error:', e.message))
