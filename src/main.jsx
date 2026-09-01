import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.jsx'

// Registra o service worker que permite abrir o app mesmo sem conexão
// (cacheia o HTML/JS/CSS). Atualiza sozinho em segundo plano quando uma
// nova versão é publicada.
if ('serviceWorker' in navigator) {
  registerSW({ immediate: true });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
