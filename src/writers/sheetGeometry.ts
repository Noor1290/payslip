// Turns a "From your file" payslip into drawing instructions for one A4 page, laid out like the
// Excel sheet, with the layout's page settings: portrait or landscape, Excel's Normal or Narrow
// margins, and the whole sheet scaled to fit the page (Excel's "fit to one page", never made
// larger) or printed at 100%. The preview (SVG) and the PDF writer both draw this list. Text widths come from
// the bundled font metrics, not from the browser.
//
// SHEET DRAWING VERSION 1. Frozen once payslips are issued with it: a change to any rule here is
// then a new version, added beside this one. (Its rules for long names, the split address and the
// page settings were added in November 2026, before any payslip was issued with it.)
// None of this touches the Table drawings in pageGeometry.ts.

import italicMetricsJson from '../assets/fonts/metrics-italic.json'
import type { BorderEdge, SheetStyle } from '../lib/sheetBody'
import type { SheetDocCell, SheetDocument } from '../lib/sheetDocument'
import { FONT_METRICS, PAGE, type DrawLine, type DrawList, type DrawRect, type DrawText, type FontMetrics, type SheetFontName } from './pageGeometry'

const METRICS: Record<SheetFontName, FontMetrics> = { ...FONT_METRICS, ...(italicMetricsJson as unknown as Record<'italic' | 'boldItalic', FontMetrics>) }

/**
 * The page's white edges, in points, as Excel's two margin settings have them: "Normal" is 0.7 inch
 * left and right, 0.75 inch top and bottom; "Narrow" is 0.25 inch left and right.
 */
export const MARGINS = { normal: { x: 50.4, y: 54 }, narrow: { x: 18, y: 54 } } as const
/** Below this print scale, the Template page warns that the payslip prints small. */
export const SMALL_PRINT_SCALE = 0.85
/** Excel's own column unit: pixels of the digit 0 in Calibri 11, and points per pixel. */
const DIGIT_PIXELS = 7
const POINTS_PER_PIXEL = 0.75
/** Excel's small space inside a cell, in points of the sheet. */
const CELL_PADDING = 2
/** The smallest text, in points of the sheet: a text is set smaller down to this, then refused. */
const MIN_SIZE = 8
const LINE_FACTOR = 1.2
const round = (value: number) => Math.round(value * 100) / 100

export const fontOf = (style: SheetStyle): SheetFontName =>
  style.font.bold ? (style.font.italic ? 'boldItalic' : 'bold') : style.font.italic ? 'italic' : 'regular'

/** A column width from Excel's unit to points, as Excel turns it into pixels. */
export function columnPoints(width: number): number {
  if (width <= 0) return 0
  return Math.trunc((256 * width + Math.trunc(128 / DIGIT_PIXELS)) / 256 * DIGIT_PIXELS) * POINTS_PER_PIXEL
}

export function textWidth(text: string, font: SheetFontName, size: number): number {
  const metrics = METRICS[font]
  let units = 0
  for (const char of text) units += metrics.widths[String(char.codePointAt(0))] ?? 0
  return (units * size) / metrics.unitsPerEm
}

const LINE_WIDTH: Record<BorderEdge['style'], number> = { hair: 0.25, thin: 0.5, dotted: 0.5, dashed: 0.5, medium: 1, double: 0.5, thick: 1.5 }

/** Words broken onto lines no wider than `width`. Null when one word alone is wider. */
function wrapped(text: string, font: SheetFontName, size: number, width: number): string[] | null {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(' ')) {
      const next = line === '' ? word : `${line} ${word}`
      if (textWidth(next, font, size) <= width) line = next
      else {
        if (line !== '') lines.push(line)
        if (textWidth(word, font, size) > width) return null
        line = word
      }
    }
    lines.push(line)
  }
  return lines
}

/** What the page settings need of a layout or of a payslip. */
export interface PageInput {
  orientation: 'portrait' | 'landscape'
  margins?: 'narrow'
  fit?: false
  columns: readonly number[]
  rows: readonly { height: number }[]
}

/**
 * The page and how large the sheet prints on it. Fitted to one page, the sheet is made smaller
 * until it fits, never larger (Excel's "fit to one page"); otherwise it prints at 100%, and
 * `fits` says whether the page holds it then.
 */
export function pageOf(input: PageInput): { width: number; height: number; x: number; y: number; scale: number; fits: boolean } {
  const landscape = input.orientation === 'landscape'
  const width = landscape ? PAGE.height : PAGE.width
  const height = landscape ? PAGE.width : PAGE.height
  const margin = MARGINS[input.margins ?? 'normal']
  const fullWidth = input.columns.reduce((sum, value) => sum + columnPoints(value), 0)
  const fullHeight = input.rows.reduce((sum, row) => sum + row.height, 0)
  const fitted = Math.min(1, (width - 2 * margin.x) / (fullWidth || 1), (height - 2 * margin.y) / (fullHeight || 1))
  const scale = input.fit === false ? 1 : fitted
  return { width, height, x: margin.x, y: margin.y, scale, fits: input.fit !== false || fitted >= 1 }
}

