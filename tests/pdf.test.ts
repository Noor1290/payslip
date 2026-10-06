import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { beforeAll, describe, expect, it } from 'vitest'
import { documentTexts } from '../src/lib/layoutModel'
import { writePayslipPdf } from '../src/writers/pdfWriter'
import { fixtureDocuments } from './fixtureDocuments'
import { expectRecorded, readFont, readRecorded } from './helpers'

interface PdfText {
  text: string
  /** Left edge and baseline in points from the top left, rounded to 0.5pt. */
  x: number
  y: number
  font: string
  size: number
}
interface PdfRecord {
  pages: number
  width: number
  height: number
  texts: PdfText[]
  metadata: Record<string, unknown>
}

const half = (value: number) => Math.round(value * 2) / 2

/**
 * The font of each piece of text, in drawing order, read from the page's own instructions:
 * every "/Name size Tf" operator, with the name looked up in the page's font list.
 */
async function fontsInDrawingOrder(bytes: Uint8Array): Promise<string[]> {
  const pdf = await PDFDocument.load(bytes)
  const node = pdf.getPage(0).node
  const fontDict = node.Resources()!.lookup(PDFName.of('Font'), PDFDict)
  const baseFont = new Map<string, string>()
  for (const [key, value] of fontDict.entries()) {
    const font = pdf.context.lookup(value, PDFDict)
    const name = font.lookup(PDFName.of('BaseFont'), PDFName).decodeText()
    // pdf-lib adds a random number after the name ("Name-1095"), and subset fonts may carry a
    // random 6-letter prefix ("ABCDEF+Name"). Neither is part of the font's identity.
    baseFont.set(key.decodeText(), name.replace(/^[A-Z]{6}\+/, '').replace(/-\d+$/, ''))
  }
  const contents = node.Contents()
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => pdf.context.lookup(ref)) : [contents]
  let code = ''
  for (const stream of streams) {
    if (stream instanceof PDFRawStream) code += `${Buffer.from(decodePDFRawStream(stream).decode()).toString('latin1')}\n`
  }
  return [...code.matchAll(/\/(\S+)\s+[\d.]+\s+Tf/g)].map((match) => baseFont.get(match[1]) ?? `unknown font ${match[1]}`)
}

/** Reads a generated PDF back with pdf.js: the text, where it is, and in which font and size. */
async function readPdf(bytes: Uint8Array): Promise<PdfRecord> {
  const fonts = await fontsInDrawingOrder(bytes)
  const task = getDocument({ data: bytes.slice(), useSystemFonts: false, disableFontFace: true, verbosity: 0 })
  const pdf = await task.promise
  const page = await pdf.getPage(1)
  const [, , width, height] = page.view
  const content = await page.getTextContent()
  const texts: PdfText[] = []
  for (const item of content.items) {
    if (!('str' in item) || item.str.trim() === '') continue
    texts.push({
      text: item.str,
      x: half(item.transform[4]),
      y: half(height - item.transform[5]),
      font: fonts[texts.length] ?? '',
      size: Math.round(item.transform[0] * 10) / 10,
    })
  }
  if (fonts.length !== texts.length) throw new Error(`Read ${texts.length} texts but ${fonts.length} font choices.`)
  const { info } = await pdf.getMetadata()
  const meta = info as Record<string, unknown>
  const record = {
    pages: pdf.numPages,
    width,
    height,
    texts,
    metadata: { Title: meta.Title, Author: meta.Author ?? null, Producer: meta.Producer, Creator: meta.Creator },
  }
  await task.destroy()
  return record
}

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
