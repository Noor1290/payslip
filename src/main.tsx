import './payrollHubBridge.js' // defines window.PayrollHubBridge; does nothing outside the dashboard
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { storedTheme } from './lib/theme'

// A theme chosen on an earlier visit is set before the first paint, so it never flashes.
const chosenTheme = storedTheme()
if (chosenTheme) document.documentElement.dataset.theme = chosenTheme

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
