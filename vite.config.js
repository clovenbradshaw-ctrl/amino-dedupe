import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/amino-dedupe/',
  build: {
    outDir: 'dist'
  }
})
