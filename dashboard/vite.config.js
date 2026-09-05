import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
  ],
  server: {
    port: 5173,
    proxy: {
      '/jobs': 'http://localhost:3000',
      '/dlq': 'http://localhost:3000',
      '/queues': 'http://localhost:3000',
      '/stats': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
})
