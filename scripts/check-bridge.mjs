// Checks the built app INSIDE a dashboard frame, with the real bridge file.
// The bridge only trusts https://noor1290.github.io, so this script answers every request for
// that address itself: a small fake dashboard page, and the app from dist/. Nothing reaches the
// real site, and any request to another address is blocked and reported.
// Run after `npm run build`: node scripts/check-bridge.mjs
import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const HUB = 'https://noor1290.github.io'
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.otf': 'font/otf',
}
const problems = []
const check = (condition, text) => {
  if (!condition) problems.push(text)
}

if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/ is missing. Run "npm run build" first.')
  process.exit(1)
}

// A stand-in for the dashboard: it embeds the app, answers "ready" with a ping like the real
// one, records every message the app sends, and lets this script send data and answer requests.
const DASHBOARD = `<!doctype html><meta charset="utf-8"><title>Fake dashboard (test)</title>
<iframe id="app" title="Payslip" src="${HUB}/payslip/" style="width:1440px;height:960px;border:0"></iframe>
<script>
  const frame = document.getElementById('app')
  const post = (type, payload, id) =>
    frame.contentWindow.postMessage({ type, from: 'dashboard', to: 'payslip', version: 1, id, payload }, '${HUB}')
  window.log = []
  window.requestAnswer = null
  window.send = (id, payload) => post('send-data', payload, id)
  window.addEventListener('message', (event) => {
    if (event.source !== frame.contentWindow) return
    window.log.push({ ...event.data, origin: event.origin })
    if (event.data.type === 'ready') post('ping', {}, 'ping-' + String(Date.now()).padStart(13, '0'))
    if (event.data.type === 'request-data' && window.requestAnswer) post('response-data', window.requestAnswer, event.data.id)
  })
</script>`

const fixture = JSON.parse(readFileSync(join(root, 'tests/fixtures/ABC Co Ltd-pdf-fill-2026-09.json'), 'utf8'))
const twoNewPeople = fixture.slice(0, 2).map((row, index) => ({ ...row, ID: `X000000000010${index}`, Surname: `NOUVEAU${index}` }))
const payload = (rows, period) => ({ dataType: 'payroll-result', rows, meta: { period } })

