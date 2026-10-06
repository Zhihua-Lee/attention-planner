import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Attention Planner',
        short_name: '注意力',
        description: '一张清单，告诉你现在做什么。',
        lang: 'zh-CN',
        theme_color: '#2f6b57',
        background_color: '#f3f5f1',
        display: 'standalone',
        start_url: '/',
        // Android: share text from any app into the list (it arrives as `/?title=…&add=…&url=…`).
        share_target: { action: '/', method: 'GET', params: { title: 'title', text: 'add', url: 'url' } },
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        importScripts: ['push-sw.js'],
        navigateFallback: '/index.html',
        // Pages served by Workers on this domain (sign-in, AI connections) must reach the network.
        navigateFallbackDenylist: [/^\/api\//, /^\/\.well-known\//, /^\/ics/],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
  test: { include: ['src/**/*.test.ts', 'tests/**/*.test.ts'], environment: 'node' },
});
