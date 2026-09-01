import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves project sites from /<repo-name>/, so every asset URL
// must be prefixed accordingly or the deployed build 404s on refresh/assets.
export default defineConfig({
  base: '/robo-sims/',
  plugins: [react()],
})
