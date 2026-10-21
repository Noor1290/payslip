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
  return doc.drawing === 1 ? layoutPageV1(doc) : doc.drawing === 2 ? layoutPageV2(doc) : doc.drawing === 3 ? layoutPageV3(doc) : layoutPageV4(doc)
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

// DRAWING VERSION 3: version 2, and the company address split at its LAST comma. Line 3 of the
// header holds everything before that comma, line 4 what comes after it. When line 3 is too wide
// at the normal size, its last words move down to the start of line 4; only when that does not
// fit either are the two lines set smaller, together, never below 8 points. Everything else is
// drawn exactly as in version 2. Frozen like versions 1 and 2 once payslips are issued with it.
const ADDRESS_ROW_IDS = ['address-1', 'address-2'] as const
const ADDRESS_MIN_SIZE = 8

/** sizeToFit, with a smallest size of its own. */
function sizeToFitFrom(lines: readonly string[], font: FontName, normal: number, available: number, smallest: number): number | null {
  const widest = (size: number) => Math.max(...lines.map((line) => measureText(line, font, size).width))
  if (widest(normal) <= available) return normal
  const size = Math.max(smallest, Math.floor(((normal * available) / widest(normal)) * 10) / 10)
  return widest(size) <= available + 0.01 ? size : null
}

/** The cells of the two address lines, when the page has both rows. */
function addressCells(doc: PayslipDocument): [DocCell, DocCell] | null {
  const [first, second] = ADDRESS_ROW_IDS.map((id) => doc.rows.find((row) => row.id === id)?.cells[0])
  return first && second ? [first, second] : null
}

/**
 * The parts of an address as the payroll gives it: cut at every comma and line break, each part
 * trimmed, runs of spaces made one, empty parts left out (a trailing comma, ", ,").
 */
export function addressParts(address: string): string[] {
  return address
    .split(/\r?\n|,/)
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter((part) => part !== '')
}

/**
 * The ways to put the address on two lines, in the order they are preferred: split at the last
 * comma; then the last parts of line 3 moved down to line 4, at a comma (the fewest first); then
 * its last words moved down, between words (the fewest first). `atComma` is false for the last kind.
 */
function addressSplits(parts: readonly string[]): { lines: [string, string]; atComma: boolean }[] {
  if (parts.length === 0) return [{ lines: ['', ''], atComma: true }]
  const last = parts.length > 1 ? parts[parts.length - 1] : ''
  const head = parts.length > 1 ? parts.slice(0, -1) : [...parts]
  const down = (moved: string): string => (last === '' ? moved : `${moved}, ${last}`)
  const line = head.join(', ')
  const splits: { lines: [string, string]; atComma: boolean }[] = [{ lines: [line, last], atComma: true }]
  for (let keep = head.length - 1; keep >= 1; keep--) {
    splits.push({ lines: [head.slice(0, keep).join(', '), down(head.slice(keep).join(', '))], atComma: true })
  }
  for (let at = line.lastIndexOf(' '); at > 0; at = line.lastIndexOf(' ', at - 1)) {
    // A space right after a comma is a break at a comma, already offered above.
    if (line[at - 1] !== ',') splits.push({ lines: [line.slice(0, at), down(line.slice(at + 1))], atComma: false })
  }
  return splits
}

/**
 * Drawing 3: the address on lines 3 and 4. The first split (in the order of addressSplits) whose
 * two lines fit at the normal size; otherwise the split at a comma that allows the largest size,
 * not below 8 points, and only when no split at a comma fits at 8 points, the split between words
 * that does (on a tie, the one preferred first). When none fits even at 8 points, the address is
 * split at its last comma and the payslip reports it as too long.
 */
