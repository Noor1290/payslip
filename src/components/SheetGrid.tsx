import type { CSSProperties } from 'react'
import { cellAt, cellName, columnName, mergeAt, type SheetBody, type SheetCell, type SheetStyle } from '../lib/sheetBody'
import { columnPoints } from '../writers/sheetGeometry'
import { sourceSummary } from '../lib/sheetWording'
import { blockEdges, type BlockEdges } from '../lib/sheetGridEdges'

export interface SheetPlace {
  row: number
  col: number
}

const EDGE_CSS: Record<string, string> = { hair: '1px dotted', thin: '1px solid', dotted: '1px dotted', dashed: '1px dashed', medium: '2px solid', double: '3px double', thick: '3px solid' }
/** Points on the sheet to pixels on screen: the grid is drawn at its Excel size. */
const PIXELS = 4 / 3
/** Excel's pale gridline, only where the cell has no line of its own, so it never covers one. */
const GRIDLINE = '1px solid #eceef1'

function look(style: SheetStyle | undefined, edges: BlockEdges, figure: boolean): CSSProperties {
  const edge = (side: 'top' | 'left' | 'bottom' | 'right') => {
    const found = edges[side]
    return found ? `${EDGE_CSS[found.style]} #${found.color}` : GRIDLINE
  }
  const lines = { borderTop: edge('top'), borderLeft: edge('left'), borderBottom: edge('bottom'), borderRight: edge('right') }
  if (!style) return lines
  return {
    fontFamily: `'${style.font.name}', 'Payslip Pagella', serif`,
    fontSize: `${style.font.size * PIXELS}px`,
    fontWeight: style.font.bold ? 700 : 400,
    fontStyle: style.font.italic ? 'italic' : 'normal',
    textDecoration: style.font.underline ? 'underline' : 'none',
    color: `#${style.font.color ?? '000000'}`,
    background: style.fill ? `#${style.fill}` : '#ffffff',
    ...lines,
    textAlign: style.horizontal ?? (figure ? 'right' : 'left'),
    verticalAlign: style.vertical ?? 'bottom',
    whiteSpace: style.wrap ? 'normal' : 'nowrap',
  }
}

/**
 * The layout as a grid, keeping the look of the file: a picture of the paper, so it stays white in
 * both themes. Every cell, or merged block, is a button that selects it. It shows what the first
 * employee's payslip prints there when payroll data is open, otherwise what goes in it.
 */
export function SheetGrid({
  body,
  selected,
  onSelect,
  printed,
}: {
  body: SheetBody
  selected: SheetPlace | null
  onSelect: (place: SheetPlace) => void
  /** What each cell prints for the first employee, by cell id. A figure or a date sits right, as in Excel. */
  printed: ReadonlyMap<string, { text: string; figure: boolean }> | null
}) {
  const label = (cell: SheetCell | null) => (cell ? sourceSummary(cell.source) : 'Empty')
  return (
    <div className="sheet-scroll" data-testid="sheet-grid">
      <table className="sheet-grid">
        <caption className="sr-only">The payslip layout, cell by cell</caption>
        <colgroup>
          <col style={{ width: 36 }} />
          {body.columns.map((width, index) => (
            <col key={index} style={{ width: columnPoints(width) * PIXELS }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="sheet-head">
              <span className="sr-only">Row</span>
            </th>
            {body.columns.map((_, index) => (
              <th key={index} scope="col" className="sheet-head">
                {columnName(body.firstColumn + index)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.rows.map((row, rowIndex) => (
            <tr key={rowIndex} style={{ height: row.height * PIXELS }}>
              <th scope="row" className="sheet-head">
                {body.firstRow + rowIndex + 1}
              </th>
              {body.columns.map((_, col) => {
                const merge = mergeAt(body, rowIndex, col)
                if (merge && (merge.row !== rowIndex || merge.col !== col)) return null
                const cell = cellAt(body, rowIndex, col)
                const style = cell ? body.styles[cell.style] : undefined
                const isSelected = selected?.row === rowIndex && selected.col === col
                const text = cell ? (printed?.get(cell.id)?.text ?? (cell.source.type === 'text' || cell.source.type === 'fixed' ? cell.source.value : '')) : ''
                const chip = cell && !printed && cell.source.type !== 'empty' && cell.source.type !== 'text' && cell.source.type !== 'fixed'
                return (
                  <td key={col} rowSpan={merge?.rows} colSpan={merge?.cols} className={isSelected ? 'sheet-selected' : undefined} style={look(style, blockEdges(body, rowIndex, col), cell !== null && (printed?.get(cell.id)?.figure ?? (cell.format.type !== 'text')))}>
                    <button
                      type="button"
                      className="sheet-cell"
                      style={{ textAlign: 'inherit', fontStyle: 'inherit', fontWeight: 'inherit' }}
                      aria-pressed={isSelected}
                      aria-label={`Cell ${cellName(body, rowIndex, col)}: ${label(cell)}`}
                      onClick={() => onSelect({ row: rowIndex, col })}
                    >
                      {chip ? <span className="sheet-chip">{label(cell)}</span> : text}
                    </button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
