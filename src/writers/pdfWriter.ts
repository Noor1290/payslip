// The PDF writer draws the layout model's drawing list onto an A4 page with the bundled font
// embedded. It formats and calculates nothing: every character comes from the layout model.

import fontkit from '@pdf-lib/fontkit'
import { decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, rgb, type PDFFont } from 'pdf-lib'
import type { PayslipDocument } from '../lib/layoutModel'
import { withValidCffHeader } from './fontProgram'
import { layoutPage, type FontName } from './pageGeometry'

export interface PdfFonts {
  regular: Uint8Array
  bold: Uint8Array
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

export async function writePayslipPdf(doc: PayslipDocument, fonts: PdfFonts): Promise<Uint8Array> {
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

  const sheet = pdf.addPage([page.width, page.height])
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
    })
  }
  for (const text of page.texts) {
    sheet.drawText(text.text, {
      x: text.x,
      y: flip(text.y),
      size: text.size,
      font: embedded[text.font],
      color: rgb(0, 0, 0),
    })
  }

  // The fonts are written into the document here, so that their font programs can be repaired.
  await pdf.flush()
  for (const font of Object.values(embedded)) repairFontProgram(pdf, font)

  return pdf.save()
}
