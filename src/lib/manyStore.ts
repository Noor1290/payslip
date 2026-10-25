// Payslips for several companies: the dashboard's side, "payslip-batch" (docs/INTEGRATION.md).
// Download only: nothing is saved through it. The dashboard lists only the companies where the
// user is an admin, asks its user ONCE (password gate open) for the month and the companies, and
// then answers one company at a time: its saved run of that month, the template its payslips
// use and its statutory rates. The rows are per-employee data: memory only, never stored.

import { z } from 'zod'
import { ask, failure, normaliseBrn, type Failure, type HubPort } from './hubWire'
import { issuedSchema, type IssuedPayslip } from './issueStore'
import { ratesRowSchema } from './ratesStore'
import type { RatesVersion } from './statutoryRates'

export const PAYSLIP_BATCH = 'payslip-batch'
/** The most companies one ask names; more are asked for as "all my companies". */
export const ASK_MAX_COMPANIES = 100
/** A company's run can be large: the app gives the dashboard this long to answer for one company. */
const LOAD_TIMEOUT_MS = 60_000

const brn = z.string().min(1).max(50)
const companyName = z.string().max(120)
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)

const companySchema = z.object({ brn, name: companyName, selected: z.boolean() })
export type BatchCompany = z.infer<typeof companySchema>

export type CompaniesAnswer = { ok: true; companies: BatchCompany[]; selectedBrn: string } | { ok: false; failure: Failure }

/** The companies where the user is an admin, the one selected in the dashboard first. Names only. */
export async function listCompanies(port: HubPort): Promise<CompaniesAnswer> {
  const answer = await ask(port, PAYSLIP_BATCH, { action: 'companies' }, null, companySchema, { maxRows: 5_000 })
  if (!answer.ok) return answer
  const selected = answer.rows.filter((row) => row.selected)
  // The dashboard names the selected company in meta; it must be the one marked in the rows.
  if (selected.length > 1 || (selected.length === 1 && normaliseBrn(selected[0].brn) !== normaliseBrn(answer.company.brn))) {
    return { ok: false, failure: failure('bad-answer') }
  }
  return { ok: true, companies: answer.rows, selectedBrn: answer.company.brn }
}

const grantedSchema = z.object({ brn, name: companyName })
export type Allowed = { ok: true; companies: z.infer<typeof grantedSchema>[] } | { ok: false; failure: Failure }

/**
 * Asks the dashboard's user, once, to allow that month for those companies. With more than 100
 * chosen, or every one, it asks for all of the user's admin companies; only those chosen are
 * loaded. Waits as long as the dashboard asks its user (up to two minutes).
 */
export async function askForCompanies(
  port: HubPort,
  selectedBrn: string,
  period: string,
  chosen: readonly string[],
  everyCompany: boolean,
): Promise<Allowed> {
  const all = everyCompany || chosen.length > ASK_MAX_COMPANIES
  const params = all ? { action: 'ask', period, all: true } : { action: 'ask', period, companies: [...chosen] }
  const answer = await ask(port, PAYSLIP_BATCH, params, selectedBrn, grantedSchema, { timeoutMs: null, maxRows: 5_000 })
  if (!answer.ok) return answer
  if (answer.period !== period) return { ok: false, failure: failure('bad-answer') }
  return { ok: true, companies: answer.rows }
}

const bundleSchema = z
  .object({
    brn,
    company: companyName,
    period: month,
    run: z.boolean(),
    employees: z.array(z.record(z.string(), z.unknown())).max(10_000),
    template: z
      .object({ template_id: z.uuid(), name: z.string().min(1).max(200), version: z.number().int().min(1), body: z.record(z.string(), z.unknown()) })
      .nullable(),
    template_reason: z.enum(['none', 'several']).nullable(),
    rates: z.array(ratesRowSchema).max(1_000),
    /** The payslips already issued for the month, the latest revision of each. */
    issued: z.array(issuedSchema).max(10_000),
  })
  .transform((row) => ({
    brn: row.brn,
    company: row.company,
    period: row.period,
    run: row.run,
    employees: row.employees,
    template: row.template && { templateId: row.template.template_id, name: row.template.name, version: row.template.version, body: row.template.body as unknown },
    templateReason: row.template_reason,
    rates: row.rates as RatesVersion[],
    issued: row.issued as IssuedPayslip[],
  }))
/** One company, as the dashboard sends it for the batch. */
export type CompanyBundle = z.infer<typeof bundleSchema>

export type Loaded = { ok: true; bundle: CompanyBundle } | { ok: false; failure: Failure }

/** One company's run of the month, with its template and rates. Only after the user allowed it. */
export async function loadCompany(port: HubPort, selectedBrn: string, period: string, companyBrn: string): Promise<Loaded> {
  const answer = await ask(port, PAYSLIP_BATCH, { action: 'load', period, company_brn: companyBrn }, selectedBrn, bundleSchema, {
    maxRows: 1,
    timeoutMs: LOAD_TIMEOUT_MS,
  })
  if (!answer.ok) return answer
  const [bundle] = answer.rows
  // One row, about the company asked for and the month asked for: anything else is not used.
  if (answer.rows.length !== 1 || normaliseBrn(bundle.brn) !== normaliseBrn(companyBrn) || bundle.period !== period) {
    return { ok: false, failure: failure('bad-answer') }
  }
  return { ok: true, bundle }
}
