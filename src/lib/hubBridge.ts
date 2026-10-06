// What the app does with messages from the Payroll Hub dashboard. The bridge file itself
// (src/payrollHubBridge.js) checks the sender's window and exact origin; this file validates the
// content with Zod and then hands the rows to the SAME import a file goes through.
// Nothing here writes to browser storage: received data lives in React state only.

import { z } from 'zod'
import { formatPeriod } from './dates'
import { importPayrollRows, type ImportError, type ImportedPayroll } from './payrollFile'

export const HUB_APP_ID = 'payslip'
export const PAYROLL_RESULT = 'payroll-result'

const periodSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)

const payloadSchema = z.object({
  dataType: z.string(),
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(10_000),
  meta: z.object({ period: periodSchema.optional(), label: z.string().max(120).optional() }).optional(),
})

const refusalSchema = z.object({ ok: z.literal(false), error: z.string(), code: z.string().optional() })

function summarise(errors: ImportError[]): string {
  const first = errors[0]?.message ?? 'The data could not be used.'
  return errors.length > 1 ? `${first} (and ${errors.length - 1} more)` : first
}

/**
 * Validates a payload from the dashboard and imports its rows.
 * Throws an Error whose message is safe to show here and on the dashboard, which reports it as
 * "Not delivered: <message>". The messages never contain an ID or a figure.
 */
export function readHubPayload(payload: unknown): ImportedPayroll {
  const parsed = payloadSchema.safeParse(payload)
  if (!parsed.success) throw new Error('The data was not in the expected format.')
  if (parsed.data.dataType !== PAYROLL_RESULT) throw new Error('This app can only use payroll results.')
  const result = importPayrollRows(parsed.data.rows, { period: parsed.data.meta?.period })
  if (!result.ok) throw new Error(summarise(result.errors))
  return result.data
}

export type HubReplyResult = { ok: true; data: ImportedPayroll } | { ok: false; error: string }

/** Reads the dashboard's answer to "Get from dashboard". */
export function readHubReply(reply: unknown): HubReplyResult {
  const refusal = refusalSchema.safeParse(reply)
  if (refusal.success) {
    const hint = refusal.data.code === 'locked' ? ' Unlock the dashboard, then try again.' : ''
    return { ok: false, error: `Nothing received: ${refusal.data.error}${hint}` }
  }
  if (typeof reply !== 'object' || reply === null || (reply as { ok?: unknown }).ok !== true) {
    return { ok: false, error: 'Nothing received: The dashboard gave an answer this app does not understand.' }
  }
  try {
    return { ok: true, data: readHubPayload(reply) }
  } catch (error) {
    return { ok: false, error: `Nothing received: ${error instanceof Error ? error.message : 'The data could not be used.'}` }
  }
}

export type MergeResult = { ok: true; data: ImportedPayroll } | { ok: false; reason: string }

/**
 * "Add to" the data already open. Only employees of the same company and the same pay month can
 * be added, and nobody twice. Otherwise the reason is returned and nothing is merged.
 */
export function mergePayroll(existing: ImportedPayroll, existingPeriod: string, incoming: ImportedPayroll): MergeResult {
  if (incoming.company.brn !== existing.company.brn || incoming.company.name !== existing.company.name) {
    return { ok: false, reason: `The new data is for another company (${incoming.company.name}).` }
  }
  if (incoming.period === null) {
    return { ok: false, reason: 'The new data does not say which month it is for.' }
  }
  if (incoming.period !== existingPeriod) {
    return { ok: false, reason: `The new data is for another month (${formatPeriod(incoming.period)}).` }
  }
  const known = new Set(existing.rows.map((row) => row.ID))
  const repeated = incoming.rows.filter((row) => known.has(row.ID)).length
  if (repeated > 0) {
    return {
      ok: false,
      reason:
        repeated === incoming.rows.length
          ? 'All of these employees are already in the list.'
          : `${repeated} of these employees are already in the list.`,
    }
  }
  const keys = [...existing.keys, ...incoming.keys.filter((key) => !existing.keys.includes(key))]
  return {
    ok: true,
    data: { rows: [...existing.rows, ...incoming.rows], keys, company: existing.company, period: existingPeriod, fileName: null },
  }
}
