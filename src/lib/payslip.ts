// One employee's payslip figures: each line copied from the payroll row, the three totals added
// in whole cents, the totals checked against the payroll's own, and the warning-only cross-check.
// Nothing here changes a payroll figure. A problem is reported, never patched.

import { isIsoDate } from './dates'
import { formatCents, parseMoney, type MoneyProblem } from './money'
import { employeeName, type PayrollRow } from './payrollFile'
import { crossCheckCsg, crossCheckNsf, type RatesVersion } from './statutoryRates'
import { templateLines, type LineSide, type PayslipTemplate, type TemplateMapping } from './template'

export type LineStatus = 'ok' | 'unmapped' | 'treated-as-zero' | 'error'

export interface ComputedLine {
  id: string
  label: string
  side: LineSide
  /** The payroll key the figure was copied from (an alias when the old name was used). */
  sourceKey: string | null
  status: LineStatus
  cents: number
  display: string
}

export type CheckId = 'gross' | 'deductions' | 'net'
export type CheckKind = 'match' | 'rounding' | 'difference' | 'unavailable'

export interface ReconcileCheck {
  id: CheckId
  label: string
  payrollKey: string
  payslipCents: number | null
  payrollCents: number | null
  /** Payslip total minus payroll total. */
  diffCents: number | null
  kind: CheckKind
}

export interface Issue {
  code: string
  lineId?: string
  message: string
}

export interface PayslipComputation {
  rowIndex: number
  employeeName: string
  /** ISO date, or null when the payroll data has none (the line stays blank). */
  dateOfEmployment: string | null
  lines: ComputedLine[]
  /** Null while any line is in error: a payslip with a hole in it has no totals. */
  totals: { earnings: number; deductions: number; net: number } | null
  checks: ReconcileCheck[]
  /** Block the payslip. */
  errors: Issue[]
  /** Shown, never blocking. */
  warnings: Issue[]
}

export interface ComputeInput {
  row: PayrollRow
  rowIndex: number
  template: PayslipTemplate
  mapping: TemplateMapping
  /** Rates in force for the pay month, or null when there are none. */
  rates: RatesVersion | null
  /** Line ids whose missing figure the user accepted as zero. */
  treatAsZero: ReadonlySet<string>
}

const PROBLEM_TEXT: Record<MoneyProblem, (key: string) => string> = {
  missing: (key) => `the payroll data has no "${key}" for this employee`,
  'not-a-number': (key) => `"${key}" is text, not a number`,
  'too-many-decimals': (key) => `"${key}" has more than 2 decimals; it is not rounded here, so fix it in the payroll app`,
  'out-of-range': (key) => `"${key}" is too large to be an amount`,
}

const PROBLEM_CODE: Record<MoneyProblem, string> = {
  missing: 'missing-key',
  'not-a-number': 'not-a-number',
  'too-many-decimals': 'too-many-decimals',
  'out-of-range': 'out-of-range',
}

const CHECK_LABEL: Record<CheckId, string> = {
  gross: 'Total Earnings',
  deductions: 'Total Deductions',
  net: 'Net Pay',
}

function hasValue(row: PayrollRow, key: string): boolean {
  return key in row && row[key] !== null && row[key] !== ''
}

function isAged60(value: unknown): boolean | null {
  if (value === true || value === 'Yes') return true
  if (value === false || value === 'No') return false
  return null
}

