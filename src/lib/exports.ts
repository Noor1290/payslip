// Building the downloadable files. Everything happens in memory in the browser; the heavy
// libraries (PDF, Excel, zip) are loaded only when a download is asked for.

import boldFontUrl from '../assets/fonts/texgyrepagella-bold.otf?url'
import regularFontUrl from '../assets/fonts/texgyrepagella-regular.otf?url'
import { payslipFileNames } from './build'
import type { PayslipDocument } from './layoutModel'

async function fontBytes(url: string): Promise<Uint8Array> {
  // The fonts ship with the app, so this request stays on the app's own origin.
  const response = await fetch(url)
  if (!response.ok) throw new Error('The payslip font could not be loaded.')
  return new Uint8Array(await response.arrayBuffer())
}

/** One PDF per employee, zipped. */
export async function buildPdfZip(docs: readonly PayslipDocument[], period: string): Promise<Uint8Array> {
  const [{ writePayslipPdf }, { zipSync }, regular, bold] = await Promise.all([
    import('../writers/pdfWriter'),
    import('fflate'),
    fontBytes(regularFontUrl),
    fontBytes(boldFontUrl),
  ])
  const names = payslipFileNames(
    docs.map((doc) => doc.employeeName),
    period,
  )
  const files: Record<string, Uint8Array> = {}
  for (let index = 0; index < docs.length; index++) {
    files[names[index]] = await writePayslipPdf(docs[index], { regular, bold })
  }
  // PDFs are already compressed; storing them keeps the zip fast.
  return zipSync(files, { level: 0 })
}

/** One workbook with a sheet per employee. */
export async function buildWorkbook(docs: readonly PayslipDocument[]): Promise<Uint8Array> {
  const { writePayslipWorkbook } = await import('../writers/excelWriter')
  return writePayslipWorkbook(docs)
}

/** Hands a file to the browser's download, then lets go of it. Nothing is stored. */
export function download(bytes: Uint8Array, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function exportBaseName(companyName: string, period: string): string {
  const clean = companyName.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim() || 'Company'
  return `${clean} - payslips - ${period}`
}

/** One company's part of the zip for several companies: where its files go, and its payslips. */
export interface CompanyFiles {
  payslips: readonly string[]
  combined: string
  workbook: string
  documents: readonly PayslipDocument[]
}

/**
 * The zip for several companies: a folder per company with each employee's PDF, one PDF with all
 * of that company's payslips, and its Excel file; the report at the top. Each payslip is drawn
 * once, by the same writer as a single download; the combined PDF is made of those same pages.
 * `onCompany` is told as each company's files are done.
 */
export async function buildCompaniesZip(
  companies: readonly CompanyFiles[],
  report: { path: string; text: string },
  onCompany: (done: number) => void = () => {},
): Promise<Uint8Array> {
  const [regular, bold] = await Promise.all([fontBytes(regularFontUrl), fontBytes(boldFontUrl)])
  return writeCompaniesZip(companies, report, { regular, bold }, onCompany)
}

/** buildCompaniesZip with the font files given: the tests read them from disk. */
export async function writeCompaniesZip(
  companies: readonly CompanyFiles[],
  report: { path: string; text: string },
  fonts: { regular: Uint8Array; bold: Uint8Array },
  onCompany: (done: number) => void = () => {},
): Promise<Uint8Array> {
  const [{ writePayslipPdf }, { writePayslipWorkbook }, { zipSync, strToU8 }, { PDFDocument }] = await Promise.all([
    import('../writers/pdfWriter'),
    import('../writers/excelWriter'),
    import('fflate'),
    import('pdf-lib'),
  ])
  const { regular, bold } = fonts
  const files: Record<string, Uint8Array> = {}
  for (const [index, company] of companies.entries()) {
    const combined = await PDFDocument.create()
    for (let n = 0; n < company.documents.length; n++) {
      const single = await writePayslipPdf(company.documents[n], { regular, bold })
      files[company.payslips[n]] = single
      const source = await PDFDocument.load(single)
      for (const page of await combined.copyPages(source, source.getPageIndices())) combined.addPage(page)
    }
    combined.setTitle(company.combined.split('/').pop()!.replace(/\.pdf$/, ''))
    combined.setProducer('Payslip app')
    combined.setCreator('Payslip app')
    files[company.combined] = await combined.save()
    files[company.workbook] = await writePayslipWorkbook(company.documents)
    onCompany(index + 1)
  }
  files[report.path] = strToU8(report.text)
  // PDFs and Excel files are already compressed; storing them keeps the zip fast.
  return zipSync(files, { level: 0 })
}
