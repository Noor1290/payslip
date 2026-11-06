// One employee's payslip from a "From your file" layout: the grid with every cell already holding
// the exact text to print. The preview, the PDF and the Excel sheet all render this one document,
// so they cannot disagree. It has no payroll logic of its own: everything comes from the evaluator.

import { roundHalfUp } from './decimal'
import { readDateOfEmployment } from './dates'
import type { SheetPayslip } from './build'
import type { ImportedPayroll, PayrollRow } from './payrollFile'
import { employeeName } from './payrollFile'
import type { ComputedLine, Issue, PayslipComputation } from './payslip'
import { formatCents } from './money'
import { labelOf, type CellFormat, type OwnValues, type SheetBody, type SheetMerge, type SheetStyle } from './sheetBody'
import { evaluateSheet, problemText, type SheetContext } from './sheetEvaluate'
import { fitSheetDocument } from './sheetFit'
import { layoutSheet, pageOf } from '../writers/sheetGeometry'

/** The drawing version of these payslips, a list of its own: nothing here touches the Table drawings. */
export const SHEET_DRAWING = 1

export interface SheetDocCell {
  col: number
  style: number
  /** Exactly what is printed. */
  text: string
  /** A figure: the number in the Excel cell, and the format it is shown with there. */
  number?: number
  /** A date: YYYY-MM-DD in the Excel cell. */
  iso?: string
  format?: CellFormat
  places?: 0 | 2
  /**
   * A name or an address fitted to its cell: printed at this size, in points of the sheet, on the
   * lines of `text`, or refused. Left out for every other text, which is set smaller only as needed.
   */
  size?: number
}

export interface SheetDocRow {
  /** In points. Taller than the layout's row when a long name or an address needs two lines. */
  height: number
  cells: SheetDocCell[]
}

export interface SheetDocument {
  kind: 'sheet'
  template: { id: string; version: string }
  drawing: number
  orientation: 'portrait' | 'landscape'
  margins?: 'narrow'
  fit?: false
  firstRow: number
  firstColumn: number
  columns: number[]
  rows: SheetDocRow[]
  merges: SheetMerge[]
  styles: SheetStyle[]
  employeeName: string
  period: string
}

export function isSheetDocument(document: unknown): document is SheetDocument {
  return typeof document === 'object' && document !== null && (document as { kind?: unknown }).kind === 'sheet'
}

export interface SheetInUse {
  body: SheetBody
  own: OwnValues
  id: string
  version: string
}

/** The company details as a layout can name them, from the row the payroll data repeats them on. */
export function companyOf(row: PayrollRow): SheetContext['company'] {
  const text = (key: string) => (typeof row[key] === 'string' ? (row[key] as string).trim() : '')
  return { name: text('Company Name'), address: text('Address'), brn: text('BRN'), vat: text('VAT') }
}

export function buildSheetDocument(sheet: SheetInUse, row: PayrollRow, period: string, today: string): { document: SheetDocument; errors: Issue[]; lines: ComputedLine[] } {
  const { body, own } = sheet
  const values = evaluateSheet(body, { company: companyOf(row), period, today, own }, row)
  const errors: Issue[] = []
  const lines: ComputedLine[] = []

  const rows = body.rows.map((sheetRow, rowIndex): SheetDocRow => ({
    height: sheetRow.height,
    cells: sheetRow.cells.map((cell): SheetDocCell => {
      const value = values.get(cell.id)!
      if (value.problem) errors.push({ code: value.problem, lineId: cell.id, message: problemText(body, rowIndex, cell, value) })
      if (value.kind === 'number' && cell.side) {
        const cents = Number(roundHalfUp(value.number!, 2).units * 10n ** BigInt(2 - roundHalfUp(value.number!, 2).scale))
        lines.push({ id: cell.id, label: labelOf(body, rowIndex, cell), side: cell.side, sourceKey: cell.source.type === 'payroll' ? cell.source.key : null, status: 'ok', cents, display: formatCents(cents) })
      }
      const printed: SheetDocCell = { col: cell.col, style: cell.style, text: value.text }
      if (value.kind === 'number') {
        printed.number = Number(`${value.number!.units}e-${value.number!.scale}`)
        printed.format = cell.format
        printed.places = value.places
      }
      if (value.kind === 'date') {
        printed.iso = value.iso
        printed.format = cell.format
      }
      return printed
    }),
  }))

  const document: SheetDocument = {
    kind: 'sheet',
    template: { id: sheet.id, version: sheet.version },
    drawing: SHEET_DRAWING,
    orientation: body.orientation,
    ...(body.margins ? { margins: body.margins } : {}),
    ...(body.fit === false ? { fit: false as const } : {}),
    firstRow: body.firstRow,
    firstColumn: body.firstColumn,
    columns: body.columns,
    rows,
    merges: body.merges,
    styles: body.styles,
    employeeName: employeeName(row),
    period,
  }
  fitSheetDocument(document, body, row, companyOf(row).address)
  return { document, errors, lines }
}

/** Said when the sheet, printed at 100%, is larger than the page. */
export const TOO_LARGE_AT_FULL_SIZE =
  'At 100%, the sheet is larger than one A4 page. On the Template page, tick "Fit the sheet on one page", or make the sheet smaller in Excel.'

const DATE_KEY = 'Date of Employment'

/** Everything the screen and the exports need for each employee, as preparePayslips gives for the Table template. */
export function prepareSheetPayslips(data: ImportedPayroll, sheet: SheetInUse, period: string, today: string): SheetPayslip[] {
  return data.rows.map((row, rowIndex) => {
    const { document, errors, lines } = buildSheetDocument(sheet, row, period, today)
    const page = layoutSheet(document)
    if (!pageOf(document).fits) errors.push({ code: 'page-too-small', message: TOO_LARGE_AT_FULL_SIZE })
    if (page.unsupported.length > 0) errors.push({ code: 'unsupported-character', message: `The payslip font cannot print these characters: ${page.unsupported.join(' ')}` })
    for (const text of page.overflow) errors.push({ code: 'too-long', message: `"${text}" is too long to fit on the payslip, even at the smallest size.` })
    const sum = (side: 'earnings' | 'deductions') => lines.filter((line) => line.side === side).reduce((total, line) => total + line.cents, 0)
    const raw = row[DATE_KEY]
    const computation: PayslipComputation = {
      rowIndex,
      employeeName: employeeName(row),
      dateOfEmployment: typeof raw === 'string' ? readDateOfEmployment(raw) : null,
      lines,
      totals: { earnings: sum('earnings'), deductions: sum('deductions'), net: sum('earnings') - sum('deductions') },
      // The cross-checks against the payroll's totals come with the choice of the three cells.
      checks: [],
      errors,
      warnings: [],
    }
    return errors.length > 0 ? { computation, document: null, page: null } : { computation, document, page }
  })
}
