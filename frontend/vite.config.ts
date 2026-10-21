import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // PWA: instalável no celular/desktop e com a interface disponível offline.
    // As chamadas /api nunca são servidas do cache (dados de estoque precisam estar atualizados).
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Estoque Idealization',
        short_name: 'Estoque',
        description: 'Gestão de estoque com scanner, compras, relatórios e IA.',
        lang: 'pt-BR',
        theme_color: '#1e40af',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [
          { name: 'Scanner', url: '/scanner', icons: [{ src: '/pwa-192.png', sizes: '192x192' }] },
          { name: 'Nova movimentação', url: '/movimentacoes?nova=exit', icons: [{ src: '/pwa-192.png', sizes: '192x192' }] },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  build: {
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        // Bibliotecas grandes em chunks próprios: melhor cache entre versões.
        advancedChunks: {
          groups: [
            { name: 'charts', test: /node_modules[\/](recharts|d3-|victory-vendor)/ },
            { name: 'react-vendor', test: /node_modules[\/](react|react-dom|react-router|scheduler)[\/]/ },
            { name: 'ui-vendor', test: /node_modules[\/](radix-ui|@radix-ui|cmdk|lucide-react)/ },
          ],
        },
      },
    },
  },
})
