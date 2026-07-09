const generarBoletas = () => {
  const TOTAL_NUMEROS = 10000
  const BOLETAS = 1000
  const POR_BOLETA = 10

  const todos = []
  for (let i = 0; i < TOTAL_NUMEROS; i++) {
    todos.push(String(i).padStart(4, '0'))
  }

  for (let i = todos.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [todos[i], todos[j]] = [todos[j], todos[i]]
  }

  const boletas = []
  for (let i = 0; i < BOLETAS; i++) {
    boletas.push({
      numero_boleta: i + 1,
      numeros: todos.slice(i * POR_BOLETA, (i + 1) * POR_BOLETA)
    })
  }

  return boletas
}

module.exports = generarBoletas
