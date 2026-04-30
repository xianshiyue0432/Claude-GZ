const { createServer } = require('vite')
const fs = require('fs')

createServer()
  .then(server => server.listen(1420))
  .then(() => console.log('Vite running on http://localhost:1420'))
  .catch(e => {
    fs.writeFileSync('__vite_error.log', String(e.stack || e.message || e))
    console.error('FAILED:', e.message)
    process.exit(1)
  })
