import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        'terminal-popout': path.resolve(__dirname, 'terminal-popout.html'),
      },
      output: {
        manualChunks: {
          'monaco-editor': ['monaco-editor'],
          'monaco-react': ['@monaco-editor/react'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['monaco-editor', '@monaco-editor/react'],
  },
})
