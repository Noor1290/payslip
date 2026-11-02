// The Excel sheet of a "From your file" payslip: the same grid, fonts, fills, borders, merged
// blocks, column widths and row heights as the layout. Every figure is a plain number with its
// number format, every date a real date. Nothing is a formula.
//
// SHEET DRAWING VERSION 1. A change here is a new version, added beside this one.

import type ExcelJS from 'exceljs'
import type { BorderEdge, CellFormat, SheetStyle } from '../lib/sheetBody'
import { excelDateFormat, excelNumberFormat } from '../lib/sheetFormats'
import { columnName } from '../lib/sheetBody'
import type { SheetDocCell, SheetDocument } from '../lib/sheetDocument'

const argb = (hex: string) => ({ argb: `FF${hex}` })
const edge = (found: BorderEdge | undefined) => (found ? { style: found.style, color: argb(found.color) } : undefined)

function utcDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function apply(target: ExcelJS.Cell, style: SheetStyle): void {
  target.font = {
    name: style.font.name,
    size: style.font.size,
    bold: style.font.bold ?? false,
    italic: style.font.italic ?? false,
    ...(style.font.underline ? { underline: true } : {}),
    ...(style.font.color ? { color: argb(style.font.color) } : {}),
  }
  if (style.fill) target.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(style.fill), bgColor: argb(style.fill) }
  const border: Partial<ExcelJS.Borders> = {}
  for (const side of ['top', 'left', 'bottom', 'right'] as const) {
    const found = edge(style[side])
    if (found) border[side] = found
  }
  target.border = border
  target.alignment = {
    ...(style.horizontal ? { horizontal: style.horizontal } : {}),
    ...(style.vertical ? { vertical: style.vertical } : {}),
    ...(style.wrap ? { wrapText: true } : {}),
  }
}

function value(target: ExcelJS.Cell, cell: SheetDocCell): void {
  const format = cell.format as CellFormat | undefined
  if (cell.number !== undefined && format?.type === 'number') {
    target.value = cell.number
    target.numFmt = excelNumberFormat(format, cell.places ?? 0)
  } else if (cell.iso !== undefined && format?.type === 'date') {
    target.value = utcDate(cell.iso)
    target.numFmt = excelDateFormat(format.pieces)
  } else if (cell.text !== '') target.value = cell.text
}

export function addSheetPage(workbook: ExcelJS.Workbook, name: string, doc: SheetDocument): void {
  const sheet = workbook.addWorksheet(name, {
    pageSetup: {
      paperSize: 9, // A4
      orientation: doc.orientation,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
  })
  const excelColumn = (col: number) => doc.firstColumn + col + 1
  const excelRow = (row: number) => doc.firstRow + row + 1
  const address = (row: number, col: number) => `${columnName(doc.firstColumn + col)}${excelRow(row)}`
  doc.columns.forEach((width, index) => {
    sheet.getColumn(excelColumn(index)).width = width
  })
  doc.rows.forEach((row, rowIndex) => {
    sheet.getRow(excelRow(rowIndex)).height = row.height
    for (const cell of row.cells) apply(sheet.getCell(address(rowIndex, cell.col)), doc.styles[cell.style])
  })
  for (const merge of doc.merges) {
    if (merge.rows === 1 && merge.cols === 1) continue
    const styled = doc.rows[merge.row].cells.find((cell) => cell.col === merge.col)
    sheet.mergeCells(`${address(merge.row, merge.col)}:${address(merge.row + merge.rows - 1, merge.col + merge.cols - 1)}`)
    // Merging gives every cell of the block the first cell's style; each edge keeps its own border.
    for (let row = merge.row; row < merge.row + merge.rows; row++) {
      for (let col = merge.col; col < merge.col + merge.cols; col++) {
        const own = doc.rows[row].cells.find((cell) => cell.col === col) ?? styled
        if (own) sheet.getCell(address(row, col)).border = { ...sheet.getCell(address(row, col)).border, ...borderOf(doc.styles[own.style]) }
      }
    }
  }
  doc.rows.forEach((row, rowIndex) => {
    for (const cell of row.cells) value(sheet.getCell(address(rowIndex, cell.col)), cell)
  })
}

function borderOf(style: SheetStyle): Partial<ExcelJS.Borders> {
  const border: Partial<ExcelJS.Borders> = {}
  for (const side of ['top', 'left', 'bottom', 'right'] as const) {
    const found = edge(style[side])
    if (found) border[side] = found
  }
  return border
}
