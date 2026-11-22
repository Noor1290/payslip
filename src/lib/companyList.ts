// The companies this app is used for: "company-list" (docs/INTEGRATION.md in the payroll_hub
// repo, migration 0024). Read only: the dashboard keeps the lists and shows its own picker. The
// Payslip app has one list, "payslips".
// Names and BRNs only, no employee and no figure. A convenience only: a company that is not on
// the list still opens; nobody's access changes.

import { z } from 'zod'
import { ask, failure, normaliseBrn, type Failure, type HubPort } from './hubWire'

export const COMPANY_LIST = 'company-list'
export const PAYSLIP_LISTS = ['payslips'] as const

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)

const rowSchema = z.object({
  company_id: z.uuid(),
  brn: z.string().max(50),
  name: z.string().max(120),
  admin: z.boolean(),
  selected: z.boolean(),
  lists: z.array(z.enum(PAYSLIP_LISTS)).max(1),
  open: z.literal(true).optional(),
  open_period: month.optional(),
})
export type ListedCompany = z.infer<typeof rowSchema>

export type CompanyList =
  | {
      ok: true
      companies: ListedCompany[]
      /** The company selected in the dashboard. */
      selected: ListedCompany
      /** Set right after a card was tapped: go straight to that company, in that month. */
      open: { period: string | null } | null
    }
  /** A dashboard from before the lists (no "company-list"): the app works as it did. */
  | { ok: false; legacy: true }
  | { ok: false; legacy: false; failure: Failure }

/** Whether a company is on this app's page. */
export const isListed = (company: Pick<ListedCompany, 'lists'>) => company.lists.length > 0

/** Every company of the user, whether it is on the Payslip list, the selected one marked. */
export async function loadCompanyList(port: HubPort): Promise<CompanyList> {
  const answer = await ask(port, COMPANY_LIST, { action: 'companies' }, null, rowSchema, { maxRows: 500 })
  if (!answer.ok) {
    const legacy = answer.failure.kind === 'no-answer' && /not registered/i.test(answer.failure.hubError ?? '')
    return legacy ? { ok: false, legacy: true } : { ok: false, legacy: false, failure: answer.failure }
  }
  const selected = answer.rows.filter((row) => row.selected)
  // The dashboard names the selected company in meta; it must be the one marked in the rows.
  if (selected.length !== 1 || normaliseBrn(selected[0].brn) !== normaliseBrn(answer.company.brn)) {
    return { ok: false, legacy: false, failure: failure('bad-answer') }
  }
  const one = selected[0]
  return { ok: true, companies: answer.rows, selected: one, open: one.open ? { period: one.open_period ?? null } : null }
}

/** Shows the dashboard's company picker. When a change is saved there, this app is reloaded. */
export async function openPicker(port: HubPort, selectedBrn: string): Promise<Failure | null> {
  const answer = await ask(port, COMPANY_LIST, { action: 'open-picker' }, selectedBrn, z.never(), { maxRows: 0 })
  return answer.ok ? null : answer.failure
}

const openedSchema = z.object({ switched: z.boolean() })

export type Opened = { ok: true; switched: boolean } | { ok: false; failure: Failure }

/**
 * Opens a company: the dashboard selects it (this app is then reloaded and goes straight to it,
 * in `period`), or says it is selected already (`switched: false`), and the app opens it itself.
 */
export async function openCompany(port: HubPort, selectedBrn: string, companyId: string, period: string): Promise<Opened> {
  const answer = await ask(port, COMPANY_LIST, { action: 'open-company', company_id: companyId, period }, selectedBrn, openedSchema, { maxRows: 1 })
  if (!answer.ok) return answer
  if (answer.rows.length !== 1) return { ok: false, failure: failure('bad-answer') }
  return { ok: true, switched: answer.rows[0].switched }
}
