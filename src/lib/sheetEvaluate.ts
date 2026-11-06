// Works out every cell of a "From your file" layout for one employee. A small calculation is a
// list of terms (JSON, checked by sheetBody.ts) worked out here by a fixed interpreter: add,
// subtract, multiply by a rate, round each part or the total once, with exact decimals. Nothing is
// ever run as code (no eval, no new Function). Copied and adapted from mra_returns/src/lib/evaluate.ts.
//
// A payroll figure is never patched: a missing column, text in a money field or more than 2
// decimals is a problem for that employee, never a blank or a zero.

import { add, fromNumber, multiply, parseDecimal, roundHalfUp, subtract, ZERO, type Decimal } from './decimal'
import { readDateOfEmployment } from './dates'
import { parseMoney } from './money'
import type { PayrollRow } from './payrollFile'
import { employeeName, normaliseKey } from './payrollFile'
import { cellName, cellsOf, type CompanyField, type OwnValues, type SheetBody, type SheetCell, type Term } from './sheetBody'
import { writeDate, writeNumber } from './sheetFormats'
import { DEFAULT_TABLE_MAPPING } from './template'
import { addressParts } from '../writers/pageGeometry'

/** The company details the payroll data repeats on every row. */
export type CompanyDetails = Record<'name' | 'address' | 'brn' | 'vat', string>

/**
 * The address split at its last comma: everything before it, and the part after it. An address
 * without a comma is all in the first part. Commas and line breaks of the payroll's address are
 * read as drawing 3 of the Table payslip reads them (addressParts).
 */
export function addressAtLastComma(address: string): [string, string] {
  const parts = addressParts(address)
  return parts.length > 1 ? [parts.slice(0, -1).join(', '), parts[parts.length - 1]] : [parts[0] ?? '', '']
}

/** What a company detail of a cell prints, before it is fitted to its cell. */
export function companyText(company: CompanyDetails, field: CompanyField): string {
  if (field === 'address1') return addressAtLastComma(company.address)[0]
  if (field === 'address2') return addressAtLastComma(company.address)[1]
  if (field === 'addressLines') return addressAtLastComma(company.address).filter((line) => line !== '').join('\n')
  return company[field]
}

export interface SheetContext {
  company: CompanyDetails
  /** "YYYY-MM". */
  period: string
  /** The date on the payslip, YYYY-MM-DD. */
  today: string
  own: OwnValues
  /** The cells whose missing payroll figure the user accepted as zero, for this employee. */
  zero?: ReadonlySet<string>
}

/**
 * The payroll columns a missing figure of which is never accepted as zero: employee CSG and NSF,
 * as the Table payslip has them (template.ts, "required").
 */
const NEVER_ZERO = new Set(
  [DEFAULT_TABLE_MAPPING.lines.csg, DEFAULT_TABLE_MAPPING.lines.nsf].flatMap((line) => [line.key!, ...(line.aliases ?? [])]).map(normaliseKey),
)

/** Whether a missing figure of this column may be treated as zero. */
export const canBeZero = (key: string) => !NEVER_ZERO.has(normaliseKey(key))

export type CellProblem =
  | 'self-reference'
  | 'loop'
  | 'unknown-cell'
  | 'missing-key'
  | 'not-a-number'
  | 'too-many-decimals'
  | 'out-of-range'
  | 'not-a-date'
  | 'too-precise'

export interface CellValue {
  /** Exactly what is printed. */
  text: string
  kind: 'text' | 'number' | 'date'
  /** kind "number": the amount kept to the decimals printed. */
  number?: Decimal
  places?: 0 | 2
  /** kind "date". */
  iso?: string
  problem: CellProblem | null
  /** Which payroll column the problem is about. */
  key?: string
  /** A missing payroll figure of this cell was accepted as zero. */
  zeroed?: true
}

const NOTHING: CellValue = { text: '', kind: 'text', problem: null }

class Evaluator {
  private readonly where: Map<string, SheetCell>
  private readonly memo = new Map<string, CellValue & { exact?: Decimal }>()
  private readonly stack: string[] = []

