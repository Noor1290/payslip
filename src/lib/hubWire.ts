// Asking the Payroll Hub dashboard for settings (statutory rates, payslip templates) and saving
// them. The wire contract is docs/INTEGRATION.md, payslip section. The bridge file checks the
// sender's window and exact origin; this file validates every answer with Zod, checks that the
// answer is about the company the app expects, and turns each refusal into a clear message.
// Nothing here holds payroll figures, and nothing is written to browser storage.

import { z } from 'zod'

export const STATUTORY_RATES = 'statutory-rates'
export const PAYSLIP_TEMPLATE = 'payslip-template'
export const PAYSLIP_ISSUE = 'payslip-issue'

/** How long the app waits for an answer to a request before it says the dashboard did not answer. */
export const REQUEST_TIMEOUT_MS = 15_000
/** The bridge gives up on a save after 10 seconds; this is only a backstop behind it. */
export const SAVE_TIMEOUT_MS = 15_000

export type HubSend = (type: 'send-data' | 'request-data', payload: unknown) => Promise<unknown>

/** The way to the dashboard. In the app it is the bridge; in the tests it is a fake dashboard. */
export interface HubPort {
  send: HubSend
  requestTimeoutMs?: number
  saveTimeoutMs?: number
}

/** The refusal codes the dashboard uses for rates and templates. */
export const REFUSAL_CODES = [
  'stale',
  'no-change',
  'forbidden',
  'wrong-company',
  'invalid',
  'not-found',
  'too-large',
  'unavailable',
] as const
export type RefusalCode = (typeof REFUSAL_CODES)[number]

/**
 * Codes of the data types behind the password gate (issued payslips). None of them means
 * "maybe stored": after "locked" on a save NOTHING was stored, so the reload rule does not apply.
 */
export const GATE_CODES = ['locked', 'denied', 'timeout'] as const
export type GateCode = (typeof GATE_CODES)[number]

export type FailureKind =
  | RefusalCode
  | GateCode
  /** Nothing usable came back in time, or the refusal had no code this app knows. */
  | 'no-answer'
  /** The answer was not in the agreed format. */
  | 'bad-answer'
  /** The answer is about another company than the one whose payroll data is open. */
  | 'other-company'
  /** The answer does not say which company it is about. */
  | 'no-company-brn'

export interface Failure {
  kind: FailureKind
  /** What happened, in a few words. */
  title: string
  /** What it means and what to do next. */
  detail: string
  /** The dashboard's own sentence, when it sent one. It names fields, never values. */
  hubError: string | null
  /**
   * For a refused month of payslips: the position, from 0, of the payslip at fault in the list
   * that was sent. The dashboard never names the employee; the app does, from this position.
   */
  index: number | null
}

/** BRNs are compared the way the dashboard compares them. */
export function normaliseBrn(brn: string): string {
  return brn.trim().toUpperCase()
}

