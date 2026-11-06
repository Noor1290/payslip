// Long names and the split address of a "From your file" payslip, fitted to their cells before the
// page is drawn, so the preview, the PDF and the Excel sheet print them the same way. Sizes are in
// points of the sheet, as Excel shows them, whatever the page's scale.
//
// A name (the full name, or the surname or other names alone) keeps its size when it fits. Too
// long, it is set smaller on one line, never below 9 points; still too long, it goes on two lines
// in its cell, again never below 9 points, broken at a space (for the full name, after the
// surname, so the surname stays whole), and its row grows when two lines need more height: the
// rows below move down. When even that does not fit, the payslip is refused; a name is never cut.
//
// The address split at its last comma is chosen as drawing 3 of the Table payslip chooses it: the
// split at the last comma when it fits at the normal size; otherwise the split that allows the
// largest size, not below 8 points, at a comma first, then between words.

import { normaliseKey, type PayrollRow } from './payrollFile'
import type { SheetBody } from './sheetBody'
import type { SheetDocCell, SheetDocument } from './sheetDocument'
import { addressParts, addressSplits } from '../writers/pageGeometry'
import { cellRoom, fontOf, linesFit, linesHeight } from '../writers/sheetGeometry'

/** The smallest size of a name, on one line or two: the owner's rule. */
export const NAME_MIN_SIZE = 9
/** The smallest size of the split address, as in drawing 3. */
export const ADDRESS_MIN_SIZE = 8
/** Sizes are tried in half points, as Excel can show them. */
const STEP = 0.5
/** Excel keeps a row's height in whole pixels: 0.75 points. */
const ROW_STEP = 0.75

const NAME_PARTS = new Set(['surname', 'other names'])

/** The largest size from `normal` down to `smallest` at which the lines fit. Null when none does. */
function largestSize(lines: readonly string[], doc: SheetDocument, cell: SheetDocCell, room: { width: number; height: number }, smallest: number): number | null {
  const style = doc.styles[cell.style]
  const font = fontOf(style)
  const normal = style.font.size
  const lowest = Math.min(smallest, normal)
  for (let size = normal; size >= lowest; size = Math.round((size - STEP) * 100) / 100) {
    if (linesFit(lines, font, size, room)) return size
  }
  return null
}

/** The place of a cell in the document. */
interface Placed {
  rowIndex: number
  cell: SheetDocCell
}

function placeOf(doc: SheetDocument, body: SheetBody, id: string): Placed | null {
  for (let rowIndex = 0; rowIndex < body.rows.length; rowIndex++) {
    const index = body.rows[rowIndex].cells.findIndex((cell) => cell.id === id)
    if (index >= 0) return { rowIndex, cell: doc.rows[rowIndex].cells[index] }
  }
  return null
}

/** Room for two lines: the cell's own height, ignoring that its row may still grow. */
const tall = (room: { width: number; height: number }) => ({ width: room.width, height: Number.POSITIVE_INFINITY })

/** Makes the row (the last of a merged block) tall enough for these lines at this size. */
function growFor(doc: SheetDocument, at: Placed, count: number, size: number): void {
  const room = cellRoom(doc, at.rowIndex, at.cell, false)
  const missing = linesHeight(count, size) - room.height
  if (missing <= 0) return
  const merge = doc.merges.find((found) => found.row === at.rowIndex && found.col === at.cell.col)
  const last = at.rowIndex + (merge ? merge.rows - 1 : 0)
  const row = doc.rows[last]
  row.height = Math.ceil((row.height + missing) / ROW_STEP - 1e-9) * ROW_STEP
}

/** One line smaller, then two lines (the row grows), never below 9 points; otherwise left to be refused. */
function fitName(doc: SheetDocument, at: Placed, surname: string | null): void {
  const { cell } = at
  const text = cell.text
  if (text === '' || text.includes('\n')) return
  const normal = doc.styles[cell.style].font.size
  const one = largestSize([text], doc, cell, cellRoom(doc, at.rowIndex, cell), NAME_MIN_SIZE)
  if (one === normal) return
  if (one !== null) {
    cell.size = one
    return
  }
  const own = tall(cellRoom(doc, at.rowIndex, cell, false))
  let best: { at: number; size: number } | null = null
  for (let space = text.indexOf(' ', surname === null ? 0 : surname.length); space > 0; space = text.indexOf(' ', space + 1)) {
    const size = largestSize([text.slice(0, space), text.slice(space + 1)], doc, cell, own, NAME_MIN_SIZE)
    // On a tie, the fullest first line.
    if (size !== null && (best === null || size >= best.size)) best = { at: space, size }
  }
  if (best === null) {
    // Refused when the page is drawn: at the smallest size, on one line, it does not fit.
    cell.size = Math.min(NAME_MIN_SIZE, normal)
    return
  }
  cell.text = `${text.slice(0, best.at)}\n${text.slice(best.at + 1)}`
  cell.size = best.size
  growFor(doc, at, 2, best.size)
}

type Split = { lines: [string, string]; atComma: boolean }

/**
 * The split of drawing 3: the first that fits at the normal size; otherwise the one allowing the
 * largest size (not below 8 points), at a comma first, then between words; otherwise the first.
 * `sizes` gives the size each cell can print its line at, or null.
 */
