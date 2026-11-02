// Changes to a "From your file" layout, each returning a new body: what a cell holds, and adding
// and removing rows and columns. Cells keep their ids, so a calculation follows a cell that moves.

import { cellAt, formatFor, MAX_SHEET_COLUMNS, MAX_SHEET_ROWS, newCellId, type SheetBody, type SheetCell, type SheetMerge } from './sheetBody'

/** Replaces what a place of the grid holds; a place with no cell yet gets one, with the row's look. */
export function setCell(body: SheetBody, row: number, col: number, change: (cell: SheetCell) => SheetCell): SheetBody {
  const found = cellAt(body, row, col)
  const start: SheetCell = found ?? { id: newCellId(body), col, style: body.rows[row].cells[0]?.style ?? 0, source: { type: 'empty' }, format: formatFor({ type: 'empty' }) }
  const next = change(start)
  const cells = found ? body.rows[row].cells.map((cell) => (cell.col === col ? next : cell)) : [...body.rows[row].cells, next].sort((a, b) => a.col - b.col)
  return { ...body, rows: body.rows.map((one, index) => (index === row ? { ...one, cells } : one)) }
}

const shiftOnInsert = (start: number, length: number, at: number): [number, number] => (at <= start ? [start + 1, length] : at < start + length ? [start, length + 1] : [start, length])

function shiftOnRemove(start: number, length: number, at: number): [number, number] | null {
  if (at < start) return [start - 1, length]
  if (at >= start + length) return [start, length]
  return length === 1 ? null : [start, length - 1]
}

const worthKeeping = (merge: SheetMerge) => merge.rows > 1 || merge.cols > 1

/** A new row before row `at`, with the height and the look of the row it follows. */
export function insertRow(body: SheetBody, at: number): SheetBody {
  if (body.rows.length >= MAX_SHEET_ROWS) return body
  const model = body.rows[Math.max(0, at - 1)]
  let working = body
  const cells = model.cells.map((cell) => {
    const id = newCellId(working)
    const made: SheetCell = { id, col: cell.col, style: cell.style, source: { type: 'empty' }, format: formatFor({ type: 'empty' }) }
    working = { ...working, rows: [...working.rows, { height: 0, cells: [made] }] }
    return made
  })
  const merges = body.merges.map((merge) => {
    const [row, rows] = shiftOnInsert(merge.row, merge.rows, at)
    return { ...merge, row, rows }
  })
  return { ...body, rows: [...body.rows.slice(0, at), { height: model.height, cells }, ...body.rows.slice(at)], merges }
}

export function removeRow(body: SheetBody, at: number): SheetBody {
  if (body.rows.length <= 1) return body
  const merges = body.merges.flatMap((merge) => {
    const moved = shiftOnRemove(merge.row, merge.rows, at)
    return moved ? [{ ...merge, row: moved[0], rows: moved[1] }] : []
  })
  return { ...body, rows: body.rows.filter((_, index) => index !== at), merges: merges.filter(worthKeeping) }
}

/** A new column before column `at`, with the width of the column it follows. */
export function insertColumn(body: SheetBody, at: number): SheetBody {
  if (body.columns.length >= MAX_SHEET_COLUMNS) return body
  const width = body.columns[Math.max(0, at - 1)]
  const merges = body.merges.map((merge) => {
    const [col, cols] = shiftOnInsert(merge.col, merge.cols, at)
    return { ...merge, col, cols }
  })
  return {
    ...body,
    columns: [...body.columns.slice(0, at), width, ...body.columns.slice(at)],
    rows: body.rows.map((row) => ({ ...row, cells: row.cells.map((cell) => (cell.col >= at ? { ...cell, col: cell.col + 1 } : cell)) })),
    merges,
  }
}

export function removeColumn(body: SheetBody, at: number): SheetBody {
  if (body.columns.length <= 1) return body
  const merges = body.merges.flatMap((merge) => {
    const moved = shiftOnRemove(merge.col, merge.cols, at)
    return moved ? [{ ...merge, col: moved[0], cols: moved[1] }] : []
  })
  return {
    ...body,
    columns: body.columns.filter((_, index) => index !== at),
    rows: body.rows.map((row) => ({ ...row, cells: row.cells.filter((cell) => cell.col !== at).map((cell) => (cell.col > at ? { ...cell, col: cell.col - 1 } : cell)) })),
    merges: merges.filter(worthKeeping),
  }
}
