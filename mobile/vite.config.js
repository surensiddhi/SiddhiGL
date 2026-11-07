import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// SiddhiGL Mobile. Dev runs on port 5174 so it does not clash with SiddhiGL Online (5173).
export default defineConfig({
  server: { port: 5174 },
  preview: { port: 4174 },
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',          // a new deploy refreshes old copies on the phone
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'SiddhiGL Mobile',
        short_name: 'SiddhiGL',
        description: 'Record sales and expenses for SiddhiGL',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f4f7f6',
        theme_color: '#1f6f5c',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{js,css,html,png,svg}']
      }
    })
  ]
})