const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 } })
  const outside = []
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== HUB) {
      outside.push(url.href)
      return route.abort()
    }
    if (url.pathname === '/payroll-hub/') return route.fulfill({ contentType: 'text/html', body: DASHBOARD })
    if (url.pathname.startsWith('/payslip/')) {
      const file = join(dist, url.pathname.slice('/payslip/'.length) || 'index.html')
      if (existsSync(file)) return route.fulfill({ contentType: TYPES[extname(file)] ?? 'application/octet-stream', body: readFileSync(file) })
    }
    return route.fulfill({ status: 404, body: 'Not found' })
  })

  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  await page.goto(`${HUB}/payroll-hub/`)
  const app = page.frameLocator('#app')
  const replyTo = async (id) => {
    await page.waitForFunction((wanted) => window.log.some((m) => m.type === 'received' && m.id === wanted), id)
    return page.evaluate((wanted) => window.log.filter((m) => m.type === 'received' && m.id === wanted).map((m) => m.payload), id)
  }
  const send = (id, data) => page.evaluate(([messageId, body]) => window.send(messageId, body), [id, data])
  const notice = app.getByTestId('waiting-notice')
  const dialog = app.getByRole('dialog', { name: 'Import payroll data' })
  const employeeRows = app.getByRole('region', { name: 'Employees' }).locator('tbody tr')

  // 1. Embedded: the app says it is ready, answers the ping, and shows the dashboard controls.
  await page.waitForFunction(() => window.log.some((m) => m.type === 'ready') && window.log.some((m) => m.type === 'pong'))
  await app.getByText('Dashboard connected').waitFor()
  check(await app.getByRole('button', { name: 'Get from dashboard' }).isVisible(), 'Embedded: "Get from dashboard" is not shown.')
  console.log('  connected: ready and pong seen, dashboard controls shown')

  // 2. Valid rows are acknowledged and WAIT; nothing is imported before the user says so.
  await send('delivery-0001', payload(fixture, '2026-09'))
  check(JSON.stringify(await replyTo('delivery-0001')) === '[{"ok":true}]', 'Valid rows were not acknowledged with ok.')
  await notice.waitFor()
  check((await notice.textContent()).includes('7 employees, September 2026, ABC Co Ltd'), 'The waiting notice does not say what is waiting.')
  await dialog.waitFor()
  check((await employeeRows.count()) === 0, 'Rows were imported before the user confirmed.')
  await dialog.getByRole('button', { name: 'Not now' }).click()
  await dialog.waitFor({ state: 'detached' })
  check((await notice.textContent()).includes('Not imported yet.'), 'After "Not now" the notice does not say the data is still waiting.')

  // 3. The same message id again: the first answer is repeated and the data is not offered twice.
  await send('delivery-0001', payload(fixture, '2026-09'))
  await page.waitForFunction(() => window.log.filter((m) => m.type === 'received' && m.id === 'delivery-0001').length === 2)
  await page.waitForTimeout(200)
  check((await dialog.count()) === 0, 'A repeated message id was handed to the app a second time.')

  // 4. Invalid rows are refused with a message, and what was waiting is untouched.
  const withoutCompany = fixture.map(({ 'Company Name': _name, ...rest }) => rest)
  await send('delivery-0002', payload(withoutCompany, '2026-09'))
  const [refusal] = await replyTo('delivery-0002')
  check(refusal.ok === false && refusal.error.includes('"Company Name" is missing'), `Invalid rows were not refused with a message: ${JSON.stringify(refusal)}`)
  check((await notice.textContent()).includes('7 employees'), 'Refused data changed what was waiting.')
  console.log(`  refused: "${refusal.error.slice(0, 70)}"`)

  // 5. Newer data replaces what was still waiting, and its preview opens.
  await send('delivery-0003', payload(twoNewPeople, '2026-09'))
  await replyTo('delivery-0003')
  await dialog.waitFor()
  check((await notice.textContent()).includes('2 employees'), 'Newer data did not replace the older waiting data.')
  await dialog.getByRole('button', { name: 'Import 2 employees' }).click()
  await app.getByRole('img', { name: /Payslip of NOUVEAU0/ }).waitFor()
  check((await employeeRows.count()) === 2, 'Importing the waiting data did not show its 2 employees.')
  check((await notice.count()) === 0, 'The waiting notice stayed after importing.')

  // 6. Data arriving while other data is open asks Add to or Replace. Same company and month: Add.
  await send('delivery-0004', payload(fixture, '2026-09'))
  await replyTo('delivery-0004')
  await dialog.waitFor()
  check(await dialog.getByRole('radio', { name: /Add to the 2 employees/ }).isChecked(), 'Add to is not the default when adding is possible.')
  await dialog.getByRole('button', { name: 'Add 7 employees' }).click()
  await dialog.waitFor({ state: 'detached' })
  check((await employeeRows.count()) === 9, 'Add to did not give 9 employees.')

  // 7. Another month cannot be added: the reason is shown and Replace is the only choice.
  await send('delivery-0005', payload(fixture, '2026-10'))
  await replyTo('delivery-0005')
  await dialog.waitFor()
  check(await dialog.getByRole('radio', { name: /Add to the 9 employees/ }).isDisabled(), 'Add to is offered for another month.')
  check((await dialog.textContent()).includes('The new data is for another month (October 2026).'), 'The reason Add to is not possible is not shown.')
  await dialog.getByRole('button', { name: 'Replace with 7 employees' }).click()
  await dialog.waitFor({ state: 'detached' })
  check((await employeeRows.count()) === 7, 'Replace did not give 7 employees.')
  check((await app.getByLabel('Pay month').inputValue()) === '2026-10', 'Replace did not take the new pay month.')
  console.log('  import flow: wait, repeat id, refuse, newer replaces older, add, replace all behaved')

  // 8. "Get from dashboard": a refusal is explained; an answer waits like any other delivery.
  await page.evaluate(() => (window.requestAnswer = { ok: false, error: 'The dashboard is locked.', code: 'locked' }))
  await app.getByRole('button', { name: 'Get from dashboard' }).click()
  await app.getByRole('alert').filter({ hasText: 'Nothing received: The dashboard is locked. Unlock the dashboard, then try again.' }).waitFor()
  await page.evaluate((answer) => (window.requestAnswer = answer), { ok: true, ...payload(twoNewPeople, '2026-10') })
  await app.getByRole('button', { name: 'Get from dashboard' }).click()
  await dialog.waitFor()
  check((await notice.textContent()).includes('2 employees, October 2026'), '"Get from dashboard" did not put the answer in the waiting notice.')
  await dialog.getByRole('button', { name: 'Not now' }).click()
  await notice.getByRole('button', { name: 'Discard' }).click()
  await notice.waitFor({ state: 'detached' })
  check((await employeeRows.count()) === 7, 'Discard changed the data that was open.')

  // 9. Every message came from this app at the hub's origin, and nothing was stored.
  const messages = await page.evaluate(() => window.log)
  check(messages.every((m) => m.from === 'payslip' && m.to === 'dashboard' && m.version === 1), 'A message did not come from "payslip" to "dashboard".')
  check(messages.every((m) => m.origin === HUB), 'A message came from another origin.')
  const storage = await page.frame({ url: `${HUB}/payslip/` }).evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    databases: indexedDB.databases ? (await indexedDB.databases()).length : 0,
    cookies: document.cookie.length,
  }))
  console.log(`  messages from the app: ${messages.length}; browser storage after use: ${JSON.stringify(storage)}`)
  check(storage.local + storage.session + storage.databases + storage.cookies === 0, `Something was written to browser storage: ${JSON.stringify(storage)}`)

  // 10. Opened on its own (not in a frame): no dashboard control at all.
  const alone = await context.newPage()
  await alone.goto(`${HUB}/payslip/`)
  await alone.getByRole('button', { name: 'Import payroll JSON' }).waitFor()
  check((await alone.getByRole('button', { name: 'Get from dashboard' }).count()) === 0, 'Standalone: "Get from dashboard" is shown.')
  check((await alone.getByText(/Dashboard connected|Waiting for the dashboard/).count()) === 0, 'Standalone: a dashboard status is shown.')

  check(outside.length === 0, `Requests to other addresses: ${[...new Set(outside)].join(', ')}`)
  check(pageErrors.length === 0, `Page errors: ${pageErrors.join(' | ')}`)
} finally {
  await browser.close()
}

if (problems.length > 0) {
  console.error(`\nBridge check FAILED:\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log('Bridge check passed: embedded behaviour, standalone unchanged, nothing stored, no outside requests.')
