import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, useLocation } from 'react-router-dom'
import { App } from './App.tsx'
import './index.css'

const basename = import.meta.env.BASE_URL.replace(/\/$/, '')

function StripTrailingSlash() {
  const { pathname, search, hash } = useLocation()
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return <Navigate to={`${pathname.replace(/\/+$/, '')}${search}${hash}`} replace />
  }
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={basename}>
      <StripTrailingSlash />
    </BrowserRouter>
  </StrictMode>,
)
