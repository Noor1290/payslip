// Publishing a template to several companies, and saving which template the payslips use
// (dashboard migration 0018). Against the fake dashboard, which follows docs/INTEGRATION.md.
// The dashboard and its database decide who may be chosen; their own tests prove that a member
// or a stranger is refused even when the app is bypassed. Fake data only.
import { beforeEach, describe, expect, it } from 'vitest'
import type { FakeHub } from '../scripts/lib/fake-hub.mjs'
import type { HubPort } from '../src/lib/hubWire'
import {
  checkCompanies,
  columnsUsed,
  copyRow,
  initialTicks,
  planCompanies,
  publishCopy,
  CHECK_PAGE,
  publishToCompanies,
  saveTemplateInUse,
  sendPublishSummary,
  type CompanyPlan,
} from '../src/lib/publishMany'
import { BUILT_IN_BODY, type TemplateBody } from '../src/lib/templateBody'
import { setLineKey } from '../src/lib/templateEdit'
import { listTemplates } from '../src/lib/templateStore'
import { BRN, fakeHub } from './fakeHubPort'

/** The built-in lines, with Presence Bonus filled from the company column of that name. */
const BODY: TemplateBody = setLineKey(BUILT_IN_BODY, 'presenceBonus', 'Presence Bonus')
const OTHER_BODY: TemplateBody = { ...BUILT_IN_BODY, labels: { ...BUILT_IN_BODY.labels, title: 'Pay advice' } }

/** The keys "Get from dashboard" gives a run's rows, for a company with the Presence Bonus column. */
const COLUMNS = ['ID', 'Surname', 'Basic Salary', 'Govt Increment', 'Allowances', 'Travelling', 'Gross Pay', 'Employee CSG', 'Employee NSF', 'PAYE', 'Total deductions', 'Net Pay']
const WITH_BONUS = [...COLUMNS, 'Presence Bonus']

type Other = FakeHub['state']['others'][number]
const other = (name: string, brn: string, more: Partial<Other> = {}): Other => ({
  name,
  brn,
  role: 'admin',
  templates: [],
  versions: [],
  inUse: null,
  payroll: { period: '2026-09', employees: 4, columns: WITH_BONUS },
  ...more,
})

let hub: FakeHub
let port: HubPort
let sent: () => string[]

/** ABC (selected) has "Monthly payslip", draft 1, published as version 1. */
function seed() {
  hub.state.runs['2026-09'] = [Object.fromEntries(WITH_BONUS.map((key) => [key, key === 'ID' ? 'X1' : key === 'Surname' ? 'DOE' : 0]))]
  hub.state.templates.push({ id: '20000000-0000-4000-8000-000000000001', name: 'Monthly payslip', body: BODY, revision: 1, updatedAt: '2026-10-01T09:00:00+04:00', by: 'you' })
  hub.state.versions.push({ templateId: '20000000-0000-4000-8000-000000000001', version: 1, name: 'Monthly payslip', body: BODY, publishedAt: '2026-10-01T09:05:00+04:00', by: 'you' })
  hub.state.ids = 1
}

beforeEach(() => {
  ;({ hub, port, sent } = fakeHub())
  seed()
})

const SELF = { name: 'Monthly payslip', body: BODY, draftRevision: 1, publishedVersion: 1 }

async function plansFor(): Promise<CompanyPlan[]> {
  const checked = await checkCompanies(port, BRN, 'Monthly payslip')
  if (!checked.ok) throw new Error(checked.failure.title)
  return planCompanies(checked.companies, SELF)
}