/** The merged block that holds a place of the payslip, if any. */
function blockOf(doc: SheetDocument, row: number, col: number) {
  return doc.merges.find((merge) => row >= merge.row && row < merge.row + merge.rows && col >= merge.col && col < merge.col + merge.cols) ?? null
}

/**
 * The columns and rows a cell's text may use. A text flows over the empty cells beside it, as in
 * Excel, unless it is wrapped or on several lines (Excel then keeps it in its cell); a figure, a
 * date and a merged block keep to their place.
 */
function spanOf(doc: SheetDocument, rowIndex: number, cell: SheetDocCell, flow = true) {
  const style = doc.styles[cell.style]
  const merge = blockOf(doc, rowIndex, cell.col)
  const [rows, cols] = merge ? [merge.rows, merge.cols] : [1, 1]
  const figure = cell.number !== undefined || cell.iso !== undefined
  const align = style.horizontal ?? (figure ? 'right' : 'left')
  const empty = (col: number) => col >= 0 && col < doc.columns.length && !blockOf(doc, rowIndex, col) && (doc.rows[rowIndex].cells.find((found) => found.col === col)?.text ?? '') === ''
  let first = cell.col
  let after = cell.col + cols
  if (flow && !merge && !figure && !style.wrap && !cell.text.includes('\n')) {
    if (align !== 'right') while (after < doc.columns.length && empty(after)) after += 1
    if (align !== 'left') while (first > 0 && empty(first - 1)) first -= 1
  }
  return { first, after, rows, cols, align, figure }
}

/** The room for a cell's text, in points of the sheet: the width inside its padding, and the height. */
export function cellRoom(doc: SheetDocument, rowIndex: number, cell: SheetDocCell, flow = true): { width: number; height: number } {
  const span = spanOf(doc, rowIndex, cell, flow)
  let width = 0
  for (let col = span.first; col < span.after; col++) width += columnPoints(doc.columns[col])
  let height = 0
  for (let row = rowIndex; row < rowIndex + span.rows; row++) height += doc.rows[row].height
  return { width: width - 2 * CELL_PADDING, height }
}

/** The height lines of text need, in points of the sheet, at a size in points of the sheet. */
export const linesHeight = (count: number, size: number) => count * size * LINE_FACTOR

/** Whether lines fit a room, in points of the sheet, at that size. */
export function linesFit(lines: readonly string[], font: SheetFontName, size: number, room: { width: number; height: number }): boolean {
  return lines.every((line) => textWidth(line, font, size) <= room.width) && (lines.length === 1 || linesHeight(lines.length, size) <= room.height)
}

