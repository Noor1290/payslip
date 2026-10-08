// Where the month review stands: whether last month could be loaded to compare with, and the
// comparison once it is. Last month's issued payslips come through the dashboard ("payslip-issue",
// which asks its user first), so they can also be declined, locked, or simply not there.
//
// Everything here is in this tab's memory only.

import { formatPeriod } from './dates'
import { canonicalJson, type Failure } from './hubWire'
import type { IssueBuild } from './issueBuild'
import { baselineFromIssued, compareMonth, type Baseline, type CurrentPayslip, type MonthComparison, type ReviewRow } from './monthCompare'
import type { MonthState } from './useIssuing'

/** What is being asked of the dashboard: last month's issued payslips. */
export type BaselineAsk = 'issued'

export type BaselineState =
  /** Nobody asked yet. The dashboard asks its user before it sends issued payslips, so the app never asks by itself. */
  | { status: 'not-asked' }
  | { status: 'loading'; what: BaselineAsk }
  /** Declined, locked, timed out, refused or not understood. Nothing is known about last month. */
  | { status: 'failed'; what: BaselineAsk; failure: Failure }
  /** Loaded, and last month has nothing to compare with. This is an answer, not a failure. */
  | { status: 'nothing' }
  | { status: 'ready'; baseline: Baseline }

/**
 * Last month as a baseline, from what the dashboard answered for that month. An empty month is
 * "nothing to compare with"; a load that failed is never read as an empty month.
 */
export function baselineState(lastPeriod: string, issued: MonthState | undefined): BaselineState {
  if (!issued) return { status: 'not-asked' }
  if (issued.status === 'loading') return { status: 'loading', what: 'issued' }
  if (issued.status === 'failed') return { status: 'failed', what: 'issued', failure: issued.failure }
  if (issued.payslips.length === 0) return { status: 'nothing' }
  return { status: 'ready', baseline: baselineFromIssued(lastPeriod, issued.payslips) }
}

/** The review itself, once there is a baseline. Null in every other state. */
export function comparisonOf(
  state: BaselineState,
  period: string,
  current: readonly CurrentPayslip[],
  templateName?: (id: string) => string | null,
): MonthComparison | null {
  return state.status === 'ready' ? compareMonth(period, current, state.baseline, templateName) : null
}

// ---------- reviewing ----------
// A mark says "I looked at this row as it is now". It is kept with what was looked at: when a
// figure of this month or of last month changes, the mark no longer counts. Marks live in this
// tab's memory only; the dashboard has no place for them (docs/HUB_CHANGES.md).

/** Row -> what the row was when it was marked. */
export type ReviewMarks = Readonly<Record<string, string>>

const markKey = (comparison: MonthComparison, row: ReviewRow) => `${comparison.period} ${row.key}`

/** Everything a review of the row covers: both months' figures, the status and the notes. */
export function reviewFingerprint(comparison: MonthComparison, row: ReviewRow): string {
  return canonicalJson({
    period: comparison.period,
    lastPeriod: comparison.lastPeriod,
    source: comparison.source,
    nationalId: row.nationalId,
    status: row.status,
    problem: row.problem,
    baselineRevision: row.baselineRevision,
    lines: row.lines.map((line) => [line.side, line.label, line.match, line.last, line.current]),
    totals: row.totals.map((total) => [total.id, total.last, total.current]),
    notes: row.notes,
  })
}

/** Whether the row was marked AND is still what was marked. */
export function isReviewed(marks: ReviewMarks, comparison: MonthComparison, row: ReviewRow): boolean {
  return marks[markKey(comparison, row)] === reviewFingerprint(comparison, row)
}

export function markReviewed(marks: ReviewMarks, comparison: MonthComparison, row: ReviewRow): ReviewMarks {
  return { ...marks, [markKey(comparison, row)]: reviewFingerprint(comparison, row) }
}

