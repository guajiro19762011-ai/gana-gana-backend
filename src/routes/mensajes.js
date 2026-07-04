const express = require('express')
const router = express.Router()
const supabase = require('../db/supabase')
const { verificarToken, soloAdmin } = require('../middleware/authMiddleware')

// ENVIAR mensaje (cliente al admin)
router.post('/', verificarToken, async (req, res) => {
  const { contenido } = req.body
  if (!contenido) return res.status(400).json({ error: 'El mensaje no puede estar vacío' })
  try {
    const { data, error } = await supabase
      .from('mensajes')
      .insert([{ usuario_id: req.usuario.id, remitente: 'cliente', contenido }])
      .select()
      .single()
    if (error) return res.status(500).json({ error: error.message })
    res.json({ success: true, mensaje: data })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// MIS MENSAJES (cliente)
router.get('/mis-mensajes', verificarToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('mensajes')
      .select('*')
      .eq('usuario_id', req.usuario.id)
      .order('created_at', { ascending: true })
    if (error) return res.status(500).json({ error: error.message })
    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// TODOS LOS MENSAJES agrupados por usuario (admin)
router.get('/todos', verificarToken, soloAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('mensajes')
      .select('*, usuarios(nombre, email, celular)')
      .order('created_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// RESPONDER mensaje (admin)
router.post('/responder', verificarToken, soloAdmin, async (req, res) => {
  const { usuario_id, contenido } = req.body
  if (!usuario_id || !contenido) return res.status(400).json({ error: 'Datos incompletos' })
  try {
    const { data, error } = await supabase
      .from('mensajes')
      .insert([{ usuario_id, remitente: 'admin', contenido }])
      .select()
      .single()
    if (error) return res.status(500).json({ error: error.message })
    res.json({ success: true, mensaje: data })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// MENSAJES DE UN USUARIO especifico (admin)
router.get('/usuario/:id', verificarToken, soloAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('mensajes')
      .select('*')
      .eq('usuario_id', req.params.id)
      .order('created_at', { ascending: true })
    if (error) return res.status(500).json({ error: error.message })
    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
