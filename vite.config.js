import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' permite publicar no GitHub Pages em qualquer subpasta
export default defineConfig({ plugins: [react()], base: './' })
