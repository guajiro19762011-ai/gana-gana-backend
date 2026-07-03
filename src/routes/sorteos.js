const express = require('express')
const router = express.Router()
const supabase = require('../db/supabase')
const { verificarToken } = require('../middleware/authMiddleware')

router.use(verificarToken)

// GET sorteo activo + numeros tomados
router.get('/activo', async (req, res) => {
  try {
    const { data: sorteo } = await supabase.from('sorteos').select('*').eq('estado', 'activo').single()
    if (!sorteo) return res.status(404).json({ error: 'No hay sorteo activo' })
    const { data: numeros } = await supabase.from('numeros_tomados').select('numero, usuario_id').eq('sorteo_id', sorteo.id)
    res.json({ sorteo, numeros: numeros || [] })
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener sorteo' })
  }
})

// COMPRAR boleta (cliente normal)
router.post('/comprar', async (req, res) => {
  const { numeros } = req.body
  const usuario_id = req.usuario.id

  if (!numeros || numeros.length !== 10)
    return res.status(400).json({ error: 'Debes seleccionar exactamente 10 números' })

  for (const n of numeros) {
    if (!/^\d{4}$/.test(n)) return res.status(400).json({ error: `Número inválido: ${n}` })
  }

  try {
    const { data: usuario } = await supabase.from('usuarios').select('saldo, rol').eq('id', usuario_id).single()
    if (!usuario || usuario.saldo < 5000) return res.status(400).json({ error: 'Saldo insuficiente. Recarga tu billetera.' })

    const { data: sorteo } = await supabase.from('sorteos').select('*').eq('estado', 'activo').single()
    if (!sorteo) return res.status(404).json({ error: 'No hay sorteo activo' })

    const { data: tomados } = await supabase.from('numeros_tomados').select('numero').eq('sorteo_id', sorteo.id).in('numero', numeros)
    if (tomados && tomados.length > 0) return res.status(400).json({ error: `Los números ${tomados.map(t => t.numero).join(', ')} ya están tomados` })

    const { data: boleta, error: boletaError } = await supabase.from('boletas').insert([{ usuario_id, sorteo_id: sorteo.id, numeros, valor: 5000 }]).select().single()
    if (boletaError) return res.status(500).json({ error: 'Error al crear boleta' })

    const numerosInsert = numeros.map(n => ({ sorteo_id: sorteo.id, numero: n, usuario_id, boleta_id: boleta.id }))
    await supabase.from('numeros_tomados').insert(numerosInsert)

    // Bono según rol: revendedor $1000, cliente normal $500
    const bono = usuario.rol === 'revendedor' ? 1000 : 500
    const nuevoSaldo = (usuario.saldo - 5000) + bono
    await supabase.from('usuarios').update({ saldo: nuevoSaldo }).eq('id', usuario_id)

    await supabase.from('movimientos').insert([
      { usuario_id, tipo: 'compra_boleta', monto: -5000, descripcion: 'Compra de boleta sorteo #' + sorteo.id, referencia_id: String(boleta.id) },
      { usuario_id, tipo: 'bono_compra', monto: bono, descripcion: `Bono por compra de boleta #${boleta.id}`, referencia_id: String(boleta.id) }
    ])

    await supabase.from('sorteos').update({ total_boletas: sorteo.total_boletas + 1 }).eq('id', sorteo.id)
    if (sorteo.total_boletas + 1 >= 1000) await supabase.from('sorteos').update({ estado: 'completo' }).eq('id', sorteo.id)

    res.json({ success: true, boleta, saldo_nuevo: nuevoSaldo })
  } catch (err) {
    res.status(500).json({ error: 'Error al procesar la compra' })
  }
})

