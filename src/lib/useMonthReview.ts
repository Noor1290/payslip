// The month review's state in the app: last month's baseline (the issued payslips already kept by
// useIssuing, or last month's payroll figures when none was issued), the comparison, and the
// review marks. Everything is in this tab's memory only, and is dropped when the company changes.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { baselineFromPayroll, loadPayrollMonth } from './baseline'
import type { PreparedPayslip } from './build'
import { normaliseBrn, type Failure, type HubPort } from './hubWire'
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
  type PayrollBaseline,
  type ReviewMarks,
} from './monthReview'
import type { ImportedPayroll } from './payrollFile'
import type { PayslipTemplate, TemplateMapping } from './template'
import type { Issuing } from './useIssuing'

export interface MonthReviewInput {
  port: HubPort
  issuing: Issuing
  /** The BRN of the payroll data that is open, or null. */
  company: string | null
  /** The pay month chosen on the Payslips page. */
  period: string
  data: ImportedPayroll | null
  /** This month's payslips, built from this month's payroll figures. Read, never changed. */
  prepared: readonly PreparedPayslip[]
  /** The template and mapping this month's payslips are made with. */
  template: PayslipTemplate
  mapping: TemplateMapping
  /** The rates this month's cross-check used, or null when it did not run. */
  rates: RatesSnapshot | null
  templateName: (id: string) => string | null
}

/** Last month's payroll rows as the dashboard answered, kept until the company changes. */
type PayrollLoad = { status: 'loading' } | { status: 'failed'; failure: Failure } | { status: 'none' } | { status: 'loaded'; data: ImportedPayroll }

const NOT_ASKED: BaselineState = { status: 'not-asked' }

export function useMonthReview({ port, issuing, company, period, data, prepared, template, mapping, rates, templateName }: MonthReviewInput) {
  const [marks, setMarks] = useState<ReviewMarks>({})
  const [payrollMonths, setPayrollMonths] = useState<Record<string, PayrollLoad>>({})

  // A review of one company, and its payroll figures, are never carried over to another.
  const companyKey = company === null ? null : normaliseBrn(company)
  const companyNow = useRef(companyKey)
  companyNow.current = companyKey
  useEffect(() => {
    setMarks({})
    setPayrollMonths({})
  }, [companyKey])

  const lastPeriod = previousMonth(period)
  const issuedLastMonth = lastPeriod === null ? undefined : issuing.months[lastPeriod]
  const payrollLoad = lastPeriod === null ? undefined : payrollMonths[lastPeriod]
  // Last month's payroll figures are put on the template in use now, so they follow a template change.
  const payroll = useMemo((): PayrollBaseline | undefined => {
    if (!payrollLoad || lastPeriod === null) return undefined
    return payrollLoad.status === 'loaded' ? { status: 'loaded', baseline: baselineFromPayroll(lastPeriod, payrollLoad.data, template, mapping) } : payrollLoad
  }, [payrollLoad, lastPeriod, template, mapping])

  const state = useMemo(() => (lastPeriod === null ? NOT_ASKED : baselineState(lastPeriod, issuedLastMonth, payroll)), [lastPeriod, issuedLastMonth, payroll])
  const templateRef = useMemo((): TemplateRef => ({ id: template.id, version: template.version }), [template.id, template.version])
  const current = useMemo(() => (data ? currentPayslips(data, prepared, templateRef, rates) : []), [data, prepared, templateRef, rates])
  const comparison = useMemo(() => comparisonOf(state, period, current, templateName), [state, period, current, templateName])

  const { load: loadMonth } = issuing
  /** Asks the dashboard for last month's issued payslips. It asks its user first. */
  const load = useCallback(() => {
    if (lastPeriod !== null) void loadMonth(lastPeriod)
  }, [lastPeriod, loadMonth])

  /** Asks the dashboard for last month's payroll run: only offered when no payslip was issued last month. */
  const loadPayroll = useCallback(async () => {
    if (lastPeriod === null || company === null) return
    const askedFor = normaliseBrn(company)
    const keep = (found: PayrollLoad) => {
      // An answer for a company that is no longer the one open is dropped.
      if (companyNow.current === askedFor) setPayrollMonths((previous) => ({ ...previous, [lastPeriod]: found }))
    }
    keep({ status: 'loading' })
    const result = await loadPayrollMonth(port, company, lastPeriod)
    keep(!result.ok ? { status: 'failed', failure: result.failure } : result.data === null ? { status: 'none' } : { status: 'loaded', data: result.data })
  }, [port, company, lastPeriod])

  /** After "nothing to compare with": forgets that answer and asks for last month's issued payslips again. */
  const checkAgain = useCallback(() => {
    if (lastPeriod === null) return
    setPayrollMonths(({ [lastPeriod]: _forgotten, ...rest }) => rest)
    void loadMonth(lastPeriod)
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
    loadPayroll: () => void loadPayroll(),
    checkAgain,
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
