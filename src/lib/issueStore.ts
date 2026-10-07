// Issued payslips through the dashboard: load a month, issue a month (all or none per message),
// and the reload rule after an issue nobody could confirm. Wire format: docs/INTEGRATION.md,
// "payslip-issue". What "lines" holds: docs/ISSUED_PAYSLIP.md.
//
// National IDs and figures exist only in the bridge messages and in this tab's memory. A refusal
// names the employee by position ("index"); the name shown comes from this app's own list.

import { z } from 'zod'
import {
  ask,
  canonicalJson,
  failure,
  jsonBytes,
  PAYSLIP_ISSUE,
  sendSave,
  type Failure,
  type HubCompany,
  type HubPort,
  type HubRole,
  type SaveEnd,
} from './hubWire'
import type { AcceptedDifference } from './reasons'
import type { RatesVersion } from './statutoryRates'

/** The dashboard's limits, checked here before anything is sent. */
export const ISSUE_MAX_PAYSLIPS = 1_000
export const PAYSLIP_MAX_BYTES = 16_000
export const MESSAGE_MAX_BYTES = 4_000_000
/** A month's answer can hold more rows than the other answers. */
const MONTH_MAX_ROWS = 5_000

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
const revision = z.number().int().min(1)

/** The rates a payslip was cross-checked against, copied: exactly these eight keys. */
const snapshotSchema = z.strictObject({
  effective_from: month,
  revision,
  nsf_employee_rate: z.number(),
  nsf_ceiling: z.number(),
  nsf_exempt_at_60: z.boolean(),
  csg_employee_rate_low: z.number(),
  csg_employee_rate_high: z.number(),
  csg_threshold: z.number(),
})
export type RatesSnapshot = z.infer<typeof snapshotSchema>

export function ratesSnapshot(version: RatesVersion | null): RatesSnapshot | null {
  if (!version) return null
  return {
    effective_from: version.effectiveFrom,
    revision: version.revision,
    nsf_employee_rate: version.nsfEmployeeRate,
    nsf_ceiling: version.nsfCeiling,
    nsf_exempt_at_60: version.nsfExemptAt60,
    csg_employee_rate_low: version.csgEmployeeRateLow,
    csg_employee_rate_high: version.csgEmployeeRateHigh,
    csg_threshold: version.csgThreshold,
  }
}

const differenceSchema = z.object({ what: z.string().max(80), payroll: z.number(), payslip: z.number(), reason: z.string().max(300) })

/** One issued payslip as the dashboard returns it. Keys this app does not know are ignored. */
const issuedSchema = z
  .object({
    national_id: z.string().min(1).max(50),
    revision,
    template_id: z.uuid(),
    template_version: revision,
    rates: snapshotSchema.nullable(),
    lines: z.array(z.record(z.string(), z.unknown())).min(1).max(200),
    accepted_differences: z.array(differenceSchema).max(50),
    issued_at: z.string().max(40),
    issued_by_you: z.boolean(),
  })
  .transform((row) => ({
    nationalId: row.national_id,
    revision: row.revision,
    templateId: row.template_id,
    templateVersion: row.template_version,
    rates: row.rates,
    /** Exactly as stored. issuedLines.decodeLines decides whether it can be shown. */
    lines: row.lines as unknown[],
    acceptedDifferences: row.accepted_differences as AcceptedDifference[],
    issuedAt: row.issued_at,
    issuedByYou: row.issued_by_you,
  }))
export type IssuedPayslip = z.infer<typeof issuedSchema>

export type MonthLoad =
  | { ok: true; payslips: IssuedPayslip[]; company: HubCompany; role: HubRole | null }
  | { ok: false; failure: Failure }

/**
 * The latest revision of every payslip issued for a month. The dashboard asks its user first and
 * needs its password gate open, so this waits as long as the bridge does: no 15-second rule.
 */
export async function loadMonth(port: HubPort, brn: string, period: string): Promise<MonthLoad> {
  const answer = await ask(port, PAYSLIP_ISSUE, { action: 'load', period }, brn, issuedSchema, { timeoutMs: null, maxRows: MONTH_MAX_ROWS })
  if (!answer.ok) return answer
  // The answer must be about the month that was asked for.
  if (answer.period !== period) return { ok: false, failure: failure('bad-answer') }
  return { ok: true, payslips: answer.rows, company: answer.company, role: answer.role }
}