// VENDER boleta como revendedor (a cliente final)
router.post('/vender', async (req, res) => {
  const { numeros, nombre_cliente, celular_cliente } = req.body
  const usuario_id = req.usuario.id

  if (!numeros || numeros.length !== 10) return res.status(400).json({ error: 'Debes seleccionar exactamente 10 números' })
  if (!nombre_cliente || !celular_cliente) return res.status(400).json({ error: 'Ingresa el nombre y celular del cliente' })

  try {
    const { data: usuario } = await supabase.from('usuarios').select('saldo, rol, nombre').eq('id', usuario_id).single()
    if (usuario.rol !== 'revendedor') return res.status(403).json({ error: 'No tienes permisos de revendedor' })
    if (!usuario || usuario.saldo < 5000) return res.status(400).json({ error: 'Saldo insuficiente. Recarga tu billetera.' })

    const { data: sorteo } = await supabase.from('sorteos').select('*').eq('estado', 'activo').single()
    if (!sorteo) return res.status(404).json({ error: 'No hay sorteo activo' })

    const { data: tomados } = await supabase.from('numeros_tomados').select('numero').eq('sorteo_id', sorteo.id).in('numero', numeros)
    if (tomados && tomados.length > 0) return res.status(400).json({ error: `Los números ${tomados.map(t => t.numero).join(', ')} ya están tomados` })

    // Crear boleta con datos del cliente final
    const { data: boleta, error: boletaError } = await supabase
      .from('boletas')
      .insert([{ usuario_id, sorteo_id: sorteo.id, numeros, valor: 5000, nombre_cliente, celular_cliente }])
      .select()
      .single()
    if (boletaError) return res.status(500).json({ error: 'Error al crear boleta' })

    const numerosInsert = numeros.map(n => ({ sorteo_id: sorteo.id, numero: n, usuario_id, boleta_id: boleta.id }))
    await supabase.from('numeros_tomados').insert(numerosInsert)

    // Bono revendedor $1000
    const nuevoSaldo = (usuario.saldo - 5000) + 1000
    await supabase.from('usuarios').update({ saldo: nuevoSaldo }).eq('id', usuario_id)

    await supabase.from('movimientos').insert([
      { usuario_id, tipo: 'venta_boleta', monto: -5000, descripcion: `Venta de boleta a ${nombre_cliente}`, referencia_id: String(boleta.id) },
      { usuario_id, tipo: 'bono_venta', monto: 1000, descripcion: `Bono por venta de boleta #${boleta.id}`, referencia_id: String(boleta.id) }
    ])

    await supabase.from('sorteos').update({ total_boletas: sorteo.total_boletas + 1 }).eq('id', sorteo.id)
    if (sorteo.total_boletas + 1 >= 1000) await supabase.from('sorteos').update({ estado: 'completo' }).eq('id', sorteo.id)

    res.json({ success: true, boleta, saldo_nuevo: nuevoSaldo })
  } catch (err) {
    res.status(500).json({ error: 'Error al procesar la venta' })
  }
})

// SOLICITAR ser revendedor
router.post('/solicitar-revendedor', async (req, res) => {
  try {
    const { data: usuario } = await supabase.from('usuarios').select('rol, solicitud_revendedor').eq('id', req.usuario.id).single()
    if (usuario.rol === 'revendedor') return res.status(400).json({ error: 'Ya eres revendedor' })
    if (usuario.solicitud_revendedor === 'pendiente') return res.status(400).json({ error: 'Ya tienes una solicitud pendiente' })

    await supabase.from('usuarios').update({ solicitud_revendedor: 'pendiente' }).eq('id', req.usuario.id)
    res.json({ success: true, mensaje: 'Solicitud enviada. El admin la revisará pronto.' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// MIS BOLETAS
router.get('/mis-boletas', async (req, res) => {
  try {
    const { data, error } = await supabase.from('boletas').select('*, sorteos(nombre, estado, numero_ganador)').eq('usuario_id', req.usuario.id).order('created_at', { ascending: false })
    if (error) return res.status(500).json({ error: 'Error al obtener boletas' })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// RESULTADOS PUBLICOS
router.get('/resultados', async (req, res) => {
  try {
    const { data: sorteo } = await supabase.from('sorteos').select('*').eq('estado', 'jugado').order('jugado_at', { ascending: false }).limit(1).single()
    if (!sorteo || !sorteo.numero_ganador) return res.json({ sorteo: null, ganadores: [] })
    const { data: ganadores } = await supabase.from('ganadores').select('*, usuarios(nombre)').eq('sorteo_id', sorteo.id).order('premio', { ascending: false })
    res.json({ sorteo, ganadores: (ganadores || []).map(g => ({ nombre: g.usuarios?.nombre, numero: g.numero, categoria: g.categoria, premio: g.premio })) })
  } catch (err) {
    res.json({ sorteo: null, ganadores: [] })
  }
})

module.exports = router
