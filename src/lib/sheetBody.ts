// The body of a "From your file" template: the owner's own Excel payslip layout, as the dashboard
// stores it (payslip-template, schema 2). It is a grid: column widths, row heights, merged blocks,
// a table of styles, and for each cell what goes in it. The uploaded file itself is not kept.
//
// Only text typed in the file stays in the body. Numbers, dates and formulas of an upload start
// Empty, so a real figure can never be stored by accident. A body from the dashboard is untrusted:
// it is checked here before it is used, as templateBody.ts does for the Table template.
//
// The calculations and cell sources follow mra_returns/src/lib/template.ts (copied, not shared:
// the apps have no common package).

import { z } from 'zod'
import { canonicalJson, jsonBytes } from './hubWire'
import { normaliseKey } from './payrollFile'
import { isEmployerContributionKey, NEVER_MAP } from './template'
import { BODY_MAX_BYTES, hasEmbeddedFile } from './templateBody'

export const SHEET_SCHEMA = 2
export const SHEET_KIND = 'file'
/** The most a layout may have: one payslip fits one A4 page. */
export const MAX_SHEET_ROWS = 80
export const MAX_SHEET_COLUMNS = 30
/** A small calculation has at most this many parts. */
export const MAX_TERMS = 20
export const MAX_TEXT = 300
const MAX_STYLES = 400

const text = z.string().max(MAX_TEXT)
const key = z.string().trim().min(1).max(120)
export const cellIdSchema = z.string().regex(/^[a-z0-9]{1,12}$/)
/** A decimal number written as text, so it is exact: "0.045", "29710", "-1". */
const decimalText = z.string().regex(/^-?\d{1,12}(\.\d{1,8})?$/)

export const COMPANY_FIELDS = ['name', 'address', 'brn', 'vat'] as const
export type CompanyField = (typeof COMPANY_FIELDS)[number]

const operandSchema = z.discriminatedUnion('type', [
  /** A payroll column of the saved run, by its key. */
  z.strictObject({ type: z.literal('column'), key }),
  /** The value of another cell of the layout. */
  z.strictObject({ type: z.literal('cell'), id: cellIdSchema }),
  z.strictObject({ type: z.literal('number'), value: decimalText }),
])
export type Operand = z.infer<typeof operandSchema>

export const ROUNDINGS = ['none', 'whole', 'two'] as const
const termSchema = z.strictObject({
  /** Added (1) or subtracted (-1). */
  sign: z.union([z.literal(1), z.literal(-1)]),
  of: operandSchema,
  /** Multiplied by this rate before rounding: "0.045" for 4.5 %. */
  times: decimalText.nullable(),
  /** Rounded on its own, half up, before it is added. */
  round: z.enum(ROUNDINGS),
})
export type Term = z.infer<typeof termSchema>

export const DATE_OF = ['employment', 'month', 'today', 'field'] as const
export type DateOf = (typeof DATE_OF)[number]

const sourceSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('empty') }),
  /** The text typed in the file; labels stay as they are. */
  z.strictObject({ type: z.literal('text'), value: text }),
  /** The same text for all companies; a company may have its own, kept outside the body. */
  z.strictObject({ type: z.literal('fixed'), value: text }),
  z.strictObject({ type: z.literal('company'), field: z.enum(COMPANY_FIELDS) }),
  /** The name as the Table payslip prints it: surname, then other names. */
  z.strictObject({ type: z.literal('name') }),
  /** An identity field of the employee: ID (the NIC), Surname, Other names... */
  z.strictObject({ type: z.literal('employee'), key }),
  /** A figure of the company's saved run. */
  z.strictObject({ type: z.literal('payroll'), key }),
  z.strictObject({
    type: z.literal('calc'),
    terms: z.array(termSchema).min(1).max(MAX_TERMS),
    /** Add the exact values and round the total once. Left out of the JSON when off. */
    once: z.literal(true).optional(),
  }),
  /** `key` only for "field": any other date field of the employee. */
  z.strictObject({ type: z.literal('date'), of: z.enum(DATE_OF), key: key.optional() }),
])
export type Source = z.infer<typeof sourceSchema>
export type SourceType = Source['type']

export const DATE_PIECES = ['D', 'DD', 'M', 'MM', 'MMM', 'MMMM', 'YY', 'YYYY'] as const
export type DatePiece = (typeof DATE_PIECES)[number]

/** One piece of a date format: part of the date, or a separator written as it is. */
const pieceSchema = z.union([
  z.strictObject({ piece: z.enum(DATE_PIECES) }),
  z.strictObject({ text: z.string().min(1).max(20) }),
])
export type DateFormatPiece = z.infer<typeof pieceSchema>

const formatSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text'), capitals: z.boolean() }),
  z.strictObject({
    type: z.literal('number'),
    /** "auto": no decimals for a whole amount and 2 otherwise, as the Table payslip does. */
    decimals: z.union([z.literal('auto'), z.literal(0), z.literal(2)]),
    thousands: z.boolean(),
    rs: z.boolean(),
    /** A zero is written "-". */
    dash: z.boolean(),
  }),
  z.strictObject({ type: z.literal('date'), pieces: z.array(pieceSchema).min(1).max(12) }),
])
export type CellFormat = z.infer<typeof formatSchema>

