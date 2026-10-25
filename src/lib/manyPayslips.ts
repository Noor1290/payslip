// Payslips for several companies at once: what each company's payslips are made with and which
// ones pass, the folders of the zip, and the report. Pure: no request, no file is written here.
// Each company uses ITS OWN template, rates and saved run, and its payslips go through exactly
// the checks of the one-company Payslips page. A payslip that would not be ready there (an
// error, or a total that differs from the payroll's and was not accepted) is left out, with
// the reason. The one difference that may be accepted in a batch is a total exactly 0.01 away
// from the payroll's (known issue 2), when the user ticks it: each one is listed in the report.
// A payslip issued for the month and unchanged is taken from its stored copy, as the one-company
// download does, so it looks exactly as it was issued. Nothing is issued.

import { payslipFileNames, preparePayslips } from './build'
import { formatPeriod, formatShortDate } from './dates'
import { exportBaseName } from './exports'
import type { PayslipDocument } from './layoutModel'
import type { CompanyBundle } from './manyStore'
import { formatCents } from './money'
import { importPayrollRows } from './payrollFile'
import { issueStatuses } from './issueBuild'
import { decodeLines } from './issuedLines'
import { pendingChecks, type AcceptedChecks, type ReconcileCheck } from './payslip'
import { ratesForCrossCheck } from './ratesStore'
import { ratesFor, type RatesVersion } from './statutoryRates'
import { readBody, templateOf } from './templateBody'

export interface LeftOut {
  name: string
  reasons: string[]
}

/** A 0.01 rounding difference that was accepted: whose, and on which total. */
export interface AcceptedRounding {
  name: string
  line: string
}

/** A payslip downloaded from what was stored when it was issued. */
export interface FromIssued {
  name: string
  revision: number
}

export interface BuildOptions {
  /** The date printed by the signatures. */
  issueDate: string
  /** Include a payslip whose only differences from the payroll's totals are exactly 0.01. */
  acceptRounding: boolean
}

export type CompanyOutcome =
  | {
      brn: string
      company: string
      /** "done": every payslip; "partly": some were left out. */
      kind: 'done' | 'partly'
      template: string
      /** The company's own rates in force for the month, used for the cross-check; null: none. */
      ratesUsed: RatesVersion | null
      documents: PayslipDocument[]
      leftOut: LeftOut[]
      rounding: AcceptedRounding[]
      fromIssued: FromIssued[]
    }
  | {
      brn: string
      company: string
      kind: 'skipped'
      reason: string
      /** When the company was skipped because no payslip passed: who, and why. */
      leftOut: LeftOut[]
    }

/**
 * Why a payslip that has no error still would not be ready: each total that differs. When 0.01
 * roundings are accepted in the batch, one of those is not something to accept elsewhere.
 */
function checkReason(check: ReconcileCheck, acceptRounding: boolean): string {
  if (check.kind === 'unavailable' || check.diffCents === null) {
    return `${check.label} cannot be compared with the payroll's "${check.payrollKey}".`
  }
  const rounding = check.kind === 'rounding'
  const differs = `${check.label} differs from the payroll's "${check.payrollKey}" by ${formatCents(Math.abs(check.diffCents))}${rounding ? ' (rounding)' : ''}.`
  return rounding && acceptRounding ? differs : `${differs} Accept it on this company's Payslips page to include it.`
}

const skipped = (bundle: CompanyBundle, reason: string, leftOut: LeftOut[] = []): CompanyOutcome => ({
  brn: bundle.brn,
  company: bundle.company,
  kind: 'skipped',
  reason,
  leftOut,
})

/**
 * One company's payslips for the month, made with its template and rates, through the same
 * checks as the Payslips page.
 */
export function buildCompany(bundle: CompanyBundle, { issueDate, acceptRounding }: BuildOptions): CompanyOutcome {
  const month = formatPeriod(bundle.period)
  if (!bundle.template) {
    return skipped(
      bundle,
      bundle.templateReason === 'several'
        ? 'No template chosen: it has more than one published template, and none is chosen for the payslips.'
        : 'No template chosen: it has no published template.',
    )
  }
  const { templateId, name, version, body } = bundle.template
  const read = readBody(body)
  if (!read.ok) return skipped(bundle, `Its template "${name}", version ${version}, cannot be used: ${read.problems[0] ?? 'it is not valid'}`)
  if (!bundle.run) return skipped(bundle, `No saved payroll for ${month}.`)
  const imported = importPayrollRows(bundle.employees, { period: bundle.period })
  if (!imported.ok) return skipped(bundle, `Its payroll for ${month} could not be used: ${imported.errors[0]?.message ?? 'it is not valid.'}`)
  const data = imported.data

  const { template, mapping } = templateOf(read.body, { id: templateId, name, version: `v${version}` })
  const rates = ratesForCrossCheck({ status: 'loaded', versions: bundle.rates, company: { name: bundle.company, brn: bundle.brn } }, bundle.period)
  const prepared = preparePayslips(data, { template, mapping, rateVersions: rates.versions, whyNoRates: rates.whyNone, period: bundle.period }, issueDate)

  const documents: PayslipDocument[] = []
  const leftOut: LeftOut[] = []
  const rounding: AcceptedRounding[] = []
  const fromIssued: FromIssued[] = []
  // What was accepted, per row, as the Payslips page records it: the issued copy is compared with it.
  const accepted: Record<number, AcceptedChecks> = {}
  const ready = prepared.filter((item) => {
    const { computation } = item
    if (computation.errors.length > 0 || !item.document) {
      leftOut.push({ name: computation.employeeName, reasons: computation.errors.map((error) => error.message) })
      return false
    }
    const pending = pendingChecks(computation, {})
    if (pending.length === 0) return true
    // Only differences of exactly 0.01, and only when the user accepts them for the batch.
    if (acceptRounding && pending.every((check) => check.kind === 'rounding' && check.diffCents !== null)) {
      accepted[computation.rowIndex] = Object.fromEntries(pending.map((check) => [check.id, check.diffCents!]))
      for (const check of pending) rounding.push({ name: computation.employeeName, line: check.label })
      return true
    }
    leftOut.push({ name: computation.employeeName, reasons: pending.map((check) => checkReason(check, acceptRounding)) })
    return false
  })
  // Issued for this month and unchanged: the payslip is the stored copy, exactly as issued.
  const statuses = issueStatuses(data, prepared, bundle.issued, accepted, {})
  for (const item of ready) {
    const status = statuses.get(item.computation.rowIndex)
    const stored = status?.kind === 'issued' && status.same ? decodeLines(status.issued.lines) : null
    if (stored?.ok && status?.kind === 'issued') {
      documents.push(stored.document)
      fromIssued.push({ name: item.computation.employeeName, revision: status.revision })
    } else {
      documents.push(item.document!)
    }
  }
  if (documents.length === 0) return skipped(bundle, 'No payslip passed its checks.', leftOut)
  return {
    brn: bundle.brn,
    company: bundle.company,
    kind: leftOut.length === 0 ? 'done' : 'partly',
    template: `${name}, version ${version}`,
    ratesUsed: ratesFor(rates.versions, bundle.period),
    documents,
    leftOut,
    rounding,
    fromIssued,
  }
}

