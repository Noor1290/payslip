// Two fake months of ABC Co Ltd for the month review: August 2026 (issued through the app's own
// code, into the stand-in dashboard) and September 2026 (the month being reviewed).
//
// August differs from September on purpose:
//   DOE JANE            the same figures                              -> Unchanged
//   PALMYRE JEAN MARC   Basic Salary 18,365 then, 19,480 now          -> Changed
//   SAMPLE ALEX         Travelling 1,200.01 then, 1,200 now (one cent) -> Changed
//   TESTER SAM          the same figures; "TESTER SAMUEL" then        -> Unchanged, with a note
//   EXEMPLE PRIYA       not in August                                 -> New
//   FICTIF MARIE        the same figures; a date of employment then   -> Unchanged, with a note
//   TEMPO LEA           the same figures                              -> Unchanged
//   ANCIEN PAUL         in August only                                -> Left
import { DEFAULT_STATUTORY_RATES } from '../src/data/defaultStatutoryRates'
import { preparePayslips, type PreparedPayslip } from '../src/lib/build'
import type { HubPort } from '../src/lib/hubWire'
import { buildIssue } from '../src/lib/issueBuild'
import { issueBatch, loadMonth, ratesSnapshot, type IssuedPayslip, type RatesSnapshot } from '../src/lib/issueStore'
import { currentPayslips, type CurrentPayslip, type TemplateRef } from '../src/lib/monthCompare'
import type { ImportedPayroll } from '../src/lib/payrollFile'
import type { AcceptedChecks } from '../src/lib/payslip'
import { checkKey, ROUNDING_REASON, withReason, type Reasons } from '../src/lib/reasons'
import { ratesFor, type RatesVersion } from '../src/lib/statutoryRates'
import { BUILT_IN_BODY, templateOf, type TemplateBody } from '../src/lib/templateBody'
import { addLine, setLineLabel } from '../src/lib/templateEdit'
import type { TemplateChoice } from '../src/lib/templateUse'
import { BRN, fakeHub } from './fakeHubPort'
import { loadFixture } from './helpers'
import type { FakeHub } from '../scripts/lib/fake-hub.mjs'

export const PERIOD = '2026-09'
export const LAST_PERIOD = '2026-08'
export const AUGUST_FIXTURE = 'ABC Co Ltd-pdf-fill-2026-08.json'
export const TEMPLATE_ID = '20000000-0000-4000-8000-000000000001'
export const TEMPLATE_B_ID = '20000000-0000-4000-8000-000000000002'

export interface Published {
  id: string
  name: string
  version: number
  body: TemplateBody
}

export const V1: Published = { id: TEMPLATE_ID, name: 'Monthly payslip', version: 1, body: BUILT_IN_BODY }
/** Version 2 of the same template: one label reworded. Every line keeps its id. */
export const V2_RENAMED: Published = { ...V1, version: 2, body: setLineLabel(BUILT_IN_BODY, 'transport', 'Travelling allowance') }
/** Version 3: the reworded label, and one more earnings line that last month did not have. */
export const V3_ADDED: Published = {
  ...V1,
  version: 3,
  body: setLineLabel(addLine(V2_RENAMED.body, { side: 'earnings' }, 'line-night'), 'line-night', 'Night shift'),
}

/**
 * ANOTHER template with the same lines under other ids. Its "allowances" id holds the line called
 * Transport Allowance and its "transport" id the line called Allowances, and two labels differ in
 * capitals and spaces only. Matched by label it is the same payslip; matched by id it is not.
 */
function otherTemplateBody(): TemplateBody {
  const relabel: Record<string, string> = { basic: 'basic  SALARY', allowances: 'Transport Allowance', transport: 'Allowances', paye: ' paye ' }
  const body: TemplateBody = JSON.parse(JSON.stringify(BUILT_IN_BODY))
  const rename = (line: { id: string; label: string }) => ({ ...line, label: relabel[line.id] ?? line.label })
  body.earnings = body.earnings.map(rename)
  body.deductionGroups = body.deductionGroups.map((group) => ({ ...group, lines: group.lines.map(rename) }))
  body.mapping.lines = { ...body.mapping.lines, allowances: BUILT_IN_BODY.mapping.lines.transport, transport: BUILT_IN_BODY.mapping.lines.allowances }
  return body
}
export const OTHER: Published = { id: TEMPLATE_B_ID, name: 'Payslip B', version: 1, body: otherTemplateBody() }