function chooseSplit(splits: readonly Split[], sizes: (split: Split) => { size: number; normal: boolean } | null): { split: Split; size: number | null } {
  const atNormal = splits.find((split) => sizes(split)?.normal === true)
  if (atNormal) return { split: atNormal, size: null }
  for (const atComma of [true, false]) {
    let best: { split: Split; size: number } | null = null
    for (const split of splits.filter((found) => found.atComma === atComma)) {
      const found = sizes(split)
      if (found && (best === null || found.size > best.size)) best = { split, size: found.size }
    }
    if (best) return best
  }
  return { split: splits[0], size: null }
}

/** A line of the address in a cell, in capitals when the cell says so, and the size it can print at. */
type Written = Placed & { write: (line: string) => string }

/** The address in two cells: the part before its last comma, and the part after it. */
function fitAddressCells(doc: SheetDocument, address: string, first: Written, second: Written): void {
  const splits = addressSplits(addressParts(address))
  const sizeIn = (at: Written, raw: string) => {
    const line = at.write(raw)
    return line === '' ? doc.styles[at.cell.style].font.size : largestSize([line], doc, { ...at.cell, text: line }, cellRoom(doc, at.rowIndex, { ...at.cell, text: line }), ADDRESS_MIN_SIZE)
  }
  const chosen = chooseSplit(splits, ({ lines: [one, two] }) => {
    const a = sizeIn(first, one)
    const b = sizeIn(second, two)
    if (a === null || b === null) return null
    const normal = a === doc.styles[first.cell.style].font.size && b === doc.styles[second.cell.style].font.size
    return { size: Math.min(a, b), normal }
  })
  const [one, two] = chosen.split.lines
  for (const [at, line] of [[first, one], [second, two]] as const) {
    at.cell.text = at.write(line)
    const size = line === '' ? null : sizeIn(at, line)
    if (size !== null && size !== doc.styles[at.cell.style].font.size) at.cell.size = size
  }
}

/** The address on two lines of one cell; the row grows when they need more height. */
function fitAddressLines(doc: SheetDocument, address: string, at: Written): void {
  const splits = addressSplits(addressParts(address))
    .filter((split) => split.lines[1] !== '')
    .map((split) => ({ ...split, lines: split.lines.map(at.write) as [string, string] }))
  // No comma and nothing to move down: one line, set smaller only as any text is.
  if (splits.length === 0) return
  const room = tall(cellRoom(doc, at.rowIndex, { ...at.cell, text: 'x\ny' }, false))
  const normal = doc.styles[at.cell.style].font.size
  const chosen = chooseSplit(splits, ({ lines }) => {
    const size = largestSize(lines, doc, at.cell, room, ADDRESS_MIN_SIZE)
    return size === null ? null : { size, normal: size === normal }
  })
  const size = chosen.size ?? largestSize(chosen.split.lines, doc, at.cell, room, ADDRESS_MIN_SIZE) ?? Math.min(ADDRESS_MIN_SIZE, normal)
  at.cell.text = chosen.split.lines.join('\n')
  at.cell.size = size
  growFor(doc, at, 2, size)
}

/** The capitals of a cell's format, applied to an address line as the evaluator applies them. */
const writerOf = (body: SheetBody, id: string) => {
  const cell = body.rows.flatMap((row) => row.cells).find((found) => found.id === id)
  return cell?.format.type === 'text' && cell.format.capitals ? (text: string) => text.toUpperCase() : (text: string) => text
}

/**
 * Fits the names and the split address of one payslip. Changes `doc` in place: the texts, sizes
 * and row heights. The address first, since a part left empty lets a neighbour flow over it.
 */
export function fitSheetDocument(doc: SheetDocument, body: SheetBody, row: PayrollRow, address: string): void {
  const all = body.rows.flatMap((sheetRow) => sheetRow.cells)
  const idOf = (field: string) => all.find((cell) => cell.source.type === 'company' && cell.source.field === field)?.id
  const [before, after] = [idOf('address1'), idOf('address2')]
  if (before && after) {
    const first = placeOf(doc, body, before)
    const second = placeOf(doc, body, after)
    if (first && second) fitAddressCells(doc, address, { ...first, write: writerOf(body, before) }, { ...second, write: writerOf(body, after) })
  }
  for (const cell of all) {
    if (cell.source.type === 'company' && cell.source.field === 'addressLines') {
      const at = placeOf(doc, body, cell.id)
      if (at) fitAddressLines(doc, address, { ...at, write: writerOf(body, cell.id) })
    }
  }

  const surname = typeof row.Surname === 'string' ? row.Surname.trim() : ''
  for (const cell of all) {
    const isName = cell.source.type === 'name' || (cell.source.type === 'employee' && NAME_PARTS.has(normaliseKey(cell.source.key)))
    if (!isName || cell.format.type !== 'text') continue
    const at = placeOf(doc, body, cell.id)
    if (!at) continue
    // The full name breaks after the surname only when it starts with it, as the Table payslip does.
    const breakAfter = cell.source.type === 'name' && surname !== '' && at.cell.text.toUpperCase().startsWith(surname.toUpperCase()) ? surname : null
    fitName(doc, at, breakAfter)
  }
}
