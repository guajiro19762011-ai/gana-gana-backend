const express = require('express')
const router = express.Router()
const supabase = require('../db/supabase')
const { verificarToken } = require('../middleware/authMiddleware')

router.use(verificarToken)

// GET saldo y movimientos
router.get('/', async (req, res) => {
  try {
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('saldo, nombre, codigo_referido, rol, solicitud_revendedor')
      .eq('id', req.usuario.id)
      .single()

    const { data: movimientos } = await supabase
      .from('movimientos')
      .select('*')
      .eq('usuario_id', req.usuario.id)
      .order('created_at', { ascending: false })
      .limit(20)

    res.json({
      saldo: usuario.saldo,
      nombre: usuario.nombre,
      codigo_referido: usuario.codigo_referido,
      rol: usuario.rol,
      solicitud_revendedor: usuario.solicitud_revendedor,
      movimientos: movimientos || []
    })
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener billetera' })
  }
})

// SOLICITAR recarga
router.post('/recargar', async (req, res) => {
  const { monto, metodo, comprobante_url } = req.body
  if (!monto || monto < 5000) return res.status(400).json({ error: 'El monto mínimo es $5.000' })
  if (!metodo) return res.status(400).json({ error: 'Selecciona un método de pago' })

  try {
    const { data, error } = await supabase
      .from('recargas')
      .insert([{ usuario_id: req.usuario.id, monto, metodo, comprobante_url: comprobante_url || null }])
      .select()
      .single()

    if (error) return res.status(500).json({ error: 'Error al crear solicitud de recarga' })
    res.json({ success: true, recarga: data, mensaje: 'Solicitud enviada. El admin la aprobará en breve.' })
  } catch (err) {
    res.status(500).json({ error: 'Error al procesar recarga' })
  }
})

module.exports = router
