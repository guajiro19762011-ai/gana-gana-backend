const express = require('express')
const router = express.Router()
const supabase = require('../db/supabase')
const { verificarToken, soloAdmin } = require('../middleware/authMiddleware')
const twilio = require('twilio')

router.use(verificarToken, soloAdmin)

const enviarWhatsApp = async (celular, mensaje) => {
  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: `whatsapp:+57${celular}`,
      body: mensaje
    })
    console.log(`✅ WhatsApp enviado a ${celular}`)
  } catch (err) {
    console.error('Error enviando WhatsApp:', err.message)
  }
}

// STATS
router.get('/stats', async (req, res) => {
  try {
    const { count: usuarios } = await supabase.from('usuarios').select('*', { count: 'exact', head: true }).eq('rol', 'cliente')
    const { count: boletas } = await supabase.from('boletas').select('*', { count: 'exact', head: true })
    const { count: recargas_pendientes } = await supabase.from('recargas').select('*', { count: 'exact', head: true }).eq('estado', 'pendiente')
    const { count: retiros_pendientes } = await supabase.from('retiros').select('*', { count: 'exact', head: true }).eq('estado', 'pendiente')
    const { data: sorteo } = await supabase.from('sorteos').select('*').eq('estado', 'activo').single()
    res.json({ usuarios, boletas, recargas_pendientes, retiros_pendientes, sorteo })
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener estadísticas' })
  }
})

