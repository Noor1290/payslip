// The on-screen layout grid draws each block's lines from the cells on that side (hotfix 1).
import { describe, expect, it } from 'vitest'
import type { SheetBody, SheetStyle } from '../src/lib/sheetBody'
import { blockEdges } from '../src/lib/sheetGridEdges'

const FONT = { name: 'Book Antiqua', size: 11 }
const MEDIUM = { style: 'medium', color: '000000' } as const
const THICK = { style: 'thick', color: '000000' } as const
const styles: SheetStyle[] = [
  { font: FONT, top: MEDIUM, left: MEDIUM, bottom: MEDIUM }, // 0: first cell of a band
  { font: FONT, top: MEDIUM, bottom: MEDIUM }, // 1: inside the band
  { font: FONT, top: MEDIUM, bottom: MEDIUM, right: MEDIUM }, // 2: last cell of the band
  { font: FONT, left: MEDIUM }, // 3
  { font: FONT, right: THICK }, // 4: the divider
  { font: FONT }, // 5: no line
  { font: FONT, right: MEDIUM }, // 6
]
const text = (id: string, col: number, style: number) => ({ id, col, style, source: { type: 'text' as const, value: id }, format: { type: 'text' as const, capitals: false } })

// Row 0: a band merged over four columns (as B4:E4 of the owner's layout); row 1: four cells.
const body: SheetBody = {
  schema: 2,
  kind: 'file',
  orientation: 'portrait',
  firstRow: 3,
  firstColumn: 1,
  columns: [28, 32, 35, 40],
  rows: [
    { height: 16, cells: [text('ca', 0, 0), text('cb', 1, 1), text('cc', 2, 1), text('cd', 3, 2)] },
    { height: 15, cells: [text('ce', 0, 3), text('cf', 1, 4), text('cg', 2, 5), text('ch', 3, 6)] },
  ],
  merges: [{ row: 0, col: 0, rows: 1, cols: 4 }],
  styles,
}

describe('blockEdges', () => {
  it("gives a merged block the right edge of its LAST cell, not only its first cell's lines", () => {
    expect(blockEdges(body, 0, 0)).toEqual({ top: MEDIUM, left: MEDIUM, bottom: MEDIUM, right: MEDIUM })
  })
  it('takes a line named by the neighbour on a shared edge, the heavier one when both name one', () => {
    // The cell after the divider has no left line of its own: the divider's thick line is its left.
    expect(blockEdges(body, 1, 2).left).toEqual(THICK)
    expect(blockEdges(body, 1, 1).right).toEqual(THICK)
    // The band's bottom line is the top of every cell below it.
    expect(blockEdges(body, 1, 2).top).toEqual(MEDIUM)
  })
  it('leaves a side without any line empty, for the pale gridline', () => {
    expect(blockEdges(body, 1, 2).bottom).toBeUndefined()
    expect(blockEdges(body, 1, 1).left).toBeUndefined()
  })
})