const edge = z.strictObject({
  style: z.enum(['thin', 'medium', 'thick', 'hair', 'dotted', 'dashed', 'double']),
  color: z.string().regex(/^[0-9A-F]{6}$/),
})
export type BorderEdge = z.infer<typeof edge>

const styleSchema = z.strictObject({
  font: z.strictObject({
    name: z.string().min(1).max(60),
    size: z.number().min(1).max(100),
    bold: z.literal(true).optional(),
    italic: z.literal(true).optional(),
    underline: z.literal(true).optional(),
    color: z.string().regex(/^[0-9A-F]{6}$/).optional(),
  }),
  fill: z.string().regex(/^[0-9A-F]{6}$/).optional(),
  top: edge.optional(),
  left: edge.optional(),
  bottom: edge.optional(),
  right: edge.optional(),
  horizontal: z.enum(['left', 'center', 'right']).optional(),
  vertical: z.enum(['top', 'middle', 'bottom']).optional(),
  wrap: z.literal(true).optional(),
})
export type SheetStyle = z.infer<typeof styleSchema>

const cellSchema = z.strictObject({
  id: cellIdSchema,
  /** The column, from 0. */
  col: z.number().int().min(0).max(MAX_SHEET_COLUMNS),
  /** Its place in `styles`. */
  style: z.number().int().min(0),
  source: sourceSchema,
  format: formatSchema,
  /** For the month review: which side of the payslip a figure is on. Left out for neither. */
  side: z.enum(['earnings', 'deductions']).optional(),
  /** For the month review: the figure's name. Left out to use the text to its left. */
  label: z.string().min(1).max(60).optional(),
})
export type SheetCell = z.infer<typeof cellSchema>

const mergeSchema = z.strictObject({
  row: z.number().int().min(0),
  col: z.number().int().min(0),
  rows: z.number().int().min(1).max(MAX_SHEET_ROWS),
  cols: z.number().int().min(1).max(MAX_SHEET_COLUMNS),
})
export type SheetMerge = z.infer<typeof mergeSchema>

const rowSchema = z.strictObject({
  /** In points, as Excel keeps it. */
  height: z.number().min(0).max(500),
  cells: z.array(cellSchema).max(MAX_SHEET_COLUMNS),
})
export type SheetRow = z.infer<typeof rowSchema>

const sheetSchema = z.strictObject({
  schema: z.literal(SHEET_SCHEMA),
  kind: z.literal(SHEET_KIND),
  orientation: z.enum(['portrait', 'landscape']),
  /** Where the grid starts in the file, so a cell keeps its Excel name (B4), from 0. */
  firstRow: z.number().int().min(0).max(10_000),
  firstColumn: z.number().int().min(0).max(1_000),
  /** In Excel's own unit, characters. */
  columns: z.array(z.number().min(0).max(255)).min(1).max(MAX_SHEET_COLUMNS),
  rows: z.array(rowSchema).min(1).max(MAX_SHEET_ROWS),
  merges: z.array(mergeSchema).max(500),
  styles: z.array(styleSchema).min(1).max(MAX_STYLES),
})
export type SheetBody = z.infer<typeof sheetSchema>

/** A company's own values for a template: a fixed value "for this company only", by cell id. */
export type OwnValues = Readonly<Record<string, string>>
export const ownValuesSchema = z.record(cellIdSchema, text)

export function isSheetBody(body: unknown): body is SheetBody {
  return typeof body === 'object' && body !== null && (body as { kind?: unknown }).kind === SHEET_KIND
}

/** "A", "B", ... "Z", "AA": a column's name, as a spreadsheet names it. */
export function columnName(index: number): string {
  let name = ''
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name
  return name
}

/** "E5": a cell's name in the Excel file (row and column are places in the grid, from 0). */
export const cellName = (body: Pick<SheetBody, 'firstRow' | 'firstColumn'>, row: number, column: number) =>
  `${columnName(body.firstColumn + column)}${body.firstRow + row + 1}`

/** Every cell, with its row. */
export function cellsOf(body: Pick<SheetBody, 'rows'>): { cell: SheetCell; row: number }[] {
  return body.rows.flatMap((row, index) => row.cells.map((cell) => ({ cell, row: index })))
}

/** The merged block that holds a place of the grid, if any. */
export function mergeAt(body: Pick<SheetBody, 'merges'>, row: number, col: number): SheetMerge | null {
  return body.merges.find((merge) => row >= merge.row && row < merge.row + merge.rows && col >= merge.col && col < merge.col + merge.cols) ?? null
}

export function cellAt(body: Pick<SheetBody, 'rows'>, row: number, col: number): SheetCell | null {
  return body.rows[row]?.cells.find((cell) => cell.col === col) ?? null
}

