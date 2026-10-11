import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages serves the app from /payslip/.
export default defineConfig({
  base: '/payslip/',
  plugins: [react(), tailwindcss()],
  // Each app of the payroll system has its own fixed local port, and refuses
  // to start on any other (strictPort), so two apps started together never
  // take each other's port. The four ports:
  //   5173  PDF form filler   5174  Payroll
  //   5175  Payslip (this app)   5176  Payroll Hub dashboard
  server: {
    port: 5175,
    strictPort: true,
  },
  build: { chunkSizeWarningLimit: 1500 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
  },
})
