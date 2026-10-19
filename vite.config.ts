import { copyFileSync, writeFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// GitHub Pages serves unknown paths as 404.html. Copying the app there keeps /view and /av6 working.
function pagesFallback() {
  return {
    name: 'pages-fallback',
    apply: 'build' as const,
    closeBundle() {
      copyFileSync('dist/index.html', 'dist/404.html')
      writeFileSync('dist/.nojekyll', '')
    },
  }
}

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/bibleguessr/' : '/',
  plugins: [react(), pagesFallback()],
  test: {
    environment: 'node',
  },
}))
