import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  // Rutas relativas: asi el mismo build vale servido en una subcarpeta de
  // GitHub Pages, abierto desde el disco, o empaquetado dentro del APK.
  base: './',

  resolve: {
    alias: {
      '@motor': path.resolve(import.meta.dirname, '../motor'),
      '@lector': path.resolve(import.meta.dirname, '../lector'),
    },
  },

  plugins: [
    react(),
    tailwind(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Comparador de luz',
        short_name: 'Luz',
        description: 'Compara tu factura de la luz con las tarifas de la Plataforma de ForoCoches. Todo ocurre en tu dispositivo.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: './',
        icons: [
          { src: 'icono-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icono-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icono-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // El worker de pdf.js es grande y hace falta entero para leer sin conexion.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,png,json,wasm}'],
      },
    }),
  ],

  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
