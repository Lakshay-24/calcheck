import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const packageJson = require('./package.json')

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __BUILD_TIMESTAMP__: JSON.stringify(new Date().toISOString())
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon-192.png', 'icon-512.png', 'logo.png', 'robots.txt'],
      manifest: {
        name: 'CalCheck AI Calorie Tracker',
        short_name: 'CalCheck AI',
        description: 'Snap food. Track calories & protein.',
        theme_color: '#11F5F6',
        background_color: '#FFFFFF',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,svg,png,jpg}']
      }
    })
  ]
})

