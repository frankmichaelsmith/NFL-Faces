/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { leaderboardApi } from './server/vite-plugin.js'

export default defineConfig({
  plugins: [
    react(),
    leaderboardApi(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Spin Streak',
        short_name: 'Spin Streak',
        description: 'A season, a Pro Bowler, a category. Tap the correct answer in 6 seconds or less.',
        theme_color: '#0b1020',
        background_color: '#0b1020',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // App shell + content bundle are precached; faces are cached as they are seen.
        globPatterns: ['**/*.{js,css,html,svg,png,json}'],
        globIgnores: ['faces/**', 'colleges/**', 'tiles/**'],
        runtimeCaching: [
          {
            urlPattern: /\/(faces|colleges|tiles)\/.*\.(jpg|png)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'faces',
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 90 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'fonts' },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    include: [
      'tests/**/*.test.ts',
      'tests/**/*.test.tsx',
      'src/**/*.test.ts',
      'scripts/**/*.test.ts',
      'server/**/*.test.ts',
    ],
    setupFiles: ['tests/setup.ts'],
  },
})