export function unmarkReviewed(marks: ReviewMarks, comparison: MonthComparison, row: ReviewRow): ReviewMarks {
  const { [markKey(comparison, row)]: _dropped, ...rest } = marks
  return rest
}

/** The rows one click may approve: the Unchanged ones, and no other. */
export function bulkApprovable(marks: ReviewMarks, comparison: MonthComparison): ReviewRow[] {
  return comparison.rows.filter((row) => row.status === 'unchanged' && !isReviewed(marks, comparison, row))
}

/** Bulk-approve: marks every Unchanged row. A Changed, New, Left or not comparable row is never marked this way. */
export function approveUnchanged(marks: ReviewMarks, comparison: MonthComparison): ReviewMarks {
  return bulkApprovable(marks, comparison).reduce((next, row) => markReviewed(next, comparison, row), marks)
}

const listed = (names: readonly string[]) => (names.length <= 6 ? names.join(', ') : `${names.slice(0, 6).join(', ')} and ${names.length - 6} more`)
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export interface ReviewGate {
  state: BaselineState
  /** Null while the pay month is not chosen. */
  lastPeriod: string | null
  comparison: MonthComparison | null
  marks: ReviewMarks
  /** Row indexes of the employees selected to be issued. */
  selected: readonly number[]
}

/**
 * Why the month cannot be issued yet, as far as the review goes. Empty when it can.
 *  - Last month must have been loaded, or found to have nothing to compare with. A load that was
 *    declined or failed blocks: it is asked again, never skipped.
 *  - Every selected payslip must be reviewed: Changed, New and not comparable ones one by one,
 *    Unchanged ones too (one click approves them all).
 *  - Everyone who left must be acknowledged.
 * Downloads do not wait for any of this.
 */
export function reviewProblems({ state, lastPeriod, comparison, marks, selected }: ReviewGate): string[] {
  if (lastPeriod === null) return []
  const last = formatPeriod(lastPeriod)
  if (state.status === 'not-asked') return [`Compare with ${last} first, in the month review. Issuing waits for it.`]
  if (state.status === 'loading') return [`The comparison with ${last} is still being loaded.`]
  if (state.status === 'failed') return [`The comparison with ${last} could not be loaded, so nothing is issued yet. Ask again in the month review.`]
  if (state.status === 'nothing' || !comparison) return []

  const chosen = new Set(selected)
  const open = comparison.rows.filter((row) => !isReviewed(marks, comparison, row))
  const names = (rows: readonly ReviewRow[]) => listed(rows.map((row) => row.employeeName))
  const toReview = open.filter((row) => row.rowIndex !== null && chosen.has(row.rowIndex) && row.status !== 'unchanged')
  const toApprove = open.filter((row) => row.rowIndex !== null && chosen.has(row.rowIndex) && row.status === 'unchanged')
  const left = open.filter((row) => row.status === 'left')

  const problems: string[] = []
  if (toReview.length > 0) {
    problems.push(`${count(toReview.length, 'selected payslip is', 'selected payslips are')} changed, new or not comparable and not reviewed yet: ${names(toReview)}.`)
  }
  if (toApprove.length > 0) {
    problems.push(`${count(toApprove.length, 'unchanged payslip is', 'unchanged payslips are')} not approved yet. Approve them in the month review.`)
  }
  if (left.length > 0) {
    problems.push(`${count(left.length, 'employee who left is', 'employees who left are')} not acknowledged yet: ${names(left)}.`)
  }
  return problems
}

/**
 * The selection as it may be issued, once the review has had its say. The payslips themselves are
 * the ones buildIssue made from this month's figures: the review adds reasons to wait, and never
 * changes, adds or removes a payslip. The second question about an identical re-issue stays.
 */
export function withReview(build: IssueBuild, problems: readonly string[]): IssueBuild {
  if (problems.length === 0) return build
  return { ok: false, problems: build.ok ? [...problems] : [...build.problems, ...problems] }
}
