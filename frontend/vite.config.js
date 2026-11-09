/* global process */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'

// Shown on the Settings page so it is obvious which version is running.
const commit = (process.env.VERCEL_GIT_COMMIT_SHA || (() => { try { return execSync('git rev-parse HEAD').toString().trim(); } catch { return 'dev'; } })()).slice(0, 7)
const APP_VERSION = `${commit} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`

// https://vite.dev/config/
// Same image proxy as the Vercel function, so pasting/exporting web images also works in `npm run dev`.
const imageProxyDev = () => ({
  name: 'image-proxy-dev',
  configureServer(server) {
    server.middlewares.use('/api/proxy-image', async (req, res) => {
      const { default: handler } = await server.ssrLoadModule('/api/proxy-image.js');
      await handler(req, res);
    });
  },
});

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  plugins: [
    react(),
    imageProxyDev(),
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
