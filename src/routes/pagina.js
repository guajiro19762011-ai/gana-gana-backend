const express = require('express')
const router = express.Router()
const supabase = require('../db/supabase')
const { verificarToken, soloAdmin } = require('../middleware/authMiddleware')

// GET info pública
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase.from('pagina_info').select('*')
    if (error) return res.status(500).json({ error: error.message })
    const info = {}
    data.forEach(item => { info[item.clave] = item.valor })
    res.json(info)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ACTUALIZAR info (admin)
router.put('/', verificarToken, soloAdmin, async (req, res) => {
  const campos = req.body
  try {
    for (const [clave, valor] of Object.entries(campos)) {
      await supabase
        .from('pagina_info')
        .upsert({ clave, valor, updated_at: new Date().toISOString() }, { onConflict: 'clave' })
    }
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
