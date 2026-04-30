import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const server = await defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 3000,
    strictPort: false,
    host: true,
  },
})

const vite = await import('vite')
const s = await vite.createServer(server)
await s.listen(3000)
console.log('Vite running on:', s.resolvedUrls.local[0])
