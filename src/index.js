const express = require('express')
const cors = require('cors')
require('dotenv').config()

const authRoutes = require('./routes/auth')
const adminRoutes = require('./routes/admin')
const sorteosRoutes = require('./routes/sorteos')
const billeteraRoutes = require('./routes/billetera')
const anunciosRoutes = require('./routes/anuncios')
const retirosRoutes = require('./routes/retiros')

const app = express()
app.use(cors())
app.use(express.json())

app.use('/api/auth', authRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/sorteos', sorteosRoutes)
app.use('/api/billetera', billeteraRoutes)
app.use('/api/anuncios', anunciosRoutes)
app.use('/api/retiros', retirosRoutes)

app.get('/', (req, res) => res.json({ status: 'GANA GANA O GANA API funcionando ✅' }))

const PORT = process.env.PORT || 4000
app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }))
app.listen(PORT, () => console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`))