export function computePayslip(input: ComputeInput): PayslipComputation {
  const { row, template, mapping, rates, treatAsZero } = input
  const errors: Issue[] = []
  const warnings: Issue[] = []

  const lines: ComputedLine[] = templateLines(template).map((line) => {
    const lineMapping = mapping.lines[line.id] ?? { key: null }
    const base = { id: line.id, label: line.label, side: line.side }
    if (lineMapping.key === null) {
      return { ...base, sourceKey: null, status: 'unmapped', cents: 0, display: formatCents(0) }
    }

    let sourceKey = lineMapping.key
    if (!hasValue(row, sourceKey)) {
      const alias = (lineMapping.aliases ?? []).find((name) => hasValue(row, name))
      if (alias) {
        sourceKey = alias
        warnings.push({
          code: 'old-name',
          lineId: line.id,
          message: `${line.label}: read from the old column name "${alias}". The new name is "${lineMapping.key}".`,
        })
      }
    }

    const money = parseMoney(row[sourceKey])
    if (money.ok) {
      if (lineMapping.toConfirm) {
        warnings.push({
          code: 'to-confirm',
          lineId: line.id,
          message: `${line.label}: mapped to "${sourceKey}", to confirm.`,
        })
      }
      return { ...base, sourceKey, status: 'ok', cents: money.cents, display: formatCents(money.cents) }
    }
    if (money.reason === 'missing' && !lineMapping.required && treatAsZero.has(line.id)) {
      return { ...base, sourceKey, status: 'treated-as-zero', cents: 0, display: formatCents(0) }
    }
    errors.push({
      code: PROBLEM_CODE[money.reason],
      lineId: line.id,
      message: `${line.label}: ${PROBLEM_TEXT[money.reason](sourceKey)}.`,
    })
    return { ...base, sourceKey, status: 'error', cents: 0, display: '' }
  })

  const complete = lines.every((line) => line.status !== 'error')
  const sum = (side: LineSide) =>
    lines.filter((line) => line.side === side).reduce((total, line) => total + line.cents, 0)
  const totals = complete
    ? (() => {
        const earnings = sum('earnings')
        const deductions = sum('deductions')
        return { earnings, deductions, net: earnings - deductions }
      })()
    : null

  const payslipTotal: Record<CheckId, number | null> = {
    gross: totals?.earnings ?? null,
    deductions: totals?.deductions ?? null,
    net: totals?.net ?? null,
  }
  const checks: ReconcileCheck[] = (['gross', 'deductions', 'net'] as const).map((id) => {
    const payrollKey = mapping.checks[id]
    const payroll = parseMoney(row[payrollKey])
    const payslipCents = payslipTotal[id]
    if (!payroll.ok) {
      errors.push({
        code: PROBLEM_CODE[payroll.reason],
        lineId: `check-${id}`,
        message: `${CHECK_LABEL[id]} cannot be checked: ${PROBLEM_TEXT[payroll.reason](payrollKey)}.`,
      })
      return { id, label: CHECK_LABEL[id], payrollKey, payslipCents, payrollCents: null, diffCents: null, kind: 'unavailable' }
    }
    if (payslipCents === null) {
      return { id, label: CHECK_LABEL[id], payrollKey, payslipCents, payrollCents: payroll.cents, diffCents: null, kind: 'unavailable' }
    }
    const diffCents = payslipCents - payroll.cents
    const kind: CheckKind = diffCents === 0 ? 'match' : Math.abs(diffCents) === 1 ? 'rounding' : 'difference'
    return { id, label: CHECK_LABEL[id], payrollKey, payslipCents, payrollCents: payroll.cents, diffCents, kind }
  })

  warnings.push(...crossCheck(row, lines, mapping, rates))

  let dateOfEmployment: string | null = null
  if (hasValue(row, mapping.dateOfEmployment)) {
    const value = row[mapping.dateOfEmployment]
    if (typeof value === 'string' && isIsoDate(value)) dateOfEmployment = value
    else {
      errors.push({
        code: 'bad-date',
        lineId: 'dateOfEmployment',
        message: `Date of Employment: "${mapping.dateOfEmployment}" is not a date written as YYYY-MM-DD.`,
      })
    }
  }

  return {
    rowIndex: input.rowIndex,
    employeeName: employeeName(row),
    dateOfEmployment,
    lines,
    totals,
    checks,
    errors,
    warnings,
  }
}

/** Recalculates employee CSG and NSF from the settings and reports any difference. Warnings only. */
function crossCheck(
  row: PayrollRow,
  lines: ComputedLine[],
  mapping: TemplateMapping,
  rates: RatesVersion | null,
): Issue[] {
  if (!rates) {
    return [{ code: 'no-rates', message: 'No statutory rates are in force for this month, so CSG and NSF were not cross-checked.' }]
  }
  const issues: Issue[] = []
  const { csgBase, nsfBase, aged60 } = mapping.crossCheck
  const amount = (value: number) => formatCents(Math.round(value * 100)).replace(/^-$/, '0')

  const compare = (lineId: 'csg' | 'nsf', baseKey: string, expectedFor: (base: number) => number, note: string) => {
    const line = lines.find((candidate) => candidate.id === lineId)
    if (!line || line.status !== 'ok') return
    const base = row[baseKey]
    if (typeof base !== 'number' || !Number.isFinite(base)) {
      issues.push({
        code: 'cross-check-skipped',
        lineId,
        message: `${line.label}: not cross-checked, because "${baseKey}" is missing or is not a number.`,
      })
      return
    }
    const expected = expectedFor(base)
    if (Math.round(expected * 100) === line.cents) return
    issues.push({
      code: `cross-check-${lineId}`,
      lineId,
      message: `${line.label}: the payroll figure is ${amount(line.cents / 100)}, the statutory rates give ${amount(expected)} (${note}). The payroll figure is shown unchanged.`,
    })
  }

  compare('csg', csgBase, (base) => crossCheckCsg(base, rates), `on ${csgBase} ${amount(Number(row[csgBase]))}`)

  const sixty = isAged60(row[aged60])
  if (sixty === null && rates.nsfExemptAt60) {
    issues.push({
      code: 'cross-check-skipped',
      lineId: 'nsf',
      message: `NSF: "${aged60}" is missing or is not Yes/No, so the 60+ exemption was not checked.`,
    })
  }
  const exempt = sixty === true && rates.nsfExemptAt60
  compare(
    'nsf',
    nsfBase,
    (base) => crossCheckNsf(base, sixty === true, rates),
    exempt ? 'NSF is 0 at 60+' : `on ${nsfBase} ${amount(Number(row[nsfBase]))}, ceiling ${amount(rates.nsfCeiling)}`,
  )
  return issues
}

/** Accepted differences: check id -> the exact difference (in cents) that was accepted. */
export type AcceptedChecks = Partial<Record<CheckId, number>>

export function pendingChecks(computation: PayslipComputation, accepted: AcceptedChecks): ReconcileCheck[] {
  return computation.checks.filter(
    (check) => check.kind !== 'match' && !(check.diffCents !== null && accepted[check.id] === check.diffCents),
  )
}

/** Ready to export: no errors, and every difference from the payroll totals accepted as it stands. */
export function isReady(computation: PayslipComputation, accepted: AcceptedChecks): boolean {
  return computation.errors.length === 0 && pendingChecks(computation, accepted).length === 0
}