describe('the messages', () => {
  it('the check names the template and carries the BRN; nothing else', async () => {
    await checkCompanies(port, BRN, '  Monthly payslip ')
    expect(hub.state.log.at(-1)!.payload).toEqual({ dataType: 'payslip-template', params: { action: 'check', name: 'Monthly payslip', page: 0, brn: BRN } })
  })

  it('publishing to one company is one row with that company and what was seen there', () => {
    expect(copyRow({ brn: BRN, companyBrn: 'C3333333', name: ' Monthly payslip ', body: BODY, expectedRevision: 2, publishedBefore: 1 })).toEqual({
      action: 'publish-copy',
      brn: BRN,
      company_brn: 'C3333333',
      name: 'Monthly payslip',
      body: BODY,
      expected_revision: 2,
    })
  })

  it('the choice of template is one row with the template and its version, or both null', async () => {
    expect(await saveTemplateInUse(port, BRN, '20000000-0000-4000-8000-000000000001', 1)).toEqual({ ok: true })
    expect(hub.state.log.at(-1)!.payload).toEqual({
      dataType: 'payslip-template',
      rows: [{ action: 'use', brn: BRN, template_id: '20000000-0000-4000-8000-000000000001', version: 1 }],
    })
    expect(hub.state.inUse).toEqual({ templateId: '20000000-0000-4000-8000-000000000001', version: 1 })
    expect(await saveTemplateInUse(port, BRN, null, null)).toEqual({ ok: true })
    expect(hub.state.inUse).toBeNull()
  })

  it('a member cannot save the choice: the dashboard refuses it', async () => {
    hub.state.role = 'viewer'
    expect(await saveTemplateInUse(port, BRN, '20000000-0000-4000-8000-000000000001', 1)).toMatchObject({ ok: false, failure: { kind: 'forbidden' } })
    expect(hub.state.inUse).toBeNull()
  })

  it('the list says which version is used for the payslips', async () => {
    hub.state.inUse = { templateId: '20000000-0000-4000-8000-000000000001', version: 1 }
    const list = await listTemplates(port, BRN)
    expect(list).toMatchObject({ ok: true, value: [{ inUseVersion: 1 }] })
  })

  it('a list from a dashboard without migration 0018 (no in_use_version) still reads, with nothing in use', async () => {
    const answer = hub.handle('request-data', { dataType: 'payslip-template', params: { action: 'list', brn: BRN } }) as { rows: Record<string, unknown>[] }
    for (const row of answer.rows) delete row.in_use_version
    const list = await listTemplates({ send: async () => answer }, BRN)
    expect(list).toMatchObject({ ok: true, value: [{ inUseVersion: null }] })
  })
})

