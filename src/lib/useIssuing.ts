// The app's state for issued payslips: the months loaded from the dashboard and the issue in
// progress. Everything is in this tab's memory only and is dropped when the company changes.

import { useCallback, useEffect, useRef, useState } from 'react'
import { failure, normaliseBrn, type Failure, type HubPort } from './hubWire'
import { checkIssue, issueBatch, loadMonth, planIssue, type IssuedPayslip, type IssueOutcome, type PayslipToIssue, type PendingIssue } from './issueStore'

export type MonthState = { status: 'loading' } | { status: 'loaded'; payslips: IssuedPayslip[] } | { status: 'failed'; failure: Failure }

export interface IssueRun {
  period: string
  /** One message each. A normal month is one batch. */
  batches: PendingIssue[]
  /** The batch being sent, or the one the run stopped at. */
  at: number
  status: 'sending' | 'checking' | 'stopped' | 'done'
  /** How the batch the run stopped at ended. */
  outcome: IssueOutcome | null
}

/** Who is issued and who is not, once a run has ended or stopped. */
export function runSummary(run: IssueRun): { issued: string[]; notIssued: string[] } {
  const names = (batches: PendingIssue[]) => batches.flatMap((batch) => batch.payslips.map((payslip) => payslip.name))
  const doneUpTo = run.status === 'done' ? run.batches.length : run.at
  return { issued: names(run.batches.slice(0, doneUpTo)), notIssued: names(run.batches.slice(doneUpTo)) }
}

/** The month after a batch was stored: each payslip sent is now the latest revision, issued by me. */
function withIssued(month: readonly IssuedPayslip[], batch: PendingIssue, revisions: ReadonlyMap<string, number>): IssuedPayslip[] {
  const issued = batch.payslips.map(
    (payslip): IssuedPayslip => ({
      nationalId: payslip.nationalId,
      revision: revisions.get(payslip.nationalId) ?? payslip.expectedRevision + 1,
      templateId: payslip.templateId,
      templateVersion: payslip.templateVersion,
      rates: payslip.rates,
      lines: payslip.lines,
      acceptedDifferences: payslip.acceptedDifferences,
      issuedAt: '',
      issuedByYou: true,
    }),
  )
  const replaced = new Set(issued.map((payslip) => payslip.nationalId))
  return [...month.filter((payslip) => !replaced.has(payslip.nationalId.trim())), ...issued].sort((a, b) => (a.nationalId < b.nationalId ? -1 : 1))
}

export function useIssuing(port: HubPort, company: string | null) {
  const [months, setMonths] = useState<Record<string, MonthState>>({})
  const [run, setRun] = useState<IssueRun | null>(null)
  /** Payslips too large to send, found before anything was sent. */
  const [tooLarge, setTooLarge] = useState<{ name: string; bytes: number }[]>([])
  const monthsRef = useRef(months)
  monthsRef.current = months

  // Issued payslips of one company are never shown for another.
  const companyKey = company === null ? null : normaliseBrn(company)
  useEffect(() => {
    setMonths({})
    setRun(null)
    setTooLarge([])
  }, [companyKey])

  const setMonth = useCallback((period: string, state: MonthState) => setMonths((previous) => ({ ...previous, [period]: state })), [])

  /** Loads a month. The dashboard asks its user first, so this can take up to two minutes. */
  const load = useCallback(
    async (period: string) => {
      if (company === null) return
      setMonth(period, { status: 'loading' })
      const result = await loadMonth(port, company, period)
      setMonth(period, result.ok ? { status: 'loaded', payslips: result.payslips } : { status: 'failed', failure: result.failure })
    },
    [port, company, setMonth],
  )

  /** Sends the batches from `from` on, one at a time, and stops at the first that is not stored. */
  const sendFrom = async (base: IssueRun, from: number, first: 'send' | 'check') => {
    for (let at = from; at < base.batches.length; at++) {
      const batch = base.batches[at]
      const checking = at === from && first === 'check'
      setRun({ ...base, at, status: checking ? 'checking' : 'sending', outcome: null })
      const outcome = checking ? await checkIssue(port, batch, base.outcome?.failure ?? failure('no-answer')) : await issueBatch(port, batch)
      const current = monthsRef.current[base.period]
      const known = current?.status === 'loaded' ? current.payslips : []
      if (outcome.end === 'saved') {
        setMonth(base.period, { status: 'loaded', payslips: outcome.month ?? withIssued(known, batch, outcome.revisions ?? new Map()) })
        continue
      }
      if (outcome.month) setMonth(base.period, { status: 'loaded', payslips: outcome.month })
      return setRun({ ...base, at, status: 'stopped', outcome })
    }
    setRun({ ...base, at: base.batches.length, status: 'done', outcome: null })
  }

  /** Checks the limits, then issues the month. Nothing is sent when a payslip is too large. */
  const start = (brn: string, period: string, payslips: PayslipToIssue[]) => {
    const plan = planIssue(brn, period, payslips)
    if (!plan.ok) {
      setRun(null)
      return setTooLarge(plan.tooLarge)
    }
    setTooLarge([])
    void sendFrom({ period, batches: plan.batches.map((batch) => ({ brn, period, payslips: batch })), at: 0, status: 'sending', outcome: null }, 0, 'send')
  }

  /** After "locked" or "not stored": the very same message again. After "not confirmed": only a check. */
  const resume = () => {
    if (run?.status !== 'stopped' || !run.outcome) return
    const { end } = run.outcome
    if (end === 'locked' || end === 'not-saved') void sendFrom(run, run.at, 'send')
    else if (end === 'unconfirmed') void sendFrom(run, run.at, 'check')
  }

  return {
    months,
    load,
    run,
    tooLarge,
    start,
    resume,
    dismiss: () => {
      setRun(null)
      setTooLarge([])
    },
    busy: run?.status === 'sending' || run?.status === 'checking',
  }
}

export type Issuing = ReturnType<typeof useIssuing>