  constructor(
    body: SheetBody,
    private readonly context: SheetContext,
    private readonly row: PayrollRow,
  ) {
    this.where = new Map(cellsOf(body).map(({ cell }) => [cell.id, cell]))
  }

  cell(cell: SheetCell): CellValue & { exact?: Decimal } {
    const done = this.memo.get(cell.id)
    if (done) return done
    this.stack.push(cell.id)
    const result = this.work(cell)
    this.stack.pop()
    this.memo.set(cell.id, result)
    return result
  }

  private number(value: Decimal, cell: SheetCell): CellValue & { exact: Decimal } {
    if (cell.format.type === 'number') {
      const written = writeNumber(value, cell.format)
      return { text: written.text, kind: 'number', number: written.value, places: written.places, problem: null, exact: value }
    }
    return { text: writeNumber(value, { type: 'number', decimals: 'auto', thousands: false, rs: false, dash: false }).text, kind: 'text', problem: null, exact: value }
  }

  private plain(text: string, cell: SheetCell): CellValue {
    if (cell.format.type === 'text') return { text: cell.format.capitals ? text.toUpperCase() : text, kind: 'text', problem: null }
    if (cell.format.type === 'date') {
      if (text === '') return NOTHING
      const iso = readDateOfEmployment(text)
      return iso ? this.date(iso, cell) : { ...NOTHING, problem: 'not-a-date' }
    }
    if (text === '') return NOTHING
    const value = parseDecimal(text)
    return value ? this.number(value, cell) : { ...NOTHING, problem: 'not-a-number' }
  }

  private date(iso: string, cell: SheetCell): CellValue {
    if (cell.format.type !== 'date') return { text: iso, kind: 'text', problem: null }
    return { text: writeDate(cell.format.pieces, iso), kind: 'date', iso, problem: null }
  }

  private field(key: string): string {
    const value = this.row[key]
    if (value === null || value === undefined) return ''
    return typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value)
  }

  private work(cell: SheetCell): CellValue & { exact?: Decimal } {
    const source = cell.source
    switch (source.type) {
      case 'empty':
        return NOTHING
      case 'text':
        return this.plain(source.value, cell)
      case 'fixed':
        return this.plain(this.context.own[cell.id] ?? source.value, cell)
      case 'company':
        return this.plain(companyText(this.context.company, source.field), cell)
      case 'name':
        return this.plain(employeeName(this.row), cell)
      case 'employee':
        return this.plain(this.field(source.key), cell)
      case 'payroll': {
        const money = this.money(source.key, cell.id)
        if ('problem' in money) return { ...NOTHING, problem: money.problem, key: source.key }
        return money.zeroed ? { ...this.number(money.value, cell), zeroed: true } : this.number(money.value, cell)
      }
      case 'date': {
        if (source.of === 'today') return this.date(this.context.today, cell)
        if (source.of === 'month') return this.date(`${this.context.period}-01`, cell)
        const raw = this.field(source.of === 'employment' ? 'Date of Employment' : (source.key ?? ''))
        if (raw === '') return NOTHING
        const iso = readDateOfEmployment(raw)
        return iso ? this.date(iso, cell) : { ...NOTHING, problem: 'not-a-date' }
      }
      case 'calc':
        return this.calc(cell, source.terms, source.once === true)
    }
  }

  private money(key: string, cellId: string): { value: Decimal; zeroed?: true } | { problem: CellProblem } {
    const money = parseMoney(this.row[key])
    // Only a figure that is not there at all, and only in a cell the user accepted it for.
    if (!money.ok && money.reason === 'missing' && this.context.zero?.has(cellId) && canBeZero(key)) return { value: ZERO, zeroed: true }
    if (!money.ok) return { problem: money.reason === 'missing' ? 'missing-key' : money.reason }
    return { value: fromNumber(money.cents / 100)! }
  }

  private calc(cell: SheetCell, terms: Term[], once: boolean): CellValue & { exact?: Decimal } {
    let total = ZERO
    let zeroed = false
    for (const term of terms) {
      const part = this.operand(term, once, cell.id)
      if ('problem' in part) return { ...NOTHING, problem: part.problem, key: part.key }
      if ('zeroed' in part && part.zeroed) zeroed = true
      let value = part.value
      if (term.times !== null) {
        const product = multiply(value, parseDecimal(term.times)!)
        if (!product) return { ...NOTHING, problem: 'too-precise' }
        value = product
      }
      if (!once && term.round === 'whole') value = roundHalfUp(value, 0)
      else if (!once && term.round === 'two') value = roundHalfUp(value, 2)
      total = term.sign === 1 ? add(total, value) : subtract(total, value)
    }
    return zeroed ? { ...this.number(total, cell), zeroed: true } : this.number(total, cell)
  }

  private operand(term: Term, once: boolean, cellId: string): { value: Decimal; zeroed?: true } | { problem: CellProblem; key?: string } {
    const of = term.of
    if (of.type === 'number') return { value: parseDecimal(of.value)! }
    if (of.type === 'column') {
      const money = this.money(of.key, cellId)
      return 'problem' in money ? { problem: money.problem, key: of.key } : money
    }
    const found = this.where.get(of.id)
    if (!found) return { problem: 'unknown-cell' }
    if (this.stack.includes(of.id)) return { problem: this.stack.at(-1) === of.id ? 'self-reference' : 'loop' }
    const referred = this.cell(found)
    if (referred.problem) return { problem: referred.problem === 'self-reference' ? 'loop' : referred.problem, key: referred.key }
    // The value as printed in that cell, or, when the total is rounded once, before that cell's rounding.
    if (referred.kind === 'number') return { value: once ? referred.exact! : referred.number! }
    if (referred.text === '') return { value: ZERO }
    const number = parseDecimal(referred.text)
    return number ? { value: number } : { problem: 'not-a-number' }
  }
}

