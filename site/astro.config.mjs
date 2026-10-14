import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

// Served by GitHub Pages at https://kthilagarajan.github.io/mrterminal/.
// With a custom domain: set SITE to it and BASE to '/'.
export default defineConfig({
  site: process.env.SITE ?? 'https://kthilagarajan.github.io',
  base: process.env.BASE ?? '/mrterminal',
  trailingSlash: 'always',
  // Keep whitespace as written: terminal samples in <pre> rely on it.
  compressHTML: false,
  integrations: [sitemap()],
  vite: { plugins: [tailwindcss()] }
})
