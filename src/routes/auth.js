const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const supabase = require('../db/supabase')

function generarCodigo() {
  const num = Math.floor(1000 + Math.random() * 9000)
  return `GG-${num}`
}

// REGISTRO
router.post('/register', async (req, res) => {
  const { nombre, celular, email, password, referido_por } = req.body

  if (!nombre || !celular || !email || !password)
    return res.status(400).json({ error: 'Todos los campos son obligatorios' })

  const { data: existe } = await supabase
    .from('usuarios')
    .select('id')
    .or(`email.eq.${email},celular.eq.${celular}`)
    .single()

  if (existe)
    return res.status(400).json({ error: 'El correo o celular ya están registrados' })

  if (referido_por) {
    const { data: ref } = await supabase
      .from('usuarios')
      .select('id')
      .eq('codigo_referido', referido_por)
      .single()
    if (!ref)
      return res.status(400).json({ error: 'Código de referido no existe' })
  }

  let codigo_referido
  let existe_codigo = true
  while (existe_codigo) {
    codigo_referido = generarCodigo()
    const { data } = await supabase
      .from('usuarios')
      .select('id')
      .eq('codigo_referido', codigo_referido)
      .single()
    existe_codigo = !!data
  }

  const password_hash = await bcrypt.hash(password, 10)

  const { data: nuevo, error } = await supabase
    .from('usuarios')
    .insert([{ nombre, celular, email, password_hash, codigo_referido, referido_por: referido_por || null }])
    .select()
    .single()

   if (error)
    return res.status(500).json({ error: error.message })

  const token = jwt.sign(
    { id: nuevo.id, nombre: nuevo.nombre, rol: nuevo.rol, codigo: nuevo.codigo_referido },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  )

  res.json({
    token,
    usuario: { id: nuevo.id, nombre: nuevo.nombre, email: nuevo.email, codigo_referido: nuevo.codigo_referido, saldo: 0, rol: nuevo.rol }
  })
})

// LOGIN
router.post('/login', async (req, res) => {
  const { email, password } = req.body

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('*')
    .eq('email', email)
    .single()

  if (!usuario)
    return res.status(400).json({ error: 'Correo o contraseña incorrectos' })

  const valido = await bcrypt.compare(password, usuario.password_hash)
  if (!valido)
    return res.status(400).json({ error: 'Correo o contraseña incorrectos' })

  const token = jwt.sign(
    { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol, codigo: usuario.codigo_referido },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  )

  res.json({
    token,
    usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, codigo_referido: usuario.codigo_referido, saldo: usuario.saldo, rol: usuario.rol }
  })
})

module.exports = router