describe('the check and what is ticked at first', () => {
  it('lists only the companies the dashboard sends: the ones where I am an admin, this company first', async () => {
    hub.state.others.push(other('DEF Ltd', 'C3333333'), other('XYZ Trading Ltd', 'C2222222', { role: 'member' }), other('AQUAVILLE WONDER LTD', 'C4444444'))
    const plans = await plansFor()
    expect(plans.map((plan) => [plan.company, plan.thisCompany])).toEqual([
      ['ABC Co Ltd', true],
      ['AQUAVILLE WONDER LTD', false],
      ['DEF Ltd', false],
    ])
  })

  it('a company whose payroll lacks a column the lines use is unticked, with the column named', async () => {
    hub.state.others.push(other('DEF Ltd', 'C3333333', { payroll: { period: '2026-09', employees: 4, columns: COLUMNS } }))
    const [, def] = await plansFor()
    expect(def.reasons).toEqual(['Its payroll of September 2026 has no column "Presence Bonus"'])
    expect(initialTicks([def], 'all').has('C3333333')).toBe(false)
  })

  it('names every missing column once, and accepts an old column name the line also takes', async () => {
    const columns = [...COLUMNS.filter((key) => key !== 'Employee CSG' && key !== 'PAYE'), 'CSG - 1.5 %/ 3%']
    hub.state.others.push(other('DEF Ltd', 'C3333333', { payroll: { period: '2026-08', employees: 2, columns } }))
    const [, def] = await plansFor()
    expect(def.reasons).toEqual(['Its payroll of August 2026 has no columns "Presence Bonus", "PAYE"'])
  })

  it('a company with no saved payroll yet is unticked, with the reason', async () => {
    hub.state.others.push(other('DEF Ltd', 'C3333333', { payroll: null }))
    const [, def] = await plansFor()
    expect(def.reasons).toEqual(['No saved payroll yet to check the columns against'])
  })

  it('a company whose draft of that template holds unpublished changes is unticked, with the reason', async () => {
    hub.state.others.push(
      other('DEF Ltd', 'C3333333', {
        templates: [{ id: '20000000-0000-4000-8000-000000000101', name: 'MONTHLY PAYSLIP', body: OTHER_BODY, revision: 3, updatedAt: '', by: 'other' }],
        versions: [{ templateId: '20000000-0000-4000-8000-000000000101', version: 2, name: 'MONTHLY PAYSLIP', body: { ...OTHER_BODY, labels: { ...OTHER_BODY.labels, title: 'Old' } }, publishedAt: '', by: 'other' }],
      }),
    )
    const [, def] = await plansFor()
    expect(def.reasons).toEqual(['Its draft of "MONTHLY PAYSLIP" has changes that were never published; publishing replaces them'])
    expect(def).toMatchObject({ what: 'New version 3 of "MONTHLY PAYSLIP"', expectedRevision: 3, publishedBefore: 2 })
  })

  it('says what happens: a new version where the name exists, a new template elsewhere', async () => {
    // This company's draft was changed and saved since version 1.
    Object.assign(hub.state.templates[0], { body: OTHER_BODY, revision: 2 })
    hub.state.others.push(other('DEF Ltd', 'C3333333'))
    const checked = await checkCompanies(port, BRN, 'Monthly payslip')
    if (!checked.ok) throw new Error(checked.failure.title)
    const [abc, def] = planCompanies(checked.companies, { ...SELF, body: OTHER_BODY, draftRevision: 2 })
    expect(abc).toMatchObject({ what: 'New version 2 of "Monthly payslip"', expectedRevision: 2, publishedBefore: 1, reasons: [] })
    expect(def).toMatchObject({ what: 'New template "Monthly payslip", version 1', expectedRevision: 0, publishedBefore: null, reasons: [] })
  })

  it('says when a company already has exactly this as its latest version: nothing new is published there', async () => {
    hub.state.others.push(
      other('DEF Ltd', 'C3333333', {
        templates: [{ id: '20000000-0000-4000-8000-000000000101', name: 'Monthly payslip', body: BODY, revision: 4, updatedAt: '', by: 'other' }],
        versions: [{ templateId: '20000000-0000-4000-8000-000000000101', version: 3, name: 'Monthly payslip', body: BODY, publishedAt: '', by: 'other' }],
      }),
    )
    const [abc, def] = await plansFor()
    expect(abc.what).toBe('Already has this as version 1; it becomes the one used for the payslips')
    expect(def.what).toBe('Already has this as version 3; it becomes the one used for the payslips')
    expect(def.reasons).toEqual([])
  })

  it('"All my companies" ticks every ready company; "Selected companies" only this one; this company always', async () => {
    hub.state.others.push(other('DEF Ltd', 'C3333333'), other('GHI Ltd', 'C5555555', { payroll: null }))
    const plans = await plansFor()
    expect([...initialTicks(plans, 'all')]).toEqual([BRN, 'C3333333'])
    expect([...initialTicks(plans, 'selected')]).toEqual([BRN])
  })

  it('a company at 50 templates without one of that name cannot be ticked at all', async () => {
    const fifty = Array.from({ length: 50 }, (_, n) => ({ id: `20000000-0000-4000-8000-${String(200 + n).padStart(12, '0')}`, name: `T${n}`, body: BODY, revision: 1, updatedAt: '', by: 'other' as const }))
    hub.state.others.push(other('DEF Ltd', 'C3333333', { templates: fifty }))
    const plans = await plansFor()
    expect(plans[1].blocked).toBe('It has 50 templates already, the most a company can have')
    // Even when ticked by hand, it is not sent.
    const results = await publishToCompanies(port, { brn: BRN, name: 'Monthly payslip', body: BODY }, plans, new Set([BRN, 'C3333333']))
    expect(results[1]).toMatchObject({ outcome: 'skipped', text: 'It has 50 templates already, the most a company can have' })
    expect(sent().filter((line) => line === 'send-data payslip-template publish-copy')).toHaveLength(1)
  })

  it('the lines checked are the mapped ones only', () => {
    expect(columnsUsed(BODY).map((line) => line.key)).toEqual(['Basic Salary', 'Govt Increment', 'Allowances', 'Travelling', 'Presence Bonus', 'Employee CSG', 'Employee NSF', 'PAYE'])
  })
})

