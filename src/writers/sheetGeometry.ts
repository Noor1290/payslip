// Turns a "From your file" payslip into drawing instructions for one A4 page, laid out like the
// Excel sheet: the whole sheet scaled to fit the page, as Excel's "fit to one page" does, never
// made larger. The preview (SVG) and the PDF writer both draw this list. Text widths come from
// the bundled font metrics, not from the browser.
//
// SHEET DRAWING VERSION 1. A change to any rule here is a new version, added beside this one.
// None of this touches the Table drawings in pageGeometry.ts.

import italicMetricsJson from '../assets/fonts/metrics-italic.json'
import type { BorderEdge, SheetStyle } from '../lib/sheetBody'
import type { SheetDocCell, SheetDocument } from '../lib/sheetDocument'
import { FONT_METRICS, PAGE, type DrawLine, type DrawList, type DrawRect, type DrawText, type FontMetrics, type SheetFontName } from './pageGeometry'

const METRICS: Record<SheetFontName, FontMetrics> = { ...FONT_METRICS, ...(italicMetricsJson as unknown as Record<'italic' | 'boldItalic', FontMetrics>) }

/** The page's white edge, in points. */
const MARGIN = 28
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

export function layoutSheet(doc: SheetDocument): DrawList<SheetFontName> {
  const landscape = doc.orientation === 'landscape'
  const width = landscape ? PAGE.height : PAGE.width
  const height = landscape ? PAGE.width : PAGE.height

  const columnWidths = doc.columns.map(columnPoints)
  const fullWidth = columnWidths.reduce((sum, value) => sum + value, 0)
  const fullHeight = doc.rows.reduce((sum, row) => sum + row.height, 0)
  const scale = Math.min(1, (width - 2 * MARGIN) / (fullWidth || 1), (height - 2 * MARGIN) / (fullHeight || 1))

  const lefts: number[] = [MARGIN]
  for (const value of columnWidths) lefts.push(lefts.at(-1)! + value * scale)
  const tops: number[] = [MARGIN]
  for (const row of doc.rows) tops.push(tops.at(-1)! + row.height * scale)

  const rects: DrawRect[] = []
  const lines: DrawLine[] = []
  const texts: DrawText<SheetFontName>[] = []
  const overflow: string[] = []
  const unsupported = new Set<string>()

  const block = (row: number, col: number) => doc.merges.find((merge) => row >= merge.row && row < merge.row + merge.rows && col >= merge.col && col < merge.col + merge.cols) ?? null
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

  const empty = (row: number, col: number) => {
    if (col < 0 || col >= doc.columns.length) return false
    if (block(row, col)) return false
    return (doc.rows[row].cells.find((found) => found.col === col)?.text ?? '') === ''
  }

  const drawCell = (cell: SheetDocCell, rowIndex: number) => {
    const style = doc.styles[cell.style]
    const merge = block(rowIndex, cell.col)
    const [rows, cols] = merge ? [merge.rows, merge.cols] : [1, 1]
    const figure = cell.number !== undefined || cell.iso !== undefined
    const align = style.horizontal ?? (figure ? 'right' : 'left')
    const font = fontOf(style)
    for (const char of cell.text) {
      if (char !== '\n' && !(String(char.codePointAt(0)) in METRICS[font].widths)) unsupported.add(char)
    }

    // A text flows over the empty cells beside it, as in Excel. A figure keeps to its cell.
    let first = cell.col
    let after = cell.col + cols
    if (!merge && !figure && !style.wrap) {
      if (align !== 'right') while (after < doc.columns.length && empty(rowIndex, after)) after += 1
      if (align !== 'left') while (first > 0 && empty(rowIndex, first - 1)) first -= 1
    }
    const left = lefts[first] + CELL_PADDING * scale
    const right = lefts[after] - CELL_PADDING * scale
    const room = right - left
    const top = tops[rowIndex]
    const bottom = tops[rowIndex + rows]

    let size = style.font.size
    let printed: string[] | null = null
    const lowest = Math.min(MIN_SIZE, style.font.size)
    for (; size >= lowest; size -= 0.25) {
      const candidate = style.wrap || cell.text.includes('\n') ? wrapped(cell.text, font, size * scale, room) : textWidth(cell.text, font, size * scale) <= room ? [cell.text] : null
      if (candidate && (candidate.length === 1 || candidate.length * size * scale * LINE_FACTOR <= bottom - top)) {
        printed = candidate
        break
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
