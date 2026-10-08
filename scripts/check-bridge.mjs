// Checks the built app INSIDE a dashboard frame, with the real bridge file.
// The bridge only trusts https://noor1290.github.io, so this script answers every request for
// that address itself: a small fake dashboard page, and the app from dist/. Nothing reaches the
// real site, and any request to another address is blocked and reported.
// Run after `npm run build`: node scripts/check-bridge.mjs
import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { lowContrast, unnamedControls } from './lib/a11y-page.mjs'
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
// Set PAYSLIP_SHOTS to a folder to keep three screenshots of the embedded pages (fake data only).
const shots = process.env.PAYSLIP_SHOTS
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
  if (window.seedHub) window.seedHub(window.hub)
  window.send = (id, payload) => post('send-data', payload, id)
  window.addEventListener('message', (event) => {
    if (event.source !== frame.contentWindow) return
    window.log.push({ ...event.data, origin: event.origin })
    if (event.data.type === 'ready') post('ping', {}, 'ping-' + String(Date.now()).padStart(13, '0'))
    const { type, id, payload } = event.data
    if (type !== 'request-data' && type !== 'send-data') return
    if (payload.dataType === 'payroll-result') {
      // A request for a NAMED month (the month review's fallback) is answered by the fake hub;
      // "Get from dashboard" names none and is answered by what this script prepared.
      if (type === 'request-data' && payload.period) {
        const run = window.hub.handle(type, payload)
        if (run !== undefined) post('response-data', run, id)
      } else if (type === 'request-data' && window.requestAnswer) post('response-data', window.requestAnswer, id)
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
  const shot = async (name) => {
    if (shots) await page.locator('#app').screenshot({ path: join(shots, `${name}.png`) })
  }
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

  // Accessibility of what only exists inside the dashboard: names, contrast, dialog keyboard.
  const appFrame = () => page.frame({ url: `${HUB}/payslip/` })
  const accessible = async (name) => {
    for (const html of await appFrame().evaluate(unnamedControls)) check(false, `${name}: control without a name: ${html}`)
    for (const item of await appFrame().evaluate(lowContrast)) check(false, `${name}: low contrast ${item}`)
  }
  const dialogKeyboard = async (dialogLocator, opener, name) => {
    const inside = () => appFrame().evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))
    check(await inside(), `${name}: focus did not move into the dialog.`)
    for (let step = 0; step < 6; step++) {
      await page.keyboard.press(step % 3 === 2 ? 'Shift+Tab' : 'Tab')
      check(await inside(), `${name}: Tab left the dialog.`)
    }
    await page.keyboard.press('Escape')
    await dialogLocator.waitFor({ state: 'detached' })
    check(await opener.evaluate((el) => el === document.activeElement), `${name}: focus did not return to the button that opened it.`)
  }

  // The first version: before/after confirmation, then one row with the BRN and expected_revision 0.
  await addRates.click()
  await app.getByLabel('Effective from').fill('2026-07')
  await app.getByLabel('Source note').fill('Sample figures, not the real ones')
  await accessible('rates form')
  await app.getByRole('button', { name: 'Review the change' }).focus()
  await page.keyboard.press('Enter')
  await confirmRates.waitFor()
  await accessible('rates confirmation')
  await dialogKeyboard(confirmRates, app.getByRole('button', { name: 'Review the change' }), 'rates confirmation')
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

  // 8c. Templates: create, save a draft, preview, publish, use.
  const chip = app.getByTestId('template-chip')
  const pdfButton = app.getByRole('button', { name: 'Download PDFs (zip)' })
  const editorCard = app.getByTestId('template-editor')
  const titleInput = app.getByLabel('Title', { exact: true })
  const saveDraftButton = app.getByRole('button', { name: 'Save draft' })
  const templateSaves = async () => (await savesOf('payslip-template')).map((rows) => rows[0])
  const hubTemplate = () => page.evaluate(() => window.hub.state.templates[0])
  check((await chip.textContent()) === 'Table (built-in)', 'The Payslips page does not say which template is used.')
  await app.getByRole('button', { name: 'Change the template' }).click()
  await app.getByTestId('template-empty').waitFor()
  check((await app.getByTestId('template-company').textContent()).includes('ABC Co Ltd, BRN C1234567'), 'Templates: the company is not shown.')

  await app.getByRole('button', { name: 'New template' }).click()
  await editorCard.waitFor()
  check((await app.getByTestId('template-problems').textContent()).includes('Give the template a name.'), 'A template with no name can be saved.')
  check(await saveDraftButton.isDisabled(), 'Save draft is enabled for a template with no name.')
  check(await app.getByRole('button', { name: /^Publish as version/ }).isDisabled(), 'A draft that was never saved can be published.')
  for (const required of ['CSG', 'NSF', 'PAYE']) {
    check(await app.getByRole('button', { name: `Remove ${required}`, exact: true }).isDisabled(), `The ${required} line can be removed.`)
  }
  check((await app.getByLabel('Payroll column for CSG', { exact: true }).locator('option[value=""]').count()) === 0, 'The CSG line can be left unmapped.')
  check((await app.getByLabel('Payroll column for CSG', { exact: true }).locator('option[value="CSG"]').count()) === 0, 'The employer CSG column is offered for a line.')
  await app.getByLabel('Template name').fill('Monthly payslip')
  await titleInput.fill('Pay advice')
  await app.getByRole('button', { name: 'Add a line to Earnings' }).click()
  await app.getByLabel('Label of New line').fill('Year-end bonus')
  check((await app.getByTestId('editor-status').textContent()).includes('Draft, never saved'), 'A new template is not marked as a draft that was never saved.')
  await accessible('template editor')
  await shot('template-editor')
  await saveDraftButton.click()
  await app.getByTestId('template-saved').filter({ hasText: 'Draft saved as revision 1' }).waitFor()
  const [created] = await templateSaves()
  check(created.action === 'save-draft' && !('template_id' in created) && created.expected_revision === 0 && created.brn === 'C1234567', `Templates: the first save is wrong: ${JSON.stringify({ ...created, body: '...' })}`)
  check(created.body.labels.title === 'Pay advice' && created.body.earnings.at(-1).label === 'Year-end bonus', 'Templates: the saved body does not hold the edits.')
  check(!/\d{3}/.test(JSON.stringify(created.body).replace(/line-[0-9a-f]{8}/g, '')) && !JSON.stringify(created.body).includes('DOE'), 'Templates: the saved body holds something that looks like payroll data.')
  check((await app.getByTestId('editor-status').textContent()).includes('Draft, revision 1') && (await app.getByTestId('editor-status').textContent()).includes('Never published'), 'Draft and published state are not shown.')

  // A draft can be previewed under a banner, never exported.
  await app.getByLabel('Preview this draft on the Payslips page').check()
  await nav('Payslips')
  await app.getByTestId('draft-banner').filter({ hasText: 'Draft, not published' }).waitFor()
  check((await chip.textContent()) === 'Monthly payslip, draft revision 1 (not published)', 'The chip does not say a draft is previewed.')
  check((await app.getByTestId('payslip-page').textContent()).includes('Pay advice'), 'The preview does not show the draft.')
  check((await app.getByTestId('payslip-page').textContent()).includes('Year-end bonus'), 'The preview does not show the added line.')
  check(await pdfButton.isDisabled(), 'A draft can be exported as PDF.')
  check(await app.getByRole('button', { name: 'Download Excel' }).isDisabled(), 'A draft can be exported as Excel.')
  check((await app.getByRole('region', { name: 'Employees' }).textContent()).includes('This is a draft, not published.'), 'No reason is given for the blocked export.')
  await nav(/^Template/)

  // Publish: exactly the saved draft, as version 1. Then use it.
  await app.getByRole('button', { name: 'Publish as version 1' }).click()
  await app.getByTestId('template-saved').filter({ hasText: 'Published as version 1' }).waitFor()
  const publishRow = (await templateSaves())[1]
  check(publishRow.action === 'publish' && publishRow.expected_revision === 1 && publishRow.brn === 'C1234567' && !('body' in publishRow), `Templates: the publish row is wrong: ${JSON.stringify(publishRow)}`)
  await app.getByLabel('Preview this draft on the Payslips page').uncheck()
  await app.getByRole('button', { name: 'Use version 1 of Monthly payslip' }).click()
  await app.getByTestId('template-in-use').filter({ hasText: 'Monthly payslip, version 1 (published)' }).waitFor()
  await nav('Payslips')
  check((await chip.textContent()) === 'Monthly payslip, version 1 (published)', 'The chip does not say which published version is used.')
  check((await app.getByTestId('draft-banner').count()) === 0, 'The draft banner is shown for a published version.')
  check(!(await app.getByRole('region', { name: 'Employees' }).textContent()).includes('This is a draft'), 'A published version is still blocked as a draft.')
  // The fake data has three rounding differences to accept; once accepted, the export is open.
  await app.getByRole('button', { name: /Accept 3 rounding differences/ }).click()
  await app.getByRole('dialog', { name: 'Accept the rounding differences?' }).getByRole('button', { name: /^Accept/ }).click()
  await app.getByText(/7 payslips for October 2026 ready to download/).waitFor()
  check(!(await pdfButton.isDisabled()), 'A published version cannot be exported.')
  check((await app.getByTestId('payslip-page').textContent()).includes('Pay advice'), 'The payslip does not use the published version.')
  await nav(/^Template/)

  // Stale: someone else saved the draft first. Nothing is overwritten; my changes are kept aside.
  await titleInput.fill('My title')
  await page.evaluate(() => {
    const [template] = window.hub.state.templates
    window.hub.otherAdminSavesDraft(template.id, { body: { ...template.body, labels: { ...template.body.labels, title: 'Their title' } } })
  })
  await saveDraftButton.click()
  await app.getByTestId('template-outcome').filter({ hasText: 'Someone saved a newer version first' }).waitFor()
  const conflict = await app.getByTestId('template-conflict').textContent()
  check(conflict.includes('now "Their title", yours "My title"'), `Templates: a stale save does not show what changed: ${conflict}`)
  check((await titleInput.inputValue()) === 'Their title', 'Templates: after a stale save the editor does not show the newer draft.')
  check((await hubTemplate()).body.labels.title === 'Their title' && (await hubTemplate()).revision === 2, 'Templates: a stale save overwrote the newer draft.')
  check((await app.getByRole('navigation', { name: 'Sections' }).textContent()).includes('Unsaved'), 'Unsaved template changes are not flagged in the navigation.')
  // Leaving or switching first asks; my changes stay until I say so.
  await app.getByRole('button', { name: 'New template' }).click()
  const leaveDialog = app.getByRole('dialog', { name: 'Start a new template?' })
  await leaveDialog.waitFor()
  await accessible('template, stale save and leave dialog')
  await leaveDialog.getByRole('button', { name: 'Keep editing' }).click()
  await app.getByRole('button', { name: 'New template' }).focus()
  await page.keyboard.press('Enter')
  await leaveDialog.waitFor()
  await dialogKeyboard(leaveDialog, app.getByRole('button', { name: 'New template' }), 'leave dialog')
  await nav('Payslips')
  await nav(/^Template/)
  check((await app.getByTestId('template-conflict').count()) === 1, 'Templates: my unsaved changes were lost by visiting another page.')
  await app.getByRole('button', { name: 'I am done with this list' }).click()
  await app.getByTestId('template-conflict').waitFor({ state: 'detached' })

  // "unavailable" on a draft save that WAS stored: found by the reload, not sent twice.
  await titleInput.fill('Final title')
  await hub(() => (window.hub.state.nextSave = { mode: 'unavailable' }))
  const before = (await templateSaves()).length
  await saveDraftButton.click()
  await app.getByTestId('template-saved').filter({ hasText: 'Draft saved as revision 3' }).waitFor()
  check((await templateSaves()).length === before + 1, 'Templates: an unconfirmed draft save was sent again.')

  // "unavailable" on a publish that was NOT stored: the reload shows it, then "Publish again".
  await hub(() => (window.hub.state.nextSave = { mode: 'unavailable-unsaved' }))
  await app.getByRole('button', { name: 'Publish as version 2' }).click()
  await app.getByTestId('template-outcome').filter({ hasText: 'nothing was published' }).waitFor()
  check(await page.evaluate(() => window.hub.state.versions.length === 1), 'Templates: a publish that was not stored shows as published.')
  await app.getByRole('button', { name: 'Publish again' }).click()
  await app.getByTestId('template-saved').filter({ hasText: 'Published as version 2' }).waitFor()
  check((await app.getByTestId('template-in-use').textContent()) === 'Monthly payslip, version 1 (published)', 'Publishing changed the version in use without being asked.')
  // Publishing the same draft again: nothing needed saving.
  await app.getByRole('button', { name: 'Publish as version 3' }).click()
  await app.getByTestId('template-outcome').filter({ hasText: 'Nothing needed saving' }).waitFor()

  // A member, not an admin: refused, then read-only with the reason. Reload asks again.
  await titleInput.fill('Viewer title')
  await hub(() => (window.hub.state.role = 'viewer'))
  await saveDraftButton.click()
  await app.getByTestId('template-outcome').filter({ hasText: 'Only an admin of this company can save' }).waitFor()
  check((await app.getByTestId('template-cannot-save').textContent()).includes('Only an admin of this company can save or publish a template'), 'Templates: not read-only after "forbidden".')
  check(await saveDraftButton.isDisabled(), 'Templates: Save draft stays enabled for a member.')
  await hub(() => (window.hub.state.role = 'admin'))
  await app.getByRole('button', { name: 'Close', exact: true }).click()
  await app.getByRole('dialog', { name: 'Close the editor?' }).getByRole('button', { name: 'Discard my changes' }).click()
  await editorCard.waitFor({ state: 'detached' })

  // A stored body that maps an employer column is refused on load, with the reason.
  await page.evaluate(() => {
    const [good] = window.hub.state.templates
    const body = JSON.parse(JSON.stringify(good.body))
    body.mapping.lines.transport.key = 'CSG'
    window.hub.state.templates.push({ id: '20000000-0000-4000-8000-000000000002', name: 'Tampered', body, revision: 1, updatedAt: '2026-10-07T10:00:00+04:00', by: 'other' })
    window.hub.state.versions.push({ templateId: '20000000-0000-4000-8000-000000000002', version: 1, name: 'Tampered', body, publishedAt: '2026-10-07T10:00:00+04:00', by: 'other' })
  })
  await app.getByRole('button', { name: 'Reload' }).click()
  await app.getByRole('button', { name: 'Open the draft of Tampered' }).click()
  await app.getByTestId('template-refused').filter({ hasText: 'is mapped to "CSG", a column that must never be on a payslip' }).waitFor()
  check((await editorCard.count()) === 0, 'A refused body was opened in the editor.')
  await app.getByRole('button', { name: 'Use version 1 of Tampered' }).click()
  await app.getByTestId('template-refused').filter({ hasText: 'Tampered, version 1' }).waitFor()
  check((await app.getByTestId('template-in-use').textContent()) === 'Monthly payslip, version 1 (published)', 'A refused body became the template in use.')
  console.log('  templates: create, draft, preview (no export), publish, use, stale, unavailable (stored and not stored), no-change, forbidden, refused body')
  await nav('Payslips')

  // 8d. Issue the month, open it again, re-issue. The data open is October 2026, seven employees,
  // with the published template "Monthly payslip, version 1" in use.
  const issuePanel = app.getByTestId('issue-panel')
  const issueButton = issuePanel.getByRole('button', { name: /^Issue \d* ?payslips?$/ })
  const issueDialog = app.getByRole('dialog', { name: /^Issue \d+ payslips? for October 2026\?$/ })
  const issueSends = () => savesOf('payslip-issue')
  const monthLoads = () => page.evaluate(() => window.hub.state.log.filter((m) => m.type === 'request-data' && m.payload.dataType === 'payslip-issue').length)
  const issuedInHub = () => page.evaluate(() => window.hub.state.issued.length)
  const nameOf = (index) => `${fixture[index].Surname} ${fixture[index]['Other names']}`
  const selectOnly = async (index) => {
    const all = app.getByLabel('Select all employees')
    // A page that was just opened selects everyone a moment after it appears.
    await page.waitForTimeout(200)
    if (!(await all.isChecked())) await all.check()
    await all.uncheck()
    await app.getByLabel(new RegExp(`^Include ${nameOf(index)}$`, 'i')).check()
  }
  const identicalDialog = app.getByRole('dialog', { name: /^Issue (an|\d+) identical payslips? again\?$/ })
  /** Confirms an issue. `identical` is the question expected about unchanged payslips, or null when none is unchanged. */
  const confirmIssue = async (identical = null) => {
    await issueButton.click()
    await issueDialog.waitFor()
    await issueDialog.getByRole('button', { name: 'Issue', exact: true }).click()
    await issueDialog.waitFor({ state: 'detached' })
    if (identical === null) {
      check((await identicalDialog.count()) === 0, 'A second confirmation was asked although no selected payslip is unchanged.')
      return
    }
    await identicalDialog.waitFor()
    const asked = await identicalDialog.textContent()
    check(asked.includes(identical), `The second confirmation does not ask "${identical}": ${asked}`)
    await identicalDialog.getByRole('button', { name: 'Issue anyway' }).click()
    await identicalDialog.waitFor({ state: 'detached' })
  }
  const checkIssued = () => issuePanel.getByRole('button', { name: /Check (again )?what is issued/ }).click()

  check((await app.getByTestId('cannot-issue').textContent()).includes('Check what is issued first'), 'A month can be issued before it was loaded.')
  check(await issueButton.isDisabled(), 'Issue is enabled before the month was loaded.')
  // The dashboard asks its user before it sends issued payslips: a "no" is said plainly.
  await hub(() => (window.hub.state.prompt = 'deny'))
  await checkIssued()
  await app.getByTestId('month-load-failure').filter({ hasText: 'The request was declined in the dashboard' }).waitFor()
  await hub(() => (window.hub.state.prompt = 'allow'))
  await issuePanel.getByRole('button', { name: 'Ask again' }).click()
  await app.getByTestId('issued-count').filter({ hasText: '0 issued in the dashboard' }).waitFor()
  check((await employeeRows.filter({ hasText: 'Not issued' }).count()) === 7, 'Employees are not marked "Not issued".')
  // The month review comes before issuing. Nothing was issued for September here, which is an answer:
  // the app says so and asks for no review. (The review itself is checked in section 14.)
  check((await app.getByTestId('cannot-issue').textContent()).includes('Compare with September 2026 first'), 'A month can be issued before it was compared with last month.')
  check(await issueButton.isDisabled(), 'Issue is enabled before the comparison with last month.')
  await app.getByTestId('month-review').getByRole('button', { name: 'Compare with September 2026' }).click()
  await app.getByTestId('review-none-issued').filter({ hasText: 'No payslip was issued for September 2026' }).waitFor()
  check((await app.getByTestId('cannot-issue').textContent()).includes('Compare with its payroll figures in the month review first'), 'With no payslip issued last month, the issue does not wait for the payroll figures.')
  await app.getByTestId('month-review').getByRole('button', { name: 'Compare with the payroll figures of September 2026' }).click()
  await app.getByTestId('review-nothing').filter({ hasText: 'Nothing to compare with for September 2026' }).waitFor()
  check((await app.getByTestId('cannot-issue').count()) === 0, 'With nothing to compare with, issuing is still blocked.')
  check((await app.getByTestId('not-issued-note').textContent()).includes('7 of the selected payslips are not issued'), 'Downloads are not labelled "Not issued".')
  check(!(await app.getByTestId('payslip-page').textContent()).includes('Not issued'), '"Not issued" is printed on the payslip itself.')
  const previewBefore = await app.getByTestId('payslip-page').textContent()

  // Locked: refused at once, nothing stored, nothing reloaded; the very same message goes again.
  await hub(() => (window.hub.state.gateOpen = false))
  const loadsBefore = await monthLoads()
  await issueButton.click()
  await issueDialog.waitFor()
  const dialogText = await issueDialog.textContent()
  check(dialogText.includes('For BRN C1234567') && dialogText.includes('Monthly payslip, version 1 (published)') && dialogText.includes('7 payslips, as revision 1'), `The issue confirmation does not say what is issued: ${dialogText}`)
  await accessible('issue confirmation')
  await issueDialog.getByRole('button', { name: 'Issue', exact: true }).click()
  await app.getByTestId('issue-outcome').filter({ hasText: 'The dashboard is locked' }).waitFor()
  check((await issuedInHub()) === 0 && (await monthLoads()) === loadsBefore, 'After "locked", something was stored or the month was reloaded.')
  await hub(() => (window.hub.state.gateOpen = true))
  await issuePanel.getByRole('button', { name: 'Issue again' }).click()
  await app.getByTestId('issue-summary').filter({ hasText: 'Issued: 7. Not issued: 0.' }).waitFor()
  const [lockedSend, issuedSend] = await issueSends()
  check(JSON.stringify(lockedSend) === JSON.stringify(issuedSend), 'After "locked", the message sent again was not the same one.')
  const sentRow = issuedSend[0]
  check(issuedSend.length === 1 && sentRow.action === 'issue' && sentRow.brn === 'C1234567' && sentRow.period === '2026-10' && sentRow.payslips.length === 7, 'The issue is not one row for the month.')
  check(sentRow.payslips.every((p) => Object.keys(p).join() === 'national_id,expected_revision,template_id,template_version,rates,lines,accepted_differences' && p.expected_revision === 0 && p.template_version === 1), 'A payslip in the issue does not have exactly the agreed keys.')
  check(sentRow.payslips.filter((p) => p.accepted_differences.length === 1 && p.accepted_differences[0].reason === 'Rounding').length === 3, 'The accepted rounding differences were not sent with their reason.')
  check(sentRow.payslips[0].rates?.effective_from === '2026-07' && sentRow.payslips[0].rates?.revision === 4, 'The rates snapshot is not the version the cross-check used.')
  check((await employeeRows.filter({ hasText: 'Issued, revision 1' }).count()) === 7, 'Employees are not marked as issued.')
  check((await app.getByTestId('not-issued-note').count()) === 0, 'Issued payslips are still labelled "Not issued".')
  await accessible('payslips with the issue panel')
  await shot('payslips-issued')

  // Open the month again: exactly as issued, whatever changed since.
  await nav('Issued payslips')
  check((await app.getByTestId('issued-company').textContent()) === 'ABC Co Ltd, BRN C1234567', 'Issued payslips: the company is not shown.')
  await app.getByRole('button', { name: /Open the month/ }).click()
  await app.getByTestId('issued-shown').filter({ hasText: '7 issued, latest revision of each' }).waitFor()
  await app.getByRole('region', { name: 'Issued payslips of the month' }).getByText('Monthly payslip, version 1').first().waitFor()
  const reopened = await app.getByTestId('payslip-page').textContent()
  check(reopened === previewBefore, 'The reopened payslip is not the one that was issued.')
  const details = await app.getByTestId('issued-details').textContent()
  check(details.includes('Version of July 2026, revision 4') && details.includes('Total Deductions') && details.includes('Reason: Rounding'), `The reopened payslip does not show its rates and accepted differences: ${details}`)
  await accessible('issued payslips')
  await shot('issued-month')
  const [zip] = await Promise.all([page.waitForEvent('download'), app.getByRole('button', { name: 'Download issued PDFs (zip)' }).click()])
  check(zip.suggestedFilename() === 'ABC Co Ltd - payslips - 2026-10 - issued.zip', `Issued PDFs: unexpected file name ${zip.suggestedFilename()}`)
  const [xlsx] = await Promise.all([page.waitForEvent('download'), app.getByRole('button', { name: 'Download issued Excel' }).click()])
  check(xlsx.suggestedFilename().endsWith('- issued.xlsx'), 'Issued Excel: unexpected file name.')
  // Change what the Payslips page is built with: the issued month does not move.
  await nav(/^Template/)
  await app.getByRole('button', { name: 'Use the built-in template' }).click()
  await nav('Payslips')
  check((await app.getByTestId('payslip-page').textContent()) !== previewBefore, 'Changing the template did not change the current payslip.')
  check((await employeeRows.filter({ hasText: 'Changed since revision 1' }).count()) === 7, 'A payslip that differs from the issued one is not marked.')
  check((await app.getByTestId('cannot-issue').textContent()).includes('published template version'), 'The built-in template can be issued.')
  await nav('Issued payslips')
  check((await app.getByTestId('payslip-page').textContent()) === previewBefore, 'A reopened payslip changed when the template in use changed.')
  await nav(/^Template/)
  await app.getByRole('button', { name: 'Use version 2 of Monthly payslip' }).click()
  await app.getByTestId('template-in-use').filter({ hasText: 'version 2 (published)' }).waitFor()
  await nav('Payslips')

  // Re-issue one employee: a new revision only, and the confirmation says so.
  await selectOnly(0)
  await issueButton.click()
  await issueDialog.waitFor()
  const reissue = (await app.getByTestId('reissue-list').textContent()).toLowerCase()
  check(reissue.includes(`${nameOf(0).toLowerCase()}: this creates revision 2; revision 1 stays.`), `The re-issue confirmation does not say what happens: ${reissue}`)
  await issueDialog.getByRole('button', { name: 'Issue', exact: true }).click()
  await app.getByTestId('issue-summary').filter({ hasText: 'Issued: 1. Not issued: 0.' }).waitFor()
  check((await issuedInHub()) === 8, 'A re-issue did not add exactly one revision.')
  check(await page.evaluate((id) => window.hub.state.issued.filter((row) => row.national_id === id).map((row) => row.revision).join() === '1,2', fixture[0].ID), 'Revision 1 did not stay after the re-issue.')
  check((await employeeRows.filter({ hasText: 'Issued, revision 2' }).count()) === 1, 'The re-issued employee is not at revision 2.')

  // The same employee again, with nothing changed: allowed, but only after a second, explicit confirmation.
  const sendsBeforeIdentical = (await issueSends()).length
  await issueButton.click()
  await issueDialog.waitFor()
  await issueDialog.getByRole('button', { name: 'Issue', exact: true }).click()
  await identicalDialog.waitFor()
  check((await issueSends()).length === sendsBeforeIdentical, 'An unchanged payslip was sent on the first confirmation alone.')
  const identicalText = (await identicalDialog.textContent()).toLowerCase()
  check(identicalText.includes('nothing has changed since revision 2. issue an identical revision 3 anyway?'), `The second confirmation does not ask the question: ${identicalText}`)
  check(identicalText.includes(`${nameOf(0).toLowerCase()}: the same as revision 2. this adds revision 3.`), `The second confirmation does not name the employee: ${identicalText}`)
  check(await identicalDialog.getByRole('button', { name: 'Cancel' }).evaluate((button) => button === document.activeElement), 'The second confirmation does not start on Cancel.')
  await accessible('identical re-issue confirmation')
  await dialogKeyboard(identicalDialog, issueButton, 'identical re-issue confirmation')
  check((await issueSends()).length === sendsBeforeIdentical && (await issuedInHub()) === 8, 'Leaving the second confirmation still issued the payslip.')
  await confirmIssue('Nothing has changed since revision 2. Issue an identical revision 3 anyway?')
  await app.getByTestId('issue-summary').filter({ hasText: 'Issued: 1. Not issued: 0.' }).waitFor()
  check((await issuedInHub()) === 9, 'An identical re-issue, confirmed twice, did not add exactly one revision.')
  check(await page.evaluate((id) => window.hub.state.issued.filter((row) => row.national_id === id).map((row) => row.revision).join() === '1,2,3', fixture[0].ID), 'The identical re-issue is not revision 3.')
  check((await employeeRows.filter({ hasText: 'Issued, revision 3' }).count()) === 1, 'The employee issued again unchanged is not at revision 3.')

  // Stale: another admin issued one employee since the month was loaded. Nothing is stored, the
  // employee is named from the position the dashboard gave, and who moved is listed.
  await app.getByLabel('Select all employees').check()
  await page.evaluate((id) => window.hub.otherAdminIssues('2026-10', id), fixture[1].ID)
  await confirmIssue('Nothing has changed since revision 3. Issue an identical revision 4 anyway?')
  await app.getByTestId('issue-outcome').filter({ hasText: 'Someone saved a newer version first' }).waitFor()
  const staleDetail = (await app.getByTestId('issue-detail').textContent()).toLowerCase()
  check(staleDetail.includes(`the payslip at fault: ${nameOf(1).toLowerCase()}`) && staleDetail.includes('revision 2, by another admin'), `A stale issue does not name who moved: ${staleDetail}`)
  check((await issuedInHub()) === 10, 'A stale issue stored something.')
  check((await app.getByTestId('issue-summary').textContent()).includes('Issued: 0. Not issued: 7.'), 'A stale issue does not say that nobody was issued.')

  // "unavailable" on an issue that WAS stored: the month is loaded again, found, and not sent twice.
  await selectOnly(2)
  await hub(() => (window.hub.state.nextSave = { mode: 'unavailable' }))
  const sendsBefore = (await issueSends()).length
  await confirmIssue()
  await app.getByTestId('issue-summary').filter({ hasText: 'Issued: 1. Not issued: 0.' }).waitFor()
  check((await issueSends()).length === sendsBefore + 1 && (await issuedInHub()) === 11, 'An unconfirmed issue was sent again.')

  // "unavailable" on an issue that was NOT stored: nobody moved, so "Issue again" is offered.
  await selectOnly(3)
  await hub(() => (window.hub.state.nextSave = { mode: 'unavailable-unsaved' }))
  await confirmIssue()
  await app.getByTestId('issue-outcome').filter({ hasText: 'nothing was issued' }).waitFor()
  check((await issuedInHub()) === 11, 'An issue that was not stored shows as issued.')
  await issuePanel.getByRole('button', { name: 'Issue again' }).click()
  await app.getByTestId('issue-summary').filter({ hasText: 'Issued: 1. Not issued: 0.' }).waitFor()
  check((await issuedInHub()) === 12, '"Issue again" did not issue.')

  // An employee the dashboard does not have: refused, named from the position.
  await app.getByLabel('Select all employees').check()
  await page.evaluate((id) => (window.hub.state.employees = [...new Set(window.hub.state.issued.map((row) => row.national_id))].filter((known) => known !== id)), fixture[4].ID)
  // Three of the seven are unchanged, and not all at the same revision: the question names none, each line does.
  await confirmIssue('Nothing has changed since these payslips were last issued. Issue an identical new revision of each anyway?')
  await app.getByTestId('issue-outcome').filter({ hasText: 'The dashboard no longer has this' }).waitFor()
  const missing = (await app.getByTestId('issue-detail').textContent()).toLowerCase()
  check(missing.includes(`the payslip at fault: ${nameOf(4).toLowerCase()}`), `A refused issue does not name the employee: ${missing}`)
  check((await app.getByTestId('issue-outcome').textContent()).includes('not a current employee'), 'The reason from the dashboard is not shown.')
  check((await issuedInHub()) === 12, 'A refused issue stored something.')
  await hub(() => (window.hub.state.employees = null))
  console.log('  issuing: declined load, locked then the same message, issue, reopen identical, downloads, re-issue, identical re-issue asked twice, stale, unavailable (stored and not stored), unknown employee')

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
  await alone.getByRole('button', { name: 'Statutory rates', exact: true }).click()
  await alone.getByTestId('unsaved-defaults').waitFor()
  check((await alone.getByRole('button', { name: /Add rates/ }).count()) === 0, 'Standalone: rates can be added.')
  check((await alone.getByRole('button', { name: 'Issued payslips' }).count()) === 0, 'Standalone: an "Issued payslips" page is offered.')
  check((await alone.getByTestId('rates-cannot-save').textContent()).includes('cannot save rates'), 'Standalone: no explanation that rates cannot be saved.')
  check((await alone.getByTestId('max-nsf').textContent()).includes('297.10'), 'Standalone: the default rates are not shown.')
  // The built-in template can be changed in memory, labelled "Not saved", and nothing can be saved.
  await alone.getByRole('button', { name: 'Template', exact: true }).click()
  await alone.getByTestId('template-editor').waitFor()
  check((await alone.getByRole('region', { name: 'Templates saved in the dashboard' }).count()) === 0, 'Standalone: a dashboard template list is shown.')
  check((await alone.getByRole('button', { name: /Save draft|Publish|New template/ }).count()) === 0, 'Standalone: a template can be saved or published.')
  check((await alone.getByTestId('template-cannot-save').textContent()).includes('cannot save templates'), 'Standalone: no explanation that templates cannot be saved.')
  await alone.getByLabel('Title', { exact: true }).fill('Pay advice')
  check((await alone.getByTestId('editor-status').textContent()) === 'Not saved', 'Standalone: changes are not labelled "Not saved".')
  check((await alone.getByTestId('template-in-use').textContent()) === 'Table (built-in, with your changes, not saved)', 'Standalone: the template in use does not say it has unsaved changes.')
  await alone.getByRole('button', { name: 'Payslips', exact: true }).click()
  await alone.getByRole('button', { name: 'Try with fake sample data' }).click()
  await alone.getByRole('img', { name: /Payslip of DOE JANE/ }).waitFor()
  check((await alone.getByTestId('payslip-page').textContent()).includes('Pay advice'), 'Standalone: the in-memory change is not used.')
  check((await alone.getByTestId('draft-banner').count()) === 0, 'Standalone: the built-in template is treated as a draft.')
  check(!(await alone.getByRole('region', { name: 'Employees' }).textContent()).includes('draft'), 'Standalone: the export is blocked as a draft.')
  check((await alone.getByTestId('issue-panel').count()) === 0 && (await alone.getByText('Not issued').count()) === 0, 'Standalone: issuing is offered.')
  check((await alone.getByTestId('month-review-standalone').textContent()).includes('available when this app is opened from there'), 'Standalone: the month review does not say it needs the dashboard.')
  check((await alone.getByRole('button', { name: /^Compare with/ }).count()) === 0, 'Standalone: a comparison with issued payslips is offered.')

  // 11. Which template a payslip uses when the app opens: one published template is preselected;
  // with more than one, the user must pick and nothing is exported until then.
  const body = JSON.parse(readFileSync(join(root, 'tests/expected/template-body.json'), 'utf8'))
  const seeded = async (names, role = 'admin', data = payload(fixture, '2026-09')) => {
    const seededPage = await context.newPage()
    await seededPage.addInitScript(
      ([templateNames, templateBody, seededRole]) => {
        window.seedHub = (fake) => {
          fake.state.role = seededRole
          templateNames.forEach((name, index) => {
            const id = `20000000-0000-4000-8000-00000000001${index}`
            const stored = { ...templateBody, labels: { ...templateBody.labels, title: `${name} title` } }
            fake.state.templates.push({ id, name, body: stored, revision: 1, updatedAt: '2026-10-07T09:00:00+04:00', by: 'other' })
            fake.state.versions.push({ templateId: id, version: 1, name, body: stored, publishedAt: '2026-10-07T09:05:00+04:00', by: 'other' })
          })
        }
      },
      [names, body, role],
    )
    await seededPage.goto(`${HUB}/payroll-hub/`)
    const frame = seededPage.frameLocator('#app')
    await frame.getByText('Dashboard connected').waitFor()
    await seededPage.evaluate((rows) => window.send('delivery-seed-01', rows), data)
    await frame.getByRole('dialog', { name: 'Import payroll data' }).getByRole('button', { name: 'Import 7 employees' }).click()
    await frame.getByRole('img', { name: /Payslip of DOE JANE/ }).waitFor()
    return { seededPage, frame }
  }
  const one = await seeded(['Monthly payslip'])
  await one.frame.getByTestId('template-chip').filter({ hasText: 'Monthly payslip, version 1 (published)' }).waitFor()
  check((await one.frame.getByTestId('payslip-page').textContent()).includes('Monthly payslip title'), 'One published template: it is not the one used.')
  await one.seededPage.close()

  const two = await seeded(['Monthly payslip', 'Weekly payslip'])
  await two.frame.getByText('This company has more than one published template. Choose the one to use on the Template page.').waitFor()
  check((await two.frame.getByTestId('template-chip').textContent()) === 'Table (built-in)', 'Two published templates: one was picked without asking.')
  check(await two.frame.getByRole('button', { name: 'Download PDFs (zip)' }).isDisabled(), 'Two published templates: the export is open before a choice.')
  await two.frame.getByRole('button', { name: 'Change the template' }).click()
  await two.frame.getByTestId('template-choose').waitFor()
  await two.frame.getByRole('button', { name: 'Use version 1 of Weekly payslip' }).click()
  await two.frame.getByTestId('template-in-use').filter({ hasText: 'Weekly payslip, version 1 (published)' }).waitFor()
  check((await two.frame.getByTestId('template-choose').count()) === 0, 'After choosing, the app still asks to choose.')
  await two.seededPage.close()
  console.log('  which template: standalone edits not saved, one published preselected, two published must be chosen')

  // 12. A member, not an admin: read-only from the start, from the role the dashboard reports.
  // Nothing has to be refused first, and no save is ever sent.
  const member = await seeded(['Monthly payslip'], 'viewer')
  const memberNav = (name) => member.frame.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name, exact: true }).click()
  check((await member.frame.getByTestId('cannot-issue').textContent()).includes('Only an admin of this company can issue payslips'), 'A member can issue.')
  check(await member.frame.getByRole('button', { name: /Check what is issued/ }).isDisabled(), 'A member can ask for issued payslips.')
  check(await member.frame.getByRole('button', { name: 'Compare with August 2026' }).isDisabled(), 'A member can ask for the issued payslips of last month.')
  check((await member.frame.getByTestId('review-cannot-compare').textContent()).includes('Only an admin of this company can load issued payslips'), 'A member is not told why the month review is off.')
  await memberNav('Statutory rates')
  await member.frame.getByTestId('rates-cannot-save').filter({ hasText: 'Only an admin of this company can add rates' }).waitFor()
  check(await member.frame.getByRole('button', { name: 'Add rates from month...' }).isDisabled(), 'A member can add rates.')
  await memberNav('Template')
  await member.frame.getByRole('button', { name: 'Open the draft of Monthly payslip' }).click()
  await member.frame.getByTestId('template-cannot-save').filter({ hasText: 'Only an admin of this company can save or publish a template' }).waitFor()
  check(await member.frame.getByRole('button', { name: "Publish the built-in template as this company's template" }).isDisabled(), 'A member can publish the built-in template.')
  await memberNav('Issued payslips')
  check((await member.frame.getByTestId('cannot-open').textContent()).includes('Only an admin of this company can open issued payslips'), 'A member can open issued payslips.')
  check(await member.seededPage.evaluate(() => window.hub.state.log.every((m) => m.type !== 'send-data' && m.payload.dataType !== 'payslip-issue')), 'A member sent a save or asked for issued payslips.')
  await member.seededPage.close()

  // 13. "Publish the built-in template as this company's template": a draft, then a publish, each
  // with its expected_revision, and the payslips then use it, so the month can be issued.
  const fresh = await seeded([])
  check((await fresh.frame.getByTestId('cannot-issue').textContent()).includes('Check what is issued first'), 'The issue panel is missing for a company with no template.')
  await fresh.frame.getByRole('button', { name: 'Change the template' }).click()
  await fresh.frame.getByRole('button', { name: "Publish the built-in template as this company's template" }).click()
  await fresh.frame.getByTestId('template-in-use').filter({ hasText: 'Table, version 1 (published)' }).waitFor()
  const steps = await fresh.seededPage.evaluate(() => window.hub.state.log.filter((m) => m.type === 'send-data').map((m) => m.payload.rows[0]))
  check(
    steps.length === 2 && steps[0].action === 'save-draft' && steps[0].expected_revision === 0 && !('template_id' in steps[0]) && steps[0].name === 'Table' && steps[1].action === 'publish' && steps[1].expected_revision === 1,
    `Publishing the built-in template did not go through the normal flow: ${JSON.stringify(steps.map((step) => ({ ...step, body: undefined })))}`,
  )
  check(JSON.stringify(steps[0].body) === JSON.stringify(body), 'The template published is not the built-in one.')
  await fresh.frame.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Payslips', exact: true }).click()
  await fresh.frame.getByTestId('template-chip').filter({ hasText: 'Table, version 1 (published)' }).waitFor()
  await fresh.frame.getByRole('button', { name: /Check what is issued/ }).click()
  await fresh.frame.getByTestId('issued-count').waitFor()
  check(!(await fresh.frame.getByTestId('issue-panel').textContent()).includes('published template version'), 'After publishing the built-in template the month still cannot be issued.')
  await fresh.seededPage.close()
  console.log('  roles and the built-in template: a member is read-only from the start; the built-in is published through draft then publish')

  // 14. Month review: August 2026 is issued, then September 2026 is compared with it. Statuses,
  // changed lines, bulk-approve for Unchanged rows only, what blocks the issue, a template version
  // banner, and the paper preview, which is never marked. Fake data only.
  const augustRows = JSON.parse(readFileSync(join(root, 'tests/fixtures/ABC Co Ltd-pdf-fill-2026-08.json'), 'utf8'))
  const rv = await seeded(['Monthly payslip'], 'admin', payload(augustRows, '2026-08'))
  const rf = rv.frame
  rv.seededPage.on('pageerror', (error) => pageErrors.push(String(error)))
  const rvFrame = () => rv.seededPage.frame({ url: `${HUB}/payslip/` })
  const rvHub = (change, arg) => rv.seededPage.evaluate(change, arg)
  const reviewCard = rf.getByTestId('month-review')
  const rvPanel = rf.getByTestId('issue-panel')
  const rvIssue = rvPanel.getByRole('button', { name: /^Issue \d* ?payslips?$/ })
  const cannotIssue = async () => ((await rf.getByTestId('cannot-issue').count()) === 0 ? '' : await rf.getByTestId('cannot-issue').textContent())
  const rvSends = () => rvHub(() => window.hub.state.log.filter((m) => m.type === 'send-data' && m.payload.dataType === 'payslip-issue').map((m) => m.payload.rows[0]))
  const acceptRounding = async () => {
    await rf.getByRole('button', { name: /^Accept \d+ rounding differences?$/ }).click()
    await rf.getByRole('dialog', { name: 'Accept the rounding differences?' }).getByRole('button', { name: /^Accept \d+$/ }).click()
  }
  const issueNow = async (month) => {
    await rvIssue.click()
    const confirm = rf.getByRole('dialog', { name: new RegExp(`^Issue \\d+ payslips? for ${month}\\?$`) })
    await confirm.getByRole('button', { name: 'Issue', exact: true }).click()
    await confirm.waitFor({ state: 'detached' })
  }
  const rvAccessible = async (name) => {
    for (const html of await rvFrame().evaluate(unnamedControls)) check(false, `${name}: control without a name: ${html}`)
    for (const item of await rvFrame().evaluate(lowContrast)) check(false, `${name}: low contrast ${item}`)
  }
  const paperLook = () =>
    rf.getByTestId('payslip-page').evaluate((el) => {
      const style = getComputedStyle(el)
      const well = getComputedStyle(el.parentElement)
      return JSON.stringify({
        background: style.backgroundColor,
        filter: style.filter,
        backdrop: style.backdropFilter,
        opacity: style.opacity,
        mix: style.mixBlendMode,
        outline: style.outlineStyle,
        wellFilter: well.filter,
        wellBackdrop: well.backdropFilter,
        children: el.parentElement.children.length,
        classes: el.getAttribute('class'),
      })
    })
  const paperMarkup = () => rf.getByTestId('payslip-page').evaluate((el) => el.outerHTML)
  const reviewRow = (name) => reviewCard.getByTestId('review-row').filter({ hasText: name })
  const statusOf = (name) => reviewRow(name).getByTestId('review-status').textContent()
  const progress = () => reviewCard.getByTestId('review-progress').textContent()

  // August first. July has no issued payslip: a declined load blocks, an empty month does not.
  await rf.getByTestId('template-chip').filter({ hasText: 'Monthly payslip, version 1 (published)' }).waitFor()
  check((await reviewCard.textContent()).includes('Month review: compared with July 2026'), 'The month review does not name last month.')
  await acceptRounding()
  await rvPanel.getByRole('button', { name: /Check what is issued/ }).click()
  await rf.getByTestId('issued-count').filter({ hasText: '0 issued in the dashboard' }).waitFor()
  check((await cannotIssue()).includes('Compare with July 2026 first'), 'August can be issued before it was compared with July.')
  await rvHub(() => (window.hub.state.prompt = 'deny'))
  await reviewCard.getByRole('button', { name: 'Compare with July 2026' }).click()
  await rf.getByTestId('review-load-failure').filter({ hasText: 'The request was declined in the dashboard' }).waitFor()
  check((await cannotIssue()).includes('The comparison with July 2026 could not be loaded'), 'A declined comparison does not block the issue.')
  check(await rvIssue.isDisabled(), 'Issue is enabled although the comparison was declined.')
  check(await rf.getByRole('button', { name: 'Download PDFs (zip)' }).isEnabled(), 'Downloads wait for the month review.')
  await rvHub(() => (window.hub.state.prompt = 'allow'))
  await reviewCard.getByRole('button', { name: 'Ask again' }).click()
  await rf.getByTestId('review-none-issued').filter({ hasText: 'No payslip was issued for July 2026' }).waitFor()
  check((await cannotIssue()).includes('No payslip was issued for July 2026. Compare with its payroll figures'), `With no payslip issued for July, the issue does not wait for the payroll figures: ${await cannotIssue()}`)

  // The fallback: July's payroll figures, asked for by month. Declined: asked again, never skipped.
  const payrollAsks = () => rvHub(() => window.hub.state.log.filter((m) => m.type === 'request-data' && m.payload.dataType === 'payroll-result').map((m) => m.payload))
  const comparePayroll = reviewCard.getByRole('button', { name: 'Compare with the payroll figures of July 2026' })
  await rvHub(() => (window.hub.state.prompt = 'deny'))
  await comparePayroll.click()
  await rf.getByTestId('review-load-failure').filter({ hasText: 'The request was declined in the dashboard' }).waitFor()
  check(await rvIssue.isDisabled(), 'Issue is enabled although the payroll figures were declined.')
  await rvHub(() => (window.hub.state.prompt = 'allow'))
  await reviewCard.getByRole('button', { name: 'Ask again' }).click()
  // The dashboard has no payroll for July either: nothing to compare with, and no review is asked for.
  await rf.getByTestId('review-nothing').filter({ hasText: 'Nothing to compare with for July 2026' }).waitFor()
  check((await cannotIssue()) === '', `With nothing to compare with, the issue is still blocked: ${await cannotIssue()}`)
  check(JSON.stringify(await payrollAsks()) === '[{"dataType":"payroll-result","period":"2026-07"},{"dataType":"payroll-result","period":"2026-07"}]', `The fallback did not ask for exactly last month's payroll: ${JSON.stringify(await payrollAsks())}`)
  // Now the dashboard has July's payroll (the same seven people and figures as August here).
  await rvHub((rows) => (window.hub.state.runs['2026-07'] = rows), augustRows)
  await reviewCard.getByRole('button', { name: 'Check July 2026 again' }).click()
  await rf.getByTestId('review-none-issued').waitFor()
  await comparePayroll.click()
  const source = rf.getByTestId('review-source-payroll')
  await source.waitFor()
  check((await source.textContent()).includes('Compared with payroll figures, not issued payslips'), 'A comparison with payroll figures is not labelled as such.')
  check((await reviewCard.getByTestId('review-status').allTextContents()).join() === 'Unchanged,Unchanged,Unchanged,Unchanged,Unchanged,Unchanged,Unchanged', 'The same payroll figures are not all Unchanged.')
  check((await cannotIssue()).includes('7 unchanged payslips are not approved yet'), `A comparison with payroll figures does not ask for a review: ${await cannotIssue()}`)
  await rvAccessible('month review, payroll figures')
  await reviewCard.getByRole('button', { name: 'Approve 7 unchanged payslips' }).click()
  check((await cannotIssue()) === '', `After approving the unchanged payslips the issue is still blocked: ${await cannotIssue()}`)
  await issueNow('August 2026')
  await rf.getByTestId('issue-summary').filter({ hasText: 'Issued: 7. Not issued: 0.' }).waitFor()

  // September replaces August in the app. It is compared with August as it was issued.
  await rv.seededPage.evaluate((rows) => window.send('delivery-seed-02', rows), payload(fixture, '2026-09'))
  await rf.getByRole('dialog', { name: 'Import payroll data' }).getByRole('button', { name: 'Replace with 7 employees' }).click()
  await rf.getByRole('img', { name: /Payslip of DOE JANE for September 2026/ }).waitFor()
  check((await reviewCard.textContent()).includes('Month review: compared with August 2026'), 'The month review does not follow the pay month.')
  await acceptRounding()
  await rvPanel.getByRole('button', { name: /Check what is issued/ }).click()
  await rf.getByTestId('issued-count').filter({ hasText: '0 issued in the dashboard' }).waitFor()
  // August was loaded and issued in this sitting, so the app already holds it: the review is there
  // without another question in the dashboard. "Load again" asks for exactly that month.
  await reviewCard.getByTestId('review-row').first().waitFor()
  const paperBefore = { look: await paperLook(), markup: await paperMarkup() }
  const loadsBeforeReview = await rvHub(() => window.hub.state.log.filter((m) => m.type === 'request-data' && m.payload.dataType === 'payslip-issue').length)
  await reviewCard.getByRole('button', { name: 'Load August 2026 again' }).click()
  await reviewCard.getByTestId('review-row').first().waitFor()
  const reviewLoads = await rvHub((from) => window.hub.state.log.filter((m) => m.type === 'request-data' && m.payload.dataType === 'payslip-issue').slice(from).map((m) => m.payload.params), loadsBeforeReview)
  check(JSON.stringify(reviewLoads) === '[{"action":"load","period":"2026-08","brn":"C1234567"}]', `The comparison did not ask for exactly last month's issued payslips: ${JSON.stringify(reviewLoads)}`)

  const expectedStatuses = [
    ['DOE JANE', 'Unchanged'],
    ['PALMYRE JEAN MARC', 'Changed'],
    ['SAMPLE ALEX', 'Changed'],
    ['TESTER SAM', 'Unchanged'],
    ['EXEMPLE PRIYA', 'New'],
    ['FICTIF MARIE', 'Unchanged'],
    ['TEMPO LEA', 'Unchanged'],
    ['ANCIEN PAUL', 'Left'],
  ]
  check((await reviewCard.getByTestId('review-row').count()) === 8, 'The month review does not have one row per employee, with the one who left.')
  check(!(await reviewCard.evaluate((card) => card.outerHTML)).includes('X00000000000'), 'A national ID is in the month review card (its text or its attributes).')
  for (const [name, status] of expectedStatuses) check((await statusOf(name)) === status, `${name} is "${await statusOf(name)}", expected "${status}".`)
  check((await reviewCard.getByTestId('review-status').evaluateAll((badges) => badges.every((badge) => badge.querySelector('svg') && badge.textContent.trim().length > 0))) === true, 'A status is shown without its icon or without its text.')
  const counts = await reviewCard.getByTestId('review-counts').textContent()
  check(['4 Unchanged', '2 Changed', '1 New', '1 Left'].every((text) => counts.includes(text)), `The counts are wrong: ${counts}`)
  check((await reviewCard.getByTestId('review-banner-template').count()) === 0 && (await reviewCard.getByTestId('review-banner-rates').count()) === 0, 'A banner is shown although the template and the rates versions are the same.')
  check((await cannotIssue()).includes('3 selected payslips are changed, new or not comparable and not reviewed yet: PALMYRE JEAN MARC, SAMPLE ALEX, EXEMPLE PRIYA.'), `The issue does not wait for the changed and new payslips: ${await cannotIssue()}`)
  check(await rvIssue.isDisabled(), 'Issue is enabled before the review is done.')

  // Expanding a row: each line with last month, this month and the difference; changed lines are marked.
  await reviewCard.getByRole('button', { name: 'Show the lines of PALMYRE JEAN MARC' }).click()
  const palmyre = reviewCard.getByTestId('review-details')
  const basic = palmyre.locator('tr', { hasText: 'Basic Salary' })
  check((await basic.textContent()).replace(/\s+/g, ' ').includes('18,365') && (await basic.textContent()).includes('19,480') && (await basic.textContent()).includes('+1,115') && (await basic.textContent()).includes('Changed'), `The changed line is not shown with both months and the difference: ${await basic.textContent()}`)
  check((await basic.getAttribute('data-changed')) === 'true' && (await basic.locator('svg').count()) === 1, 'A changed line is not marked with an icon and text.')
  const increment = palmyre.locator('tr', { hasText: 'Govt Increment' })
  check((await increment.getAttribute('data-changed')) === null && !(await increment.textContent()).includes('Changed'), 'An unchanged line is marked as changed.')
  check((await palmyre.locator('tr[data-changed="true"]').count()) === 6, 'Not exactly the three changed lines and the three changed totals are marked.')
  if (shots) {
    await reviewCard.getByRole('button', { name: 'Hide the lines of PALMYRE JEAN MARC' }).scrollIntoViewIfNeeded()
    await rv.seededPage.locator('#app').screenshot({ path: join(shots, 'month-review.png') })
  }
  await reviewCard.getByRole('button', { name: 'Hide the lines of PALMYRE JEAN MARC' }).click()
  // One cent.
  await reviewCard.getByRole('button', { name: 'Show the lines of SAMPLE ALEX' }).click()
  const transport = reviewCard.getByTestId('review-details').locator('tr', { hasText: 'Transport Allowance' })
  check((await transport.textContent()).includes('1,200.01') && (await transport.textContent()).includes('-0.01') && (await transport.getAttribute('data-changed')) === 'true', `A one-cent change is not shown: ${await transport.textContent()}`)
  await reviewCard.getByRole('button', { name: 'Hide the lines of SAMPLE ALEX' }).click()
  // What is not money is a note.
  await reviewCard.getByRole('button', { name: 'Show the lines of TESTER SAM' }).click()
  check((await reviewCard.getByTestId('review-notes').textContent()).includes('Name: "TESTER SAMUEL" last month, "TESTER SAM" now.'), 'A name written another way last month is not noted.')
  await rvAccessible('month review, a row open')

  // The paper is never marked: with rows open and a changed employee on screen, the page is the
  // same picture of paper as without the review.
  check((await paperLook()) === paperBefore.look && (await paperMarkup()) === paperBefore.markup, 'The payslip preview changed when rows of the month review were opened.')
  await reviewCard.getByRole('button', { name: 'Show the payslip of PALMYRE JEAN MARC' }).click()
  await rf.getByRole('img', { name: /Payslip of PALMYRE JEAN MARC/ }).waitFor()
  const palmyrePaper = { look: await paperLook(), markup: await paperMarkup() }
  check(palmyrePaper.look === paperBefore.look, `The paper of a changed employee is not plain white paper: ${palmyrePaper.look}`)
  check(!/Changed|Unchanged|last month|18,365/i.test(await rf.getByTestId('payslip-page').textContent()), 'Something from the review is printed on the payslip.')
  check(JSON.parse(palmyrePaper.look).background === 'rgb(255, 255, 255)' && JSON.parse(palmyrePaper.look).filter === 'none' && JSON.parse(palmyrePaper.look).children === 1, `The paper is tinted or has something drawn beside it: ${palmyrePaper.look}`)
  await reviewCard.getByRole('button', { name: 'Hide the lines of TESTER SAM' }).click()

  // Keyboard: every control of the review shows the 2px accent focus ring.
  const accent = await rvFrame().evaluate(() => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--accent)'
    document.body.appendChild(probe)
    const value = getComputedStyle(probe).color
    probe.remove()
    return value
  })
  await reviewCard.getByRole('button', { name: 'Show the lines of DOE JANE' }).focus()
  for (let step = 0; step < 8; step++) {
    await rv.seededPage.keyboard.press('Tab')
    const ring = await rvFrame().evaluate(() => {
      const el = document.activeElement
      const style = getComputedStyle(el)
      return { what: el.outerHTML.slice(0, 80), inside: Boolean(el.closest('[data-testid="month-review"]')), style: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor }
    })
    if (ring.inside && (ring.style === 'none' || ring.width !== '2px' || ring.color !== accent)) check(false, `Month review: focus ring is ${ring.width} ${ring.style} ${ring.color} on ${ring.what}`)
  }

  // Bulk-approve marks the Unchanged rows, and no other.
  check((await progress()).trim() === '0 of 8 reviewed.', `Something is reviewed before anyone reviewed it: ${await progress()}`)
  await reviewCard.getByRole('button', { name: 'Approve 4 unchanged payslips' }).click()
  check((await progress()).trim() === '4 of 8 reviewed.', `Bulk-approve did not mark exactly the 4 unchanged rows: ${await progress()}`)
  for (const [name, status] of expectedStatuses) {
    const box = reviewRow(name).getByRole('checkbox')
    check((await box.isChecked()) === (status === 'Unchanged'), `After bulk-approve, ${name} (${status}) is ${(await box.isChecked()) ? 'marked' : 'not marked'}.`)
  }
  check(await reviewCard.getByTestId('review-approve-unchanged').isDisabled(), 'Bulk-approve is still offered when no unchanged row is left.')
  check((await cannotIssue()).includes('3 selected payslips are changed, new or not comparable'), 'After bulk-approve the changed and new payslips no longer block the issue.')
  for (const name of ['PALMYRE JEAN MARC', 'SAMPLE ALEX', 'EXEMPLE PRIYA']) await rf.getByLabel(`Mark ${name} as reviewed`).check()
  check((await cannotIssue()).includes('1 employee who left is not acknowledged yet: ANCIEN PAUL.'), `The employee who left does not block the issue: ${await cannotIssue()}`)
  await rf.getByLabel('Acknowledge that ANCIEN PAUL left').check()
  check((await cannotIssue()) === '' && (await rvIssue.isEnabled()), `A fully reviewed month cannot be issued: ${await cannotIssue()}`)
  check((await progress()).trim() === '8 of 8 reviewed.', 'The progress does not say everything is reviewed.')

  // A new template version: a banner says so, and what was reviewed has to be looked at again.
  await rvHub(() => {
    const state = window.hub.state
    const template = state.templates[0]
    const next = JSON.parse(JSON.stringify(state.versions[0].body))
    next.earnings = next.earnings.map((line) => (line.id === 'transport' ? { ...line, label: 'Travelling allowance' } : line))
    Object.assign(template, { body: next, revision: template.revision + 1 })
    state.versions.push({ templateId: template.id, version: 2, name: template.name, body: next, publishedAt: '2026-10-08T09:05:00+04:00', by: 'other' })
  })
  const rvNav = (name) => rf.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name, exact: true }).click()
  await rvNav('Template')
  await rf.getByRole('region', { name: 'Templates saved in the dashboard' }).getByRole('button', { name: 'Reload', exact: true }).click()
  await rf.getByRole('button', { name: 'Use version 2 of Monthly payslip' }).click()
  await rf.getByTestId('template-in-use').filter({ hasText: 'version 2 (published)' }).waitFor()
  await rvNav('Payslips')
  const banner = rf.getByTestId('review-banner-template')
  await banner.waitFor()
  check((await banner.textContent()).includes('The template version is not the one August 2026 was issued with') && (await banner.textContent()).includes('August 2026: 7 payslips with this template, version 1.') && (await banner.textContent()).includes('September 2026: Monthly payslip, version 2.'), `The template banner does not say what differs: ${await banner.textContent()}`)
  for (const [name, status] of expectedStatuses) check((await statusOf(name)) === status, `A reworded label changed the status of ${name} to "${await statusOf(name)}".`)
  check((await progress()).trim() === '1 of 8 reviewed.', `Marks were kept although what they covered changed: ${await progress()}`)
  await reviewCard.getByRole('button', { name: 'Show the lines of DOE JANE' }).click()
  const notes = await reviewCard.getByTestId('review-notes').textContent()
  check(notes.includes('"Transport Allowance" last month is "Travelling allowance" now.') && notes.includes('Template: version 1 last month, version 2 now.'), `The reworded label and the template version are not noted: ${notes}`)
  await reviewCard.getByRole('button', { name: 'Hide the lines of DOE JANE' }).click()
  // The other theme (this browser starts light): names and contrast of the review, banner included.
  await rf.getByRole('button', { name: 'Dark theme' }).click()
  // Let the 150ms colour transitions finish, however busy the machine is.
  await rv.seededPage.waitForTimeout(400)
  await rvFrame().waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running' || animation.effect?.getTiming().iterations === Infinity))
  await rvAccessible('month review, dark theme')
  check((await paperLook()) === paperBefore.look, 'The paper changed with the theme or the banner.')
  if (shots) await rv.seededPage.locator('#app').screenshot({ path: join(shots, 'month-review-dark.png') })
  await rf.getByRole('button', { name: 'Light theme' }).click()
  await rv.seededPage.waitForTimeout(400)

  // Review again, then issue: what is sent is September's own payslips, nothing of August.
  await reviewCard.getByRole('button', { name: /^Approve 4 unchanged payslips$/ }).click()
  for (const name of ['PALMYRE JEAN MARC', 'SAMPLE ALEX', 'EXEMPLE PRIYA']) await rf.getByLabel(`Mark ${name} as reviewed`).check()
  check((await cannotIssue()) === '' && (await rvIssue.isEnabled()), `The reviewed month cannot be issued: ${await cannotIssue()}`)
  await issueNow('September 2026')
  await rf.getByTestId('issue-summary').filter({ hasText: 'Issued: 7. Not issued: 0.' }).waitFor()
  const sentMonths = await rvSends()
  const september = sentMonths[sentMonths.length - 1]
  check(sentMonths.length === 2 && september.period === '2026-09' && september.payslips.length === 7, 'The September issue is not one message with seven payslips.')
  check(september.payslips.every((p) => p.template_version === 2 && p.expected_revision === 0 && p.lines[0].period === '2026-09'), 'A September payslip is not made with the template in use, as revision 1 of September.')
  check(september.payslips.every((p) => JSON.stringify(p.lines).includes('Pay period: September 2026') && !JSON.stringify(p.lines).includes('August')), 'Something of August is in a September payslip.')
  check(!september.payslips.some((p) => p.national_id === 'X0000000000008'), 'A payslip was issued for the employee who left.')
  check(Object.keys(september.payslips[0]).join() === 'national_id,expected_revision,template_id,template_version,rates,lines,accepted_differences', 'The review added a key to the issued payslip.')

  // The identical re-issue rule still applies after a review: a second question, and Cancel sends nothing.
  await rvIssue.click()
  await rf.getByRole('dialog', { name: /^Issue 7 payslips for September 2026\?$/ }).getByRole('button', { name: 'Issue', exact: true }).click()
  const again = rf.getByRole('dialog', { name: 'Issue 7 identical payslips again?' })
  await again.waitFor()
  check((await again.textContent()).includes('Nothing has changed since revision 1. Issue an identical revision 2 anyway?'), 'The second question about an identical re-issue is not asked after a review.')
  await again.getByRole('button', { name: 'Cancel' }).click()
  await again.waitFor({ state: 'detached' })
  check((await rvSends()).length === 2, 'Cancelling the identical re-issue sent something.')

  const rvMessages = await rv.seededPage.evaluate(() => window.log)
  check(rvMessages.every((m) => m.from === 'payslip' && m.to === 'dashboard' && m.origin === 'https://noor1290.github.io'), 'Month review: a message did not come from this app at the hub origin.')
  const rvStorage = await rvFrame().evaluate(async () => localStorage.length + sessionStorage.length + (indexedDB.databases ? (await indexedDB.databases()).length : 0) + document.cookie.length)
  check(rvStorage === 0, 'Month review: something was written to browser storage.')
  check(!rvFrame().url().includes('X000') && !/[?#]/.test(rvFrame().url()), 'Month review: something was put in the URL.')
  await rv.seededPage.close()
  console.log('  month review: declined load blocks, payroll fallback (declined, no run, compared and labelled), four statuses, changed lines, one cent, notes, paper untouched, bulk-approve for unchanged only, left acknowledged, template banner, marks dropped, issue is this month only, identical re-issue asked twice')

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
