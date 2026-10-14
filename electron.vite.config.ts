import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const alias = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    resolve: { alias },
    // The `mrt` command-line tool ships as a second entry, run on the app's own Node.
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts'), cli: resolve(__dirname, 'src/cli/index.ts') } } }
  },
  preload: { resolve: { alias } },
  renderer: { resolve: { alias }, plugins: [react()] }
})
