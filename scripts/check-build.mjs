// Checks the production build:
//   1. no file in dist/ loads anything from an outside server (static scan);
//   2. using the real app (import, both screens, PDF zip, Excel) makes 0 requests to any other
//      origin and writes nothing to browser storage;
//   3. the downloaded files are what they claim to be.
// Run after `npm run build`: node scripts/check-build.mjs
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'
import { chromium } from 'playwright'
import { startPreview } from './lib/preview-server.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = join(root, 'dist')
const problems = []
const note = (text) => console.log(`  ${text}`)

if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/ is missing. Run "npm run build" first.')
  process.exit(1)
}

// 1. Static scan: tags and CSS that would fetch from another host.
const files = []
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path)
    else files.push(path)
  }
}
walk(dist)
const loaders = [
  /<(?:script|img|iframe|source|video|audio)[^>]+src=["']?(?:https?:)?\/\//i,
  /<link[^>]+href=["']?(?:https?:)?\/\//i,
  /url\(\s*["']?(?:https?:)?\/\//i,
  /@import\s+["'](?:https?:)?\/\//i,
]
for (const file of files.filter((f) => /\.(html|css)$/.test(f))) {
  const text = readFileSync(file, 'utf8')
  for (const pattern of loaders) {
    if (pattern.test(text)) problems.push(`${file.replace(root, '.')} loads something from another host (${pattern})`)
  }
}
console.log(`Static scan: ${files.length} files in dist/.`)

// 2 and 3. Drive the built app and watch every request.
const server = await startPreview()
const browser = await chromium.launch()
try {
  const context = await browser.newContext({ acceptDownloads: true })
  const page = await context.newPage()
  const outside = []
  let requests = 0
  page.on('request', (request) => {
    requests++
    const url = request.url()
    if (!url.startsWith(server.origin) && !url.startsWith('data:') && !url.startsWith('blob:')) outside.push(url)
  })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(String(error)))

  await page.goto(server.url)
  await page.getByRole('button', { name: 'Try with fake sample data' }).click()
  await page.getByRole('img', { name: /Payslip of DOE JANE/ }).waitFor()

  // The three rounding differences block the download until they are accepted.
  const pdfButton = page.getByRole('button', { name: 'Download PDFs (zip)' })
  if (!(await pdfButton.isDisabled())) problems.push('The download was not blocked while differences were pending.')
  await page.getByRole('button', { name: /Accept 3 rounding differences/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Accept 3' }).click()

  const [zipDownload] = await Promise.all([page.waitForEvent('download'), pdfButton.click()])
  const zipBytes = readFileSync(await zipDownload.path())
  const entries = Object.keys(unzipSync(new Uint8Array(zipBytes)))
  note(`zip: ${zipDownload.suggestedFilename()} with ${entries.length} files`)
  if (zipDownload.suggestedFilename() !== 'ABC Co Ltd - payslips - 2026-09.zip') problems.push('Unexpected zip file name.')
  if (entries.length !== 7 || !entries.includes('DOE JANE - 2026-09.pdf')) problems.push(`Unexpected zip content: ${entries.join(', ')}`)
  for (const [name, bytes] of Object.entries(unzipSync(new Uint8Array(zipBytes)))) {
    if (Buffer.from(bytes.slice(0, 5)).toString('latin1') !== '%PDF-') problems.push(`${name} is not a PDF.`)
  }

  const [xlsxDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download Excel' }).click(),
  ])
  const sheets = Object.keys(unzipSync(new Uint8Array(readFileSync(await xlsxDownload.path())))).filter((name) =>
    /^xl\/worksheets\/sheet\d+\.xml$/.test(name),
  )
  note(`xlsx: ${xlsxDownload.suggestedFilename()} with ${sheets.length} sheets`)
  if (sheets.length !== 7) problems.push(`Expected 7 sheets in the workbook, found ${sheets.length}.`)

  // A real file through the file picker: the fake "problems" sample, one problem per employee.
  await page.locator('input[type="file"]').setInputFiles(join(root, 'samples', 'PROBLEMS ABC Co Ltd-pdf-fill-2026-09.json'))
  // Same company, month and people as the data already open: adding is not possible, so Replace.
  const importDialog = page.getByRole('dialog', { name: 'Import payroll data' })
  if (!(await importDialog.getByRole('radio', { name: /Add to the 7 employees/ }).isDisabled())) problems.push('Add to was offered for employees who are already in the list.')
  await importDialog.getByRole('button', { name: 'Replace with 7 employees' }).click()
  const badges = await page.getByRole('region', { name: 'Employees' }).locator('.card-header .badge').allTextContents()
  note(`problems sample: ${badges.join(', ')}`)
  if (badges.join(', ') !== '1 ready, 3 to accept, 3 to fix') problems.push(`Problems sample gave "${badges.join(', ')}".`)
  if (!(await page.getByRole('button', { name: 'Download PDFs (zip)' }).isDisabled())) {
    problems.push('The download was not blocked for payslips with errors.')
  }
  await page.getByRole('button', { name: 'PALMYRE JEAN MARC' }).click()
  const missing = await page.getByRole('alert').filter({ hasText: 'Employee CSG' }).count()
  if (missing !== 1) problems.push('The missing Employee CSG was not shown as an error for that employee.')
  if ((await page.getByTestId('payslip-page').count()) !== 0) problems.push('A payslip with an error was still drawn.')

  await page.getByRole('button', { name: 'Template', exact: true }).click()
  await page.getByRole('heading', { name: 'Where each line comes from' }).waitFor()
  await page.getByRole('button', { name: 'Statutory rates', exact: true }).click()
  await page.getByRole('heading', { name: 'Worked example' }).waitFor()

  const storage = await page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    databases: indexedDB.databases ? (await indexedDB.databases()).length : 0,
    cookies: document.cookie.length,
  }))
  note(`requests: ${requests}, to other origins: ${outside.length}`)
  note(`browser storage after use: ${JSON.stringify(storage)}`)
  if (outside.length > 0) problems.push(`Requests to outside servers: ${[...new Set(outside)].join(', ')}`)
  if (storage.local + storage.session + storage.databases + storage.cookies > 0) {
    problems.push(`Something was written to browser storage: ${JSON.stringify(storage)}`)
  }
  if (pageErrors.length > 0) problems.push(`Page errors: ${pageErrors.join(' | ')}`)
} finally {
  await browser.close()
  await server.close()
}

if (problems.length > 0) {
  console.error(`\nBuild check FAILED:\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
console.log('Build check passed: 0 requests to outside servers, nothing in browser storage.')
