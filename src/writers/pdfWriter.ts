// The PDF writer draws the layout model's drawing list onto an A4 page with the bundled font
// embedded. It formats and calculates nothing: every character comes from the layout model.

import fontkit from '@pdf-lib/fontkit'
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { PayslipDocument } from '../lib/layoutModel'
import { isSheetDocument, type SheetDocument } from '../lib/sheetDocument'
import { withValidCffHeader } from './fontProgram'
import { layoutPage, type DrawList, type FontName, type SheetFontName } from './pageGeometry'
import { layoutSheet } from './sheetGeometry'

export interface PdfFonts {
  regular: Uint8Array
  bold: Uint8Array
  /** Needed only by layouts from a file. */
  italic?: Uint8Array
  boldItalic?: Uint8Array
}

function colour(hex: string) {
  const channel = (start: number) => parseInt(hex.slice(start, start + 2), 16) / 255
  return rgb(channel(0), channel(2), channel(4))
}

/** Puts a valid header on the font program pdf-lib embedded for `font` (see fontProgram.ts). */
function repairFontProgram(pdf: PDFDocument, font: PDFFont): void {
  const descendant = pdf.context.lookup(font.ref, PDFDict).lookup(PDFName.of('DescendantFonts'), PDFArray).lookup(0, PDFDict)
  const descriptor = descendant.lookup(PDFName.of('FontDescriptor'), PDFDict)
  const ref = descriptor.get(PDFName.of('FontFile3'))
  const stream = ref instanceof PDFRef ? pdf.context.lookup(ref) : undefined
  // The bundled fonts are OpenType with CFF outlines, so anything else here is a fault.
  if (!(ref instanceof PDFRef) || !(stream instanceof PDFRawStream)) throw new Error('The payslip font was not embedded in the PDF.')
  const program = withValidCffHeader(decodePDFRawStream(stream).decode())
  pdf.context.assign(ref, pdf.context.flateStream(program, { Subtype: stream.dict.get(PDFName.of('Subtype')) }))
}

/** Draws the list on the page: what the Table payslips and the layouts from a file share. */
function drawList(sheet: PDFPage, page: DrawList<SheetFontName>, embedded: Partial<Record<SheetFontName, PDFFont>>): void {
  const flip = (y: number) => page.height - y
  for (const rect of page.rects) {
    sheet.drawRectangle({ x: rect.x, y: flip(rect.y + rect.h), width: rect.w, height: rect.h, color: colour(rect.fill) })
  }
  for (const line of page.lines) {
    sheet.drawLine({
      start: { x: line.x1, y: flip(line.y1) },
      end: { x: line.x2, y: flip(line.y2) },
      thickness: line.width,
      color: colour(line.color),
      ...(line.dash ? { dashArray: line.dash } : {}),
    })
  }
  for (const text of page.texts) {
    sheet.drawText(text.text, {
      x: text.x,
      y: flip(text.y),
      size: text.size,
      font: embedded[text.font],
      color: text.color ? colour(text.color) : rgb(0, 0, 0),
    })
  }
}

/**
 * A payslip from a layout in a file. The dates in the file come from the payslip, not the clock,
 * and only the fonts it prints are embedded, so the same payslip gives the same bytes.
 */
async function writeSheetPdf(doc: SheetDocument, fonts: PdfFonts, fileDate: Date): Promise<Uint8Array> {
  const page = layoutSheet(doc)
  if (page.unsupported.length > 0) throw new Error(`The payslip font cannot print: ${page.unsupported.join(' ')}`)
  if (page.overflow.length > 0) throw new Error(`Too long to print on the payslip: ${page.overflow.join(' | ')}`)

  const pdf = await PDFDocument.create({ updateMetadata: false })
  pdf.registerFontkit(fontkit)
  const features = { liga: false, kern: false }
  const embedded: Partial<Record<SheetFontName, PDFFont>> = {}
  for (const name of ['regular', 'bold', 'italic', 'boldItalic'] as const) {
    if (!page.texts.some((text) => text.font === name)) continue
    const bytes = fonts[name]
    if (!bytes) throw new Error('The payslip font was not loaded.')
    embedded[name] = await pdf.embedFont(bytes, { subset: true, features })
  }

  pdf.setTitle(`Payslip - ${doc.employeeName} - ${doc.period}`)
  pdf.setProducer('Payslip app')
  pdf.setCreator('Payslip app')
  pdf.setCreationDate(fileDate)
  pdf.setModificationDate(fileDate)
  drawList(pdf.addPage([page.width, page.height]), page, embedded)

  await pdf.flush()
  for (const font of Object.values(embedded)) repairFontProgram(pdf, font)
  return pdf.save({ updateFieldAppearances: false })
}

/** `fileDate`: the date on the file of a payslip from a layout; a Table payslip has the clock's. */
export async function writePayslipPdf(doc: PayslipDocument | SheetDocument, fonts: PdfFonts, fileDate = new Date(0)): Promise<Uint8Array> {
  if (isSheetDocument(doc)) return writeSheetPdf(doc, fonts, fileDate)
  const page = layoutPage(doc)
  if (page.unsupported.length > 0) {
    throw new Error(`The payslip font cannot print: ${page.unsupported.join(' ')}`)
  }

  if (page.overflow.length > 0) {
    throw new Error(`Too long to print on the payslip: ${page.overflow.join(' | ')}`)
  }

  const pdf = await PDFDocument.create()
  pdf.registerFontkit(fontkit)
  // Ligatures and kerning are off so every character sits where the shared geometry put it.
  const features = { liga: false, kern: false }
  const embedded: Record<FontName, PDFFont> = {
    regular: await pdf.embedFont(fonts.regular, { subset: true, features }),
    bold: await pdf.embedFont(fonts.bold, { subset: true, features }),
  }

  pdf.setTitle(`Payslip - ${doc.employeeName} - ${doc.period}`)
  pdf.setProducer('Payslip app')
  pdf.setCreator('Payslip app')

  drawList(pdf.addPage([page.width, page.height]), page, embedded)

  // The fonts are written into the document here, so that their font programs can be repaired.
  await pdf.flush()
  for (const font of Object.values(embedded)) repairFontProgram(pdf, font)

  return pdf.save()
}
