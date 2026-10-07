// Statutory rates through the dashboard: load every version, save one new version, and the
// reload rule after a save nobody could confirm. Wire format: docs/INTEGRATION.md.

import { z } from 'zod'
import {
  ask,
  failure,
  sendSave,
  STATUTORY_RATES,
  type Failure,
  type HubCompany,
  type HubPort,
  type SaveEnd,
} from './hubWire'
import { DEFAULT_STATUTORY_RATES } from '../data/defaultStatutoryRates'
import { formatPeriod } from './dates'
import { highestRevision, ratesFor, sameRates, storedNote, type RatesInput, type RatesVersion } from './statutoryRates'

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)
const rate = z.number().min(0).max(100)
const amount = z.number().min(0)

/** One version as the dashboard sends it. Keys this app does not know are ignored, never used. */
const ratesRowSchema = z
  .object({
    effective_from: month,
    revision: z.number().int().min(1),
    nsf_employee_rate: rate,
    nsf_ceiling: amount,
    nsf_exempt_at_60: z.boolean(),
    csg_employee_rate_low: rate,
    csg_employee_rate_high: rate,
    csg_threshold: amount,
    source_note: z.string().max(300).nullish(),
    created_at: z.string().max(40),
    created_by_you: z.boolean(),
  })
  .transform(
    (row): RatesVersion => ({
      effectiveFrom: row.effective_from,
      revision: row.revision,
      nsfEmployeeRate: row.nsf_employee_rate,
      nsfCeiling: row.nsf_ceiling,
      nsfExemptAt60: row.nsf_exempt_at_60,
      csgEmployeeRateLow: row.csg_employee_rate_low,
      csgEmployeeRateHigh: row.csg_employee_rate_high,
      csgThreshold: row.csg_threshold,
      sourceNote: row.source_note ?? null,
      createdAt: row.created_at,
      createdByYou: row.created_by_you,
    }),
  )

const savedRatesSchema = z.object({ effective_from: month, revision: z.number().int().min(1) })

export type RatesLoad = { ok: true; versions: RatesVersion[]; company: HubCompany } | { ok: false; failure: Failure }

/** Every version of the company's rates. `expectedBrn` is the BRN of the payroll data open, or null. */
export async function loadRates(port: HubPort, expectedBrn: string | null): Promise<RatesLoad> {
  const answer = await ask(port, STATUTORY_RATES, {}, expectedBrn, ratesRowSchema)
  return answer.ok ? { ok: true, versions: answer.rows, company: answer.company } : answer
}

/** A save the user confirmed. Kept as it is until its outcome is known. */
export interface PendingRatesSave {
  /** The BRN of the company in the payroll data that is open. */
  brn: string
  input: RatesInput
  /** The highest revision the app had seen for the month when the user confirmed. */
  expectedRevision: number
}

export function pendingRatesSave(brn: string, input: RatesInput, versions: readonly RatesVersion[]): PendingRatesSave {
  return { brn, input, expectedRevision: highestRevision(versions, input.effectiveFrom) }
}

/** The one row of a rates save. No other key is accepted by the dashboard. */
export function ratesSaveRow(pending: PendingRatesSave): Record<string, unknown> {
  const { input } = pending
  const note = storedNote(input.sourceNote)
  return {
    brn: pending.brn,
    effective_from: input.effectiveFrom,
    expected_revision: pending.expectedRevision,
    nsf_employee_rate: input.nsfEmployeeRate,
    nsf_ceiling: input.nsfCeiling,
    nsf_exempt_at_60: input.nsfExemptAt60,
    csg_employee_rate_low: input.csgEmployeeRateLow,
    csg_employee_rate_high: input.csgEmployeeRateHigh,
    csg_threshold: input.csgThreshold,
    ...(note === null ? {} : { source_note: note }),
  }
}

export interface RatesOutcome {
  end: SaveEnd
  /** Null when saved. */
  failure: Failure | null
  /** The list as reloaded after the save, or null when it could not be reloaded. */
  versions: RatesVersion[] | null
  /** The version now in force for that month: the saved one, or the one someone else saved. */
  latest: RatesVersion | null
}

/**
 * Did the save go through? Looked up in a freshly loaded list:
 *  - the month is still at the expected revision: it was NOT stored;
 *  - it moved on by exactly one, holds exactly what was sent and is marked as mine: stored;
 *  - anything else: someone else saved in between.
 */
