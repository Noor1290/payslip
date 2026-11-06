// One employee's payslip from a "From your file" layout: the grid with every cell already holding
// the exact text to print. The preview, the PDF and the Excel sheet all render this one document,
// so they cannot disagree. It has no payroll logic of its own: everything comes from the evaluator.

import { roundHalfUp } from './decimal'
import { readDateOfEmployment } from './dates'
import type { SheetPayslip } from './build'
import type { ImportedPayroll, PayrollRow } from './payrollFile'
import { employeeName } from './payrollFile'
import { CHECK_LABEL, PROBLEM_CODE, PROBLEM_TEXT, type CheckId, type CheckKind, type ComputedLine, type Issue, type PayslipComputation, type ReconcileCheck } from './payslip'
import { formatCents, parseMoney } from './money'
import { cellName, labelOf, TOTALS, type CellFormat, type OwnValues, type SheetBody, type SheetCell, type SheetMerge, type SheetStyle, type SheetTotal } from './sheetBody'
import { canBeZero, evaluateSheet, problemText, type CellValue, type SheetContext } from './sheetEvaluate'
import { DEFAULT_TABLE_MAPPING } from './template'
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

/** A cell's name in messages: "C14 (Basic Salary)", or "C14" when nothing names it. */
export function cellTitle(body: SheetBody, row: number, cell: SheetCell): string {
  const label = labelOf(body, row, cell)
  return label ? `${cellName(body, row, cell.col)} (${label})` : cellName(body, row, cell.col)
}

/** What a payslip of a layout says beyond its document: the figures of its sides, its totals, and what was accepted or is missing. */
export interface SheetFacts {
  lines: ComputedLine[]
  /** The cents printed in each cell marked as a total. Null when the cell has a problem. */
  totals: Partial<Record<SheetTotal, { cents: number | null; title: string }>>
  zeroable: Record<string, string>
  zeroCells: { id: string; label: string }[]
  requiredEmpty: string[]
}

const centsOf = (value: CellValue) => {
  const rounded = roundHalfUp(value.number!, 2)
  return Number(rounded.units * 10n ** BigInt(2 - rounded.scale))
}

