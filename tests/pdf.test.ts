import { beforeAll, describe, expect, it } from 'vitest'
import { documentTexts } from '../src/lib/layoutModel'
import { writePayslipPdf } from '../src/writers/pdfWriter'
import { fixtureDocuments } from './fixtureDocuments'
import { expectRecorded, readFont, readRecorded } from './helpers'
import { readPdf, type PdfRecord } from './readPdf'

describe('PDF read back with pdf.js (recorded)', () => {
  const docs = fixtureDocuments()
  const fonts = { regular: readFont('regular'), bold: readFont('bold') }
  let first: PdfRecord
  let fractional: PdfRecord

  beforeAll(async () => {
    first = await readPdf(await writePayslipPdf(docs[0], fonts))
    fractional = await readPdf(await writePayslipPdf(docs[6], fonts))
  })

  it('is exactly the recorded page: text, position, font and size', () => {
    expectRecorded('pdf-doe-jane', first)
    expectRecorded('pdf-tempo-lea', fractional)
  })

  it('PROOF the recording can fail: one changed figure, or one moved text, no longer matches it', () => {
    const recorded = readRecorded<PdfRecord>('pdf-doe-jane')
    const value = structuredClone(first)
    value.texts.find((t) => t.text === '279.52')!.text = '279.53'
    expect(value).not.toEqual(recorded)

    const moved = structuredClone(first)
    moved.texts.find((t) => t.text === 'Payslip')!.x += 0.5
    expect(moved).not.toEqual(recorded)

    expect(first).toEqual(recorded)
  })

  it('is one A4 portrait page', () => {
    expect(first.pages).toBe(1)
    expect([first.width, first.height]).toEqual([595.28, 841.89])
  })

  it('prints exactly the texts of the layout model, nothing more and nothing less', () => {
    expect(first.texts.map((t) => t.text)).toEqual(documentTexts(docs[0]))
    expect(fractional.texts.map((t) => t.text)).toEqual(documentTexts(docs[6]))
  })

  it('embeds the bundled font: regular for lines, bold for headings', () => {
    const byText = (text: string) => first.texts.find((t) => t.text === text)!
    expect(byText('Basic Salary')).toMatchObject({ font: 'TeXGyrePagella-Regular', size: 10 })
    expect(byText('18,000')).toMatchObject({ font: 'TeXGyrePagella-Regular', size: 10 })
    expect(byText('Payslip')).toMatchObject({ font: 'TeXGyrePagella-Bold', size: 11 })
    expect(new Set(first.texts.map((t) => t.font))).toEqual(new Set(['TeXGyrePagella-Regular', 'TeXGyrePagella-Bold']))
  })

  it('lines the labels up on the left and the amounts further right', () => {
    const byText = (text: string) => first.texts.find((t) => t.text === text)!
    expect(byText('Basic Salary').x).toBe(byText('Total Earnings').x)
    expect(byText('18,000').x).toBeGreaterThan(byText('Basic Salary').x)
  })

  it('carries no author, and names the app as producer', () => {
    expect(first.metadata).toEqual({
      Title: 'Payslip - DOE JANE - 2026-09',
      Author: null,
      Producer: 'Payslip app',
      Creator: 'Payslip app',
    })
  })

  it('refuses to write a page with a character the font cannot print', async () => {
    const doc = structuredClone(docs[0])
    doc.rows.find((r) => r.id === 'employee-name')!.cells[1].text = 'DOE 中'
    await expect(writePayslipPdf(doc, fonts)).rejects.toThrow(/cannot print/)
  })
})