/** One payslip ready to be issued. `name` is for this app's own messages and is never sent. */
export interface PayslipToIssue {
  name: string
  nationalId: string
  /** The revision last seen for this employee and month in a load; 0 when there is none. */
  expectedRevision: number
  templateId: string
  templateVersion: number
  rates: RatesSnapshot | null
  lines: Record<string, unknown>[]
  acceptedDifferences: AcceptedDifference[]
}

/** One payslip as it is sent: every key present, and no other key. */
export function wirePayslip(payslip: PayslipToIssue): Record<string, unknown> {
  return {
    national_id: payslip.nationalId,
    expected_revision: payslip.expectedRevision,
    template_id: payslip.templateId,
    template_version: payslip.templateVersion,
    rates: payslip.rates,
    lines: payslip.lines,
    accepted_differences: payslip.acceptedDifferences,
  }
}

/** One message: one batch of a month, stored all or none. Kept as it is until its outcome is known. */
export interface PendingIssue {
  brn: string
  period: string
  payslips: PayslipToIssue[]
}

export function issueRow(pending: PendingIssue): Record<string, unknown> {
  return { action: 'issue', brn: pending.brn, period: pending.period, payslips: pending.payslips.map(wirePayslip) }
}

export type IssuePlan =
  /** A payslip over the dashboard's limit: nothing is sent, and nothing is trimmed. */
  | { ok: false; tooLarge: { name: string; bytes: number }[] }
  | { ok: true; batches: PayslipToIssue[][] }

/**
 * Checks the limits before sending, and splits a month that does not fit in one message into
 * batches. One batch is the normal case. Each batch is all or none by itself.
 */
export function planIssue(brn: string, period: string, payslips: readonly PayslipToIssue[]): IssuePlan {
  const sizes = payslips.map((payslip) => jsonBytes(wirePayslip(payslip)))
  const tooLarge = payslips.flatMap((payslip, index) => (sizes[index] > PAYSLIP_MAX_BYTES ? [{ name: payslip.name, bytes: sizes[index] }] : []))
  if (tooLarge.length > 0) return { ok: false, tooLarge }

  // What the message weighs around its payslips, with room to spare.
  const budget = MESSAGE_MAX_BYTES - jsonBytes([issueRow({ brn, period, payslips: [] })]) - 1_000
  const batches: PayslipToIssue[][] = [[]]
  let used = 0
  payslips.forEach((payslip, index) => {
    const size = sizes[index] + 1
    const current = batches[batches.length - 1]
    if (current.length > 0 && (current.length >= ISSUE_MAX_PAYSLIPS || used + size > budget)) {
      batches.push([])
      used = 0
    }
    batches[batches.length - 1].push(payslip)
    used += size
  })
  return { ok: true, batches }
}

const issuedResultSchema = z.object({
  period: month,
  issued: z.number().int().min(1),
  issued_at: z.string().max(40),
  payslips: z.array(z.object({ national_id: z.string(), revision })).min(1).max(ISSUE_MAX_PAYSLIPS),
})

/** An employee whose latest revision is not the one the app expected. */
export interface Moved {
  name: string
  revision: number
  issuedByYou: boolean
  issuedAt: string
}

/** How an issue ended. "locked": the dashboard's gate was closed and NOTHING was stored. */
export type IssueEnd = SaveEnd | 'locked'

export interface IssueOutcome {
  end: IssueEnd
  failure: Failure | null
  /** The employee at fault, named from the position the dashboard gave. Null when it gave none. */
  culprit: string | null
  /** After a reload: who is no longer at the revision the app expected. */
  moved: Moved[]
  /** The month as reloaded, or null when it was not (or could not be) reloaded. */
  month: IssuedPayslip[] | null
  /** When saved: the new revision of each payslip, by national ID. */
  revisions: Map<string, number> | null
}

const latestOf = (payslips: readonly IssuedPayslip[], nationalId: string) => payslips.find((found) => found.nationalId.trim() === nationalId.trim()) ?? null

/**
 * Did the issue go through? Looked up in a freshly loaded month. An issue is all or none, so:
 *  - nobody moved: it was NOT stored, and the same message may be sent again;
 *  - everybody is at expected + 1, issued by me, with the lines that were sent: it was stored;
 *  - anything else: someone else issued in between.
 */
