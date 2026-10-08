// Checks the production build:
//   1. no file in dist/ loads anything from an outside server (static scan);
//   2. using the real app (import, both screens, PDF zip, Excel) makes 0 requests to any other
//      origin and writes nothing to browser storage;
//   3. the downloaded files are what they claim to be;
//   4. the payslip font: the preview and the PDFs use the bundled font files, the preview draws
//      each text as wide as the shared geometry measured it, and every PDF embeds a font
//      program whose header a strict viewer accepts.
// Run after `npm run build`: node scripts/check-build.mjs
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFStream } from 'pdf-lib'
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

/** Name and header (4 bytes) of the font program of each font on the first page of a PDF. */
async function pdfFontHeaders(bytes) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false })
  const fonts = new Map()
  for (const [, ref] of pdf.getPage(0).node.Resources().lookup(PDFName.of('Font'), PDFDict).entries()) {
    const font = pdf.context.lookup(ref, PDFDict)
    const name = font.lookup(PDFName.of('BaseFont'), PDFName).decodeText().replace(/-\d+$/, '')
    const descriptor = font.lookup(PDFName.of('DescendantFonts'), PDFArray).lookup(0, PDFDict).lookup(PDFName.of('FontDescriptor'), PDFDict)
    const program = descriptor.lookupMaybe(PDFName.of('FontFile3'), PDFStream)
    fonts.set(name, program ? decodePDFRawStream(program).decode().slice(0, 4) : null)
  }
  return fonts
}

// 2, 3 and 4. Drive the built app and watch every request.
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
  const fontResponses = []
  page.on('response', (response) => {
    if (/texgyrepagella-[^/]*\.otf$/.test(new URL(response.url()).pathname)) fontResponses.push(response)
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
    if (Buffer.from(bytes.slice(0, 5)).toString('latin1') !== '%PDF-') {
      problems.push(`${name} is not a PDF.`)
      continue
    }
    const headers = await pdfFontHeaders(bytes)
    if ([...headers.keys()].sort().join(', ') !== 'TeXGyrePagella-Bold, TeXGyrePagella-Regular') problems.push(`${name} uses the fonts ${[...headers.keys()].join(', ')}.`)
    for (const [font, header] of headers) {
      // What a strict viewer checks before it uses the font: version 1, a header of 4 bytes or more, offset size 1 to 4.
      if (!header || header[0] !== 1 || header[2] < 4 || header[3] < 1 || header[3] > 4) {
        problems.push(`${name}: the embedded ${font} has a header a strict viewer refuses (${header ? header.join(' ') : 'not embedded'}).`)
      }
    }
  }

  // The preview: drawn with the bundled font, each text as wide as the shared geometry measured it.
  const metrics = JSON.parse(readFileSync(join(root, 'src/assets/fonts/metrics.json'), 'utf8'))
  const drawn = await page.getByTestId('payslip-page').evaluate(async (svg) => {
    await document.fonts.ready
    return {
      faces: [...document.fonts].filter((face) => face.family.replace(/["']/g, '') === 'Payslip Pagella').map((face) => `${face.weight} ${face.status}`).sort(),
      family: getComputedStyle(svg.querySelector('text')).fontFamily,
      texts: [...svg.querySelectorAll('text')].map((text) => ({
        text: text.textContent,
        size: Number(text.getAttribute('font-size')),
        font: text.getAttribute('font-weight') === '700' ? 'bold' : 'regular',
        length: text.getComputedTextLength(),
      })),
    }
  })
  if (drawn.faces.join(', ') !== '400 loaded, 700 loaded') problems.push(`The payslip font is not loaded in the preview: ${drawn.faces.join(', ')}`)
  if (!/^["']?Payslip Pagella/.test(drawn.family)) problems.push(`The preview text asks for the font ${drawn.family}.`)
  let widest = 0
  for (const text of drawn.texts) {
    const units = [...text.text].reduce((sum, char) => sum + metrics[text.font].widths[char.codePointAt(0)], 0)
    const difference = Math.abs(text.length - (units * text.size) / metrics[text.font].unitsPerEm)
    widest = Math.max(widest, difference)
    // The browser rounds glyph advances to its own grid: up to about 0.1 pt on the longest label.
    // Another font would differ by whole points... unless it has the same widths, hence the checks above.
    if (!(difference < 0.25)) problems.push(`The preview draws "${text.text}" ${text.length.toFixed(2)} wide, not as the payslip font measures it.`)
  }
  note(`preview: ${drawn.texts.length} texts in ${drawn.family.split(',')[0]}, largest width difference ${widest.toFixed(3)} pt`)

  // The preview and the PDF export load the same two files, and they are the bundled ones.
  const served = new Map()
  for (const response of fontResponses) served.set(response.url(), await response.body())
  const bundledFonts = ['regular', 'bold'].map((weight) => readFileSync(join(root, 'src/assets/fonts', `texgyrepagella-${weight}.otf`)))
  note(`font files loaded by the preview and the PDF export: ${[...served.keys()].map((url) => url.split('/').pop()).join(', ')}`)
  if (served.size !== 2) problems.push(`Expected the preview and the PDF export to share 2 font files, saw ${served.size}.`)
  for (const [url, body] of served) {
    if (!bundledFonts.some((font) => font.equals(body))) problems.push(`${url} is not one of the bundled payslip fonts.`)
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
