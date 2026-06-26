const express = require('express')
const router = express.Router()
const supabase = require('../db/supabase')
const { verificarToken, soloAdmin } = require('../middleware/authMiddleware')

// SOLICITAR retiro (usuario)
router.post('/', verificarToken, async (req, res) => {
  const { monto, metodo, datos_pago } = req.body
  if (!monto || monto < 10000) return res.status(400).json({ error: 'El retiro mínimo es $10.000' })
  if (!metodo) return res.status(400).json({ error: 'Selecciona un método de retiro' })
  if (!datos_pago) return res.status(400).json({ error: 'Ingresa los datos de pago' })
  try {
    const { data: usuario } = await supabase.from('usuarios').select('saldo').eq('id', req.usuario.id).single()
    if (!usuario || usuario.saldo < monto) return res.status(400).json({ error: 'Saldo insuficiente' })

    // Descontar saldo inmediatamente
    await supabase.from('usuarios').update({ saldo: usuario.saldo - monto }).eq('id', req.usuario.id)

    // Registrar movimiento
    await supabase.from('movimientos').insert([{
      usuario_id: req.usuario.id,
      tipo: 'retiro_solicitado',
      monto: -monto,
      descripcion: `Retiro solicitado via ${metodo}`
    }])

    const { data, error } = await supabase
      .from('retiros')
      .insert([{ usuario_id: req.usuario.id, monto, metodo, datos_pago }])
      .select()
      .single()
    if (error) return res.status(500).json({ error: error.message })
    res.json({ success: true, retiro: data, mensaje: 'Solicitud enviada. El admin procesará tu retiro pronto.' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// MIS RETIROS (usuario)
router.get('/mis-retiros', verificarToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('retiros')
      .select('*')
      .eq('usuario_id', req.usuario.id)
      .order('created_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET retiros pendientes (admin)
router.get('/pendientes', verificarToken, soloAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('retiros')
      .select('*, usuario:usuario_id(nombre, email, celular)')
      .eq('estado', 'pendiente')
      .order('created_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// APROBAR retiro (admin)
router.post('/:id/aprobar', verificarToken, soloAdmin, async (req, res) => {
  try {
    await supabase.from('retiros').update({
      estado: 'aprobado',
      procesado_por: req.usuario.id,
      procesado_at: new Date().toISOString()
    }).eq('id', req.params.id)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// RECHAZAR retiro (admin) - devolver saldo
router.post('/:id/rechazar', verificarToken, soloAdmin, async (req, res) => {
  try {
    const { data: retiro } = await supabase.from('retiros').select('*').eq('id', req.params.id).single()
    if (!retiro) return res.status(404).json({ error: 'Retiro no encontrado' })

    await supabase.from('retiros').update({ estado: 'rechazado' }).eq('id', req.params.id)

    // Devolver saldo al usuario
    const { data: usuario } = await supabase.from('usuarios').select('saldo').eq('id', retiro.usuario_id).single()
    await supabase.from('usuarios').update({ saldo: (usuario.saldo || 0) + retiro.monto }).eq('id', retiro.usuario_id)

    await supabase.from('movimientos').insert([{
      usuario_id: retiro.usuario_id,
      tipo: 'retiro_rechazado',
      monto: retiro.monto,
      descripcion: 'Retiro rechazado — saldo devuelto'
    }])

    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
