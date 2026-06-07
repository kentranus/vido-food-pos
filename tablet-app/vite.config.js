import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// When deployed to GitHub Pages, paths need /<repo-name>/ prefix.
// Set VITE_BASE env in workflow (or leave as './' for relative paths which works
// in both GitHub Pages subfolder and Capacitor file:// loading).
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: { host: true, port: 5173 },
})
