// From the payslips on screen to the payslips to issue. A month can be issued only when a
// PUBLISHED template is chosen, the payroll data is for that month, and every selected payslip
// has no error and every difference fixed or accepted with a reason.

import type { PreparedPayslip } from './build'
import { encodeLines, figuresOf } from './issuedLines'
import { ratesSnapshot, type IssuedPayslip, type PayslipToIssue } from './issueStore'
import type { ImportedPayroll } from './payrollFile'
import { isReady, type AcceptedChecks } from './payslip'
import { acceptedDifferences, type Reasons } from './reasons'
import type { RatesVersion } from './statutoryRates'
import type { TemplateChoice } from './templateUse'

export interface IssueInput {
  data: ImportedPayroll
  /** The pay month chosen on the Payslips page. */
  period: string
  prepared: readonly PreparedPayslip[]
  /** Row indexes of the employees to issue. */
  selected: readonly number[]
  accepted: Readonly<Record<number, AcceptedChecks>>
  reasons: Reasons
  /** What the payslips on screen are built with. Only a published version can be issued. */
  choice: TemplateChoice
  /** True when the screen shows a draft instead of the choice. */
  previewingDraft: boolean
  /** The rates the cross-check used for this month, or null when it did not run. */
  rates: RatesVersion | null
  /** The month as last loaded from the dashboard: where each expected_revision comes from. */
  month: readonly IssuedPayslip[]
}

export type IssueBuild = { ok: true; payslips: PayslipToIssue[] } | { ok: false; problems: string[] }

/** Why the month cannot be issued as a whole, before looking at any employee. Empty when it can. */
export function monthProblems(input: Pick<IssueInput, 'data' | 'period' | 'choice' | 'previewingDraft'>): string[] {
  const problems: string[] = []
  if (input.previewingDraft) problems.push('You are previewing a draft. Stop previewing it: only a published template version can be issued.')
  else if (input.choice.kind !== 'published') {
    problems.push('Payslips are issued with a published template version of the company. Choose one on the Template page, or publish the built-in template there.')
  }
  if (input.data.period === null) problems.push('The payroll data does not say which month it is for, so it cannot be issued. Get the month from the dashboard.')
  else if (input.data.period !== input.period) problems.push('The pay month chosen is not the month of the payroll data. They must be the same to issue.')
  return problems
}

export function buildIssue(input: IssueInput): IssueBuild {
  const problems = monthProblems(input)
  if (input.selected.length === 0) problems.push('Select at least one employee.')
  if (problems.length > 0 || input.choice.kind !== 'published') return { ok: false, problems }
  const { choice } = input

  const payslips: PayslipToIssue[] = []
  const seen = new Set<string>()
  for (const rowIndex of input.selected) {
    const item = input.prepared.find((found) => found.computation.rowIndex === rowIndex)
    if (!item) continue
    const { computation, document } = item
    const name = computation.employeeName
    const accepted = input.accepted[rowIndex] ?? {}
    if (!document || computation.errors.length > 0) {
      problems.push(`${name}: the payslip has an error to fix.`)
      continue
    }
    if (!isReady(computation, accepted)) {
      problems.push(`${name}: a difference from the payroll totals is not accepted yet.`)
      continue
    }
    const { differences, zeroReasons, missing } = acceptedDifferences(computation, accepted, input.reasons[rowIndex])
    if (missing.length > 0) {
      problems.push(`${name}: ${missing.join('; ')}.`)
      continue
    }
    const nationalId = String(input.data.rows[rowIndex].ID).trim()
    if (seen.has(nationalId)) {
      problems.push(`${name}: this employee is in the selection twice.`)
      continue
    }
    seen.add(nationalId)
    payslips.push({
      name,
      nationalId,
      expectedRevision: input.month.find((issued) => issued.nationalId.trim() === nationalId)?.revision ?? 0,
      templateId: choice.templateId,
      templateVersion: choice.version,
      rates: ratesSnapshot(input.rates),
      lines: encodeLines(document, figuresOf(computation, zeroReasons)),
      acceptedDifferences: differences,
    })
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, payslips }
}
