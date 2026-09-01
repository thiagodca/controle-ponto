import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'autoUpdate': o service worker baixa a versão nova em segundo plano
      // e assume assim que o usuário reabrir/recarregar o app — sem precisar
      // reinstalar nada.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg'],
      manifest: {
        name: 'Controle de Ponto',
        short_name: 'Ponto',
        description: 'Controle de ponto com registro por geolocalização',
        theme_color: '#4f46e5',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Faz o "cache first" do HTML/JS/CSS gerados no build, permitindo
        // abrir o app mesmo sem nenhuma conexão. Dados (Supabase) NÃO são
        // cacheados aqui — isso é feito à parte, via localStorage, no
        // próprio App.jsx (loadData/saveDataSnapshot), porque a lógica de
        // negócio (bloqueios, cálculo de horas) precisa de controle fino
        // sobre o que é "dado confiável" vs "última cópia conhecida".
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
})
