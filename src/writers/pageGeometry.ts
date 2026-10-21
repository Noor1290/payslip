// Turns the layout model into drawing instructions for one A4 page: filled rectangles, lines and
// text at exact positions, in PDF points with the origin at the TOP left. The preview (SVG) and
// the PDF writer both draw this same list, so what is on screen is what is in the PDF.
// Text widths come from the bundled font metrics table, not from the browser.

import metricsJson from '../assets/fonts/metrics.json'
import { KNOWN_DRAWINGS, unknownDrawing, type DocCell, type DocRow, type PayslipDocument } from '../lib/layoutModel'

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

// DRAWING VERSION 1. Everything from here to the end of layoutPageV1 is frozen: payslips were
// issued with it and must always be drawn the same way (tests/format1.test.ts). A change to any
// number or rule below is a new drawing version, added beside this one, never in place of it.
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

/** Draws a payslip with the rules of its own drawing version. */
export function layoutPage(doc: PayslipDocument): DrawList {
  if (!KNOWN_DRAWINGS.includes(doc.drawing)) throw new Error(unknownDrawing(doc.drawing))
  return doc.drawing === 1 ? layoutPageV1(doc) : layoutPageV2(doc)
}

function layoutPageV1(doc: PayslipDocument): DrawList {
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

// DRAWING VERSION 2: version 1, and a name that does not fit on one line, even at the smallest
// size, may take two. Its row is then twice as tall and every row below it moves down by one row;
// a payslip whose name fits on one line is drawn exactly as in version 1. Frozen like version 1
// once payslips are issued with it.
const NAME_ROW_ID = 'employee-name'
const NAME_COL = 1

/** The left and right edges of the four columns, B to E. */
function columnEdges(doc: PayslipDocument): number[] {
  const contentWidth = PAGE.width - 2 * MARGIN_X
  const totalWidth = doc.columnWidths.reduce((sum, width) => sum + width, 0)
  const colX: number[] = [MARGIN_X]
  for (const width of doc.columnWidths) colX.push(colX[colX.length - 1] + (contentWidth * width) / totalWidth)
  return colX
}

/**
 * The size that fits every one of `lines` in `available` points: `normal`, or smaller down to
 * MIN_SIZE. Null when they do not fit even then. For one line this is the rule of version 1.
 */
function sizeToFit(lines: readonly string[], font: FontName, normal: number, available: number): number | null {
  const widest = (size: number) => Math.max(...lines.map((line) => measureText(line, font, size).width))
  if (widest(normal) <= available) return normal
  const size = Math.max(MIN_SIZE, Math.floor(((normal * available) / widest(normal)) * 10) / 10)
  return widest(size) <= available + 0.01 ? size : null
}

/**
 * The two lines of the name, when the payslip shows it on two: the name cell's text holds exactly
 * one line break where the name has a space. A line break the name itself contains is not one.
 */
function nameLinesOf(doc: PayslipDocument, row: DocRow, cell: DocCell): [string, string] | null {
  if (row.id !== NAME_ROW_ID || cell.col !== NAME_COL || doc.employeeName.includes('\n')) return null
  const lines = cell.text.split('\n')
  return lines.length === 2 && lines.join(' ') === doc.employeeName ? [lines[0], lines[1]] : null
}

/** The width a text of `cell` has in its column, between the paddings. */
function cellWidth(doc: PayslipDocument, cell: DocCell): number {
  const colX = columnEdges(doc)
  return colX[cell.col + cell.span] - colX[cell.col] - 2 * PADDING_X
}

/**
 * The name of a drawing-2 payslip as the page prints it: its one or two lines, its printed size,
 * and the normal size of its cell. Null for drawing 1, and for a name that does not fit.
 */
export function nameOnPage(doc: PayslipDocument): { lines: string[]; size: number; normal: number } | null {
  if (doc.drawing < 2) return null
  const row = doc.rows.find((found) => found.id === NAME_ROW_ID)
  const cell = row?.cells.find((found) => found.col === NAME_COL)
  if (!row || !cell || cell.text === '') return null
  const lines = nameLinesOf(doc, row, cell) ?? [cell.text]
  const normal = PRINT_SIZE[cell.size]
  const size = sizeToFit(lines, cell.bold ? 'bold' : 'regular', normal, cellWidth(doc, cell))
  return size === null ? null : { lines, size, normal }
}

/**
 * Drawing 2: puts the name on two lines when it does not fit on one, even at the smallest size.
 * The break is at a space after the surname, so the surname stays whole on the first line, and
 * the break that allows the largest size wins (on a tie, the fullest first line). When two lines
 * do not fit either, the name is left on one line and the payslip reports it as too long.
 */
export function withNameOnTwoLines(doc: PayslipDocument, surname: string): PayslipDocument {
  if (doc.drawing < 2) return doc
  const rowIndex = doc.rows.findIndex((found) => found.id === NAME_ROW_ID)
  const cell = rowIndex < 0 ? undefined : doc.rows[rowIndex].cells.find((found) => found.col === NAME_COL)
  if (!cell || cell.text !== doc.employeeName || cell.text.includes('\n') || !cell.text.startsWith(surname)) return doc
  const name = cell.text
  const font: FontName = cell.bold ? 'bold' : 'regular'
  const normal = PRINT_SIZE[cell.size]
  const available = cellWidth(doc, cell)
  if (sizeToFit([name], font, normal, available) !== null) return doc

  let best: { at: number; size: number } | null = null
  for (let at = name.indexOf(' ', surname.length); at > 0; at = name.indexOf(' ', at + 1)) {
    const size = sizeToFit([name.slice(0, at), name.slice(at + 1)], font, normal, available)
    if (size !== null && (best === null || size >= best.size)) best = { at, size }
  }
  if (best === null) return doc
  const text = `${name.slice(0, best.at)}\n${name.slice(best.at + 1)}`
  const rows = doc.rows.map((row, index) =>
    index === rowIndex ? { ...row, cells: row.cells.map((found) => (found === cell ? { ...found, text } : found)) } : row,
  )
  return { ...doc, rows }
}

function layoutPageV2(doc: PayslipDocument): DrawList {
  const colX = columnEdges(doc)
  const left = colX[0]
  const right = colX[4]
  const heights = doc.rows.map((row) => (row.cells.some((cell) => nameLinesOf(doc, row, cell)) ? 2 * ROW_HEIGHT : ROW_HEIGHT))
  const tops: number[] = [TOP]
  for (const height of heights) tops.push(tops[tops.length - 1] + height)
  const bottom = tops[doc.rows.length]

  const rects: DrawRect[] = []
  const greyRules: DrawLine[] = []
  const blackRules: DrawLine[] = []
  const texts: DrawText[] = []
  const unsupported = new Set<string>()
  const overflow: string[] = []

  doc.rows.forEach((row, index) => {
    const top = tops[index]
    const height = heights[index]
    if (row.fill) rects.push({ x: round(left), y: round(top), w: round(right - left), h: height, fill: row.fill })
    if (row.ruleBelow) {
      const y = round(top + height)
      const rule = { x1: round(left), y1: y, x2: round(right), y2: y }
      if (row.ruleBelow === 'grey') greyRules.push({ ...rule, width: LINE.grey, color: GREY })
      else blackRules.push({ ...rule, width: LINE.medium, color: INK })
    }

    for (const cell of row.cells) {
      if (cell.text === '') continue
      const font: FontName = cell.bold ? 'bold' : 'regular'
      const cellLeft = colX[cell.col] + PADDING_X
      const cellRight = colX[cell.col + cell.span] - PADDING_X
      // Each line of a two-line name sits in its own half of the row; any other text in the first.
      const lines = nameLinesOf(doc, row, cell) ?? [cell.text]
      for (const line of lines) for (const char of measureText(line, font, 1).missing) unsupported.add(char)
      // A long name must never be cut off or run into the next column: it is set smaller instead.
      const fitted = sizeToFit(lines, font, PRINT_SIZE[cell.size], cellRight - cellLeft)
      if (fitted === null) overflow.push(lines.join(' '))
      const size = fitted ?? MIN_SIZE
      lines.forEach((line, lineIndex) => {
        const width = measureText(line, font, size).width
        const x = cell.align === 'left' ? cellLeft : cell.align === 'right' ? cellRight - width : (cellLeft + cellRight - width) / 2
        // Centre the capital letters in the row (in its half, for a two-line name), whatever the size.
        const capHeight = (FONT_METRICS[font].capHeight / FONT_METRICS[font].unitsPerEm) * size
        const y = top + lineIndex * ROW_HEIGHT + ROW_HEIGHT / 2 + capHeight / 2
        texts.push({ x: round(x), y: round(y), text: line, font, size })
      })
    }
  })

  const dividerIndex = doc.rows.findIndex((row) => row.id === doc.dividerFromRowId)
  const divider: DrawLine[] =
    dividerIndex < 0
      ? []
      : [{ x1: round(colX[2]), y1: round(tops[dividerIndex]), x2: round(colX[2]), y2: round(bottom), width: LINE.thick, color: INK }]

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
