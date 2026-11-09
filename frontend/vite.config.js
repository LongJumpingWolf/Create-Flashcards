/* global process */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'

// Shown on the Settings page so it is obvious which version is running.
const commit = (process.env.VERCEL_GIT_COMMIT_SHA || (() => { try { return execSync('git rev-parse HEAD').toString().trim(); } catch { return 'dev'; } })()).slice(0, 7)
const APP_VERSION = `${commit} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`

// https://vite.dev/config/
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  plugins: [
    react(),
    VitePWA({
      // 'prompt' + no refresh handler: a new version installs quietly and takes
      // over on the next visit, so an update never reloads the page while a card
      // is being written.
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: false, // public/site.webmanifest is already linked from index.html
      workbox: {
        // Precache the whole app shell, the PDF worker and the SQLite WASM used by
        // the offline .apkg exporter.
        globPatterns: ['**/*.{js,mjs,css,html,wasm,svg,png,ico,webmanifest,xml}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
  optimizeDeps: {
    include: ['pdfjs-dist'],
  },
})
