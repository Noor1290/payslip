// The Excel writer renders the same layout model as the preview and the PDF, one sheet per
// employee, styled like the reference workbook: Book Antiqua 11 and 12, #66CCFF bands, medium
// borders, a thick divider between the two halves, merged heading cells.
// Every figure is a plain number from the payroll data. Only the three totals are live formulas.
//
// DRAWING VERSION 1. The styles and the sheet set-up in this file are frozen: payslips were issued
// with them and must always be written the same way (tests/format1.test.ts). A change is a new
// drawing version, added beside this one, never in place of it.

import ExcelJS from 'exceljs'
import { KNOWN_DRAWINGS, unknownDrawing, type DocCell, type DocRow, type PayslipDocument } from '../lib/layoutModel'
import { centsToNumber, isWholeRupees } from '../lib/money'

// Accounting-style formats, as in the reference: a zero shows as "-".
export const FORMAT_WHOLE = '_-* #,##0_-;-* #,##0_-;_-* "-"??_-;_-@'
export const FORMAT_DECIMALS = '_-* #,##0.00_-;-* #,##0.00_-;_-* "-"??_-;_-@'
export const FORMAT_DATE = 'd-mmm-yy'

const BLACK = { argb: 'FF000000' }
const GREY = { argb: 'FFCCCCCC' }
const COLUMN_LETTERS = ['B', 'C', 'D', 'E'] as const
/** Row heights the reference sets by hand (Excel row number -> points). */
const BAND_ROW_HEIGHT = 16.2
const HEADINGS_ROW_HEIGHT = 15.6

export function moneyFormat(cents: number): string {
  return isWholeRupees(cents) ? FORMAT_WHOLE : FORMAT_DECIMALS
}

/** Sheet names: at most 31 characters, none of \ / ? * [ ] :, and unique in the workbook. */
export function sheetNames(names: readonly string[]): string[] {
  const used = new Set<string>()
  return names.map((name) => {
    const clean = name.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim() || 'Payslip'
    let candidate = clean.slice(0, 31)
    for (let n = 2; used.has(candidate.toLowerCase()); n++) {
      const suffix = ` (${n})`
      candidate = `${clean.slice(0, 31 - suffix.length)}${suffix}`
    }
    used.add(candidate.toLowerCase())
    return candidate
  })
}

function utcDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function addSheet(workbook: ExcelJS.Workbook, name: string, doc: PayslipDocument): void {
  if (!KNOWN_DRAWINGS.includes(doc.drawing)) throw new Error(unknownDrawing(doc.drawing))
  const sheet = workbook.addWorksheet(name, {
    pageSetup: {
      paperSize: 9, // A4
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
    },
  })
  doc.columnWidths.forEach((width, index) => {
    sheet.getColumn(index + 2).width = width
  })

  const excelRow = (index: number) => doc.firstExcelRow + index
  const address = (col: number, index: number) => `${COLUMN_LETTERS[col]}${excelRow(index)}`
  const dividerIndex = doc.rows.findIndex((row) => row.id === doc.dividerFromRowId)
  const lastIndex = doc.rows.length - 1

  // Where each named figure lives, so the totals' formulas can point at their lines.
  const addressOfLine = new Map<string, string>()
  doc.rows.forEach((row, index) => {
    for (const cell of row.cells) if (cell.lineId) addressOfLine.set(cell.lineId, address(cell.col, index))
  })

  const ruleColour = (rule: DocRow['ruleBelow']) => (rule === 'grey' ? GREY : BLACK)

  doc.rows.forEach((row, index) => {
    const sheetRow = sheet.getRow(excelRow(index))
    if (row.fill || ['company', 'address-1', 'address-2', 'brn', 'period'].includes(row.id)) sheetRow.height = BAND_ROW_HEIGHT
    if (row.id === doc.dividerFromRowId) sheetRow.height = HEADINGS_ROW_HEIGHT

    const cellAt = new Map<number, DocCell>()
    for (const cell of row.cells) {
      for (let offset = 0; offset < cell.span; offset++) cellAt.set(cell.col + offset, cell)
      if (cell.span > 1) sheet.mergeCells(`${address(cell.col, index)}:${address(cell.col + cell.span - 1, index)}`)
    }

    const above = index === 0 ? null : doc.rows[index - 1].ruleBelow
    for (let col = 0; col < 4; col++) {
      const target = sheet.getCell(address(col, index))
      const cell = cellAt.get(col)

      const border: Partial<ExcelJS.Borders> = {}
      if (col === 0) border.left = { style: 'medium', color: BLACK }
      if (col === 3) border.right = { style: 'medium', color: BLACK }
      if (col === 1 && dividerIndex >= 0 && index >= dividerIndex) border.right = { style: 'thick', color: BLACK }
      if (index === 0) border.top = { style: 'medium', color: BLACK }
      else if (above) border.top = { style: 'medium', color: ruleColour(above) }
      if (index === lastIndex) border.bottom = { style: 'medium', color: BLACK }
      else if (row.ruleBelow) border.bottom = { style: 'medium', color: ruleColour(row.ruleBelow) }
      target.border = border

      target.font = { name: doc.fonts.excel, size: cell?.size ?? 11, bold: cell?.bold ?? false }
      target.alignment = { horizontal: cell?.align ?? 'left', vertical: 'middle' }
      if (row.fill) {
        target.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${row.fill}` }, bgColor: { argb: `FF${row.fill}` } }
      }

      // Only the first cell of a merged range holds the value.
      if (!cell || cell.col !== col) continue
      if (cell.kind === 'money') {
        const cents = cell.cents ?? 0
        target.numFmt = moneyFormat(cents)
        if (cell.formula) {
          const refs = cell.formula.lineIds.map((id) => {
            const ref = addressOfLine.get(id)
            if (!ref) throw new Error(`The total "${cell.lineId}" points at a line that is not on the page: ${id}`)
            return ref
          })
          const formula = refs.join(cell.formula.op === 'sum' ? '+' : '-')
          target.value = { formula, result: centsToNumber(cents) }
          // The total follows the display rule even after someone edits a line in Excel.
          const ref = address(cell.col, index)
          sheet.addConditionalFormatting({
            ref,
            rules: [
              { type: 'expression', priority: 1, formulae: [`${ref}=TRUNC(${ref})`], style: { numFmt: FORMAT_WHOLE } },
              { type: 'expression', priority: 2, formulae: [`${ref}<>TRUNC(${ref})`], style: { numFmt: FORMAT_DECIMALS } },
            ],
          })
        } else {
          target.value = centsToNumber(cents)
        }
      } else if (cell.kind === 'date' && cell.isoDate) {
        target.value = utcDate(cell.isoDate)
        target.numFmt = FORMAT_DATE
      } else {
        target.value = cell.text
      }
    }
  })
}

/** One workbook with a sheet per employee. */
export async function writePayslipWorkbook(docs: readonly PayslipDocument[]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Payslip app'
  workbook.lastModifiedBy = 'Payslip app'
  const names = sheetNames(docs.map((doc) => doc.employeeName))
  docs.forEach((doc, index) => addSheet(workbook, names[index], doc))
  const buffer = await workbook.xlsx.writeBuffer()
  return new Uint8Array(buffer as ArrayBuffer)
}
