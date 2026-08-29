import '@wailsio/runtime' // side-effect import: enables window drag for frameless windows
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initTouchDrag } from './touchdrag'

// The runtime's drag only covers the mouse; touch panels need our own handler.
initTouchDrag()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
