import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { fontRecord, readPdfFonts } from './pdfFonts'

// Reads a generated PDF back: its fonts, the text, where it is, and in which font and size. Shared by the
// PDF recordings and by the test that a reopened payslip prints exactly as it was issued.

export interface PdfText {
  text: string
  /** Left edge and baseline in points from the top left, rounded to 0.5pt. */
  x: number
  y: number
  font: string
  size: number
}
export interface PdfRecord {
  pages: number
  width: number
  height: number
  /** The fonts of the page: name, whether the font program is embedded, and its header. */
  fonts: ReturnType<typeof fontRecord>[]
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
export async function readPdf(bytes: Uint8Array): Promise<PdfRecord> {
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
    fonts: (await readPdfFonts(bytes)).fonts.map(fontRecord),
    texts,
    metadata: { Title: meta.Title, Author: meta.Author ?? null, Producer: meta.Producer, Creator: meta.Creator },
  }
  await task.destroy()
  return record
}
