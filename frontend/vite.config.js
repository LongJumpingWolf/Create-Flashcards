import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt' + no refresh handler: a new version installs quietly and takes
      // over on the next visit, so an update never reloads the page while a card
      // is being written.
      registerType: 'prompt',
      injectRegister: false,
      manifest: false, // public/site.webmanifest is already linked from index.html
      workbox: {
        // Precache the whole app shell, the PDF worker and the SQLite WASM used by
        // the offline .apkg exporter.
        globPatterns: ['**/*.{js,mjs,css,html,wasm,svg,png,ico,webmanifest,xml}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  optimizeDeps: {
    include: ['pdfjs-dist'],
  },
})