const TEXT: Record<FailureKind, { title: string; detail: string }> = {
  stale: {
    title: 'Someone saved a newer version first',
    detail: 'Nothing was overwritten and your change was not saved. The newer version is shown so you can make the change again.',
  },
  'no-change': {
    title: 'Nothing needed saving',
    detail: 'This is the same as what the dashboard already has.',
  },
  forbidden: {
    title: 'Only an admin of this company can save',
    detail: 'You are signed in to the dashboard as a member, so this is shown read-only. Ask an admin to make the change.',
  },
  'wrong-company': {
    title: 'The dashboard has another company selected',
    detail: 'Select the company of this payroll data in the dashboard, then try again.',
  },
  invalid: {
    title: 'The dashboard refused the data',
    detail: 'Correct what it names, then save again.',
  },
  'not-found': {
    title: 'The dashboard no longer has this',
    detail: 'Reload the list to see what the company has now.',
  },
  'too-large': {
    title: 'Too large, or the company has reached its limit',
    detail: 'Trying again cannot help. Make it smaller, or stay within the limit of 50 templates and 1,000 rates versions.',
  },
  unavailable: {
    title: 'The dashboard could not do this',
    detail: 'Check that you are signed in to the dashboard with a company selected, and that it is online.',
  },
  locked: {
    title: 'The dashboard is locked',
    detail: 'Nothing was stored. Confirm your password in the dashboard to unlock it, then do this again.',
  },
  denied: {
    title: 'The request was declined in the dashboard',
    detail: 'Nothing was sent to this app. Ask again when you are ready, and allow it in the dashboard.',
  },
  timeout: {
    title: 'Nobody answered the question in the dashboard',
    detail: 'The dashboard asks before it sends issued payslips. Ask again, then allow it there.',
  },
  'no-answer': {
    title: 'The dashboard did not answer',
    detail: 'Check that the dashboard is open and signed in, then check again.',
  },
  'bad-answer': {
    title: 'The dashboard gave an answer this app does not understand',
    detail: 'Nothing from that answer was used. The app and the dashboard may be on different versions.',
  },
  'other-company': {
    title: 'The dashboard answered for another company',
    detail: 'The answer was not used. Select the company of this payroll data in the dashboard, then check again.',
  },
  'no-company-brn': {
    title: "The dashboard's company has no BRN",
    detail: 'The app cannot tell which company the answer is about, so it was not used. Give the company its BRN in the dashboard.',
  },
}

export function failure(kind: FailureKind, hubError: string | null = null, index: number | null = null): Failure {
  return { kind, title: TEXT[kind].title, detail: TEXT[kind].detail, hubError, index }
}

const refusalSchema = z.object({
  ok: z.literal(false),
  error: z.string().max(400).optional(),
  code: z.string().max(40).optional(),
  index: z.number().int().min(0).max(100_000).optional(),
})

const isRefusalCode = (code: string | undefined): code is RefusalCode | GateCode =>
  code !== undefined && ([...REFUSAL_CODES, ...GATE_CODES] as readonly string[]).includes(code)

/** A refusal with no code (the bridge's own time-out, "not registered") counts as no answer. */
function failureOfRefusal(refusal: z.infer<typeof refusalSchema>): Failure {
  const hubError = refusal.error?.trim() || null
  return failure(isRefusalCode(refusal.code) ? refusal.code : 'no-answer', hubError, refusal.index ?? null)
}

const NO_ANSWER = Symbol('no answer')

function withTimeout(promise: Promise<unknown>, ms: number): Promise<unknown> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(NO_ANSWER), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(NO_ANSWER)
      },
    )
  })
}

export interface HubCompany {
  /** The company's name, as the dashboard labels it. */
  name: string
  brn: string
}

/** The signed-in user's role in the company the answer is about. A hint: the database decides. */
export type HubRole = 'admin' | 'member'

export type Answer<T> =
  | { ok: true; rows: T[]; company: HubCompany; role: HubRole | null; period: string | null }
  | { ok: false; failure: Failure }

export interface AskOptions {
  /** How long the app itself waits. Null: as long as the bridge does (the dashboard asks its user first). */
  timeoutMs?: number | null
  /** The most rows this kind of answer may have. */
  maxRows?: number
}

const answerSchema = z.object({
  ok: z.literal(true),
  dataType: z.string(),
  rows: z.array(z.unknown()).max(5_000),
  meta: z
    .object({
      label: z.string().max(120).optional(),
      brn: z.string().max(50).optional(),
      role: z.enum(['admin', 'member']).optional(),
      period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
    })
    .optional(),
})

/**
 * Asks the dashboard for rows. The answer is used only when it is in the agreed format AND names
 * the company the app expects (`expectedBrn`, the BRN of the payroll data that is open; null
 * when no payroll data is open, in which case the answer's own company is reported back).
 */
