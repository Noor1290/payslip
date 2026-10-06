// The layout model: ONE description of a payslip page that the preview, the PDF writer and the
// Excel writer all render. Every cell already holds the exact text to print, so the three
// outputs cannot disagree on content. The model is a grid, like the reference workbook:
// four columns (B to E) and one row per line of the reference (rows 4 to 34).

import { formatPeriod, formatShortDate } from './dates'
import { formatCents } from './money'
import type { Company } from './payrollFile'
import type { ComputedLine, PayslipComputation } from './payslip'
import type { PayslipTemplate } from './template'

export type Align = 'left' | 'center' | 'right'

export interface DocCell {
  /** 0 to 3 = Excel columns B to E. */
  col: 0 | 1 | 2 | 3
  /** How many columns the cell covers (a merged cell in Excel). */
  span: 1 | 2 | 4
  kind: 'text' | 'money' | 'date'
  /** Exactly what the preview, the PDF and (through its number format) Excel show. */
  text: string
  bold: boolean
  /** Font size in the Excel file (the reference's 11 and 12). */
  size: 11 | 12
  align: Align
  /** kind 'money': the amount in whole cents. */
  cents?: number
  /** kind 'date': the date as YYYY-MM-DD. */
  isoDate?: string
  /** Names the figure, so a total's formula can point at its lines. */
  lineId?: string
  /** A total: Excel gets a live formula over these lines; the text is the value already added up. */
  formula?: { op: 'sum' | 'subtract'; lineIds: string[] }
}

export interface DocRow {
  id: string
  cells: DocCell[]
  /** Band fill colour (RRGGBB), or null. */
  fill: string | null
  /** A horizontal rule under the row, across the full width. */
  ruleBelow: 'black' | 'grey' | null
}

export interface PayslipDocument {
  template: { id: string; version: string }
  page: { size: 'A4'; orientation: 'portrait' }
  fonts: { excel: string; print: string }
  /** Excel column widths of B to E, from the reference. Other writers use them as proportions. */
  columnWidths: [number, number, number, number]
  /** First Excel row; row n of `rows` is Excel row firstExcelRow + n. */
  firstExcelRow: number
  rows: DocRow[]
  /** The thick divider between the two halves runs from this row to the last one. */
  dividerFromRowId: string
  employeeName: string
  period: string
}

export const BAND_FILL = '66CCFF'
const COLUMN_WIDTHS: [number, number, number, number] = [28.77734375, 32.77734375, 35.6640625, 40.5546875]

export interface DocumentInput {
  template: PayslipTemplate
  /** Must have totals: a payslip with an error line is never laid out. */
  computation: PayslipComputation
  company: Company
  nic: string
  period: string
  /** The sign-off date, YYYY-MM-DD. */
  issueDate: string
}

type CellOptions = Partial<Pick<DocCell, 'span' | 'bold' | 'size' | 'align'>>

function text(col: DocCell['col'], value: string, options: CellOptions = {}): DocCell {
  return { col, span: 1, kind: 'text', text: value, bold: false, size: 11, align: 'left', ...options }
}

function money(col: DocCell['col'], cents: number, display: string, lineId: string, formula?: DocCell['formula']): DocCell {
  const cell: DocCell = { col, span: 1, kind: 'money', text: display, bold: false, size: 11, align: 'right', cents, lineId }
  if (formula) cell.formula = formula
  return cell
}

function date(col: DocCell['col'], iso: string, align: Align): DocCell {
  return { col, span: 1, kind: 'date', text: formatShortDate(iso), bold: false, size: 11, align, isoDate: iso }
}

function row(id: string, cells: DocCell[], extra: Partial<Pick<DocRow, 'fill' | 'ruleBelow'>> = {}): DocRow {
  return { id, cells, fill: null, ruleBelow: null, ...extra }
}

