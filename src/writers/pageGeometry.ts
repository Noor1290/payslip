// Turns the layout model into drawing instructions for one A4 page: filled rectangles, lines and
// text at exact positions, in PDF points with the origin at the TOP left. The preview (SVG) and
// the PDF writer both draw this same list, so what is on screen is what is in the PDF.
// Text widths come from the bundled font metrics table, not from the browser.

import metricsJson from '../assets/fonts/metrics.json'
import type { DocCell, PayslipDocument } from '../lib/layoutModel'

export type FontName = 'regular' | 'bold'

export interface FontMetrics {
  postscriptName: string
  unitsPerEm: number
  capHeight: number
  widths: Record<string, number>
}

export const FONT_METRICS = metricsJson as unknown as Record<FontName, FontMetrics>

export interface DrawRect {
  x: number
  y: number
  w: number
  h: number
  fill: string
}
export interface DrawLine {
  x1: number
  y1: number
  x2: number
  y2: number
  width: number
  color: string
}
export interface DrawText {
  /** Left edge of the text. */
  x: number
  /** Baseline. */
  y: number
  text: string
  font: FontName
  size: number
}
export interface DrawList {
  width: number
  height: number
  rects: DrawRect[]
  lines: DrawLine[]
  texts: DrawText[]
  /** Characters the payslip font cannot print. A page with any of these must not be exported. */
  unsupported: string[]
  /** Texts too long for their cell even at the smallest size. Also blocks the export. */
  overflow: string[]
}

export const PAGE = { width: 595.28, height: 841.89 } // A4 portrait, in points
const MARGIN_X = 40
const TOP = 56
const ROW_HEIGHT = 17
const PADDING_X = 4
/** The reference's 11 and 12 point Excel sizes, as printed sizes on the page. */
const PRINT_SIZE: Record<DocCell['size'], number> = { 11: 10, 12: 11 }
const MIN_SIZE = 6
const INK = '000000'
const GREY = 'CCCCCC'
const LINE = { medium: 1.25, grey: 1, thick: 2 }

const round = (value: number) => Math.round(value * 100) / 100

/** Width of `text` at `size`, and any characters the font lacks. */
export function measureText(text: string, font: FontName, size: number): { width: number; missing: string[] } {
  const metrics = FONT_METRICS[font]
  let units = 0
  const missing: string[] = []
  for (const char of text) {
    const advance = metrics.widths[String(char.codePointAt(0))]
    if (advance === undefined) missing.push(char)
    else units += advance
  }
  return { width: (units * size) / metrics.unitsPerEm, missing }
}

export function layoutPage(doc: PayslipDocument): DrawList {
  const contentWidth = PAGE.width - 2 * MARGIN_X
  const totalWidth = doc.columnWidths.reduce((sum, width) => sum + width, 0)
  const colX: number[] = [MARGIN_X]
  for (const width of doc.columnWidths) colX.push(colX[colX.length - 1] + (contentWidth * width) / totalWidth)
  const left = colX[0]
  const right = colX[4]
  const rowTop = (index: number) => TOP + index * ROW_HEIGHT
  const bottom = rowTop(doc.rows.length)

  const rects: DrawRect[] = []
  const greyRules: DrawLine[] = []
  const blackRules: DrawLine[] = []
  const texts: DrawText[] = []
  const unsupported = new Set<string>()
  const overflow: string[] = []

  doc.rows.forEach((row, index) => {
    const top = rowTop(index)
    if (row.fill) rects.push({ x: round(left), y: round(top), w: round(right - left), h: ROW_HEIGHT, fill: row.fill })
    if (row.ruleBelow) {
      const y = round(top + ROW_HEIGHT)
      const rule = { x1: round(left), y1: y, x2: round(right), y2: y }
      if (row.ruleBelow === 'grey') greyRules.push({ ...rule, width: LINE.grey, color: GREY })
      else blackRules.push({ ...rule, width: LINE.medium, color: INK })
    }

    for (const cell of row.cells) {
      if (cell.text === '') continue
      const font: FontName = cell.bold ? 'bold' : 'regular'
      const cellLeft = colX[cell.col] + PADDING_X
      const cellRight = colX[cell.col + cell.span] - PADDING_X
      const available = cellRight - cellLeft
      let size = PRINT_SIZE[cell.size]
      let measured = measureText(cell.text, font, size)
      for (const char of measured.missing) unsupported.add(char)
      // A long name must never be cut off or run into the next column: it is set smaller instead.
      if (measured.width > available) {
        size = Math.max(MIN_SIZE, Math.floor(((size * available) / measured.width) * 10) / 10)
        measured = measureText(cell.text, font, size)
        if (measured.width > available + 0.01) overflow.push(cell.text)
      }
      const x =
        cell.align === 'left'
          ? cellLeft
          : cell.align === 'right'
            ? cellRight - measured.width
            : (cellLeft + cellRight - measured.width) / 2
      // Centre the capital letters in the row, whatever the size.
      const capHeight = (FONT_METRICS[font].capHeight / FONT_METRICS[font].unitsPerEm) * size
      const y = top + ROW_HEIGHT / 2 + capHeight / 2
      texts.push({ x: round(x), y: round(y), text: cell.text, font, size })
    }
  })

  const dividerIndex = doc.rows.findIndex((row) => row.id === doc.dividerFromRowId)
  const divider: DrawLine[] =
    dividerIndex < 0
      ? []
      : [{ x1: round(colX[2]), y1: round(rowTop(dividerIndex)), x2: round(colX[2]), y2: round(bottom), width: LINE.thick, color: INK }]

  const box = { x1: round(left), y1: round(TOP), x2: round(right), y2: round(bottom) }
  const outline: DrawLine[] = [
    { x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y1, width: LINE.medium, color: INK },
    { x1: box.x1, y1: box.y2, x2: box.x2, y2: box.y2, width: LINE.medium, color: INK },
    { x1: box.x1, y1: box.y1, x2: box.x1, y2: box.y2, width: LINE.medium, color: INK },
    { x1: box.x2, y1: box.y1, x2: box.x2, y2: box.y2, width: LINE.medium, color: INK },
  ]

  return {
    width: PAGE.width,
    height: PAGE.height,
    rects,
    lines: [...greyRules, ...blackRules, ...divider, ...outline],
    texts,
    unsupported: [...unsupported],
    overflow,
  }
}
