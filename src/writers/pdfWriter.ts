// The PDF writer draws the layout model's drawing list onto an A4 page with the bundled font
// embedded. It formats and calculates nothing: every character comes from the layout model.

import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, rgb } from 'pdf-lib'
import type { PayslipDocument } from '../lib/layoutModel'
import { layoutPage, type FontName } from './pageGeometry'

export interface PdfFonts {
  regular: Uint8Array
  bold: Uint8Array
}

function colour(hex: string) {
  const channel = (start: number) => parseInt(hex.slice(start, start + 2), 16) / 255
  return rgb(channel(0), channel(2), channel(4))
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
  const embedded: Record<FontName, Awaited<ReturnType<typeof pdf.embedFont>>> = {
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

  return pdf.save()
}