export function judgeIssue(loaded: readonly IssuedPayslip[], pending: PendingIssue): { verdict: 'saved' | 'not-saved' | 'stale'; moved: Moved[] } {
  const moved: Moved[] = []
  let mine = true
  for (const payslip of pending.payslips) {
    const latest = latestOf(loaded, payslip.nationalId)
    const now = latest?.revision ?? 0
    if (now === payslip.expectedRevision) {
      mine = false
      continue
    }
    moved.push({ name: payslip.name, revision: now, issuedByYou: latest?.issuedByYou ?? false, issuedAt: latest?.issuedAt ?? '' })
    if (!latest || now !== payslip.expectedRevision + 1 || !latest.issuedByYou || canonicalJson(latest.lines) !== canonicalJson(payslip.lines)) mine = false
  }
  if (moved.length === 0) return { verdict: 'not-saved', moved }
  return { verdict: mine ? 'saved' : 'stale', moved: mine ? [] : moved }
}

const UNCONFIRMED =
  'The payslips may or may not have been issued, and the month could not be loaded to find out. Check again before issuing: the app will not send them twice.'
const NOT_ISSUED = 'Checked with the dashboard: nothing was issued, and nobody else issued these payslips. You can issue again.'

const none = { culprit: null, moved: [], month: null, revisions: null }
const revisionsOf = (pending: PendingIssue) => new Map(pending.payslips.map((payslip) => [payslip.nationalId, payslip.expectedRevision + 1]))

/**
 * The reload rule: loads the month again and compares. Called after an issue that got no answer
 * or "unavailable", and by "Check again". It never sends the issue itself. The load asks the
 * dashboard's user, so it can itself be declined or time out: then nothing is known yet.
 */
export async function checkIssue(port: HubPort, pending: PendingIssue, cause: Failure): Promise<IssueOutcome> {
  const loaded = await loadMonth(port, pending.brn, pending.period)
  if (!loaded.ok) return { ...none, end: 'unconfirmed', failure: { ...loaded.failure, detail: `${UNCONFIRMED} ${loaded.failure.detail}` } }
  const { verdict, moved } = judgeIssue(loaded.payslips, pending)
  if (verdict === 'saved') return { ...none, end: 'saved', failure: null, month: loaded.payslips, revisions: revisionsOf(pending) }
  if (verdict === 'stale') return { ...none, end: 'stale', failure: failure('stale'), moved, month: loaded.payslips }
  return { ...none, end: 'not-saved', failure: { ...cause, detail: NOT_ISSUED }, month: loaded.payslips }
}

/** Sends ONE batch, ONCE. On doubt it reloads and compares; "locked" means nothing was stored. */
export async function issueBatch(port: HubPort, pending: PendingIssue): Promise<IssueOutcome> {
  const sent = await sendSave(port, PAYSLIP_ISSUE, issueRow(pending), issuedResultSchema)
  if (sent.ok) {
    // The answer must be about exactly what was sent; otherwise it is not trusted.
    const expected = revisionsOf(pending)
    const agrees =
      sent.result.period === pending.period &&
      sent.result.payslips.length === pending.payslips.length &&
      sent.result.payslips.every((found) => expected.get(found.national_id.trim()) === found.revision)
    if (!agrees) return checkIssue(port, pending, failure('bad-answer'))
    return { ...none, end: 'saved', failure: null, revisions: expected }
  }
  if (sent.uncertain) return checkIssue(port, pending, sent.failure)

  const culprit = sent.failure.index === null ? null : (pending.payslips[sent.failure.index]?.name ?? null)
  if (sent.failure.kind === 'locked') return { ...none, end: 'locked', failure: sent.failure }
  if (sent.failure.kind === 'stale') {
    // Someone issued since the month was loaded. Load it again to show who moved.
    const loaded = await loadMonth(port, pending.brn, pending.period)
    const moved = loaded.ok ? judgeIssue(loaded.payslips, pending).moved : []
    return { ...none, end: 'stale', failure: sent.failure, culprit, moved, month: loaded.ok ? loaded.payslips : null }
  }
  return { ...none, end: 'refused', failure: sent.failure, culprit }
}