/** A new cell id that the layout does not use yet. */
export function newCellId(body: Pick<SheetBody, 'rows'>, random: () => number = Math.random): string {
  const used = new Set(cellsOf(body).map(({ cell }) => cell.id))
  for (;;) {
    const id = `c${Math.floor(random() * 36 ** 6).toString(36)}`
    if (!used.has(id)) return id
  }
}

/** The text to the left of a cell on its row: what a figure is called. Empty when there is none. */
export function labelOf(body: SheetBody, row: number, cell: SheetCell): string {
  if (cell.label) return cell.label
  const left = body.rows[row].cells.filter((other) => other.col < cell.col && other.source.type === 'text' && other.source.value.trim() !== '')
  const nearest = left.at(-1)?.source
  return nearest?.type === 'text' ? nearest.value.trim().replace(/\s*:$/, '') : ''
}

/** The format a cell starts with for what goes in it. */
export function formatFor(source: Source): CellFormat {
  if (source.type === 'payroll' || source.type === 'calc') return { type: 'number', decimals: 'auto', thousands: true, rs: false, dash: true }
  if (source.type === 'date') {
    return source.of === 'month'
      ? { type: 'date', pieces: [{ piece: 'MMMM' }, { text: ' ' }, { piece: 'YYYY' }] }
      : { type: 'date', pieces: [{ piece: 'D' }, { text: '-' }, { piece: 'MMM' }, { text: '-' }, { piece: 'YY' }] }
  }
  return { type: 'text', capitals: false }
}

/** Every payroll column a layout reads, directly or in a calculation. */
export function columnsRead(body: SheetBody): string[] {
  const keys = new Set<string>()
  for (const { cell } of cellsOf(body)) {
    if (cell.source.type === 'payroll') keys.add(cell.source.key)
    if (cell.source.type === 'calc') for (const term of cell.source.terms) if (term.of.type === 'column') keys.add(term.of.key)
  }
  return [...keys]
}

/** What is wrong with a layout that already has the right shape. Empty when it can be used. */
export function sheetProblems(body: SheetBody): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  const width = body.columns.length

  body.rows.forEach((row, index) => {
    const seen = new Set<number>()
    for (const cell of row.cells) {
      const name = cellName(body, index, cell.col)
      if (ids.has(cell.id)) problems.push(`Two cells share the id of ${name}.`)
      ids.add(cell.id)
      if (cell.col >= width || seen.has(cell.col)) problems.push(`The layout has a wrong place for cell ${name}.`)
      seen.add(cell.col)
      if (cell.style >= body.styles.length) problems.push(`Cell ${name} has no style.`)
    }
  })
  for (const merge of body.merges) {
    if (merge.row + merge.rows > body.rows.length || merge.col + merge.cols > width) problems.push('A merged block goes past the edge of the layout.')
  }

  const blocked = new Set(NEVER_MAP.map(normaliseKey))
  for (const { cell, row } of cellsOf(body)) {
    for (const key of cell.source.type === 'payroll' ? [cell.source.key] : cell.source.type === 'calc' ? cell.source.terms.flatMap((term) => (term.of.type === 'column' ? [term.of.key] : [])) : []) {
      if (blocked.has(normaliseKey(key)) || isEmployerContributionKey(key)) {
        problems.push(`Cell ${cellName(body, row, cell.col)} uses "${key}", a column that must never be on a payslip (employer side, or the second PAYE column).`)
      }
    }
    if (cell.source.type === 'date' && cell.source.of === 'field' && !cell.source.key) problems.push(`Cell ${cellName(body, row, cell.col)} does not say which date field it shows.`)
  }

  if (hasEmbeddedFile(body)) problems.push('A template cannot contain images or other embedded files.')
  const bytes = jsonBytes(body)
  if (bytes > BODY_MAX_BYTES) problems.push(`The template is ${Math.ceil(bytes / 1000)} KB; the dashboard accepts at most 150 KB.`)
  return problems
}

export type SheetRead = { ok: true; body: SheetBody } | { ok: false; problems: string[] }

/** Checks a layout received from the dashboard. It is used only when this returns ok. */
export function readSheetBody(raw: unknown): SheetRead {
  const parsed = sheetSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      problems: parsed.error.issues.slice(0, 8).map((issue) => {
        const where = issue.path.join('.') || 'the template'
        return issue.code === 'unrecognized_keys' ? `Unexpected field in ${where}.` : `"${where}" is missing or not valid.`
      }),
    }
  }
  const problems = sheetProblems(parsed.data)
  return problems.length > 0 ? { ok: false, problems } : { ok: true, body: parsed.data }
}

/** Reads what the dashboard stored as own values; anything not in this shape counts as none. */
export function readOwnValues(stored: unknown): OwnValues {
  const parsed = ownValuesSchema.safeParse(stored)
  return parsed.success ? parsed.data : {}
}

export const sameOwnValues = (a: OwnValues, b: OwnValues) => canonicalJson(a) === canonicalJson(b)
