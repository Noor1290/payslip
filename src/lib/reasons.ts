// Why a difference was accepted. A payslip is issued only when every blocking difference is fixed
// or accepted WITH a reason; the reasons are stored with the issued payslip.

import type { AcceptedChecks, CheckId, PayslipComputation } from './payslip'

export const REASON_MAX = 300
/** The fixed reason for a difference of exactly 0.01, which may be accepted in bulk. */
export const ROUNDING_REASON = 'Rounding'

/** Reasons per employee (row index), by what was accepted: a total's check, or a line treated as zero. */
export type Reasons = Record<number, Record<string, string>>

export const checkKey = (id: CheckId) => `check-${id}`
export const zeroKey = (lineId: string) => `zero-${lineId}`

/** What is wrong with a typed reason. Null when it can be used. */
export function reasonProblem(reason: string): string | null {
  const trimmed = reason.trim()
  if (trimmed.length === 0) return 'Say why, in a few words.'
  if (trimmed.length > REASON_MAX) return `Keep the reason to ${REASON_MAX} characters or fewer.`
  return null
}

export function withReason(reasons: Reasons, rowIndex: number, key: string, reason: string): Reasons {
  return { ...reasons, [rowIndex]: { ...reasons[rowIndex], [key]: reason.trim() } }
}

/** One accepted difference as it is stored: the figure, the two amounts, and why. */
export interface AcceptedDifference {
  what: string
  payroll: number
  payslip: number
  reason: string
}

/**
 * The accepted differences of a payslip, for issuing. `missing` lists what was accepted without a
 * reason (or not accepted at all): such a payslip cannot be issued.
 */
export function acceptedDifferences(
  computation: PayslipComputation,
  accepted: AcceptedChecks,
  reasons: Readonly<Record<string, string>> = {},
): { differences: AcceptedDifference[]; zeroReasons: Record<string, string>; missing: string[] } {
  const differences: AcceptedDifference[] = []
  const zeroReasons: Record<string, string> = {}
  const missing: string[] = []
  for (const check of computation.checks) {
    if (check.kind === 'match') continue
    if (check.payrollCents === null || check.payslipCents === null || check.diffCents === null || accepted[check.id] !== check.diffCents) {
      missing.push(`${check.label} is not accepted`)
      continue
    }
    const reason = reasons[checkKey(check.id)]?.trim()
    if (!reason) {
      missing.push(`${check.label} was accepted without a reason`)
      continue
    }
    // Whole cents to an amount with 2 decimals: exact for any amount a payslip holds.
    differences.push({ what: check.label, payroll: check.payrollCents / 100, payslip: check.payslipCents / 100, reason })
  }
  for (const line of computation.lines) {
    if (line.status !== 'treated-as-zero') continue
    const reason = reasons[zeroKey(line.id)]?.trim()
    if (reason) zeroReasons[line.id] = reason
    else missing.push(`${line.label} was treated as zero without a reason`)
  }
  return { differences, zeroReasons, missing }
}