/** Every cell of the layout for one employee, by cell id. */
export function evaluateSheet(body: SheetBody, context: SheetContext, row: PayrollRow): Map<string, CellValue> {
  const evaluator = new Evaluator(body, context, row)
  return new Map(cellsOf(body).map(({ cell }) => [cell.id, evaluator.cell(cell)]))
}

const PROBLEM_TEXT: Record<CellProblem, (key: string) => string> = {
  'self-reference': () => 'the calculation uses its own cell',
  loop: () => 'the calculation goes round in a circle through other cells',
  'unknown-cell': () => 'the calculation uses a cell that is no longer in the layout',
  'missing-key': (key) => `the payroll data has no "${key}" for this employee`,
  'not-a-number': (key) => (key ? `"${key}" is text, not a number` : 'this is text, not a number'),
  'too-many-decimals': (key) => `"${key}" has more than 2 decimals; it is not rounded here, so fix it in the payroll app`,
  'out-of-range': (key) => `"${key}" is too large to be an amount`,
  'not-a-date': () => 'this cannot be read as a date',
  'too-precise': () => 'the calculation has too many decimals',
}

export function problemText(body: SheetBody, row: number, cell: SheetCell, value: CellValue): string {
  return `Cell ${cellName(body, row, cell.col)}: ${PROBLEM_TEXT[value.problem!](value.key ?? '')}.`
}

const LAYOUT_PROBLEMS: readonly CellProblem[] = ['self-reference', 'loop', 'unknown-cell']

/** What is wrong with the calculations themselves, whatever the data. */
export function calculationProblems(body: SheetBody): string[] {
  const context: SheetContext = { company: { name: '', address: '', brn: '', vat: '' }, period: '2000-01', today: '2000-01-01', own: {} }
  const values = evaluateSheet(body, context, {})
  return cellsOf(body).flatMap(({ cell, row }) => {
    const value = values.get(cell.id)!
    return value.problem && LAYOUT_PROBLEMS.includes(value.problem) ? [problemText(body, row, cell, value)] : []
  })
}