export function withAddressSplitAtLastComma(doc: PayslipDocument, addressLines: readonly [string, string]): PayslipDocument {
  if (doc.drawing < 3) return doc
  const cells = addressCells(doc)
  if (!cells) return doc
  const [cell] = cells
  const font: FontName = cell.bold ? 'bold' : 'regular'
  const normal = PRINT_SIZE[cell.size]
  const available = cellWidth(doc, cell)
  const splits = addressSplits(addressParts(addressLines.join(',')))
  const fits = (lines: readonly string[], smallest: number) => sizeToFitFrom(lines.filter((line) => line !== ''), font, normal, available, smallest)
  let chosen = splits.find((split) => fits(split.lines, normal) !== null)?.lines ?? null
  for (const atComma of [true, false]) {
    let best = 0
    for (const split of chosen ? [] : splits.filter((found) => found.atComma === atComma)) {
      const size = fits(split.lines, ADDRESS_MIN_SIZE) ?? 0
      if (size > best) [best, chosen] = [size, split.lines]
    }
  }
  const [line3, line4] = chosen ?? splits[0].lines
  const textOf: Record<string, string> = { 'address-1': line3, 'address-2': line4 }
  const rows = doc.rows.map((row) =>
    row.id in textOf ? { ...row, cells: row.cells.map((found, index) => (index === 0 ? { ...found, text: textOf[row.id] } : found)) } : row,
  )
  return { ...doc, rows }
}

/** The printed size of the address lines of a drawing-3 payslip, and their normal size. Null before drawing 3, or when they do not fit. */
export function addressOnPage(doc: PayslipDocument): { size: number; normal: number } | null {
  if (doc.drawing < 3) return null
  const cells = addressCells(doc)
  if (!cells) return null
  const lines = cells.map((cell) => cell.text).filter((text) => text !== '')
  if (lines.length === 0) return null
  const normal = PRINT_SIZE[cells[0].size]
  const size = sizeToFitFrom(lines, cells[0].bold ? 'bold' : 'regular', normal, cellWidth(doc, cells[0]), ADDRESS_MIN_SIZE)
  return size === null ? null : { size, normal }
}

function layoutPageV3(doc: PayslipDocument): DrawList {
  const page = layoutPageV2(doc)
  const cells = addressCells(doc)
  if (!cells) return page
  const lines = cells.map((cell) => cell.text).filter((text) => text !== '')
  if (lines.length === 0) return page
  const font: FontName = cells[0].bold ? 'bold' : 'regular'
  const colX = columnEdges(doc)
  const fitted = sizeToFitFrom(lines, font, PRINT_SIZE[cells[0].size], cellWidth(doc, cells[0]), ADDRESS_MIN_SIZE)
  const size = fitted ?? ADDRESS_MIN_SIZE
  // The address rows are above the name, so they are where version 2 put them: one row each.
  const overflow = page.overflow.filter((text) => !lines.includes(text))
  if (fitted === null) overflow.push(...lines)
  const texts = [...page.texts]
  ADDRESS_ROW_IDS.forEach((id, index) => {
    const cell = cells[index]
    if (cell.text === '') return
    const top = TOP + doc.rows.findIndex((row) => row.id === id) * ROW_HEIGHT
    const at = texts.findIndex((text) => text.text === cell.text && text.y > top && text.y < top + ROW_HEIGHT)
    if (at < 0) return
    const width = measureText(cell.text, font, size).width
    const cellLeft = colX[cell.col] + PADDING_X
    const cellRight = colX[cell.col + cell.span] - PADDING_X
    const x = cell.align === 'left' ? cellLeft : cell.align === 'right' ? cellRight - width : (cellLeft + cellRight - width) / 2
    const capHeight = (FONT_METRICS[font].capHeight / FONT_METRICS[font].unitsPerEm) * size
    texts[at] = { x: round(x), y: round(top + ROW_HEIGHT / 2 + capHeight / 2), text: cell.text, font, size }
  })
  return { ...page, texts, overflow }
}

