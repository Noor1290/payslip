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

const sample = JSON.parse(readFileSync(join(root, 'tests/fixtures/ABC Co Ltd-pdf-fill-2026-09.json'), 'utf8'))
// One more fake employee, with a name too long for its cell on one line at 9 points.
const LONG = { surname: 'SAMPLELONGSURNAME', other: 'Annabelle Marie-Claire Josephine' }
// Its payroll has no Allowances: a figure missing, to be treated as zero for this employee.
const { Allowances: _allowances, ...withoutAllowances } = sample[0]
const fixture = [...sample, { ...withoutAllowances, ID: 'X0000000000077', Surname: LONG.surname, 'Other names': LONG.other }]
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
  // Tall enough that a screenshot of a whole section is not cut by the frame.
  if (shots) {
    await page.setViewportSize({ width: 1600, height: 2600 })
    await page.evaluate(() => (document.getElementById('app').style.height = '2560px'))
  }
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
  await field(app, 'Detail').selectOption('addressLines')
  check((await app.getByTestId('address-hint').count()) === 1, 'The address on two lines says nothing of how it is split.')
  await shot('9-address-on-two-lines')
  await open('C10')
  await goes('employee')
  check((await app.getByTestId('name-hint').count()) === 1, 'A name cell does not say how a long name is fitted.')
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
  const total = (which) => field(app, "This cell is the payslip's").selectOption(which)
  await figure('C18', 'Gross Pay')
  await total('earnings')
  await figure('E18', 'Total deductions')
  await total('deductions')
  await open('E20')
  await goes('calc')
  await shot('5-calculation')
  await field(app, 'Figure').fill('Gross Pay')
  await app.getByRole('button', { name: 'Add a part' }).click()
  await field(app.getByTestId('calc-part').nth(1), 'Part 2').selectOption('-1')
  await field(app.getByTestId('calc-part').nth(1), 'Figure').fill('Total deductions')
  await total('net')
  await shot('12-net-pay-total')
  await open('C23')
  await goes('today')

  // A fixed value for this company only.
  await open('B11')
  await goes('fixed')
  await field(app, 'Value for all companies').fill('NIC :')
  await app.getByLabel('ABC Co Ltd has its own value').check()
  await field(app, 'Value for ABC Co Ltd only').fill('National ID :')
  check((await app.getByTestId('applies').textContent()).includes('ABC Co Ltd only'), 'The cell does not say whose value applies.')

  // A required cell that stays empty: beside "Signature Employer :", a fixed value left blank.
  await app.getByRole('button', { name: /^Cell E22:/ }).click()
  if ((await app.getByTestId('sheet-cell-new').count()) > 0) await app.getByRole('button', { name: 'Use this cell' }).click()
  await app.getByTestId('sheet-cell-editor').waitFor()
  await goes('fixed')
  await field(app, 'Value for all companies').fill('')
  await app.getByRole('checkbox', { name: /^Required/ }).check()
  await shot('13-required-cell')

  // A row added and removed.
  await open('B22')
  await app.getByRole('button', { name: 'Add above' }).click()
  check((await app.getByRole('button', { name: /^Cell B25:/ }).count()) === 1, 'A row was not added.')
  await app.getByRole('button', { name: /^Cell B22:/ }).click()
  await app.getByRole('button', { name: 'Remove row' }).click()
  check((await app.getByRole('button', { name: /^Cell B25:/ }).count()) === 0, 'A row was not removed.')
  await shot('6-grid-with-values')

  // The page settings: the scale shown, the warning below 85%, Narrow margins print larger.
  const scaleText = async () => (await app.getByTestId('sheet-scale').textContent()).trim()
  const percent = (text) => Number(/(\d+)%/.exec(text)?.[1])
  const normal = percent(await scaleText())
  check(normal > 0 && normal < 85, `The fake layout prints at ${normal}% with Normal margins.`)
  check((await app.getByTestId('sheet-small-print').count()) === 1, 'Below 85% there is no warning.')
  await app.getByTestId('sheet-page').scrollIntoViewIfNeeded()
  await shot('10-page-settings')
  await field(app.getByTestId('sheet-page'), 'Margins').selectOption('narrow')
  const narrow = percent(await scaleText())
  check(narrow > normal, `Narrow margins do not print larger (${normal}% then ${narrow}%).`)
  await field(app.getByTestId('sheet-page'), 'Orientation').selectOption('landscape')
  check(percent(await scaleText()) > narrow, 'Landscape does not print larger.')
  await field(app.getByTestId('sheet-page'), 'Orientation').selectOption('portrait')

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
  if (shots) await app.getByTestId('payslip-page').screenshot({ path: join(shots, '7-preview.png'), animations: 'disabled' })
  await shot('7b-payslips-page')

  // The long name: on two lines, the surname whole on the first, nothing cut.
  await app.getByRole('button', { name: `${LONG.surname} ${LONG.other}` }).click()
  // Its Allowances are missing: an error, until treated as zero for this employee, with a reason.
  const checks = app.getByRole('region', { name: `Checks for ${LONG.surname} ${LONG.other}` })
  check((await checks.textContent()).includes('Cell C16: the payroll data has no "Allowances" for this employee.'), 'The missing figure is not named by its cell.')
  if (shots) await checks.screenshot({ path: join(shots, '14-missing-figure.png') })
  await checks.getByRole('button', { name: 'Treat as zero for this employee' }).click()
  const zeroDialog = app.getByRole('dialog', { name: 'Treat cell C16 (Allowances) as zero?' })
  await zeroDialog.waitFor()
  if (shots) await zeroDialog.screenshot({ path: join(shots, '15-treat-as-zero.png') })
  await zeroDialog.getByLabel('Reason').fill('No allowance this month')
  await zeroDialog.getByRole('button', { name: 'Treat as zero' }).click()
  await app.getByTestId('payslip-page').waitFor()
  check((await checks.textContent()).includes('Treated as zero.'), 'The cell treated as zero is not shown with its reason.')
  if (shots) await checks.screenshot({ path: join(shots, '16-checks-card.png') })
  const longPaper = await app.getByTestId('payslip-page').textContent()
  check(longPaper.includes(LONG.surname) && longPaper.includes('Josephine'), 'The long name is not all on the payslip.')
  check(!(await app.getByTestId('payslip-page').textContent()).includes(`${LONG.surname} ${LONG.other}`), 'The long name was not put on two lines.')
  if (shots) await app.getByTestId('payslip-page').screenshot({ path: join(shots, '11-long-name.png'), animations: 'disabled' })

  // The Net Pay check: the payroll's net pay is a cent away for some employees; accepted as rounding.
  await app.getByRole('button', { name: /^Accept \d+ rounding difference/ }).click()
  await app.getByRole('dialog', { name: 'Accept the rounding differences?' }).getByRole('button', { name: /^Accept \d+$/ }).click()

  // The required cell is empty for everyone: listed first, then downloaded anyway.
  const download = async (name) => {
    const [file] = await Promise.all([
      page.waitForEvent('download'),
      (async () => {
        await app.getByRole('button', { name }).first().click()
        const asked = app.getByRole('dialog', { name: /required cells? (is|are) empty/ })
        await asked.waitFor()
        check((await asked.getByTestId('required-list').textContent()).includes('DOE JANE: cell E22'), 'The empty required cell is not listed by employee and cell.')
        if (shots && name.source === 'PDF') await asked.screenshot({ path: join(shots, '17-required-before-download.png') })
        await asked.getByRole('button', { name: 'Download anyway' }).click()
      })(),
    ])
    return readFileSync(await file.path())
  }
  const zip = await download(/PDF/)
  const pdfs = Object.entries(unzipSync(zip))
  check(pdfs.length === fixture.length, `The PDF zip holds ${pdfs.length} files.`)
  check(pdfs.every(([, bytes]) => new TextDecoder('latin1').decode(bytes.slice(0, 5)) === '%PDF-'), 'A file in the zip is not a PDF.')
  const xlsx = await download(/Excel/)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(xlsx)
  check(workbook.worksheets.length === fixture.length, `The workbook has ${workbook.worksheets.length} sheets.`)
  const longSheet = workbook.worksheets.at(-1)
  check(String(longSheet.getCell('C10').value).includes('\n') && longSheet.getCell('C10').alignment?.wrapText === true, 'In Excel, the long name is not on two lines.')
  check(longSheet.getRow(10).height > workbook.worksheets[0].getRow(10).height, "In Excel, the long name's row did not grow.")
  check(workbook.worksheets[0].pageSetup.margins?.left === 0.25, 'The Excel sheet does not have Narrow margins.')
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
console.log('From your file check passed: upload, cells, address on two lines, page settings, totals, required cell, save, own value, publish, use, preview, long name, treat as zero, rounding, required before download, PDF, Excel, history.')