export interface Month {
  period: string
  data: ImportedPayroll
  prepared: PreparedPayslip[]
  accepted: Record<number, AcceptedChecks>
  reasons: Reasons
  choice: TemplateChoice
  template: TemplateRef
  rates: RatesVersion | null
}

/** A month of payslips built by the app's own code from a payroll fixture, every rounding difference accepted. */
export function monthOf(period: string, published: Published = V1, fixture?: string): Month {
  return monthFrom(loadFixture(fixture), period, published)
}

/** The same, from payroll data already in hand (a fixture with one figure changed, say). */
export function monthFrom(data: ImportedPayroll, period: string, published: Published = V1): Month {
  const { template, mapping } = templateOf(published.body, { id: published.id, name: published.name, version: `v${published.version}` })
  const prepared = preparePayslips(data, { template, mapping, rateVersions: DEFAULT_STATUTORY_RATES, period }, `${period}-28`)
  const accepted: Record<number, AcceptedChecks> = {}
  let reasons: Reasons = {}
  for (const { computation } of prepared) {
    for (const check of computation.checks) {
      if (check.kind !== 'rounding') continue
      accepted[computation.rowIndex] = { ...accepted[computation.rowIndex], [check.id]: check.diffCents! }
      reasons = withReason(reasons, computation.rowIndex, checkKey(check.id), ROUNDING_REASON)
    }
  }
  return {
    period,
    data,
    prepared,
    accepted,
    reasons,
    choice: { kind: 'published', templateId: published.id, name: published.name, version: published.version, body: published.body },
    template: { id: published.id, version: `v${published.version}` },
    rates: ratesFor(DEFAULT_STATUTORY_RATES, period),
  }
}

export const september = (published: Published = V1): Month => monthOf(PERIOD, published)
export const august = (published: Published = V1): Month => monthOf(LAST_PERIOD, published, AUGUST_FIXTURE)

/** This month as the review sees it. */
export function current(month: Month, rates: RatesSnapshot | null = ratesSnapshot(month.rates)): CurrentPayslip[] {
  return currentPayslips(month.data, month.prepared, month.template, rates)
}

/** A stand-in dashboard that has every template version above published. */
export function dashboard(): { hub: FakeHub; port: HubPort; sent: () => string[] } {
  const made = fakeHub()
  for (const published of [V1, V2_RENAMED, V3_ADDED, OTHER]) {
    if (!made.hub.state.templates.some((found) => found.id === published.id)) {
      made.hub.state.templates.push({ id: published.id, name: published.name, body: { ...published.body }, revision: 1, updatedAt: '2026-08-20T09:00:00+04:00', by: 'you' })
    }
    made.hub.state.versions.push({ templateId: published.id, version: published.version, name: published.name, body: { ...published.body }, publishedAt: '2026-08-20T09:05:00+04:00', by: 'you' })
  }
  return made
}

/** Issues a month into the dashboard, everyone selected, exactly as the Payslips page would. */
export async function issue(port: HubPort, month: Month, selected?: number[]): Promise<void> {
  const loaded = await loadMonth(port, BRN, month.period)
  if (!loaded.ok) throw new Error(loaded.failure.title)
  const built = buildIssue({
    data: month.data,
    period: month.period,
    prepared: month.prepared,
    selected: selected ?? month.data.rows.map((_, index) => index),
    accepted: month.accepted,
    reasons: month.reasons,
    choice: month.choice,
    previewingDraft: false,
    rates: month.rates,
    month: loaded.payslips,
  })
  if (!built.ok) throw new Error(built.problems.join(' '))
  const outcome = await issueBatch(port, { brn: BRN, period: month.period, payslips: built.payslips })
  if (outcome.end !== 'saved') throw new Error(`The fake month was not issued: ${outcome.end}`)
}

/** August 2026 as the dashboard returns it after it was issued with a template version. */
export async function issuedAugust(published: Published = V1): Promise<IssuedPayslip[]> {
  const { port } = dashboard()
  await issue(port, august(published))
  const loaded = await loadMonth(port, BRN, LAST_PERIOD)
  if (!loaded.ok) throw new Error(loaded.failure.title)
  return loaded.payslips
}