// DRAWING VERSION 4: version 3, and a wider place for a name that does not fit its column, at the
// normal size or smaller down to 8 points. Such a name starts closer to "Name :", and "Date of
// Employment :" with its date moves right on the same row, as far as the row allows, so the name
// has the space between them. One line there, from the normal size down to 8 points; otherwise
// two lines there (the row twice as tall, as in version 2), down to 8 points; otherwise the payslip
// is refused. A name that fits its column at 8 points or more is drawn exactly as in version 3.
// Frozen like versions 1 to 3 once payslips are issued with it.
const NAME_MIN_SIZE = 8
/** The space kept between two texts of the name row: the paddings of two neighbouring cells. */
const NAME_GAP = 2 * PADDING_X

/** The name row and its name cell, when the name is not empty. */
function nameRowCells(doc: PayslipDocument): { index: number; row: DocRow; name: DocCell } | null {
  const index = doc.rows.findIndex((found) => found.id === NAME_ROW_ID)
  const name = index < 0 ? undefined : doc.rows[index].cells.find((found) => found.col === NAME_COL)
  return name && name.text !== '' ? { index, row: doc.rows[index], name } : null
}

/** The width of a text of the name row other than the name, as version 3 prints it in its own column. */
function widthInColumn(doc: PayslipDocument, cell: DocCell): number {
  const font: FontName = cell.bold ? 'bold' : 'regular'
  const size = sizeToFit([cell.text], font, PRINT_SIZE[cell.size], cellWidth(doc, cell)) ?? MIN_SIZE
  return measureText(cell.text, font, size).width
}

/**
 * The wide name area: from just after "Name :" to just before "Date of Employment :", which moves
 * right with its date until the date ends where the row's last column ends. `moved` is where the
 * date's label and the date then start. Every gap is NAME_GAP.
 */
function wideNameArea(doc: PayslipDocument, row: DocRow): { left: number; right: number; moved: Map<DocCell, number> } {
  const colX = columnEdges(doc)
  const label = row.cells.find((found) => found.col === 0 && found.text !== '')
  const left = colX[0] + PADDING_X + (label ? widthInColumn(doc, label) + NAME_GAP : 0)
  const moved = new Map<DocCell, number>()
  let right = colX[4] - PADDING_X + NAME_GAP
  for (const cell of row.cells.filter((found) => found.col > NAME_COL && found.text !== '').sort((a, b) => b.col - a.col)) {
    right -= NAME_GAP + widthInColumn(doc, cell)
    moved.set(cell, right)
  }
  return { left, right: right - NAME_GAP, moved }
}

/** The name of a drawing-4 payslip as the page prints it, and whether it is in the wide area. Null before drawing 4, or when it does not fit. */
export function nameOnPageV4(doc: PayslipDocument): { lines: string[]; size: number; normal: number; wide: boolean } | null {
  if (doc.drawing < 4) return null
  const found = nameRowCells(doc)
  if (!found) return null
  const { row, name } = found
  const lines = nameLinesOf(doc, row, name) ?? [name.text]
  const font: FontName = name.bold ? 'bold' : 'regular'
  const normal = PRINT_SIZE[name.size]
  const usual = lines.length === 1 ? sizeToFitFrom(lines, font, normal, cellWidth(doc, name), NAME_MIN_SIZE) : null
  if (usual !== null) return { lines, size: usual, normal, wide: false }
  const area = wideNameArea(doc, row)
  const size = sizeToFitFrom(lines, font, normal, area.right - area.left, NAME_MIN_SIZE)
  return size === null ? null : { lines, size, normal, wide: true }
}

/**
 * Drawing 4: a name that fits neither its column nor, on one line, the wide area (8 points or
 * more) goes on two lines in the wide area, broken at a space after the surname, as in version 2:
 * the break that allows the largest size wins (on a tie, the fullest first line). When two lines
 * do not fit at 8 points either, the name is left on one line and the payslip reports it as too long.
 */
