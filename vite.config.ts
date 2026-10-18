import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const local = (dir: string) => `${path.resolve(import.meta.dirname, dir)}/**`
// Tauri CLI задаёт TAURI_ENV_* для beforeDevCommand / beforeBuildCommand
const tauri = !!process.env.TAURI_ENV_PLATFORM

// https://vite.dev/config/
export default defineConfig({
  // ошибки Rust в том же терминале не должны стираться
  clearScreen: !tauri,
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
        description: 'Конспекты, закреп формул и тулзы по предметам. Работает офлайн, данные — файлы на диске.',
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
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    // окно Tauri открывает ровно devUrl из tauri.conf.json
    strictPort: tauri,
    // Node-код (MCP, сервер хранения) и vault внутри проекта браузеру не нужны:
    // без этого правка конспекта на сервере хранения перезагружала бы страницу
    watch: { ignored: [local('server'), local('mcp'), local('vault'), local('src-tauri'), '**/.typos-server/**'] },
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