describe('publishing, company by company', () => {
  it('to selected companies: each gets the template under the same name, used for its payslips', async () => {
    hub.state.others.push(
      other('DEF Ltd', 'C3333333'),
      other('GHI Ltd', 'C5555555', {
        templates: [{ id: '20000000-0000-4000-8000-000000000101', name: 'monthly payslip', body: OTHER_BODY, revision: 2, updatedAt: '', by: 'other' }],
        versions: [{ templateId: '20000000-0000-4000-8000-000000000101', version: 4, name: 'monthly payslip', body: OTHER_BODY, publishedAt: '', by: 'other' }],
      }),
      other('JKL Ltd', 'C6666666'),
    )
    const plans = await plansFor()
    const ticked = new Set([BRN, 'C3333333', 'C5555555'])
    const progress: string[] = []
    const results = await publishToCompanies(port, { brn: BRN, name: 'Monthly payslip', body: OTHER_BODY }, plans, ticked, (done, total, company) =>
      progress.push(company ? `Company ${done + 1} of ${total}: ${company}` : `${done} of ${total}`),
    )

    expect(results.map((result) => [result.company, result.outcome, result.text])).toEqual([
      ['ABC Co Ltd', 'updated', 'Published as version 2 of "Monthly payslip", used for the payslips'],
      ['DEF Ltd', 'updated', 'New template "Monthly payslip", version 1, used for the payslips'],
      ['GHI Ltd', 'updated', 'Already had this as version 4; now used for the payslips'],
      ['JKL Ltd', 'skipped', 'Not ticked'],
    ])
    expect(progress).toEqual(['Company 1 of 3: ABC Co Ltd', 'Company 2 of 3: DEF Ltd', 'Company 3 of 3: GHI Ltd', '3 of 3'])

    // Each company has its own template, history and choice; JKL is untouched.
    const [def, ghi, jkl] = hub.state.others
    expect(hub.state.versions.map((v) => v.version)).toEqual([1, 2])
    expect(hub.state.inUse).toEqual({ templateId: '20000000-0000-4000-8000-000000000001', version: 2 })
    expect(def.templates).toMatchObject([{ name: 'Monthly payslip', revision: 1 }])
    expect(def.inUse).toEqual({ templateId: def.templates[0].id, version: 1 })
    // Same name whatever the capitals: its own name kept, no identical version added, now in use.
    expect(ghi.templates).toMatchObject([{ name: 'monthly payslip', revision: 2 }])
    expect(ghi.versions).toHaveLength(1)
    expect(ghi.inUse).toEqual({ templateId: '20000000-0000-4000-8000-000000000101', version: 4 })
    expect(jkl.templates).toEqual([])
    expect(jkl.inUse).toBeNull()
    // Issued payslips are never touched.
    expect(hub.state.issued).toEqual([])
    // One message per company, never one for several.
    expect(sent().filter((line) => line.startsWith('send-data'))).toEqual(Array(3).fill('send-data payslip-template publish-copy'))
  })

  it('to all my companies: every ready company is published to', async () => {
    hub.state.others.push(other('DEF Ltd', 'C3333333'), other('GHI Ltd', 'C5555555'), other('XYZ Trading Ltd', 'C2222222', { role: 'member' }))
    const plans = await plansFor()
    const results = await publishToCompanies(port, { brn: BRN, name: 'Monthly payslip', body: OTHER_BODY }, plans, initialTicks(plans, 'all'))
    expect(results.map((result) => result.outcome)).toEqual(['updated', 'updated', 'updated'])
    expect(hub.state.others.filter((company) => company.inUse !== null).map((company) => company.name)).toEqual(['DEF Ltd', 'GHI Ltd'])
  })

  it('one company failing does not stop the others, and says why', async () => {
    hub.state.others.push(other('DEF Ltd', 'C3333333'), other('GHI Ltd', 'C5555555'))
    hub.state.refuseCopy = { C3333333: 'forbidden' }
    const plans = await plansFor()
    const results = await publishToCompanies(port, { brn: BRN, name: 'Monthly payslip', body: OTHER_BODY }, plans, initialTicks(plans, 'all'))
    expect(results.map((result) => [result.company, result.outcome])).toEqual([
      ['ABC Co Ltd', 'updated'],
      ['DEF Ltd', 'failed'],
      ['GHI Ltd', 'updated'],
    ])
    expect(results[1]).toMatchObject({ text: 'Not published', failure: { kind: 'forbidden' } })
    expect(hub.state.others[0].templates).toEqual([])
    expect(hub.state.others[1].inUse).not.toBeNull()
  })

  it('a company changed since the check is refused as stale and keeps what was saved there', async () => {
    hub.state.others.push(
      other('DEF Ltd', 'C3333333', {
        templates: [{ id: '20000000-0000-4000-8000-000000000101', name: 'Monthly payslip', body: BODY, revision: 1, updatedAt: '', by: 'other' }],
        versions: [{ templateId: '20000000-0000-4000-8000-000000000101', version: 1, name: 'Monthly payslip', body: BODY, publishedAt: '', by: 'other' }],
      }),
    )
    const plans = await plansFor()
    // Another admin saves DEF's draft after the check.
    Object.assign(hub.state.others[0].templates[0], { body: { mine: true }, revision: 2 })
    const results = await publishToCompanies(port, { brn: BRN, name: 'Monthly payslip', body: OTHER_BODY }, plans, initialTicks(plans, 'all'))
    expect(results[1]).toMatchObject({ outcome: 'failed', failure: { kind: 'stale' } })
    expect(hub.state.others[0].templates[0]).toMatchObject({ body: { mine: true }, revision: 2 })
    expect(results[0].outcome).toBe('updated')
  })

  it('a company that was unticked for a reason can be ticked back and published to', async () => {
    hub.state.others.push(other('DEF Ltd', 'C3333333', { payroll: null }))
    const plans = await plansFor()
    expect(initialTicks(plans, 'all').has('C3333333')).toBe(false)
    const results = await publishToCompanies(port, { brn: BRN, name: 'Monthly payslip', body: OTHER_BODY }, plans, new Set([BRN, 'C3333333']))
    expect(results[1]).toMatchObject({ outcome: 'updated' })
  })

  it('skipped companies keep their reasons in the outcome', async () => {
    hub.state.others.push(other('DEF Ltd', 'C3333333', { payroll: null }))
    const plans = await plansFor()
    const results = await publishToCompanies(port, { brn: BRN, name: 'Monthly payslip', body: OTHER_BODY }, plans, initialTicks(plans, 'all'))
    expect(results[1]).toEqual({
      brn: 'C3333333',
      company: 'DEF Ltd',
      thisCompany: false,
      outcome: 'skipped',
      text: 'Not ticked',
      reasons: ['No saved payroll yet to check the columns against'],
    })
  })

  it('this company is always published to, even when not in the ticks', async () => {
    const plans = await plansFor()
    const results = await publishToCompanies(port, { brn: BRN, name: 'Monthly payslip', body: OTHER_BODY }, plans, new Set())
    expect(results).toMatchObject([{ thisCompany: true, outcome: 'updated' }])
  })

  it('a company the app was not offered is refused by the dashboard: a member company, sent by hand', async () => {
    hub.state.others.push(other('XYZ Trading Ltd', 'C2222222', { role: 'member' }))
    const outcome = await publishCopy(port, { brn: BRN, companyBrn: 'C2222222', name: 'Monthly payslip', body: BODY, expectedRevision: 0, publishedBefore: null })
    expect(outcome).toMatchObject({ end: 'refused', failure: { kind: 'forbidden' } })
    expect(hub.state.others[0].templates).toEqual([])
  })
})

