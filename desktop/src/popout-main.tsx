import React from 'react'
import ReactDOM from 'react-dom/client'
import { PopoutStudio } from './pages/PopoutStudio'
import './theme/globals.css'
import { initializeTheme } from './stores/uiStore'

initializeTheme()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PopoutStudio />
  </React.StrictMode>,
)
