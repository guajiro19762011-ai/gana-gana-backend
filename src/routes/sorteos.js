const express = require('express')
const router = express.Router()
const supabase = require('../db/supabase')
const { verificarToken } = require('../middleware/authMiddleware')
const generarBoletas = require('../utils/generarBoletas')

// RUTAS PÚBLICAS (sin autenticación)
const routerPublico = require('express').Router()

// HISTORIAL PÚBLICO de sorteos jugados
routerPublico.get('/historial-publico', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sorteos')
      .select('id, nombre, numero_ganador, jugado_at, total_boletas, premios_pagados')
      .eq('estado', 'jugado')
      .order('jugado_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GANADORES DE UN SORTEO ESPECÍFICO (público)
routerPublico.get('/ganadores-sorteo/:id', async (req, res) => {
  try {
    const { data: ganadores, error } = await supabase
      .from('ganadores')
      .select('*, usuarios(nombre)')
      .eq('sorteo_id', req.params.id)
      .order('premio', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })

    // Incluir ganadores de boleta gratis
    const { data: boletasGratis } = await supabase
      .from('boletas_gratis')
      .select('*, usuarios(nombre)')
      .eq('sorteo_id', req.params.id)

    const todos = [
      ...(ganadores || []),
      ...(boletasGratis || []).map(bg => ({
        numero: bg.numero_ganador,
        categoria: '2 Últimas',
        premio: 0,
        usuarios: bg.usuarios
      }))
    ]

    res.json(todos)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports.publico = routerPublico

router.use(verificarToken)

// GET sorteo activo
router.get('/activo', async (req, res) => {
  try {
    const { data: sorteo } = await supabase.from('sorteos').select('*').eq('estado', 'activo').single()
    if (!sorteo) return res.status(404).json({ error: 'No hay sorteo activo' })
    const { data: tomados } = await supabase
      .from('boletas_pregeneradas')
      .select('numeros, usuario_id')
      .eq('sorteo_id', sorteo.id)
      .eq('disponible', false)
    res.json({ sorteo, numeros: (tomados || []).flatMap(b => b.numeros.map(n => ({ numero: n, usuario_id: b.usuario_id }))) })
  } catch (err) {
    res.status(500).json({ error: 'Error al obtener sorteo' })
  }
})

// BUSCAR boleta por número
router.get('/buscar/:numero', async (req, res) => {
  const { numero } = req.params
  if (!/^\d{4}$/.test(numero)) return res.status(400).json({ error: 'Número inválido' })
  try {
    const { data: sorteo } = await supabase.from('sorteos').select('*').eq('estado', 'activo').single()
    if (!sorteo) return res.status(404).json({ error: 'No hay sorteo activo' })
    const { data: boletas } = await supabase
      .from('boletas_pregeneradas')
      .select('*')
      .eq('sorteo_id', sorteo.id)
      .contains('numeros', [numero])
    if (!boletas || boletas.length === 0) return res.status(404).json({ error: 'Número no encontrado' })
    const boleta = boletas[0]
    if (!boleta.disponible) return res.status(400).json({ vendida: true, error: 'Esta boleta ya fue vendida. Intenta con otro número.' })
    res.json({ boleta, disponible: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// BOLETA ALEATORIA
router.get('/aleatoria', async (req, res) => {
  try {
    const { data: sorteo } = await supabase.from('sorteos').select('*').eq('estado', 'activo').single()
    if (!sorteo) return res.status(404).json({ error: 'No hay sorteo activo' })
    const { data: boletas } = await supabase
      .from('boletas_pregeneradas')
      .select('*')
      .eq('sorteo_id', sorteo.id)
      .eq('disponible', true)
      .limit(50)
    if (!boletas || boletas.length === 0) return res.status(404).json({ error: 'No hay boletas disponibles' })
    const boleta = boletas[Math.floor(Math.random() * boletas.length)]
    res.json({ boleta, disponible: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// COMPRAR boleta
router.post('/comprar', async (req, res) => {
  const { boleta_id, nombre_cliente, celular_cliente } = req.body
  const usuario_id = req.usuario.id
  if (!boleta_id) return res.status(400).json({ error: 'Selecciona una boleta' })
  try {
    const { data: usuario } = await supabase.from('usuarios').select('saldo, rol').eq('id', usuario_id).single()
    if (!usuario || usuario.saldo < 5000) return res.status(400).json({ error: 'Saldo insuficiente' })
    const { data: sorteo } = await supabase.from('sorteos').select('*').eq('estado', 'activo').single()
    if (!sorteo) return res.status(404).json({ error: 'No hay sorteo activo' })
    const { data: boleta } = await supabase.from('boletas_pregeneradas').select('*').eq('id', boleta_id).single()
    if (!boleta || !boleta.disponible) return res.status(400).json({ error: 'Esta boleta ya fue vendida' })

    await supabase.from('boletas_pregeneradas').update({
      disponible: false, usuario_id,
      nombre_cliente: nombre_cliente || null,
      celular_cliente: celular_cliente || null,
      vendida_at: new Date().toISOString()
    }).eq('id', boleta_id)

    const { data: boletaReg } = await supabase.from('boletas').insert([{
      usuario_id, sorteo_id: sorteo.id, numeros: boleta.numeros, valor: 5000,
      nombre_cliente: nombre_cliente || null, celular_cliente: celular_cliente || null
    }]).select().single()

    const numerosInsert = boleta.numeros.map(n => ({ sorteo_id: sorteo.id, numero: n, usuario_id, boleta_id: boletaReg?.id }))
    await supabase.from('numeros_tomados').insert(numerosInsert)

    const bono = usuario.rol === 'revendedor' ? 1000 : 500
    const nuevoSaldo = (usuario.saldo - 5000) + bono
    await supabase.from('usuarios').update({ saldo: nuevoSaldo }).eq('id', usuario_id)

    await supabase.from('movimientos').insert([
      { usuario_id, tipo: 'compra_boleta', monto: -5000, descripcion: `Compra boleta #${boleta.numero_boleta}` },
      { usuario_id, tipo: 'bono_compra', monto: bono, descripcion: `Bono por compra boleta #${boleta.numero_boleta}` }
    ])

    await supabase.from('sorteos').update({ total_boletas: sorteo.total_boletas + 1 }).eq('id', sorteo.id)
    if (sorteo.total_boletas + 1 >= 1000) await supabase.from('sorteos').update({ estado: 'completo' }).eq('id', sorteo.id)

    res.json({ success: true, boleta: { ...boleta, id: boletaReg?.id, sorteos: sorteo }, saldo_nuevo: nuevoSaldo })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// VENDER boleta (revendedor)
router.post('/vender', async (req, res) => {
  const { boleta_id, nombre_cliente, celular_cliente } = req.body
  const usuario_id = req.usuario.id
  if (!boleta_id) return res.status(400).json({ error: 'Selecciona una boleta' })
  if (!nombre_cliente || !celular_cliente) return res.status(400).json({ error: 'Ingresa nombre y celular del cliente' })
  try {
    const { data: usuario } = await supabase.from('usuarios').select('saldo, rol, nombre').eq('id', usuario_id).single()
    if (usuario.rol !== 'revendedor') return res.status(403).json({ error: 'No tienes permisos de revendedor' })
    if (!usuario || usuario.saldo < 5000) return res.status(400).json({ error: 'Saldo insuficiente' })
    const { data: sorteo } = await supabase.from('sorteos').select('*').eq('estado', 'activo').single()
    if (!sorteo) return res.status(404).json({ error: 'No hay sorteo activo' })
    const { data: boleta } = await supabase.from('boletas_pregeneradas').select('*').eq('id', boleta_id).single()
    if (!boleta || !boleta.disponible) return res.status(400).json({ error: 'Esta boleta ya fue vendida' })

    await supabase.from('boletas_pregeneradas').update({
      disponible: false, usuario_id, nombre_cliente, celular_cliente,
      vendida_at: new Date().toISOString()
    }).eq('id', boleta_id)

    const { data: boletaReg } = await supabase.from('boletas').insert([{
      usuario_id, sorteo_id: sorteo.id, numeros: boleta.numeros, valor: 5000,
      nombre_cliente, celular_cliente
    }]).select().single()

    const numerosInsert = boleta.numeros.map(n => ({ sorteo_id: sorteo.id, numero: n, usuario_id, boleta_id: boletaReg?.id }))
    await supabase.from('numeros_tomados').insert(numerosInsert)

    const nuevoSaldo = (usuario.saldo - 5000) + 1000
    await supabase.from('usuarios').update({ saldo: nuevoSaldo }).eq('id', usuario_id)

    await supabase.from('movimientos').insert([
      { usuario_id, tipo: 'venta_boleta', monto: -5000, descripcion: `Venta boleta #${boleta.numero_boleta} a ${nombre_cliente}` },
      { usuario_id, tipo: 'bono_venta', monto: 1000, descripcion: `Bono venta boleta #${boleta.numero_boleta}` }
    ])

    await supabase.from('sorteos').update({ total_boletas: sorteo.total_boletas + 1 }).eq('id', sorteo.id)
    if (sorteo.total_boletas + 1 >= 1000) await supabase.from('sorteos').update({ estado: 'completo' }).eq('id', sorteo.id)

    res.json({
      success: true,
      boleta: { ...boleta, id: boletaReg?.id, nombre_cliente, celular_cliente, nombre_vendedor: usuario.nombre, sorteos: sorteo },
      saldo_nuevo: nuevoSaldo
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// SOLICITAR revendedor
router.post('/solicitar-revendedor', async (req, res) => {
  try {
    const { data: usuario } = await supabase.from('usuarios').select('rol, solicitud_revendedor').eq('id', req.usuario.id).single()
    if (usuario.rol === 'revendedor') return res.status(400).json({ error: 'Ya eres revendedor' })
    if (usuario.solicitud_revendedor === 'pendiente') return res.status(400).json({ error: 'Ya tienes una solicitud pendiente' })
    await supabase.from('usuarios').update({ solicitud_revendedor: 'pendiente' }).eq('id', req.usuario.id)
    res.json({ success: true, mensaje: 'Solicitud enviada.' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// MIS BOLETAS
router.get('/mis-boletas', async (req, res) => {
  try {
    const { data, error } = await supabase.from('boletas').select('*, sorteos(nombre, estado, numero_ganador)').eq('usuario_id', req.usuario.id).order('created_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// BOLETAS GRATIS pendientes del cliente
router.get('/boleta-gratis', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('boletas_gratis')
      .select('*')
      .eq('usuario_id', req.usuario.id)
      .eq('estado', 'pendiente')
    if (error) return res.status(500).json({ error: error.message })
    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// RECLAMAR boleta gratis
router.post('/reclamar-boleta-gratis', async (req, res) => {
  const { boleta_gratis_id, boleta_id } = req.body
  const usuario_id = req.usuario.id
  if (!boleta_gratis_id || !boleta_id) return res.status(400).json({ error: 'Datos incompletos' })
  try {
    // Verificar que la boleta gratis existe y es del usuario
    const { data: boletaGratis } = await supabase.from('boletas_gratis').select('*').eq('id', boleta_gratis_id).eq('usuario_id', usuario_id).eq('estado', 'pendiente').single()
    if (!boletaGratis) return res.status(404).json({ error: 'Boleta gratis no encontrada o ya reclamada' })

    const { data: sorteo } = await supabase.from('sorteos').select('*').eq('estado', 'activo').single()
    if (!sorteo) return res.status(404).json({ error: 'No hay sorteo activo' })

    // Verificar boleta pre-generada disponible
    const { data: boleta } = await supabase.from('boletas_pregeneradas').select('*').eq('id', boleta_id).single()
    if (!boleta || !boleta.disponible) return res.status(400).json({ error: 'Esta boleta ya fue vendida' })

    // Marcar boleta como vendida SIN costo y SIN bono
    await supabase.from('boletas_pregeneradas').update({
      disponible: false, usuario_id, vendida_at: new Date().toISOString()
    }).eq('id', boleta_id)

    // Registrar en boletas
    const { data: boletaReg } = await supabase.from('boletas').insert([{
      usuario_id, sorteo_id: sorteo.id, numeros: boleta.numeros, valor: 0
    }]).select().single()

    // Registrar números tomados
    const numerosInsert = boleta.numeros.map(n => ({ sorteo_id: sorteo.id, numero: n, usuario_id, boleta_id: boletaReg?.id }))
    await supabase.from('numeros_tomados').insert(numerosInsert)

    // Marcar boleta gratis como reclamada
    await supabase.from('boletas_gratis').update({ estado: 'reclamada', reclamada_at: new Date().toISOString() }).eq('id', boleta_gratis_id)

    // Movimiento de $0
    await supabase.from('movimientos').insert([{
      usuario_id, tipo: 'boleta_gratis', monto: 0,
      descripcion: `Boleta gratis reclamada por acierto 2 últimas cifras — Boleta #${boleta.numero_boleta}`
    }])

    await supabase.from('sorteos').update({ total_boletas: sorteo.total_boletas + 1 }).eq('id', sorteo.id)

    res.json({ success: true, boleta: { ...boleta, id: boletaReg?.id, sorteos: sorteo } })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// RESULTADOS
router.get('/resultados', async (req, res) => {
  try {
    const { data: sorteos } = await supabase
      .from('sorteos')
      .select('*')
      .eq('estado', 'jugado')
      .order('jugado_at', { ascending: false })
      .limit(1)

    const sorteo = sorteos?.[0] || null
    if (!sorteo || !sorteo.numero_ganador) return res.json({ sorteo: null, ganadores: [] })

    const { data: ganadores } = await supabase
      .from('ganadores')
      .select('*, usuarios(nombre)')
      .eq('sorteo_id', sorteo.id)
      .order('premio', { ascending: false })

    // Incluir ganadores de boleta gratis (2 últimas)
    const { data: boletasGratis } = await supabase
      .from('boletas_gratis')
      .select('*, usuarios(nombre)')
      .eq('sorteo_id', sorteo.id)

    const ganadoresFinal = [
      ...(ganadores || []).map(g => ({
        nombre: g.usuarios?.nombre,
        numero: g.numero,
        categoria: g.categoria,
        premio: g.premio
      })),
      ...(boletasGratis || []).map(bg => ({
        nombre: bg.usuarios?.nombre,
        numero: bg.numero_ganador,
        categoria: '2 Últimas',
        premio: 0,
        esBoleta: true
      }))
    ]

    res.json({ sorteo, ganadores: ganadoresFinal })
  } catch (err) {
    console.error('Error resultados:', err)
    res.json({ sorteo: null, ganadores: [] })
  }
})

module.exports = router