// HISTORIAL DE SORTEOS
router.get('/sorteos/historial', async (req, res) => {
  try {
    const { data, error } = await supabase.from('sorteos').select('*').order('created_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GANADORES DE UN SORTEO
router.get('/sorteos/:id/ganadores', async (req, res) => {
  try {
    const { data, error } = await supabase.from('ganadores').select('*, usuarios(nombre, email)').eq('sorteo_id', req.params.id).order('premio', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// RECARGAS pendientes
router.get('/recargas', async (req, res) => {
  try {
    const { data, error } = await supabase.from('recargas').select('*, usuario:usuario_id(nombre, email, celular)').eq('estado', 'pendiente').order('created_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// APROBAR recarga
router.post('/recargas/:id/aprobar', async (req, res) => {
  const { id } = req.params
  try {
    const { data: recarga } = await supabase.from('recargas').select('*').eq('id', id).single()
    if (!recarga) return res.status(404).json({ error: 'Recarga no encontrada' })
    await supabase.from('recargas').update({ estado: 'aprobada', aprobado_por: req.usuario.id, aprobado_at: new Date().toISOString() }).eq('id', id)
    const { data: usuario } = await supabase.from('usuarios').select('saldo, nombre, celular').eq('id', recarga.usuario_id).single()
    await supabase.from('usuarios').update({ saldo: (usuario.saldo || 0) + recarga.monto }).eq('id', recarga.usuario_id)
    await supabase.from('movimientos').insert([{ usuario_id: recarga.usuario_id, tipo: 'recarga', monto: recarga.monto, descripcion: 'Recarga aprobada por admin via ' + recarga.metodo, referencia_id: String(id) }])

    // Notificar por WhatsApp
    await enviarWhatsApp(usuario.celular,
      `🎟️ *GANA GANA O GANA*\n\n¡Hola ${usuario.nombre}! ✅\n\nTu recarga de *$${recarga.monto.toLocaleString('es-CO')} COP* ha sido aprobada y ya está disponible en tu billetera.\n\n¡Compra tu boleta y participa! 🍀`
    )
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Error al aprobar recarga' })
  }
})

// RECHAZAR recarga
router.post('/recargas/:id/rechazar', async (req, res) => {
  try {
    await supabase.from('recargas').update({ estado: 'rechazada' }).eq('id', req.params.id)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// CALCULAR GANADORES
router.post('/sorteo/ganadores', async (req, res) => {
  const { numero } = req.body
  if (!/^\d{4}$/.test(numero)) return res.status(400).json({ error: 'Número inválido' })
  try {
    const d = numero.split('')
    const ganadores = []
    const { data: sorteo } = await supabase.from('sorteos').select('*').eq('estado', 'activo').single()
    if (!sorteo) return res.status(404).json({ error: 'No hay sorteo activo' })

    const { data: mayor } = await supabase.from('numeros_tomados').select('*, usuarios(id, nombre, email, celular)').eq('sorteo_id', sorteo.id).eq('numero', numero)
    if (mayor && mayor.length > 0) mayor.forEach(m => ganadores.push({ numero, categoria: 'Premio Mayor', premio: 2000000, nombre: m.usuarios?.nombre, email: m.usuarios?.email, celular: m.usuarios?.celular, usuario_id: m.usuarios?.id }))

    for (let x = 0; x <= 9; x++) {
      const n = d[0] + d[1] + d[2] + x
      if (n === numero) continue
      const { data } = await supabase.from('numeros_tomados').select('*, usuarios(id, nombre, email, celular)').eq('sorteo_id', sorteo.id).eq('numero', n)
      if (data && data.length > 0) data.forEach(m => ganadores.push({ numero: n, categoria: '3 Primeras', premio: 80000, nombre: m.usuarios?.nombre, email: m.usuarios?.email, celular: m.usuarios?.celular, usuario_id: m.usuarios?.id }))
    }

    for (let x = 0; x <= 9; x++) {
      const n = x + d[1] + d[2] + d[3]
      if (n === numero) continue
      const { data } = await supabase.from('numeros_tomados').select('*, usuarios(id, nombre, email, celular)').eq('sorteo_id', sorteo.id).eq('numero', n)
      if (data && data.length > 0) data.forEach(m => ganadores.push({ numero: n, categoria: '3 Últimas', premio: 80000, nombre: m.usuarios?.nombre, email: m.usuarios?.email, celular: m.usuarios?.celular, usuario_id: m.usuarios?.id }))
    }

    const excluidos = new Set([numero])
    for (let x = 0; x <= 9; x++) excluidos.add(d[0] + d[1] + d[2] + x)
    for (let x = 0; x <= 9; x++) excluidos.add(x + d[1] + d[2] + d[3])

    for (let a = 0; a <= 9; a++) {
      for (let b = 0; b <= 9; b++) {
        const n = String(a) + String(b) + d[2] + d[3]
        if (excluidos.has(n)) continue
        const { data } = await supabase.from('numeros_tomados').select('*, usuarios(id, nombre, email, celular)').eq('sorteo_id', sorteo.id).eq('numero', n)
        if (data && data.length > 0) data.forEach(m => ganadores.push({ numero: n, categoria: '2 Últimas', premio: 5000, nombre: m.usuarios?.nombre, email: m.usuarios?.email, celular: m.usuarios?.celular, usuario_id: m.usuarios?.id }))
      }
    }

    res.json(ganadores)
  } catch (err) {
    res.status(500).json({ error: 'Error al calcular ganadores' })
  }
})

// PAGAR PREMIO + NOTIFICAR POR WHATSAPP
router.post('/sorteo/pagar-premio', async (req, res) => {
  const { usuario_id, premio, categoria, numero, celular } = req.body
  if (!usuario_id || !premio || !categoria) return res.status(400).json({ error: 'Datos incompletos' })
  try {
    const { data: sorteo } = await supabase.from('sorteos').select('*').eq('estado', 'activo').single()
    const { data: usuario } = await supabase.from('usuarios').select('saldo, nombre, celular').eq('id', usuario_id).single()
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' })

    await supabase.from('usuarios').update({ saldo: (usuario.saldo || 0) + premio }).eq('id', usuario_id)
    await supabase.from('movimientos').insert([{ usuario_id, tipo: 'premio', monto: premio, descripcion: `Premio ${categoria} - número ${numero}`, referencia_id: numero }])

    if (sorteo) {
      await supabase.from('ganadores').insert([{ sorteo_id: sorteo.id, usuario_id, numero, categoria, premio, boleta_id: 1 }])
      await supabase.from('sorteos').update({ premios_pagados: (sorteo.premios_pagados || 0) + premio }).eq('id', sorteo.id)
    }

    // Mensaje según categoría
    const mensajes = {
      'Premio Mayor': `🏆 *¡GANASTE EL PREMIO MAYOR!* 🏆\n\n¡Felicitaciones ${usuario.nombre}! 🎉\n\nTu número *${numero}* ganó el *Premio Mayor* del sorteo.\n\n💰 *$${premio.toLocaleString('es-CO')} COP* han sido acreditados a tu billetera en GANA GANA O GANA.\n\n¡Muchas gracias por participar! 🍀`,
      '3 Primeras': `🥈 *¡GANASTE UN PREMIO!* 🥈\n\n¡Felicitaciones ${usuario.nombre}! 🎉\n\nTu número *${numero}* ganó el premio de *3 primeras cifras*.\n\n💰 *$${premio.toLocaleString('es-CO')} COP* han sido acreditados a tu billetera.\n\n¡Sigue participando! 🍀`,
      '3 Últimas': `🥉 *¡GANASTE UN PREMIO!* 🥉\n\n¡Felicitaciones ${usuario.nombre}! 🎉\n\nTu número *${numero}* ganó el premio de *3 últimas cifras*.\n\n💰 *$${premio.toLocaleString('es-CO')} COP* han sido acreditados a tu billetera.\n\n¡Sigue participando! 🍀`,
      '2 Últimas': `🎁 *¡GANASTE UNA BOLETA GRATIS!* 🎁\n\n¡Felicitaciones ${usuario.nombre}! 🎉\n\nTu número *${numero}* coincidió con las *2 últimas cifras*.\n\n¡Tu boleta gratis ha sido acreditada a tu billetera! 🍀`,
    }

    const celularFinal = celular || usuario.celular
    await enviarWhatsApp(celularFinal, mensajes[categoria] || `🎉 ¡Ganaste $${premio.toLocaleString('es-CO')} COP! Ya está en tu billetera.`)

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Error al pagar premio' })
  }
})

// CERRAR SORTEO E INICIAR NUEVO
router.post('/sorteo/cerrar', async (req, res) => {
  const { numero_ganador } = req.body
  if (!numero_ganador) return res.status(400).json({ error: 'Número ganador requerido' })
  try {
    const { data: sorteo } = await supabase.from('sorteos').select('*').eq('estado', 'activo').single()
    if (!sorteo) return res.status(404).json({ error: 'No hay sorteo activo' })

    const recaudo = sorteo.recaudo_actual || (sorteo.total_boletas * 5000)
    const premios = sorteo.premios_pagados || 0
    const utilidad = recaudo - premios

    await supabase.from('sorteos').update({ estado: 'jugado', numero_ganador, jugado_at: new Date().toISOString(), saldo_acumulado: utilidad }).eq('id', sorteo.id)

    const { data: anteriores } = await supabase.from('sorteos').select('saldo_acumulado').eq('estado', 'jugado')
    const saldoTotal = anteriores?.reduce((acc, s) => acc + (s.saldo_acumulado || 0), 0) || 0

    const nuevoNumero = sorteo.id + 1
    const { data: nuevoSorteo } = await supabase.from('sorteos').insert([{ nombre: `Sorteo #${String(nuevoNumero).padStart(4,'0')}`, estado: 'activo', total_boletas: 0, recaudo_actual: 0, premios_pagados: 0 }]).select().single()

    res.json({ success: true, utilidad, saldo_total: saldoTotal, nuevo_sorteo: nuevoSorteo })
  } catch (err) {
    res.status(500).json({ error: 'Error al cerrar sorteo: ' + err.message })
  }
})

// LISTAR USUARIOS
router.get('/usuarios', async (req, res) => {
  try {
    const { data, error } = await supabase.from('usuarios').select('id, nombre, email, celular, codigo_referido, saldo, rol, activo, created_at').order('created_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// EDITAR USUARIO
router.put('/usuarios/:id', async (req, res) => {
  const { nombre, celular, email, saldo, activo } = req.body
  try {
    const updates = {}
    if (nombre !== undefined) updates.nombre = nombre
    if (celular !== undefined) updates.celular = celular
    if (email !== undefined) updates.email = email
    if (saldo !== undefined) updates.saldo = saldo
    if (activo !== undefined) updates.activo = activo
    const { data, error } = await supabase.from('usuarios').update(updates).eq('id', req.params.id).select().single()
    if (error) return res.status(500).json({ error: error.message })
    res.json({ success: true, usuario: data })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ELIMINAR USUARIO
router.delete('/usuarios/:id', async (req, res) => {
  try {
    await supabase.from('usuarios').delete().eq('id', req.params.id)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// RECARGAR SALDO MANUAL
router.post('/usuarios/:id/recargar', async (req, res) => {
  const { monto, descripcion } = req.body
  if (!monto || monto <= 0) return res.status(400).json({ error: 'Monto inválido' })
  try {
    const { data: usuario } = await supabase.from('usuarios').select('saldo, nombre, celular').eq('id', req.params.id).single()
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' })
    await supabase.from('usuarios').update({ saldo: (usuario.saldo || 0) + monto }).eq('id', req.params.id)
    await supabase.from('movimientos').insert([{ usuario_id: req.params.id, tipo: 'recarga_admin', monto, descripcion: descripcion || 'Recarga manual por administrador' }])

    await enviarWhatsApp(usuario.celular,
      `🎟️ *GANA GANA O GANA*\n\n¡Hola ${usuario.nombre}! ✅\n\nEl administrador ha recargado *$${monto.toLocaleString('es-CO')} COP* a tu billetera.\n\n¡Ya puedes comprar tu boleta! 🍀`
    )
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// BOLETAS DE UN USUARIO
router.get('/usuarios/:id/boletas', async (req, res) => {
  try {
    const { data, error } = await supabase.from('boletas').select('*, sorteos(nombre, estado, numero_ganador)').eq('usuario_id', req.params.id).order('created_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
