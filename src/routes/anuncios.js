const express = require('express')
const router = express.Router()
const supabase = require('../db/supabase')
const { verificarToken, soloAdmin } = require('../middleware/authMiddleware')

// GET anuncios publicos (usuario)
router.get('/', verificarToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('anuncios')
      .select('id, titulo, contenido, created_at')
      .eq('activo', true)
      .order('created_at', { ascending: false })
      .limit(10)
    if (error) return res.status(500).json({ error: error.message })
    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET todos los anuncios (admin)
router.get('/todos', verificarToken, soloAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('anuncios')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) return res.status(500).json({ error: error.message })
    res.json(data || [])
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// CREAR anuncio (admin)
router.post('/', verificarToken, soloAdmin, async (req, res) => {
  const { titulo, contenido } = req.body
  if (!titulo || !contenido) return res.status(400).json({ error: 'Título y contenido son obligatorios' })
  try {
    const { data, error } = await supabase
      .from('anuncios')
      .insert([{ titulo, contenido, created_by: req.usuario.id }])
      .select()
      .single()
    if (error) return res.status(500).json({ error: error.message })
    res.json({ success: true, anuncio: data })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ACTIVAR/DESACTIVAR anuncio (admin)
router.put('/:id', verificarToken, soloAdmin, async (req, res) => {
  const { activo, titulo, contenido } = req.body
  try {
    const updates = {}
    if (activo !== undefined) updates.activo = activo
    if (titulo !== undefined) updates.titulo = titulo
    if (contenido !== undefined) updates.contenido = contenido
    const { data, error } = await supabase.from('anuncios').update(updates).eq('id', req.params.id).select().single()
    if (error) return res.status(500).json({ error: error.message })
    res.json({ success: true, anuncio: data })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ELIMINAR anuncio (admin)
router.delete('/:id', verificarToken, soloAdmin, async (req, res) => {
  try {
    await supabase.from('anuncios').delete().eq('id', req.params.id)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
