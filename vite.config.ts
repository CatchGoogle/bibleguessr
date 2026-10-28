import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// GitHub Pages serves unknown paths as 404.html. Copying the app there keeps /view and /av6 working.
function pagesFallback() {
  return {
    name: 'pages-fallback',
    apply: 'build' as const,
    closeBundle() {
      copyFileSync('dist/index.html', 'dist/404.html')
      for (const route of ['play', 'view', 'view/preview', 'av6']) {
        mkdirSync(`dist/${route}`, { recursive: true })
        copyFileSync('dist/index.html', `dist/${route}/index.html`)
      }
      writeFileSync('dist/.nojekyll', '')
    },
  }
}

export default defineConfig(({ command }) => ({
  // GitHub Pages serves from /bibleguessr/. Netlify (see netlify.toml) sets VITE_BASE=/ for the site root.
  base: process.env.VITE_BASE ?? (command === 'build' ? '/bibleguessr/' : '/'),
  plugins: [react(), pagesFallback()],
  test: {
    environment: 'node',
  },
}))
