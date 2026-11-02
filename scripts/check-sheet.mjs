// Checks "From your file" in the built app, inside a fake dashboard as check-bridge.mjs does:
// upload a fake layout, choose what goes in the cells, save, publish, use the version, see the
// payslip, download the PDF and the Excel file, restore a version, and keep a company's own value.
// Set PAYSLIP_SHOTS to a folder to keep screenshots (fake data only).
// Run after `npm run build`: node scripts/check-sheet.mjs
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'
import { unzipSync } from 'fflate'
import { chromium } from 'playwright'
import { createFakeHub } from './lib/fake-hub.mjs'
import { fakeLayoutBytes } from './lib/fake-layout.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const HUB = 'https://noor1290.github.io'
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.otf': 'font/otf' }
const problems = []
const shots = process.env.PAYSLIP_SHOTS
const check = (condition, text) => {
  if (!condition) problems.push(text)
}

const DASHBOARD = `<!doctype html><meta charset="utf-8"><title>Fake dashboard (test)</title>
<iframe id="app" title="Payslip" src="${HUB}/payslip/" style="width:1560px;height:1000px;border:0"></iframe>
<script>
  const frame = document.getElementById('app')
  const post = (type, payload, id) =>
    frame.contentWindow.postMessage({ type, from: 'dashboard', to: 'payslip', version: 1, id, payload }, '${HUB}')
  window.log = []
  ${createFakeHub.toString()}
  window.hub = createFakeHub()
  window.send = (id, payload) => post('send-data', payload, id)
  window.addEventListener('message', (event) => {
    if (event.source !== frame.contentWindow) return
    window.log.push(event.data)
    if (event.data.type === 'ready') post('ping', {}, 'ping-' + String(Date.now()).padStart(13, '0'))
    const { type, id, payload } = event.data
    if (type !== 'request-data' && type !== 'send-data') return
    const answer = window.hub.handle(type, payload)
    if (answer !== undefined) post(type === 'request-data' ? 'response-data' : 'received', answer, id)
  })
</script>`

