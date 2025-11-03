import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

// Wait for DOM to be ready
document.addEventListener('DOMContentLoaded', () => {
  const rootElement = document.getElementById('react-root')
  
  if (rootElement) {
    createRoot(rootElement).render(<App />)
  } else {
    console.error('React root element not found')
  }
})