export function buildSheetDocument(
  sheet: SheetInUse,
  row: PayrollRow,
  period: string,
  today: string,
  zero: ReadonlySet<string> = new Set(),
): { document: SheetDocument; errors: Issue[]; lines: ComputedLine[]; facts: SheetFacts } {
  const { body, own } = sheet
  const values = evaluateSheet(body, { company: companyOf(row), period, today, own, zero }, row)
  const errors: Issue[] = []
  const facts: SheetFacts = { lines: [], totals: {}, zeroable: {}, zeroCells: [], requiredEmpty: [] }

  const rows = body.rows.map((sheetRow, rowIndex): SheetDocRow => ({
    height: sheetRow.height,
    cells: sheetRow.cells.map((cell): SheetDocCell => {
      const value = values.get(cell.id)!
      const title = cellTitle(body, rowIndex, cell)
      if (value.problem) {
        errors.push({ code: value.problem, lineId: cell.id, message: problemText(body, rowIndex, cell, value) })
        if (value.problem === 'missing-key' && value.key && canBeZero(value.key)) facts.zeroable[cell.id] = title
      }
      if (value.kind === 'number' && cell.side) {
        const cents = centsOf(value)
        facts.lines.push({
          id: cell.id,
          label: labelOf(body, rowIndex, cell),
          side: cell.side,
          sourceKey: cell.source.type === 'payroll' ? cell.source.key : null,
          status: value.zeroed ? 'treated-as-zero' : 'ok',
          cents,
          display: formatCents(cents),
        })
      } else if (value.zeroed) facts.zeroCells.push({ id: cell.id, label: title })
      if (cell.total) facts.totals[cell.total] = { cents: value.kind === 'number' && !value.problem ? centsOf(value) : null, title }
      if (cell.required && !value.problem && value.text.trim() === '') facts.requiredEmpty.push(title)

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
  return { document, errors, lines: facts.lines, facts }
}

/** Said when the sheet, printed at 100%, is larger than the page. */
export const TOO_LARGE_AT_FULL_SIZE =
  'At 100%, the sheet is larger than one A4 page. On the Template page, tick "Fit the sheet on one page", or make the sheet smaller in Excel.'

/** Said when no cell is marked as a total. */
export const NO_TOTALS =
  "No cell of the layout is marked as Total earnings, Total deductions or Net pay, so this payslip is not checked against the payroll's totals."

const DATE_KEY = 'Date of Employment'
const CHECK_OF: Record<SheetTotal, CheckId> = { earnings: 'gross', deductions: 'deductions', net: 'net' }

/**
 * The checks of a layout: each cell marked as a total, as printed, against the payroll's Gross
 * Pay, Total deductions and Net Pay, as the Table payslip checks its totals (a difference of
 * exactly 0.01 is rounding). Only the totals the layout marks are checked.
 */
function sheetChecks(row: PayrollRow, facts: SheetFacts, errors: Issue[]): ReconcileCheck[] {
  const checks: ReconcileCheck[] = []
  for (const total of TOTALS) {
    const marked = facts.totals[total]
    if (!marked) continue
    const id = CHECK_OF[total]
    const label = `${CHECK_LABEL[id]}, cell ${marked.title}`
    const payrollKey = DEFAULT_TABLE_MAPPING.checks[id]
    const payroll = parseMoney(row[payrollKey])
    if (!payroll.ok) {
      errors.push({ code: PROBLEM_CODE[payroll.reason], lineId: `check-${id}`, message: `${CHECK_LABEL[id]} cannot be checked: ${PROBLEM_TEXT[payroll.reason](payrollKey)}.` })
      checks.push({ id, label, payrollKey, payslipCents: marked.cents, payrollCents: null, diffCents: null, kind: 'unavailable' })
      continue
    }
    if (marked.cents === null) {
      checks.push({ id, label, payrollKey, payslipCents: null, payrollCents: payroll.cents, diffCents: null, kind: 'unavailable' })
      continue
    }
    const diffCents = marked.cents - payroll.cents
    const kind: CheckKind = diffCents === 0 ? 'match' : Math.abs(diffCents) === 1 ? 'rounding' : 'difference'
    checks.push({ id, label, payrollKey, payslipCents: marked.cents, payrollCents: payroll.cents, diffCents, kind })
  }
  return checks
}

/** Everything the screen and the exports need for each employee, as preparePayslips gives for the Table template. */
export function prepareSheetPayslips(
  data: ImportedPayroll,
  sheet: SheetInUse,
  period: string,
  today: string,
  treatAsZero: ReadonlyMap<number, ReadonlySet<string>> = new Map(),
): SheetPayslip[] {
  return data.rows.map((row, rowIndex) => {
    const { document, errors, facts } = buildSheetDocument(sheet, row, period, today, treatAsZero.get(rowIndex))
    const page = layoutSheet(document)
    if (!pageOf(document).fits) errors.push({ code: 'page-too-small', message: TOO_LARGE_AT_FULL_SIZE })
    if (page.unsupported.length > 0) errors.push({ code: 'unsupported-character', message: `The payslip font cannot print these characters: ${page.unsupported.join(' ')}` })
    for (const text of page.overflow) errors.push({ code: 'too-long', message: `"${text}" is too long to fit on the payslip, even at the smallest size.` })
    const checks = sheetChecks(row, facts, errors)
    const warnings: Issue[] = []
    if (Object.keys(facts.totals).length === 0) warnings.push({ code: 'no-totals', message: NO_TOTALS })
    for (const title of facts.requiredEmpty) warnings.push({ code: 'required-empty', message: `Cell ${title} is required, and it is empty.` })
    const { lines } = facts
    const sum = (side: 'earnings' | 'deductions') => lines.filter((line) => line.side === side).reduce((total, line) => total + line.cents, 0)
    const raw = row[DATE_KEY]
    const computation: PayslipComputation = {
      rowIndex,
      employeeName: employeeName(row),
      dateOfEmployment: typeof raw === 'string' ? readDateOfEmployment(raw) : null,
      lines,
      totals: { earnings: sum('earnings'), deductions: sum('deductions'), net: sum('earnings') - sum('deductions') },
      checks,
      errors,
      warnings,
      zeroable: facts.zeroable,
      zeroCells: facts.zeroCells,
      requiredEmpty: facts.requiredEmpty,
    }
    return errors.length > 0 ? { computation, document: null, page: null } : { computation, document, page }
  })
}