export function withNameInWideArea(doc: PayslipDocument, surname: string): PayslipDocument {
  if (doc.drawing < 4) return doc
  const found = nameRowCells(doc)
  if (!found) return doc
  const { index: rowIndex, row, name: cell } = found
  if (cell.text !== doc.employeeName || cell.text.includes('\n') || !cell.text.startsWith(surname)) return doc
  if (nameOnPageV4(doc) !== null) return doc
  const name = cell.text
  const font: FontName = cell.bold ? 'bold' : 'regular'
  const area = wideNameArea(doc, row)

  let best: { at: number; size: number } | null = null
  for (let at = name.indexOf(' ', surname.length); at > 0; at = name.indexOf(' ', at + 1)) {
    const size = sizeToFitFrom([name.slice(0, at), name.slice(at + 1)], font, PRINT_SIZE[cell.size], area.right - area.left, NAME_MIN_SIZE)
    if (size !== null && (best === null || size >= best.size)) best = { at, size }
  }
  if (best === null) return doc
  const text = `${name.slice(0, best.at)}\n${name.slice(best.at + 1)}`
  const rows = doc.rows.map((found, index) =>
    index === rowIndex ? { ...found, cells: found.cells.map((other) => (other === cell ? { ...other, text } : other)) } : found,
  )
  return { ...doc, rows }
}

/**
 * The Excel sizes of a name in the wide area, in whole points. In Excel the name has the merged
 * columns C and D, and the date's label and the date share column E; each is set at the largest
 * whole size that fits there by the page's own measure (11 in Excel is 10 on the page), never
 * above 11 nor above the page's size. Null when the name is not in the wide area.
 */
export function wideNameExcelSizes(doc: PayslipDocument): { name: number; date: number } | null {
  const printed = nameOnPageV4(doc)
  const found = nameRowCells(doc)
  if (!printed?.wide || !found) return null
  const colX = columnEdges(doc)
  const font: FontName = found.name.bold ? 'bold' : 'regular'
  const widest = Math.max(...printed.lines.map((line) => measureText(line, font, printed.normal).width))
  const name = Math.min(Math.floor((11 * printed.size) / printed.normal), Math.floor((11 * (colX[3] - colX[1] - 2 * PADDING_X)) / widest))
  // In column E the label and the date are one text, a space apart.
  const together = found.row.cells.filter((cell) => cell.col > NAME_COL && cell.text !== '').map((cell) => cell.text).join(' ')
  const date = Math.min(11, Math.floor((11 * (colX[4] - colX[3] - 2 * PADDING_X)) / measureText(together, 'regular', 10).width))
  return { name, date }
}

function layoutPageV4(doc: PayslipDocument): DrawList {
  const page = layoutPageV3(doc)
  const printed = nameOnPageV4(doc)
  const found = nameRowCells(doc)
  if (!found || printed?.wide === false) return page
  const { index, row, name } = found
  const lines = nameLinesOf(doc, row, name) ?? [name.text]
  const area = wideNameArea(doc, row)
  const font: FontName = name.bold ? 'bold' : 'regular'
  const size = printed?.size ?? NAME_MIN_SIZE
  // The name row is below the address and above the only row version 2 makes taller: one row per row above it.
  const top = TOP + index * ROW_HEIGHT
  const height = lines.length === 2 ? 2 * ROW_HEIGHT : ROW_HEIGHT
  const overflow = page.overflow.filter((text) => text !== lines.join(' '))
  if (printed === null) overflow.push(lines.join(' '))
  const capHeight = (FONT_METRICS[font].capHeight / FONT_METRICS[font].unitsPerEm) * size
  const texts = page.texts.map((text) => {
    if (text.y <= top || text.y >= top + height) return text
    const lineIndex = lines.indexOf(text.text)
    if (lineIndex >= 0) return { x: round(area.left), y: round(top + lineIndex * ROW_HEIGHT + ROW_HEIGHT / 2 + capHeight / 2), text: text.text, font, size }
    const cell = [...area.moved.keys()].find((other) => other.text === text.text)
    return cell ? { ...text, x: round(area.moved.get(cell)!) } : text
  })
  return { ...page, texts, overflow }
}
