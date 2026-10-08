// The month review's state in the app: last month's baseline (from the months already kept by
// useIssuing), the comparison, and the review marks. Everything is in this tab's memory only and
// the marks are dropped when the company changes.

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PreparedPayslip } from './build'
import { normaliseBrn } from './hubWire'
import type { RatesSnapshot } from './issueStore'
import { currentPayslips, previousMonth, type MonthComparison, type ReviewRow, type TemplateRef } from './monthCompare'
import {
  approveUnchanged,
  baselineState,
  bulkApprovable,
  comparisonOf,
  isReviewed,
  markReviewed,
  reviewProblems,
  unmarkReviewed,
  type BaselineState,
  type ReviewMarks,
} from './monthReview'
import type { ImportedPayroll } from './payrollFile'
import type { Issuing } from './useIssuing'

export interface MonthReviewInput {
  issuing: Issuing
  /** The BRN of the payroll data that is open, or null. */
  company: string | null
  /** The pay month chosen on the Payslips page. */
  period: string
  data: ImportedPayroll | null
  /** This month's payslips, built from this month's payroll figures. Read, never changed. */
  prepared: readonly PreparedPayslip[]
  /** The template and the rates this month's payslips are made with. */
  template: TemplateRef
  rates: RatesSnapshot | null
  templateName: (id: string) => string | null
}

const NOT_ASKED: BaselineState = { status: 'not-asked' }

export function useMonthReview({ issuing, company, period, data, prepared, template, rates, templateName }: MonthReviewInput) {
  const [marks, setMarks] = useState<ReviewMarks>({})

  // A review of one company is never carried over to another.
  const companyKey = company === null ? null : normaliseBrn(company)
  useEffect(() => setMarks({}), [companyKey])

  const lastPeriod = previousMonth(period)
  const issuedLastMonth = lastPeriod === null ? undefined : issuing.months[lastPeriod]
  const state = useMemo(() => (lastPeriod === null ? NOT_ASKED : baselineState(lastPeriod, issuedLastMonth)), [lastPeriod, issuedLastMonth])
  const current = useMemo(() => (data ? currentPayslips(data, prepared, template, rates) : []), [data, prepared, template, rates])
  const comparison = useMemo(() => comparisonOf(state, period, current, templateName), [state, period, current, templateName])

  const { load: loadMonth } = issuing
  /** Asks the dashboard for last month's issued payslips. It asks its user first. */
  const load = useCallback(() => {
    if (lastPeriod !== null) void loadMonth(lastPeriod)
  }, [lastPeriod, loadMonth])

  const setReviewed = useCallback(
    (row: ReviewRow, reviewed: boolean) => {
      if (comparison) setMarks((previous) => (reviewed ? markReviewed(previous, comparison, row) : unmarkReviewed(previous, comparison, row)))
    },
    [comparison],
  )
  const approveAllUnchanged = useCallback(() => {
    if (comparison) setMarks((previous) => approveUnchanged(previous, comparison))
  }, [comparison])

  /** The rows whose mark still covers what they are now. */
  const reviewedKeys = useMemo(
    () => new Set(comparison ? comparison.rows.filter((row) => isReviewed(marks, comparison, row)).map((row) => row.key) : []),
    [marks, comparison],
  )

  return {
    lastPeriod,
    state,
    comparison,
    load,
    isReviewed: (row: ReviewRow) => reviewedKeys.has(row.key),
    setReviewed,
    /** How many Unchanged rows one click would approve. */
    unchangedToApprove: comparison ? bulkApprovable(marks, comparison).length : 0,
    approveUnchanged: approveAllUnchanged,
    /** Why the month cannot be issued yet, as far as the review goes. */
    problems: (selected: readonly number[]) => reviewProblems({ state, lastPeriod, comparison, marks, selected }),
  }
}

export type MonthReview = ReturnType<typeof useMonthReview>
export type { MonthComparison }
