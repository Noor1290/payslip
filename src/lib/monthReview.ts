// Where the month review stands: whether last month could be loaded to compare with, and the
// comparison once it is. Last month's issued payslips come through the dashboard ("payslip-issue",
// which asks its user first), so they can also be declined, locked, or simply not there.
//
// Everything here is in this tab's memory only.

import type { Failure } from './hubWire'
import { baselineFromIssued, compareMonth, type Baseline, type CurrentPayslip, type MonthComparison } from './monthCompare'
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
