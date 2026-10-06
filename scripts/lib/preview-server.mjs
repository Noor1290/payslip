// Serves the production build (dist/) on localhost for the check scripts, exactly as GitHub
// Pages would: static files only, under /payslip/.
import { preview } from 'vite'

export async function startPreview(port = 4319) {
  const server = await preview({ preview: { port, strictPort: true, host: '127.0.0.1' }, logLevel: 'silent' })
  const origin = `http://127.0.0.1:${port}`
  return { origin, url: `${origin}/payslip/`, close: () => server.close() }
}