/** A company that could not even be loaded from the dashboard. */
export function notLoaded(company: { brn: string; name: string }, why: string): CompanyOutcome {
  return { brn: company.brn, company: company.name, kind: 'skipped', reason: why, leftOut: [] }
}

/** Characters Windows does not allow in a file or folder name. */
const clean = (text: string) => text.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()

/** One folder per company, named after it; two companies with the same name get their BRN too. */
export function folderNames(outcomes: readonly { company: string; brn: string }[]): string[] {
  const counts = new Map<string, number>()
  for (const outcome of outcomes) {
    const key = (clean(outcome.company) || 'Company').toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return outcomes.map((outcome) => {
    const name = clean(outcome.company) || 'Company'
    return (counts.get(name.toLowerCase()) ?? 0) > 1 ? `${name} (${clean(outcome.brn)})` : name
  })
}

/** What goes into the zip for one company, by path. The bytes are written elsewhere. */
export function companyPaths(folder: string, company: string, period: string, documents: readonly PayslipDocument[]) {
  const base = exportBaseName(company, period)
  return {
    payslips: payslipFileNames(
      documents.map((doc) => doc.employeeName),
      period,
    ).map((file) => `${folder}/${file}`),
    combined: `${folder}/${clean(company) || 'Company'} - all payslips - ${period}.pdf`,
    workbook: `${folder}/${base}.xlsx`,
  }
}

export const reportFileName = (period: string) => `Report - ${period}.txt`
export const zipFileName = (period: string) => `Payslips - several companies - ${period}.zip`

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

export const roundingText = (item: AcceptedRounding) => `Accepted a 0.01 rounding difference: ${item.name}, ${item.line}`
export const fromIssuedText = (item: FromIssued) => `Taken from the issued copy (revision ${item.revision}): ${item.name}`

/** The counts at the top of the report, also shown on screen. */
export function summaryLine(outcomes: readonly CompanyOutcome[]): string {
  const count = (kind: CompanyOutcome['kind']) => outcomes.filter((outcome) => outcome.kind === kind).length
  const payslips = outcomes.reduce((total, outcome) => total + (outcome.kind === 'skipped' ? 0 : outcome.documents.length), 0)
  return `${plural(outcomes.length, 'company', 'companies')}: ${count('done')} in full, ${count('partly')} partly, ${count('skipped')} skipped. ${plural(payslips, 'payslip')} made.`
}

/**
 * The report: which companies and employees were left out, and why. Names, never a national ID
 * or a figure other than the difference that kept a payslip out.
 */
export function reportText(outcomes: readonly CompanyOutcome[], period: string, madeOn: string): string {
  const lines = [
    `Payslips for ${formatPeriod(period)}`,
    `Made on ${formatShortDate(madeOn)} by Payslip Automation. Downloaded only: nothing was issued.`,
    '',
    summaryLine(outcomes),
    '',
  ]
  for (const outcome of outcomes) {
    const head = `${outcome.company} (BRN ${outcome.brn})`
    if (outcome.kind === 'skipped') lines.push(`${head}: skipped. ${outcome.reason}`)
    else if (outcome.kind === 'done') lines.push(`${head}: ${plural(outcome.documents.length, 'payslip')}, with ${outcome.template}.`)
    else lines.push(`${head}: ${plural(outcome.documents.length, 'payslip')}, with ${outcome.template}; ${outcome.leftOut.length} left out:`)
    for (const person of outcome.leftOut) lines.push(`  - ${person.name}: ${person.reasons.join(' ')}`)
    if (outcome.kind === 'skipped') continue
    for (const item of outcome.rounding) lines.push(`  ${roundingText(item)}`)
    for (const item of outcome.fromIssued) lines.push(`  ${fromIssuedText(item)}`)
  }
  return `${lines.join('\r\n')}\r\n`
}
