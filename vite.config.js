import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/eco-file-system/', 
  plugins: [react()],
  server: { port: 5173 },
})