describe('the reload rule for one company', () => {
  it('a publication whose answer was lost is found by checking again, and not sent twice', async () => {
    hub.state.others.push(other('DEF Ltd', 'C3333333'))
    hub.state.nextSave = { mode: 'lost' }
    const outcome = await publishCopy(port, { brn: BRN, companyBrn: 'C3333333', name: 'Monthly payslip', body: BODY, expectedRevision: 0, publishedBefore: null })
    expect(outcome).toMatchObject({ end: 'saved', version: 1, created: true })
    expect(sent().filter((line) => line.startsWith('send-data'))).toHaveLength(1)
    expect(sent().at(-1)).toBe('request-data payslip-template check')
  })

  it('one that was not stored is reported as not published, so it may be sent again', async () => {
    hub.state.others.push(other('DEF Ltd', 'C3333333'))
    hub.state.nextSave = { mode: 'unavailable-unsaved' }
    const outcome = await publishCopy(port, { brn: BRN, companyBrn: 'C3333333', name: 'Monthly payslip', body: BODY, expectedRevision: 0, publishedBefore: null })
    expect(outcome).toMatchObject({ end: 'not-saved', failure: { detail: 'Checked with the dashboard: nothing was published there. You can publish to it again.' } })
  })

  it('when the check cannot be made either, it is not confirmed, never resent', async () => {
    hub.state.others.push(other('DEF Ltd', 'C3333333'))
    hub.state.nextSave = { mode: 'lost' }
    const answers: unknown[] = []
    const flaky: HubPort = {
      ...port,
      send: (type, payload) => {
        const reply = type === 'request-data' ? Promise.resolve({ ok: false, error: 'No answer.' }) : port.send(type, payload)
        answers.push(type)
        return reply
      },
    }
    const outcome = await publishCopy(flaky, { brn: BRN, companyBrn: 'C3333333', name: 'Monthly payslip', body: BODY, expectedRevision: 0, publishedBefore: null })
    expect(outcome.end).toBe('unconfirmed')
    expect(answers).toEqual(['send-data', 'request-data'])
  })
})

