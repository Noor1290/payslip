// Checks the built app INSIDE a dashboard frame, with the real bridge file.
// The bridge only trusts https://noor1290.github.io, so this script answers every request for
// that address itself: a small fake dashboard page, and the app from dist/. Nothing reaches the
// real site, and any request to another address is blocked and reported.
// Run after `npm run build`: node scripts/check-bridge.mjs
import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createFakeHub } from './lib/fake-hub.mjs'

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
// Rates and templates are answered by the in-memory fake from scripts/lib/fake-hub.mjs, which
// follows docs/INTEGRATION.md; `window.hub.state` lets this script play another admin, a viewer,
// another company, or an answer that never arrives.
const DASHBOARD = `<!doctype html><meta charset="utf-8"><title>Fake dashboard (test)</title>
<iframe id="app" title="Payslip" src="${HUB}/payslip/" style="width:1440px;height:960px;border:0"></iframe>
<script>
  const frame = document.getElementById('app')
  const post = (type, payload, id) =>
    frame.contentWindow.postMessage({ type, from: 'dashboard', to: 'payslip', version: 1, id, payload }, '${HUB}')
  window.log = []
  window.requestAnswer = null
  ${createFakeHub.toString()}
  window.hub = createFakeHub()
  window.send = (id, payload) => post('send-data', payload, id)
  window.addEventListener('message', (event) => {
    if (event.source !== frame.contentWindow) return
    window.log.push({ ...event.data, origin: event.origin })
    if (event.data.type === 'ready') post('ping', {}, 'ping-' + String(Date.now()).padStart(13, '0'))
    const { type, id, payload } = event.data
    if (type !== 'request-data' && type !== 'send-data') return
    if (payload.dataType === 'payroll-result') {
      if (type === 'request-data' && window.requestAnswer) post('response-data', window.requestAnswer, id)
      return
    }
    const answer = window.hub.handle(type, payload)
    if (answer !== undefined) post(type === 'request-data' ? 'response-data' : 'received', answer, id)
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

  // 1b. With no payroll data open, rates load read-only for the dashboard's company: no save.
  const hub = (change) => page.evaluate(change)
  const nav = (name) => app.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name, exact: true }).click()
  const addRates = app.getByRole('button', { name: 'Add rates from month...' })
  await nav('Statutory rates')
  await app.getByTestId('rates-empty').waitFor()
  check((await app.getByTestId('rates-company').textContent()).includes('ABC Co Ltd, BRN C1234567'), 'Rates: the company the answer is about is not shown.')
  check(await addRates.isDisabled(), 'Rates: saving is possible with no payroll data open.')
  check((await app.getByTestId('rates-cannot-save').textContent()).includes('Import or get payroll data first'), 'Rates: no explanation of why saving is off.')
  check((await app.getByTestId('unsaved-defaults').count()) === 0, 'Embedded: the bundled defaults are shown as rates.')
  await nav('Payslips')

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

  // 8b. Statutory rates, saved through the dashboard.
  const warnings = () => app.getByRole('region', { name: 'Checks' }).textContent()
  check((await warnings()).includes('The dashboard has no statutory rates saved for this company, so CSG and NSF were not cross-checked.'), 'With no rates saved, the cross-check does not say so.')
  const savesOf = (dataType) => page.evaluate((wanted) => window.hub.state.log.filter((m) => m.type === 'send-data' && m.payload.dataType === wanted).map((m) => m.payload.rows), dataType)
  const confirmRates = app.getByRole('dialog', { name: 'Save these rates?' })
  const saveRatesVersion = async (fill) => {
    await addRates.click()
    await app.getByLabel('Effective from').fill('2026-07')
    if (fill) await fill()
    await app.getByRole('button', { name: 'Review the change' }).click()
    await confirmRates.waitFor()
    await confirmRates.getByRole('button', { name: 'Save to the dashboard' }).click()
    await confirmRates.waitFor({ state: 'detached' })
  }
  await nav('Statutory rates')
  await addRates.waitFor()

  // A rate with too many decimals is refused in the form; nothing is sent, nothing is rounded.
  await addRates.click()
  await app.getByLabel('Employee CSG lower rate, %').fill('1.23456')
  await app.getByRole('button', { name: 'Review the change' }).click()
  await app.getByText('A rate can have at most 4 decimals. It is not rounded for you.').waitFor()
  check((await savesOf('statutory-rates')).length === 0, 'Rates: an invalid form was sent.')
  await app.getByRole('button', { name: 'Cancel' }).click()

  // The first version: before/after confirmation, then one row with the BRN and expected_revision 0.
  await addRates.click()
  await app.getByLabel('Effective from').fill('2026-07')
  await app.getByLabel('Source note').fill('Sample figures, not the real ones')
  await app.getByRole('button', { name: 'Review the change' }).click()
  await confirmRates.waitFor()
  check((await confirmRates.textContent()).includes('From July 2026, as revision 1, for BRN C1234567'), 'Rates: the confirmation does not say month, revision and company.')
  check((await confirmRates.locator('tbody tr').filter({ hasText: 'NSF salary ceiling' }).textContent()).includes('None'), 'Rates: "before" is not "None" for a first version.')
  await confirmRates.getByRole('button', { name: 'Save to the dashboard' }).click()
  await app.getByTestId('rates-saved').filter({ hasText: 'July 2026, revision 1' }).waitFor()
  const [firstSave] = await savesOf('statutory-rates')
  check(firstSave.length === 1 && firstSave[0].brn === 'C1234567' && firstSave[0].expected_revision === 0 && firstSave[0].nsf_ceiling === 29710, `Rates: the save row is wrong: ${JSON.stringify(firstSave)}`)
  check((await app.getByTestId('max-nsf').textContent()).includes('297.10'), 'Rates: the highest NSF is not shown beside the ceiling.')
  check((await app.getByRole('region', { name: 'Version history' }).textContent()).includes('You, 7-Oct-26'), 'Rates: the history does not say who added the version and when.')

  // An identical save: "nothing needed saving", not an error.
  await saveRatesVersion(() => app.getByLabel('Source note').fill('Sample figures, not the real ones'))
  await app.getByTestId('rates-outcome').filter({ hasText: 'Nothing needed saving' }).waitFor()

  // "unavailable" on a save that WAS stored: the app reloads, finds it, and does not send it again.
  await hub(() => (window.hub.state.nextSave = { mode: 'unavailable' }))
  await saveRatesVersion(() => app.getByLabel('NSF salary ceiling, Rs').fill('29750'))
  await app.getByTestId('rates-saved').filter({ hasText: 'July 2026, revision 2' }).waitFor()
  check((await savesOf('statutory-rates')).length === 3, 'Rates: an unconfirmed save was sent again.')

  // "unavailable" on a save that was NOT stored: the reload shows it, and only then "Save again".
  await hub(() => (window.hub.state.nextSave = { mode: 'unavailable-unsaved' }))
  await saveRatesVersion(() => app.getByLabel('NSF salary ceiling, Rs').fill('29760'))
  await app.getByTestId('rates-outcome').filter({ hasText: 'the save was not stored' }).waitFor()
  check((await savesOf('statutory-rates')).length === 4, 'Rates: a save that was not stored was resent before the user asked.')
  await app.getByRole('button', { name: 'Save again' }).click()
  await app.getByTestId('rates-saved').filter({ hasText: 'July 2026, revision 3' }).waitFor()
  const resent = (await savesOf('statutory-rates'))[4][0]
  check(resent.expected_revision === 2 && resent.nsf_ceiling === 29760, 'Rates: "Save again" did not resend the same save with the same expected_revision.')

  // Someone else saves first: stale. Nothing is overwritten; what changed is shown.
  await addRates.click()
  await app.getByLabel('Effective from').fill('2026-07')
  await app.getByLabel('NSF salary ceiling, Rs').fill('29800')
  await app.getByRole('button', { name: 'Review the change' }).click()
  await confirmRates.waitFor()
  await hub(() => window.hub.otherAdminSavesRates('2026-07', { nsf_employee_rate: 1, nsf_ceiling: 31000, nsf_exempt_at_60: true, csg_employee_rate_low: 1.5, csg_employee_rate_high: 3, csg_threshold: 50000 }))
  await confirmRates.getByRole('button', { name: 'Save to the dashboard' }).click()
  await app.getByTestId('rates-outcome').filter({ hasText: 'Someone saved a newer version first' }).waitFor()
  const stale = await app.getByTestId('rates-stale').textContent()
  check(stale.includes('revision 4, Another admin') && stale.includes('31,000') && stale.includes('29,800'), 'Rates: a stale save does not show what changed.')
  check(await page.evaluate(() => window.hub.state.rates.length === 4 && window.hub.state.rates[3].nsf_ceiling === 31000), 'Rates: a stale save overwrote the newer version.')
  check((await app.getByLabel('NSF salary ceiling, Rs').inputValue()) === '29800', 'Rates: a stale save lost what was typed.')
  await app.getByRole('button', { name: 'Cancel' }).click()

  // The cross-check now uses the saved rates (October 2026 falls under the July version).
  await nav('Payslips')
  check(!(await warnings()).includes('not cross-checked'), 'With rates saved, the cross-check still says it did not run.')
  await nav('Statutory rates')

  // A member, not an admin: the save is refused and the page turns read-only.
  await hub(() => (window.hub.state.role = 'viewer'))
  await saveRatesVersion(() => app.getByLabel('NSF salary ceiling, Rs').fill('29900'))
  await app.getByTestId('rates-outcome').filter({ hasText: 'Only an admin of this company can save' }).waitFor()
  check((await app.getByTestId('rates-cannot-save').textContent()).includes('Only an admin of this company can add rates'), 'Rates: not read-only after "forbidden".')
  await app.getByRole('button', { name: 'Cancel' }).click()
  await hub(() => (window.hub.state.role = 'admin'))

  // The dashboard has another company selected: nothing is shown as this company's rates.
  await hub(() => (window.hub.state.company = { name: 'XYZ Ltd', brn: 'C7654321' }))
  await app.getByRole('button', { name: 'Reload' }).click()
  await app.getByTestId('rates-load-failure').filter({ hasText: 'The dashboard has another company selected' }).waitFor()
  check((await app.getByRole('region', { name: 'Version history' }).count()) === 0, 'Rates: the answer for another company left rates on screen.')
  await nav('Payslips')
  check((await warnings()).includes('could not be loaded from the dashboard (the dashboard has another company selected)'), 'The cross-check does not say why it did not run.')
  await nav('Statutory rates')

  // No answer at all: after the app's own 15 seconds, "did not answer" with "Check again".
  await hub(() => {
    window.hub.state.company = { name: 'ABC Co Ltd', brn: 'C1234567' }
    window.hub.state.nextRequest = { mode: 'lost' }
  })
  const asked = Date.now()
  await app.getByRole('button', { name: 'Check again' }).click()
  await app.getByTestId('rates-load-failure').filter({ hasText: 'The dashboard did not answer' }).waitFor({ timeout: 25000 })
  const waited = (Date.now() - asked) / 1000
  check(waited > 13 && waited < 20, `Rates: the app waited ${waited.toFixed(1)} s for an answer, expected about 15.`)
  await app.getByRole('button', { name: 'Check again' }).click()
  await app.getByRole('region', { name: 'Version history' }).waitFor()
  console.log(`  rates: first version, no-change, unavailable (stored and not stored), stale, forbidden, wrong company, no answer (${waited.toFixed(1)} s)`)
  await nav('Payslips')

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
  await alone.getByRole('button', { name: 'Statutory rates', exact: true }).click()
  await alone.getByTestId('unsaved-defaults').waitFor()
  check((await alone.getByRole('button', { name: /Add rates/ }).count()) === 0, 'Standalone: rates can be added.')
  check((await alone.getByTestId('rates-cannot-save').textContent()).includes('cannot save rates'), 'Standalone: no explanation that rates cannot be saved.')
  check((await alone.getByTestId('max-nsf').textContent()).includes('297.10'), 'Standalone: the default rates are not shown.')

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
