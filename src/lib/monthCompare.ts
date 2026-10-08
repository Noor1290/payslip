// The month review: each employee's payslip of this month beside the one of last month.
//
// It only READS. This month's payslips are always built from this month's payroll figures
// (src/lib/build.ts); nothing here is copied into a payslip, and nothing here changes a figure.
// Last month comes from the issued payslips the dashboard keeps ("payslip-issue"), or, when none
// was issued at all, from last month's payroll run (src/lib/baseline.ts).
//
// Only money decides a status: a line or one of the three totals that differs by a cent or more,
// or a line that has no partner. A name, a date, a renamed label, the template or the rates are
// shown as notes and never change a status. Amounts are whole cents, so nothing is rounded.

import type { PreparedPayslip } from './build'
import { formatPeriod, formatShortDate } from './dates'
import { canonicalJson } from './hubWire'
import { decodeLines, type IssuedFigure, type IssuedFigures } from './issuedLines'
import type { IssuedPayslip, RatesSnapshot } from './issueStore'
import type { PayslipDocument } from './layoutModel'
import { formatCents } from './money'
import type { ImportedPayroll } from './payrollFile'
import type { LineSide } from './template'

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/

/** The calendar month before a pay month: "2026-01" gives "2025-12". Null when it is not a month. */
export function previousMonth(period: string): string | null {
  const match = MONTH.exec(period)
  if (!match) return null
  const [year, month] = [Number(match[1]), Number(match[2])]
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`
}

/** Which template a payslip was made with: its id and its version ("v2", "built-in-1"). */
export interface TemplateRef {
  id: string
  version: string
}

/** One employee's payslip of one month, reduced to what the review compares and notes. */
export interface ComparedSide {
  employeeName: string
  /** YYYY-MM-DD, or null when the payslip shows none. */
  dateOfEmployment: string | null
  /** Null for a baseline made from payroll figures: no payslip was issued, so no template was used. */
  template: TemplateRef | null
  rates: RatesSnapshot | null
  figures: IssuedFigures
}

export interface BaselinePayslip {
  nationalId: string
  employeeName: string
  /** The revision compared with. Null for a baseline made from payroll figures. */
  revision: number | null
  /** Null when the payslip cannot be read: `problem` says why. */
  side: ComparedSide | null
  problem: string | null
}

/** Last month, as the review compares with it. */
export interface Baseline {
  period: string
  /** 'payroll': no payslip was issued last month, so its payroll figures are used instead. */
  source: 'issued' | 'payroll'
  payslips: BaselinePayslip[]
}

const UNREADABLE_NAME = 'An employee whose payslip cannot be read'

/** The date of employment printed on a payslip, read from the row that holds it. */
function dateOfEmploymentOf(document: PayslipDocument): string | null {
  const row = document.rows.find((found) => found.id === 'employee-name')
  return row?.cells.find((cell) => cell.kind === 'date')?.isoDate ?? null
}

/** The name a stored payslip was issued under, when that much of it can be read. */
function storedName(lines: unknown): string {
  const first = Array.isArray(lines) ? (lines[0] as { employeeName?: unknown } | null) : null
  const name = typeof first?.employeeName === 'string' ? first.employeeName.trim().slice(0, 300) : ''
  return name || UNREADABLE_NAME
}

/**
 * Last month's issued payslips as a baseline. Each one is the latest revision the dashboard has.
 * A stored payslip is data from outside: one that fails its checks is kept in the list with the
 * reason, and is never guessed at.
 */
export function baselineFromIssued(period: string, payslips: readonly IssuedPayslip[]): Baseline {
  return {
    period,
    source: 'issued',
    payslips: payslips.map((payslip): BaselinePayslip => {
      const nationalId = payslip.nationalId.trim()
      const decoded = decodeLines(payslip.lines)
      if (!decoded.ok) return { nationalId, employeeName: storedName(payslip.lines), revision: payslip.revision, side: null, problem: decoded.problem }
      if (decoded.document.period !== period) {
        return {
          nationalId,
          employeeName: decoded.document.employeeName,
          revision: payslip.revision,
          side: null,
          problem: `The stored payslip is for ${formatPeriod(decoded.document.period)}, not ${formatPeriod(period)}. It is not compared.`,
        }
      }
      return {
        nationalId,
        employeeName: decoded.document.employeeName,
        revision: payslip.revision,
        side: {
          employeeName: decoded.document.employeeName,
          dateOfEmployment: dateOfEmploymentOf(decoded.document),
          template: { id: payslip.templateId, version: `v${payslip.templateVersion}` },
          rates: payslip.rates,
          figures: decoded.figures,
        },
        problem: null,
      }
    }),
  }
}

export interface CurrentPayslip {
  rowIndex: number
  nationalId: string
  employeeName: string
  /** Null while this month's payslip has a figure in error: `problem` says so. */
  side: ComparedSide | null
  problem: string | null
}

const HAS_ERROR = "This month's payslip has a figure to fix first, so there is nothing to compare yet."

/** This month's payslips, as built from this month's payroll figures, reduced to what is compared. */
export function currentPayslips(
  data: ImportedPayroll,
  prepared: readonly PreparedPayslip[],
  template: TemplateRef,
  rates: RatesSnapshot | null,
): CurrentPayslip[] {
  return prepared.map(({ computation }): CurrentPayslip => {
    const base = { rowIndex: computation.rowIndex, nationalId: String(data.rows[computation.rowIndex].ID).trim(), employeeName: computation.employeeName }
    const { totals } = computation
    if (!totals || computation.lines.some((line) => line.status === 'error')) return { ...base, side: null, problem: HAS_ERROR }
    const lines = computation.lines.map(
      (line): IssuedFigure => ({ id: line.id, label: line.label, side: line.side, cents: line.cents, source: line.sourceKey, status: line.status as IssuedFigure['status'] }),
    )
    return {
      ...base,
      side: { employeeName: computation.employeeName, dateOfEmployment: computation.dateOfEmployment, template, rates, figures: { lines, totals: { ...totals } } },
      problem: null,
    }
  })
}

export type RowStatus = 'unchanged' | 'changed' | 'new' | 'left' | 'cannot-compare'

export const STATUS_TEXT: Record<RowStatus, string> = {
  unchanged: 'Unchanged',
  changed: 'Changed',
  new: 'New',
  left: 'Left',
  'cannot-compare': 'Cannot be compared',
}

/** How a line found its partner in the other month. */
export type LineMatch = 'id' | 'label' | 'only-last' | 'only-current'

export interface LineComparison {
  side: LineSide
  /** This month's label; last month's for a line that is only there. */
  label: string
  /** Last month's label, when the same line was called something else then. */
  lastLabel: string | null
  match: LineMatch
  /** Why the line has no partner. Null for a matched line. */
  unmatched: string | null
  /** Whole cents. Null where the month has no such line. */
  last: number | null
  current: number | null
  /** This month minus last month. Null for a line without a partner. */
  difference: number | null
  changed: boolean
}

export type TotalId = 'earnings' | 'deductions' | 'net'

export interface TotalComparison {
  id: TotalId
  label: string
  last: number | null
  current: number | null
  difference: number | null
  changed: boolean
}

export interface ReviewRow {
  /** Unique in the list. It is used in the page, so it never holds a national ID. */
  key: string
  nationalId: string
  /** The employee's row in this month's payroll data. Null for someone who left. */
  rowIndex: number | null
  employeeName: string
  status: RowStatus
  /** Why the row cannot be compared. */
  problem: string | null
  /** How lines were matched: by id (the same template) or by label (another template). */
  matchedBy: 'id' | 'label' | null
  lines: LineComparison[]
  totals: TotalComparison[]
  /** Differences that are not money. Shown, and never part of the status. */
  notes: string[]
  /** The revision of last month's payslip, when there is one. */
  baselineRevision: number | null
}

export interface BannerLine {
  kind: 'template' | 'rates'
  text: string
  details: string[]
}

export interface MonthComparison {
  period: string
  lastPeriod: string
  source: Baseline['source']
  rows: ReviewRow[]
  counts: Record<RowStatus, number>
  /** What differs for the month as a whole: the template version, the rates version. */
  banner: BannerLine[]
}

const TOTAL_LABEL: Record<TotalId, string> = { earnings: 'Total Earnings', deductions: 'Total Deductions', net: 'Net Pay' }
const TOTAL_IDS: readonly TotalId[] = ['earnings', 'deductions', 'net']
const SIDES: readonly LineSide[] = ['earnings', 'deductions']

/** Labels are compared without regard to capitals or extra spaces. Nothing else is ignored. */
export function normaliseLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase()
}

const matched = (line: IssuedFigure, before: IssuedFigure, match: 'id' | 'label'): LineComparison => ({
  side: line.side,
  label: line.label,
  lastLabel: before.label === line.label ? null : before.label,
  match,
  unmatched: null,
  last: before.cents,
  current: line.cents,
  difference: line.cents - before.cents,
  changed: line.cents !== before.cents,
})
const onlyCurrent = (line: IssuedFigure, why: string): LineComparison => ({
  side: line.side,
  label: line.label,
  lastLabel: null,
  match: 'only-current',
  unmatched: why,
  last: null,
  current: line.cents,
  difference: null,
  changed: true,
})
const onlyLast = (line: IssuedFigure, why: string): LineComparison => ({
  side: line.side,
  label: line.label,
  lastLabel: null,
  match: 'only-last',
  unmatched: why,
  last: line.cents,
  current: null,
  difference: null,
  changed: true,
})

/**
 * Pairs the lines of two payslips. The same template: by the line's stable id. Another template:
 * by label, on the same side of the page. A line without exactly one partner is listed as not
 * matched, with its amount, and is never paired by guess.
 */
export function compareLines(last: readonly IssuedFigure[], current: readonly IssuedFigure[], by: 'id' | 'label'): LineComparison[] {
  const out: LineComparison[] = []
  for (const side of SIDES) {
    const before = last.filter((line) => line.side === side)
    const now = current.filter((line) => line.side === side)
    if (by === 'id') {
      const beforeById = new Map(before.map((line) => [line.id, line]))
      const nowIds = new Set(now.map((line) => line.id))
      for (const line of now) {
        const partner = beforeById.get(line.id)
        out.push(partner ? matched(line, partner, 'id') : onlyCurrent(line, "Not on last month's payslip."))
      }
      for (const line of before) if (!nowIds.has(line.id)) out.push(onlyLast(line, "Not on this month's payslip."))
      continue
    }
    const count = (lines: readonly IssuedFigure[]) => {
      const counts = new Map<string, number>()
      for (const line of lines) counts.set(normaliseLabel(line.label), (counts.get(normaliseLabel(line.label)) ?? 0) + 1)
      return counts
    }
    const [beforeCount, nowCount] = [count(before), count(now)]
    const single = (label: string) => beforeCount.get(label) === 1 && nowCount.get(label) === 1
    const why = (label: string, here: Map<string, number>, there: Map<string, number>, other: string) =>
      (here.get(label) ?? 0) > 1 || (there.get(label) ?? 0) > 1
        ? 'More than one line has this label, so it is not matched.'
        : `No line with this label ${other}.`
    for (const line of now) {
      const label = normaliseLabel(line.label)
      const partner = single(label) ? before.find((found) => normaliseLabel(found.label) === label) : undefined
      out.push(partner ? matched(line, partner, 'label') : onlyCurrent(line, why(label, nowCount, beforeCount, 'last month')))
    }
    for (const line of before) {
      const label = normaliseLabel(line.label)
      if (!single(label)) out.push(onlyLast(line, why(label, beforeCount, nowCount, 'this month')))
    }
  }
  return out
}

function compareTotals(last: IssuedFigures['totals'] | null, current: IssuedFigures['totals'] | null): TotalComparison[] {
  return TOTAL_IDS.map((id) => {
    const [before, now] = [last?.[id] ?? null, current?.[id] ?? null]
    const difference = before === null || now === null ? null : now - before
    return { id, label: TOTAL_LABEL[id], last: before, current: now, difference, changed: difference !== 0 }
  })
}

const shortDate = (iso: string | null) => (iso === null ? 'none' : formatShortDate(iso))

/** "the rates of July 2026, revision 2", or "not cross-checked". */
export function describeRates(rates: RatesSnapshot | null): string {
  return rates === null ? 'not cross-checked' : `the rates of ${formatPeriod(rates.effective_from)}, revision ${rates.revision}`
}
const sameRatesVersion = (a: RatesSnapshot | null, b: RatesSnapshot | null) => canonicalJson(a) === canonicalJson(b)
const versionNumber = (version: string) => version.replace(/^v(?=\d+$)/, '')

/** What differs between the two payslips besides money. Information only. */
function notesFor(last: ComparedSide, current: ComparedSide, lines: readonly LineComparison[]): string[] {
  const notes: string[] = []
  if (last.employeeName !== current.employeeName) notes.push(`Name: "${last.employeeName}" last month, "${current.employeeName}" now.`)
  if (last.dateOfEmployment !== current.dateOfEmployment) {
    notes.push(`Date of employment: ${shortDate(last.dateOfEmployment)} last month, ${shortDate(current.dateOfEmployment)} now.`)
  }
  for (const line of lines) if (line.lastLabel !== null) notes.push(`"${line.lastLabel}" last month is "${line.label}" now.`)
  if (last.template && current.template) {
    if (last.template.id !== current.template.id) notes.push('Template: another template last month, so the lines are matched by label.')
    else if (last.template.version !== current.template.version) {
      notes.push(`Template: version ${versionNumber(last.template.version)} last month, version ${versionNumber(current.template.version)} now.`)
    }
    if (!sameRatesVersion(last.rates, current.rates)) notes.push(`Cross-check: ${describeRates(last.rates)} last month, ${describeRates(current.rates)} now.`)
  }
  return notes
}

const asOnly = (figures: IssuedFigures, month: 'last' | 'current'): LineComparison[] =>
  SIDES.flatMap((side) =>
    figures.lines
      .filter((line) => line.side === side)
      .map((line): LineComparison => ({ ...(month === 'last' ? onlyLast(line, '') : onlyCurrent(line, '')), unmatched: null, changed: false })),
  )

function compareEmployee(current: CurrentPayslip, before: BaselinePayslip | undefined): ReviewRow {
  const base = { key: `row-${current.rowIndex}`, nationalId: current.nationalId, rowIndex: current.rowIndex, employeeName: current.employeeName }
  const none = { matchedBy: null, lines: [], totals: [], notes: [] }
  if (!current.side) return { ...base, ...none, status: 'cannot-compare', problem: current.problem, baselineRevision: before?.revision ?? null }
  if (!before) {
    return {
      ...base,
      status: 'new',
      problem: null,
      matchedBy: null,
      lines: asOnly(current.side.figures, 'current'),
      totals: compareTotals(null, current.side.figures.totals).map((total) => ({ ...total, changed: false })),
      notes: [],
      baselineRevision: null,
    }
  }
  if (!before.side) return { ...base, ...none, status: 'cannot-compare', problem: before.problem, baselineRevision: before.revision }

  const [last, now] = [before.side, current.side]
  // No template on the baseline: it was built from payroll figures with this month's template.
  const matchedBy = last.template === null || now.template === null || last.template.id === now.template.id ? 'id' : 'label'
  const lines = compareLines(last.figures.lines, now.figures.lines, matchedBy)
  const totals = compareTotals(last.figures.totals, now.figures.totals)
  const changed = lines.some((line) => line.changed) || totals.some((total) => total.changed)
  return { ...base, status: changed ? 'changed' : 'unchanged', problem: null, matchedBy, lines, totals, notes: notesFor(last, now, lines), baselineRevision: before.revision }
}

function leftRow(before: BaselinePayslip, position: number): ReviewRow {
  return {
    key: `left-${position + 1}`,
    nationalId: before.nationalId,
    rowIndex: null,
    employeeName: before.employeeName,
    status: 'left',
    problem: before.side ? null : before.problem,
    matchedBy: null,
    lines: before.side ? asOnly(before.side.figures, 'last') : [],
    totals: before.side ? compareTotals(before.side.figures.totals, null).map((total) => ({ ...total, changed: false })) : [],
    notes: [],
    baselineRevision: before.revision,
  }
}

const RATE_LABELS: [keyof RatesSnapshot, string][] = [
  ['nsf_employee_rate', 'NSF rate (%)'],
  ['nsf_ceiling', 'NSF ceiling'],
  ['nsf_exempt_at_60', 'NSF exemption at 60+'],
  ['csg_employee_rate_low', 'CSG lower rate (%)'],
  ['csg_employee_rate_high', 'CSG higher rate (%)'],
  ['csg_threshold', 'CSG threshold'],
]
const rateValue = (value: RatesSnapshot[keyof RatesSnapshot]) => (typeof value === 'boolean' ? (value ? 'on' : 'off') : typeof value === 'number' ? value.toLocaleString('en-US', { maximumFractionDigits: 4 }) : String(value))

const people = (count: number) => `${count} ${count === 1 ? 'payslip' : 'payslips'}`

/** What differs for the month as a whole. Empty when last month used the same template and rates versions. */
function bannerFor(period: string, baseline: Baseline, current: readonly CurrentPayslip[], templateName: (id: string) => string | null): BannerLine[] {
  // A baseline made from payroll figures has no template or rates of its own to differ from.
  if (baseline.source !== 'issued') return []
  const now = current.find((found) => found.side)?.side
  const before = baseline.payslips.flatMap((payslip) => (payslip.side ? [payslip.side] : []))
  if (!now?.template || before.length === 0) return []
  const banner: BannerLine[] = []

  const templates = new Map<string, { ref: TemplateRef; count: number }>()
  for (const side of before) {
    if (!side.template) continue
    const key = `${side.template.id} ${side.template.version}`
    templates.set(key, { ref: side.template, count: (templates.get(key)?.count ?? 0) + 1 })
  }
  const otherTemplates = [...templates.values()].filter(({ ref }) => ref.id !== now.template!.id || ref.version !== now.template!.version)
  if (otherTemplates.length > 0) {
    const byLabel = otherTemplates.some(({ ref }) => ref.id !== now.template!.id)
    banner.push({
      kind: 'template',
      text: byLabel
        ? `Some of ${formatPeriod(baseline.period)} was issued with another template. Those payslips are compared line by line by label.`
        : `The template version is not the one ${formatPeriod(baseline.period)} was issued with. Lines are still matched by their ids.`,
      details: [
        ...otherTemplates.map(({ ref, count }) => {
          const name = ref.id === now.template!.id ? 'this template' : (templateName(ref.id) ?? 'a template that is not in the list now')
          return `${formatPeriod(baseline.period)}: ${people(count)} with ${name}, version ${versionNumber(ref.version)}.`
        }),
        `${formatPeriod(period)}: ${templateName(now.template.id) ?? 'this template'}, version ${versionNumber(now.template.version)}.`,
      ],
    })
  }

  const rates = new Map<string, { rates: RatesSnapshot | null; count: number }>()
  for (const side of before) {
    const key = canonicalJson(side.rates)
    rates.set(key, { rates: side.rates, count: (rates.get(key)?.count ?? 0) + 1 })
  }
  const otherRates = [...rates.values()].filter((found) => !sameRatesVersion(found.rates, now.rates))
  if (otherRates.length > 0) {
    const details = otherRates.map((found) => `${formatPeriod(baseline.period)}: ${people(found.count)} cross-checked with ${describeRates(found.rates)}.`)
    details.push(`${formatPeriod(period)}: ${describeRates(now.rates)}.`)
    for (const found of otherRates) {
      if (!found.rates || !now.rates) continue
      for (const [key, label] of RATE_LABELS) {
        if (found.rates[key] !== now.rates[key]) details.push(`${label}: ${rateValue(found.rates[key])} then, ${rateValue(now.rates[key])} now.`)
      }
    }
    banner.push({
      kind: 'rates',
      text: `The statutory rates version is not the one ${formatPeriod(baseline.period)} was cross-checked with. Rates only feed the cross-check warnings: no figure on a payslip comes from them.`,
      details,
    })
  }
  return banner
}

/**
 * The whole review: one row per employee of this month, then one per employee who was on last
 * month's payslips and is not in this month's data.
 */
export function compareMonth(
  period: string,
  current: readonly CurrentPayslip[],
  baseline: Baseline,
  templateName: (id: string) => string | null = () => null,
): MonthComparison {
  const before = new Map(baseline.payslips.map((payslip) => [payslip.nationalId, payslip]))
  const present = new Set(current.map((payslip) => payslip.nationalId))
  const rows = [
    ...current.map((payslip) => compareEmployee(payslip, before.get(payslip.nationalId))),
    ...baseline.payslips.filter((payslip) => !present.has(payslip.nationalId)).map(leftRow),
  ]
  const counts: Record<RowStatus, number> = { unchanged: 0, changed: 0, new: 0, left: 0, 'cannot-compare': 0 }
  for (const row of rows) counts[row.status]++
  return { period, lastPeriod: baseline.period, source: baseline.source, rows, counts, banner: bannerFor(period, baseline, current, templateName) }
}

/** A difference as it is shown: "+500", "-0.01", or "0" when there is none. */
export function signedCents(cents: number): string {
  return cents === 0 ? '0' : `${cents > 0 ? '+' : '-'}${formatCents(Math.abs(cents))}`
}

/** An amount as it is shown in the review: the payslip's own display rule, with zero as "0". */
export function shownCents(cents: number | null): string {
  return cents === null ? '' : cents === 0 ? '0' : formatCents(cents)
}