export function buildPayslipDocument(input: DocumentInput): PayslipDocument {
  const { template, computation, company, period } = input
  if (!computation.totals) throw new Error('A payslip with a line in error cannot be laid out.')
  const { labels } = template
  const heading: CellOptions = { span: 4, bold: true, size: 12, align: 'center' }
  const lineById = new Map(computation.lines.map((line) => [line.id, line]))
  const moneyCell = (col: DocCell['col'], line: ComputedLine) => money(col, line.cents, line.display, line.id)

  // The two halves of the body, row by row: earnings on the left, deduction groups on the right.
  const left: DocCell[][] = template.earnings.map((line) => [text(0, line.label), moneyCell(1, lineById.get(line.id)!)])
  const right: DocCell[][] = []
  template.deductionGroups.forEach((group, index) => {
    if (index > 0) right.push([])
    right.push([text(2, group.label)])
    if (group.gapAfterLabel) right.push([])
    for (const line of group.lines) right.push([text(2, line.label), moneyCell(3, lineById.get(line.id)!)])
  })
  const bodyRows: DocRow[] = Array.from({ length: Math.max(left.length, right.length) }, (_, index) =>
    row(`body-${index + 1}`, [...(left[index] ?? []), ...(right[index] ?? [])]),
  )

  const earningIds = template.earnings.map((line) => line.id)
  const deductionIds = template.deductionGroups.flatMap((group) => group.lines.map((line) => line.id))
  const { totals } = computation

  const rows: DocRow[] = [
    row('title', [text(0, labels.title, heading)], { fill: BAND_FILL, ruleBelow: 'black' }),
    row('company', [text(0, company.name, heading)], { ruleBelow: 'grey' }),
    row('address-1', [text(0, company.addressLines[0], heading)], { ruleBelow: 'grey' }),
    row('address-2', [text(0, company.addressLines[1], heading)], { ruleBelow: 'grey' }),
    row('brn', [text(0, `${labels.brnPrefix}${company.brn}`, heading)], { ruleBelow: 'grey' }),
    row('period', [text(3, `${labels.payPeriodPrefix}${formatPeriod(period)}`, { bold: true, size: 12, align: 'center' })], {
      ruleBelow: 'black',
    }),
    row('employee-band', [text(0, labels.employeeInfo, heading)], { fill: BAND_FILL, ruleBelow: 'black' }),
    row('employee-name', [
      text(0, labels.name),
      text(1, computation.employeeName),
      text(2, labels.dateOfEmployment),
      ...(computation.dateOfEmployment ? [date(3, computation.dateOfEmployment, 'left')] : []),
    ]),
    row('employee-nic', [text(0, labels.nic), text(1, input.nic)]),
    row('spacer', [], { ruleBelow: 'black' }),
    row('headings', [
      text(0, labels.earnings, { span: 2, bold: true, size: 12, align: 'center' }),
      text(2, labels.deductions, { span: 2, bold: true, size: 12, align: 'center' }),
    ]),
    row('currency', [text(1, labels.currency, { align: 'center' }), text(3, labels.currency, { align: 'center' })]),
    ...bodyRows,
    row('gap-1', []),
    row('totals', [
      text(0, labels.totalEarnings),
      money(1, totals.earnings, formatCents(totals.earnings), 'totalEarnings', { op: 'sum', lineIds: earningIds }),
      text(2, labels.totalDeductions),
      money(3, totals.deductions, formatCents(totals.deductions), 'totalDeductions', { op: 'sum', lineIds: deductionIds }),
    ]),
    row('gap-2', []),
    row('gap-3', []),
    row('net-pay', [
      text(2, labels.netPay),
      money(3, totals.net, formatCents(totals.net), 'netPay', {
        op: 'subtract',
        lineIds: ['totalEarnings', 'totalDeductions'],
      }),
    ]),
    row('gap-4', []),
    row('signatures', [text(0, labels.signatureEmployee), text(2, labels.signatureEmployer)]),
    row('sign-date', [text(0, labels.date), date(1, input.issueDate, 'right')]),
    row('gap-5', []),
    row('end', []),
  ]

  return {
    template: { id: template.id, version: template.version },
    page: { size: 'A4', orientation: 'portrait' },
    fonts: { excel: 'Book Antiqua', print: 'TeX Gyre Pagella' },
    columnWidths: COLUMN_WIDTHS,
    firstExcelRow: 4,
    rows,
    dividerFromRowId: 'headings',
    employeeName: computation.employeeName,
    period,
  }
}

/** Every piece of text on the page, in reading order. Used to compare the three outputs. */
export function documentTexts(doc: PayslipDocument): string[] {
  return doc.rows.flatMap((r) => r.cells.map((cell) => cell.text)).filter((value) => value !== '')
}