export function judgeRatesSave(versions: readonly RatesVersion[], pending: PendingRatesSave): 'saved' | 'not-saved' | 'stale' {
  const month = pending.input.effectiveFrom
  const highest = highestRevision(versions, month)
  if (highest === pending.expectedRevision) return 'not-saved'
  const latest = versions.find((v) => v.effectiveFrom === month && v.revision === highest)
  return highest === pending.expectedRevision + 1 && latest && latest.createdByYou === true && sameRates(latest, pending.input)
    ? 'saved'
    : 'stale'
}

function latestOf(versions: readonly RatesVersion[] | null, month: string): RatesVersion | null {
  if (!versions) return null
  const highest = highestRevision(versions, month)
  return versions.find((v) => v.effectiveFrom === month && v.revision === highest) ?? null
}

const UNCONFIRMED = 'The save may or may not have been stored, and the dashboard could not be asked. Check again before saving: the app will not send it twice.'

/**
 * The reload rule: asks for the rates again and compares the revision. Called after a save that
 * got no answer or "unavailable", and by "Check again". It never sends the save itself.
 */
export async function checkRatesSave(port: HubPort, pending: PendingRatesSave, cause: Failure): Promise<RatesOutcome> {
  const reloaded = await loadRates(port, pending.brn)
  if (!reloaded.ok) {
    return { end: 'unconfirmed', failure: { ...reloaded.failure, detail: `${UNCONFIRMED} ${reloaded.failure.detail}` }, versions: null, latest: null }
  }
  const verdict = judgeRatesSave(reloaded.versions, pending)
  const latest = latestOf(reloaded.versions, pending.input.effectiveFrom)
  if (verdict === 'saved') return { end: 'saved', failure: null, versions: reloaded.versions, latest }
  if (verdict === 'stale') return { end: 'stale', failure: failure('stale'), versions: reloaded.versions, latest }
  return {
    end: 'not-saved',
    failure: {
      ...cause,
      detail: 'Checked with the dashboard: the save was not stored, and nobody else changed these rates. You can save again.',
    },
    versions: reloaded.versions,
    latest,
  }
}

/** Sends the save ONCE, then follows the contract: reload on success, on "stale" and on doubt. */
export async function saveRates(port: HubPort, pending: PendingRatesSave): Promise<RatesOutcome> {
  const sent = await sendSave(port, STATUTORY_RATES, ratesSaveRow(pending), savedRatesSchema)
  if (!sent.ok && sent.uncertain) return checkRatesSave(port, pending, sent.failure)

  const reloaded = await loadRates(port, pending.brn)
  const versions = reloaded.ok ? reloaded.versions : null
  const latest = latestOf(versions, pending.input.effectiveFrom)
  if (sent.ok) return { end: 'saved', failure: null, versions, latest }
  const end: SaveEnd = sent.failure.kind === 'stale' ? 'stale' : sent.failure.kind === 'no-change' ? 'no-change' : 'refused'
  return { end, failure: sent.failure, versions, latest }
}

/** Where the app stands with the dashboard's rates. Opened on its own it never leaves "standalone". */
export type RatesState =
  | { status: 'standalone' }
  | { status: 'waiting' }
  | { status: 'loading' }
  | { status: 'loaded'; versions: RatesVersion[]; company: HubCompany }
  | { status: 'failed'; failure: Failure }

const NOT_CHECKED = 'so CSG and NSF were not cross-checked.'

/**
 * The versions the cross-check may use, and what to say when none is in force for the month.
 * Opened on its own, the app uses its bundled defaults. Inside the dashboard it uses ONLY what the
 * dashboard returned: with nothing loaded or nothing saved it says so, it never falls back.
 */
export function ratesForCrossCheck(state: RatesState, period: string): { versions: readonly RatesVersion[]; whyNone: string | null } {
  if (state.status === 'standalone') return { versions: DEFAULT_STATUTORY_RATES, whyNone: null }
  if (state.status === 'failed') {
    return { versions: [], whyNone: `The statutory rates could not be loaded from the dashboard (${state.failure.title.toLowerCase()}), ${NOT_CHECKED}` }
  }
  if (state.status !== 'loaded') {
    return { versions: [], whyNone: `The statutory rates have not been loaded from the dashboard yet, ${NOT_CHECKED}` }
  }
  if (state.versions.length === 0) {
    return { versions: [], whyNone: `The dashboard has no statutory rates saved for this company, ${NOT_CHECKED}` }
  }
  if (ratesFor(state.versions, period)) return { versions: state.versions, whyNone: null }
  const earliest = state.versions.reduce((first, v) => (v.effectiveFrom < first ? v.effectiveFrom : first), state.versions[0].effectiveFrom)
  return {
    versions: state.versions,
    whyNone: `The rates saved in the dashboard start in ${formatPeriod(earliest)}, after this pay month, ${NOT_CHECKED}`,
  }
}