describe('any number of companies', () => {
  it('asks page after page until a page is not full, and gets every company once', async () => {
    for (let n = 0; n < 2 * CHECK_PAGE + 19; n++) hub.state.others.push(other(`Company ${String(n).padStart(3, '0')}`, `B${n}`))
    const checked = await checkCompanies(port, BRN, 'Monthly payslip')
    if (!checked.ok) throw new Error(checked.failure.title)
    expect(checked.companies).toHaveLength(2 * CHECK_PAGE + 20)
    expect(checked.companies[0]).toMatchObject({ brn: BRN, selected: true })
    expect(new Set(checked.companies.map((company) => company.brn)).size).toBe(2 * CHECK_PAGE + 20)
    expect(hub.state.log.filter((m) => m.payload.params?.action === 'check').map((m) => m.payload.params?.page)).toEqual([0, 1, 2])
  })

  it('a page that is exactly full is followed by one more ask, which ends it', async () => {
    for (let n = 0; n < CHECK_PAGE - 1; n++) hub.state.others.push(other(`Company ${String(n).padStart(3, '0')}`, `B${n}`))
    const checked = await checkCompanies(port, BRN, 'Monthly payslip')
    expect(checked).toMatchObject({ ok: true })
    expect(hub.state.log.filter((m) => m.payload.params?.action === 'check')).toHaveLength(2)
  })

  it('a refused page refuses the whole check: nothing half-checked is shown', async () => {
    for (let n = 0; n < CHECK_PAGE + 5; n++) hub.state.others.push(other(`Company ${String(n).padStart(3, '0')}`, `B${n}`))
    const send = port.send
    let asks = 0
    const flaky: HubPort = { ...port, send: (type, payload) => (type === 'request-data' && ++asks === 2 ? Promise.resolve({ ok: false, code: 'unavailable', error: 'Down.' }) : send(type, payload)) }
    expect(await checkCompanies(flaky, BRN, 'Monthly payslip')).toMatchObject({ ok: false, failure: { kind: 'unavailable' } })
  })
})

describe('one toast for the whole batch', () => {
  it('after the batch, one summary with the counts goes to the dashboard, which stores nothing', async () => {
    hub.state.others.push(other('DEF Ltd', 'C3333333'), other('GHI Ltd', 'C5555555', { payroll: null }), other('JKL Ltd', 'C6666666'))
    hub.state.refuseCopy = { C6666666: 'forbidden' }
    const plans = await plansFor()
    const results = await publishToCompanies(port, { brn: BRN, name: 'Monthly payslip', body: OTHER_BODY }, plans, initialTicks(plans, 'all'))
    await sendPublishSummary(port, BRN, ' Monthly payslip ', results)
    expect(hub.state.log.at(-1)!.payload).toEqual({
      dataType: 'payslip-template',
      rows: [{ action: 'publish-summary', brn: BRN, name: 'Monthly payslip', published: 2, skipped: 1, failed: 1, unconfirmed: 0 }],
    })
    expect(sent().filter((line) => line.startsWith('send-data'))).toEqual([
      'send-data payslip-template publish-copy',
      'send-data payslip-template publish-copy',
      'send-data payslip-template publish-copy',
      'send-data payslip-template publish-summary',
    ])
  })
})

describe('answers are validated', () => {
  it('a check that names no selected company, or two, is not used', async () => {
    const send = async () => ({ ok: true, dataType: 'payslip-template', rows: [], meta: { brn: BRN, label: 'ABC Co Ltd', role: 'admin' } })
    expect(await checkCompanies({ send }, BRN, 'T')).toMatchObject({ ok: false, failure: { kind: 'bad-answer' } })
  })

  it('a check row with an unknown shape is not used', async () => {
    const row: Record<string, unknown> = { brn: BRN, company: 'ABC Co Ltd', selected: true, templates: 'many', template: null, payroll: null }
    const send = async () => ({ ok: true, dataType: 'payslip-template', rows: [row], meta: { brn: BRN, label: 'ABC Co Ltd', role: 'admin' } })
    expect(await checkCompanies({ send }, BRN, 'T')).toMatchObject({ ok: false, failure: { kind: 'bad-answer' } })
  })
})