export async function ask<T>(
  port: HubPort,
  dataType: string,
  params: Record<string, unknown>,
  expectedBrn: string | null,
  rowSchema: z.ZodType<T>,
  options: AskOptions = {},
): Promise<Answer<T>> {
  const payload = { dataType, params: expectedBrn === null ? params : { ...params, brn: expectedBrn } }
  const asked = port.send('request-data', payload)
  const reply = options.timeoutMs === null ? await asked.catch(() => NO_ANSWER) : await withTimeout(asked, options.timeoutMs ?? port.requestTimeoutMs ?? REQUEST_TIMEOUT_MS)
  if (reply === NO_ANSWER) return { ok: false, failure: failure('no-answer') }

  const refusal = refusalSchema.safeParse(reply)
  if (refusal.success) return { ok: false, failure: failureOfRefusal(refusal.data) }

  const answer = answerSchema.safeParse(reply)
  if (!answer.success || answer.data.dataType !== dataType) return { ok: false, failure: failure('bad-answer') }
  if (answer.data.rows.length > (options.maxRows ?? 1_000)) return { ok: false, failure: failure('bad-answer') }

  const brn = answer.data.meta?.brn?.trim()
  if (!brn) return { ok: false, failure: failure('no-company-brn') }
  if (expectedBrn !== null && normaliseBrn(brn) !== normaliseBrn(expectedBrn)) {
    return { ok: false, failure: failure('other-company') }
  }

  const rows = z.array(rowSchema).safeParse(answer.data.rows)
  if (!rows.success) return { ok: false, failure: failure('bad-answer') }
  return {
    ok: true,
    rows: rows.data,
    company: { name: answer.data.meta?.label?.trim() ?? '', brn },
    role: answer.data.meta?.role ?? null,
    period: answer.data.meta?.period ?? null,
  }
}

export type Saved<R> =
  | { ok: true; result: R }
  /** `uncertain`: the save MAY have been stored. Reload and compare before saving again. */
  | { ok: false; failure: Failure; uncertain: boolean }

const savedSchema = z.object({ ok: z.literal(true), result: z.unknown() })

/** Kinds after which nobody knows whether the save was stored. */
const UNCERTAIN: readonly FailureKind[] = ['unavailable', 'no-answer', 'bad-answer']

/** Sends ONE command: exactly one row per message, and never a second time by itself. */
export async function sendSave<R>(
  port: HubPort,
  dataType: string,
  row: Record<string, unknown>,
  resultSchema: z.ZodType<R>,
): Promise<Saved<R>> {
  const reply = await withTimeout(port.send('send-data', { dataType, rows: [row] }), port.saveTimeoutMs ?? SAVE_TIMEOUT_MS)
  const fail = (found: Failure): Saved<R> => ({ ok: false, failure: found, uncertain: UNCERTAIN.includes(found.kind) })
  if (reply === NO_ANSWER) return fail(failure('no-answer'))

  const refusal = refusalSchema.safeParse(reply)
  if (refusal.success) return fail(failureOfRefusal(refusal.data))

  const saved = savedSchema.safeParse(reply)
  if (!saved.success) return fail(failure('bad-answer'))
  const result = resultSchema.safeParse(saved.data.result)
  if (!result.success) return fail(failure('bad-answer'))
  return { ok: true, result: result.data }
}

/** How a save ended, once the reload rule has been followed. */
export type SaveEnd =
  /** Stored. */
  | 'saved'
  /** Identical to what is stored: nothing to do, not an error. */
  | 'no-change'
  /** Someone else saved first. Nothing was overwritten. */
  | 'stale'
  /** Refused for a reason a retry cannot fix as it is (forbidden, wrong company, invalid...). */
  | 'refused'
  /** Reloaded and compared: the save was NOT stored. It may be sent again, unchanged. */
  | 'not-saved'
  /** Not known yet: the reload failed too. Only "Check again" is offered, never a resend. */
  | 'unconfirmed'

/** Bytes of a value once written as JSON: what crosses the bridge. */
export function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value) ?? '').length
}

/** JSON with object keys sorted, so two bodies can be compared whatever order their keys came in. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, inner]) => inner !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, inner]) => `${JSON.stringify(key)}:${canonicalJson(inner)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

/** The bridge, as a port. Only meaningful inside the dashboard's frame. */
export const bridgePort: HubPort = {
  send: (type, payload) => window.PayrollHubBridge.sendToDashboard(type, payload),
}
