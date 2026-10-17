import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Установка как приложение (своё окно, иконка в Пуске) и работа без интернета
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'TYPOS — учебные конспекты',
        short_name: 'TYPOS',
        description: 'Конспекты, закреп формул и проекты по предметам. Работает офлайн, данные — файлы на диске.',
        lang: 'ru',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f3f2ed',
        theme_color: '#f3f2ed',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [{ name: 'Поиск', short_name: 'Поиск', url: '/?search=1' }],
      },
      workbox: {
        // всё приложение, включая шрифты и MathLive, доступно офлайн
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // просмотрщик DOCX/PPTX (1,5 МБ) — не в установку, а в кэш при первом открытии документа
        globIgnores: ['viewers/**'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/viewers/'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'typos-viewers', expiration: { maxEntries: 4 } },
          },
        ],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