export function layoutSheet(doc: SheetDocument): DrawList<SheetFontName> {
  const page = pageOf(doc)
  const { width, height, scale } = page

  const columnWidths = doc.columns.map(columnPoints)
  const lefts: number[] = [page.x]
  for (const value of columnWidths) lefts.push(lefts.at(-1)! + value * scale)
  const tops: number[] = [page.y]
  for (const row of doc.rows) tops.push(tops.at(-1)! + row.height * scale)

  const rects: DrawRect[] = []
  const lines: DrawLine[] = []
  const texts: DrawText<SheetFontName>[] = []
  const overflow: string[] = []
  const unsupported = new Set<string>()

  const block = (row: number, col: number) => blockOf(doc, row, col)
  const master = (row: number, col: number) => {
    const merge = block(row, col)
    const place = merge ? { row: merge.row, col: merge.col } : { row, col }
    return doc.rows[place.row]?.cells.find((cell) => cell.col === place.col) ?? null
  }
  const styleAt = (row: number, col: number) => {
    const cell = doc.rows[row]?.cells.find((found) => found.col === col)
    return cell ? doc.styles[cell.style] : undefined
  }

  // Fills first, so that the lines lie on top. A merged block has its first cell's fill.
  doc.rows.forEach((row, rowIndex) => {
    for (let col = 0; col < doc.columns.length; col++) {
      const merge = block(rowIndex, col)
      if (merge && (merge.row !== rowIndex || merge.col !== col)) continue
      const cell = row.cells.find((found) => found.col === col)
      const fill = cell ? doc.styles[cell.style].fill : undefined
      if (!fill) continue
      const [rows, cols] = merge ? [merge.rows, merge.cols] : [1, 1]
      rects.push({ x: round(lefts[col]), y: round(tops[rowIndex]), w: round(lefts[col + cols] - lefts[col]), h: round(tops[rowIndex + rows] - tops[rowIndex]), fill })
    }
  })

  const pushEdge = (x1: number, y1: number, x2: number, y2: number, found: BorderEdge) => {
    const dash = found.style === 'dashed' ? [3, 2] : found.style === 'dotted' || found.style === 'hair' ? [1, 1.5] : undefined
    const base = { width: LINE_WIDTH[found.style], color: found.color, ...(dash ? { dash } : {}) }
    if (found.style === 'double') {
      const [dx, dy] = y1 === y2 ? [0, 0.75] : [0.75, 0]
      lines.push({ x1: round(x1 - dx), y1: round(y1 - dy), x2: round(x2 - dx), y2: round(y2 - dy), ...base })
      lines.push({ x1: round(x1 + dx), y1: round(y1 + dy), x2: round(x2 + dx), y2: round(y2 + dy), ...base })
    } else lines.push({ x1: round(x1), y1: round(y1), x2: round(x2), y2: round(y2), ...base })
  }

  // Each line once: the edge between two cells is either cell's, the heavier when both name one;
  // inside a merged block there is none.
  const heavier = (a: BorderEdge | undefined, b: BorderEdge | undefined) => (!a ? b : !b ? a : LINE_WIDTH[b.style] > LINE_WIDTH[a.style] ? b : a)
  for (let row = 0; row <= doc.rows.length; row++) {
    for (let col = 0; col < doc.columns.length; col++) {
      const inner = row > 0 && row < doc.rows.length && block(row, col) !== null && block(row, col) === block(row - 1, col)
      if (inner) continue
      const found = heavier(row > 0 ? styleAt(row - 1, col)?.bottom : undefined, styleAt(row, col)?.top)
      if (found) pushEdge(lefts[col], tops[row], lefts[col + 1], tops[row], found)
    }
  }
  for (let col = 0; col <= doc.columns.length; col++) {
    for (let row = 0; row < doc.rows.length; row++) {
      const inner = col > 0 && col < doc.columns.length && block(row, col) !== null && block(row, col) === block(row, col - 1)
      if (inner) continue
      const found = heavier(col > 0 ? styleAt(row, col - 1)?.right : undefined, styleAt(row, col)?.left)
      if (found) pushEdge(lefts[col], tops[row], lefts[col], tops[row + 1], found)
    }
  }

  const drawCell = (cell: SheetDocCell, rowIndex: number) => {
    const style = doc.styles[cell.style]
    const { first, after, rows, cols, align } = spanOf(doc, rowIndex, cell)
    const font = fontOf(style)
    for (const char of cell.text) {
      if (char !== '\n' && !(String(char.codePointAt(0)) in METRICS[font].widths)) unsupported.add(char)
    }

    const left = lefts[first] + CELL_PADDING * scale
    const right = lefts[after] - CELL_PADDING * scale
    const room = right - left
    const top = tops[rowIndex]
    const bottom = tops[rowIndex + rows]

    let size = style.font.size
    let printed: string[] | null = null
    if (cell.size !== undefined) {
      // A name or an address already fitted to its cell (sheetDocument.ts): at this size and on
      // these lines, or not at all. It is never set smaller here.
      size = cell.size
      const given = cell.text.split('\n')
      printed = linesFit(given, font, size, cellRoom(doc, rowIndex, cell)) ? given : null
    } else {
      const lowest = Math.min(MIN_SIZE, style.font.size)
      for (; size >= lowest; size -= 0.25) {
        const candidate = style.wrap || cell.text.includes('\n') ? wrapped(cell.text, font, size * scale, room) : textWidth(cell.text, font, size * scale) <= room ? [cell.text] : null
        if (candidate && (candidate.length === 1 || candidate.length * size * scale * LINE_FACTOR <= bottom - top)) {
          printed = candidate
          break
        }
      }
    }
    if (!printed) {
      overflow.push(cell.text)
      return
    }

    const metrics = METRICS[font]
    const points = round(size * scale)
    const capHeight = (metrics.capHeight * points) / metrics.unitsPerEm
    const leading = points * LINE_FACTOR
    const textHeight = capHeight + leading * (printed.length - 1)
    const vertical = style.vertical ?? 'bottom'
    const firstBaseline =
      vertical === 'top' ? top + 2 * scale + capHeight : vertical === 'middle' ? top + (bottom - top - textHeight) / 2 + capHeight : bottom - 2.5 * scale - leading * (printed.length - 1)
    printed.forEach((line, index) => {
      const lineWidth = textWidth(line, font, points)
      const x = align === 'left' ? left : align === 'right' ? right - lineWidth : (lefts[cell.col] + lefts[cell.col + cols]) / 2 - lineWidth / 2
      const y = firstBaseline + leading * index
      const color = style.font.color && style.font.color !== '000000' ? style.font.color : undefined
      texts.push({ x: round(x), y: round(y), text: line, font, size: points, ...(color ? { color } : {}) })
      if (style.font.underline) lines.push({ x1: round(x), y1: round(y + 1.2 * scale), x2: round(x + lineWidth), y2: round(y + 1.2 * scale), width: 0.5, color: color ?? '000000' })
    })
  }

  doc.rows.forEach((row, rowIndex) => {
    for (const cell of row.cells) {
      if (cell.text === '' || master(rowIndex, cell.col) !== cell) continue
      drawCell(cell, rowIndex)
    }
  })

  return { width, height, rects, lines, texts, unsupported: [...unsupported], overflow }
}
