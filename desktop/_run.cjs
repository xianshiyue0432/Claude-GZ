const { createServer } = require('vite')
const react = require('@vitejs/plugin-react')
const tailwindcss = require('@tailwindcss/vite')

createServer({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 3000, strictPort: false, host: true },
})
  .then(s => s.listen(3000))
  .then(() => console.log('OK on 3000'))
  .catch(e => {
    require('fs').writeFileSync('_vite_err.txt', String(e.stack || e.message || e) + '\n\n' + JSON.stringify(e, null, 2))
    console.error(e.message)
    process.exit(1)
  })