const fixture = JSON.parse(readFileSync(join(root, 'tests/fixtures/ABC Co Ltd-pdf-fill-2026-09.json'), 'utf8'))
const browser = await chromium.launch()
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1040 }, acceptDownloads: true })
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
  await app.getByText('Dashboard connected').waitFor()
  const shot = async (name) => {
    if (!shots) return
    const editor = app.getByTestId('template-editor')
    await ((await editor.count()) > 0 ? editor : page.locator('#app')).screenshot({ path: join(shots, `${name}.png`) })
  }
  const nav = (name) => app.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name, exact: true }).click()

  await page.evaluate((rows) => window.send('delivery-0001', { dataType: 'payroll-result', rows, meta: { period: '2026-09' } }), fixture)
  await app.getByRole('button', { name: 'Review and import' }).click().catch(() => {})
  const dialog = app.getByRole('dialog', { name: 'Import payroll data' })
  await dialog.waitFor()
  await dialog.getByRole('button', { name: /^Import/ }).first().click()
  await nav('Template')

  // Upload.
  await shot('1-template-page')
  await app.getByTestId('layout-file').setInputFiles({ name: 'Monthly payslip.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from(await fakeLayoutBytes()) })
  await app.getByTestId('sheet-grid').waitFor()
  const notes = await app.getByTestId('upload-notes').textContent()
  check(notes.includes('start Empty'), 'The upload does not say that numbers start Empty.')
  check(notes.includes('TeX Gyre Pagella'), 'The upload does not say which fonts change.')
  await shot('2-uploaded-grid')

  // Choose cells.
  const open = async (name) => {
    await app.getByRole('button', { name: new RegExp(`^Cell ${name}:`) }).click()
    await app.getByTestId('sheet-cell-editor').waitFor()
  }
  const field = (root, name) => root.locator(`label.field:has(span.field-label:text-is("${name}"))`).locator('select, input')
  const goes = (value) => field(app, 'What goes in it').selectOption(value)
  await open('B5')
  await goes('company')
  await open('B6')
  await goes('company')
  await field(app, 'Detail').selectOption('address')
  await open('C10')
  await goes('employee')
  await open('E10')
  await goes('employment')
  check((await app.getByTestId('date-preview').textContent()).includes('15-Mar-21'), 'The date format has no live preview.')
  await app.getByRole('button', { name: '15/03/2021' }).click()
  check((await app.getByTestId('date-preview').textContent()).includes('15/03/2021'), 'The date preview does not follow the format.')
  await shot('3-date-format')
  await open('C11')
  await goes('employee')
  await field(app, 'Field').selectOption('ID')
  const figure = async (cell, key, side) => {
    await open(cell)
    await goes('payroll')
    await field(app, 'Payroll figure').fill(key)
    if (side) await field(app, 'Side of the payslip').selectOption(side)
  }
  await figure('C14', 'Basic Salary', 'earnings')
  check((await app.getByTestId('number-preview').textContent()).includes('18,750.50'), 'The number format has no live preview.')
  await app.getByLabel('Write "Rs" before it').check()
  check((await app.getByTestId('number-preview').textContent()).includes('Rs 18,750.50'), 'The number preview does not follow the format.')
  await shot('4-number-format')
  await app.getByLabel('Write "Rs" before it').uncheck()
  await figure('C15', 'Govt Increment', 'earnings')
  await figure('C16', 'Allowances', 'earnings')
  await figure('E14', 'Employee CSG', 'deductions')
  await figure('E15', 'Employee NSF', 'deductions')
  await figure('E16', 'PAYE', 'deductions')
  await figure('C18', 'Gross Pay')
  await figure('E18', 'Total deductions')
  await open('E20')
  await goes('calc')
  await shot('5-calculation')
  await field(app, 'Figure').fill('Gross Pay')
  await app.getByRole('button', { name: 'Add a part' }).click()
  await field(app.getByTestId('calc-part').nth(1), 'Part 2').selectOption('-1')
  await field(app.getByTestId('calc-part').nth(1), 'Figure').fill('Total deductions')
  await open('C23')
  await goes('today')

  // A fixed value for this company only.
  await open('B11')
  await goes('fixed')
  await field(app, 'Value for all companies').fill('NIC :')
  await app.getByLabel('ABC Co Ltd has its own value').check()
  await field(app, 'Value for ABC Co Ltd only').fill('National ID :')
  check((await app.getByTestId('applies').textContent()).includes('ABC Co Ltd only'), 'The cell does not say whose value applies.')

  // A row added and removed.
  await open('B22')
  await app.getByRole('button', { name: 'Add above' }).click()
  check((await app.getByRole('button', { name: /^Cell B25:/ }).count()) === 1, 'A row was not added.')
  await app.getByRole('button', { name: /^Cell B22:/ }).click()
  await app.getByRole('button', { name: 'Remove row' }).click()
  check((await app.getByRole('button', { name: /^Cell B25:/ }).count()) === 0, 'A row was not removed.')
  await shot('6-grid-with-values')

  // Save, publish, use.
  await app.getByRole('button', { name: 'Save draft' }).click()
  await app.getByTestId('template-saved').waitFor()
  await page.waitForFunction(() => window.hub.state.ownValues && Object.values(window.hub.state.ownValues).length === 1)
  const stored = await page.evaluate(() => window.hub.state.templates[0].body)
  const text = JSON.stringify(stored)
  for (const name of ['DOE', 'JANE', '18000', 'X0000']) check(!text.includes(name), `The saved layout holds "${name}".`)
  check(stored.kind === 'file' && stored.schema === 2, 'The saved layout has the wrong kind.')
  const own = await page.evaluate(() => Object.values(window.hub.state.ownValues)[0])
  check(Object.values(own.own_values).includes('National ID :'), "The company's own value was not saved.")
  check(!text.includes('National ID'), "The company's own value is in the body, where publishing would lose it.")
  await app.getByRole('button', { name: 'Publish as version 1' }).click()
  await app.getByRole('dialog', { name: 'Use version 1 now?' }).getByRole('button', { name: 'Use version 1' }).click()
  await app.getByTestId('template-in-use').getByText('version 1 (published)').waitFor()

  // The payslip, from the published version.
  await nav('Payslips')
  await app.getByTestId('payslip-page').waitFor()
  const paper = await app.getByTestId('payslip-page').textContent()
  for (const printed of ['Payslip', 'ABC Co Ltd', 'DOE JANE', 'National ID :']) check(paper.includes(printed), `The preview does not show "${printed}".`)
  check(!paper.includes('SAMPLE PERSON'), 'The text of the uploaded example is still on the payslip.')
  if (shots) {
    await page.setViewportSize({ width: 1600, height: 2600 })
    await page.evaluate(() => (document.getElementById('app').style.height = '2560px'))
    await app.getByTestId('payslip-page').screenshot({ path: join(shots, '7-preview.png') })
    await page.evaluate(() => (document.getElementById('app').style.height = '1000px'))
    await page.setViewportSize({ width: 1600, height: 1040 })
  }
  await shot('7b-payslips-page')

  const download = async (name) => {
    const [file] = await Promise.all([page.waitForEvent('download'), app.getByRole('button', { name }).first().click()])
    return readFileSync(await file.path())
  }
  const zip = await download(/PDF/)
  const pdfs = Object.entries(unzipSync(zip))
  check(pdfs.length === 7, `The PDF zip holds ${pdfs.length} files.`)
  check(pdfs.every(([, bytes]) => new TextDecoder('latin1').decode(bytes.slice(0, 5)) === '%PDF-'), 'A file in the zip is not a PDF.')
  const xlsx = await download(/Excel/)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(xlsx)
  check(workbook.worksheets.length === 7, `The workbook has ${workbook.worksheets.length} sheets.`)
  check(workbook.worksheets[0].getCell('C14').value === fixture[0]['Basic Salary'], 'The Excel figure is wrong.')
  if (shots) {
    writeFileSync(join(shots, 'DOE JANE - 2026-09.pdf'), pdfs[0][1])
    writeFileSync(join(shots, 'payslips-2026-09.xlsx'), xlsx)
  }

  // Issuing waits for Stage 2, and says so.
  const issued = await page.evaluate(() => window.log.filter((m) => m.payload?.dataType === 'payslip-issue' && m.type === 'send-data').length)
  check(issued === 0, 'Something was issued.')

  // History and Restore.
  await nav('Template')
  await app.getByRole('button', { name: 'History' }).click()
  await app.getByTestId('sheet-history').getByText('Version 1', { exact: true }).waitFor()
  await shot('8-history')
  await app.getByRole('button', { name: /^Restore/ }).click()
  await app.getByTestId('template-saved').waitFor()

  check(outside.length === 0, `Requests to other addresses: ${[...new Set(outside)].join(', ')}`)
  check(pageErrors.length === 0, `Page errors: ${pageErrors.join(' | ')}`)
} finally {
  await browser.close()
}

if (problems.length > 0) {
  console.error(`\nFrom your file check FAILED:\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log('From your file check passed: upload, cells, save, own value, publish, use, preview, PDF, Excel, history.')
