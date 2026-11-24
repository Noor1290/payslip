// The lines of the on-screen layout grid (Template page), drawn as Excel and the PDF draw them:
// each side of a cell, or of a merged block, comes from the cells that are actually on that side,
// and where two cells share an edge the heavier line wins (the rule in sheetGeometry.ts).
// The screen only: the PDF and the Excel file have their own drawing and are not changed.

import { cellAt, mergeAt, type BorderEdge, type SheetBody } from './sheetBody'

export type Side = 'top' | 'left' | 'bottom' | 'right'
export type BlockEdges = Partial<Record<Side, BorderEdge>>

/** As heavy as each line prints (the PDF's line widths). */
const WEIGHT: Record<BorderEdge['style'], number> = { hair: 0.25, thin: 0.5, dotted: 0.5, dashed: 0.5, double: 0.5, medium: 1, thick: 1.5 }

const heavier = (a: BorderEdge | undefined, b: BorderEdge | undefined) => (!a ? b : !b ? a : WEIGHT[b.style] > WEIGHT[a.style] ? b : a)

/** The four lines around the cell or merged block whose first cell is at (row, col). */
export function blockEdges(body: Pick<SheetBody, 'rows' | 'merges' | 'styles' | 'columns'>, row: number, col: number): BlockEdges {
  const merge = mergeAt(body, row, col)
  const [rows, cols] = merge ? [merge.rows, merge.cols] : [1, 1]
  const sideOf = (r: number, c: number, side: Side) => {
    if (r < 0 || c < 0 || r >= body.rows.length || c >= body.columns.length) return undefined
    const cell = cellAt(body, r, c)
    return cell ? body.styles[cell.style]?.[side] : undefined
  }
  const edges: BlockEdges = {}
  const put = (side: Side, found: BorderEdge | undefined) => {
    if (found) edges[side] = found
  }
  let top: BorderEdge | undefined
  let bottom: BorderEdge | undefined
  for (let c = col; c < col + cols; c++) {
    top = heavier(top, heavier(sideOf(row, c, 'top'), sideOf(row - 1, c, 'bottom')))
    bottom = heavier(bottom, heavier(sideOf(row + rows - 1, c, 'bottom'), sideOf(row + rows, c, 'top')))
  }
  let left: BorderEdge | undefined
  let right: BorderEdge | undefined
  for (let r = row; r < row + rows; r++) {
    left = heavier(left, heavier(sideOf(r, col, 'left'), sideOf(r, col - 1, 'right')))
    right = heavier(right, heavier(sideOf(r, col + cols - 1, 'right'), sideOf(r, col + cols, 'left')))
  }
  put('top', top)
  put('left', left)
  put('bottom', bottom)
  put('right', right)
  return edges
}
