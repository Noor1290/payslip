// Payslips for several companies at once (Stage 2): the dashboard's side through the fake
// dashboard, each company built with its own template and rates through the same checks as the
// Payslips page, the zip's folders, files and report, and companies that are skipped.
// Fake data only (ABC Co Ltd and invented companies).
import { strFromU8, unzipSync } from 'fflate'
import { PDFDocument } from 'pdf-lib'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FakeHub } from '../scripts/lib/fake-hub.mjs'
import { preparePayslips } from '../src/lib/build'
import { importPayrollRows } from '../src/lib/payrollFile'
import { DEFAULT_STATUTORY_RATES } from '../src/data/defaultStatutoryRates'
import { writeCompaniesZip } from '../src/lib/exports'
import type { HubPort } from '../src/lib/hubWire'
import { encodeLines, figuresOf } from '../src/lib/issuedLines'
import { DRAWING_VERSION } from '../src/lib/layoutModel'
import { buildCompany, companyPaths, folderNames, reportFileName, reportText, summaryLine, type CompanyOutcome } from '../src/lib/manyPayslips'
import { ASK_MAX_COMPANIES, askForCompanies, listCompanies, loadCompany, type CompanyBundle } from '../src/lib/manyStore'
import { isReady } from '../src/lib/payslip'
import { DEFAULT_TABLE_MAPPING, TABLE_TEMPLATE } from '../src/lib/template'
import { BUILT_IN_BODY, readBody, templateOf, type TemplateBody } from '../src/lib/templateBody'
import { BRN, fakeHub } from './fakeHubPort'
import { readFixtureText, readFont } from './helpers'

const SEPTEMBER = JSON.parse(readFixtureText('ABC Co Ltd-pdf-fill-2026-09.json')) as Record<string, unknown>[]
/** The same people, for another company: its own name, address and BRN on every row. */
const rowsOf = (name: string, brn: string, change: (row: Record<string, unknown>) => Record<string, unknown> = (row) => row) =>
  SEPTEMBER.map((row) => change({ ...row, 'Company Name': name, BRN: brn, Address: `${name} House, Fake Road, Port Louis` }))

const titled = (title: string): TemplateBody => ({ ...BUILT_IN_BODY, labels: { ...BUILT_IN_BODY.labels, title } })
/** The rates rows as the dashboard sends them. */
const RATES_WIRE = DEFAULT_STATUTORY_RATES.map((v) => ({
  effective_from: v.effectiveFrom,
  revision: v.revision,
  nsf_employee_rate: v.nsfEmployeeRate,
  nsf_ceiling: v.nsfCeiling,
  nsf_exempt_at_60: v.nsfExemptAt60,
  csg_employee_rate_low: v.csgEmployeeRateLow,
  csg_employee_rate_high: v.csgEmployeeRateHigh,
  csg_threshold: v.csgThreshold,
  source_note: null,
  created_at: '2026-07-01T09:00:00+04:00',
  by: 'you',
}))

type Other = FakeHub['state']['others'][number]
const other = (name: string, brn: string, more: Partial<Other> = {}): Other => ({
  name,
  brn,
  role: 'admin',
  templates: [],
  versions: [],
  inUse: null,
  payroll: null,
  runs: { '2026-09': rowsOf(name, brn) },
  rates: RATES_WIRE,
  ...more,
})
const withTemplate = (id: string, name: string, body: TemplateBody, version = 1) => ({
  templates: [{ id, name, body, revision: 1, updatedAt: '', by: 'other' as const }],
  versions: [{ templateId: id, version, name, body, publishedAt: '', by: 'other' as const }],
})

let hub: FakeHub
let port: HubPort

/** The batch's options: today's behaviour (no rounding accepted), and the owner's default. */
const OFF = { issueDate: '2026-10-01', acceptRounding: false }
const ON = { issueDate: '2026-10-01', acceptRounding: true }

beforeEach(() => {
  ;({ hub, port } = fakeHub())
  hub.state.runs['2026-09'] = SEPTEMBER
  hub.state.rates = RATES_WIRE as never
  hub.state.templates.push({ id: '20000000-0000-4000-8000-000000000001', name: 'Monthly payslip', body: titled('ABC payslip'), revision: 1, updatedAt: '', by: 'you' })
  hub.state.versions.push({ templateId: '20000000-0000-4000-8000-000000000001', version: 1, name: 'Monthly payslip', body: titled('ABC payslip'), publishedAt: '', by: 'you' })
  hub.state.ids = 1
  hub.state.others.push(
    other('DEF Ltd', 'C3333333', withTemplate('20000000-0000-4000-8000-000000000101', 'DEF layout', titled('DEF payslip'), 4)),
    other('XYZ Trading Ltd', 'C2222222', { role: 'member', ...withTemplate('20000000-0000-4000-8000-000000000102', 'XYZ', titled('XYZ')) }),
  )
})

/** Asks for the companies, then loads each, as the page does. */
async function loadAll(period: string, brns: string[]): Promise<CompanyBundle[]> {
  const allowed = await askForCompanies(port, BRN, period, brns, false)
  if (!allowed.ok) throw new Error(allowed.failure.title)
  const bundles: CompanyBundle[] = []
  for (const brn of brns) {
    const loaded = await loadCompany(port, BRN, period, brn)
    if (!loaded.ok) throw new Error(`${brn}: ${loaded.failure.title}`)
    bundles.push(loaded.bundle)
  }
  return bundles
}

describe('the dashboard side', () => {
  it('lists only the companies where I am an admin, this company first, and says which is selected', async () => {
    const answer = await listCompanies(port)
    expect(answer).toEqual({
      ok: true,
      selectedBrn: BRN,
      companies: [
        { brn: BRN, name: 'ABC Co Ltd', selected: true },
        { brn: 'C3333333', name: 'DEF Ltd', selected: false },
      ],
    })
    expect(hub.state.log.at(-1)!.payload).toEqual({ dataType: 'payslip-batch', params: { action: 'companies' } })
  })

  it('asks once for the month and the companies chosen; with more than 100, or all, it asks for all', async () => {
    await askForCompanies(port, BRN, '2026-09', [BRN, 'C3333333'], false)
    expect(hub.state.log.at(-1)!.payload.params).toEqual({ action: 'ask', period: '2026-09', companies: [BRN, 'C3333333'], brn: BRN })
    await askForCompanies(port, BRN, '2026-09', [BRN, 'C3333333'], true)
    expect(hub.state.log.at(-1)!.payload.params).toEqual({ action: 'ask', period: '2026-09', all: true, brn: BRN })
    const many = Array.from({ length: ASK_MAX_COMPANIES + 1 }, (_, n) => `B${n}`)
    await askForCompanies(port, BRN, '2026-09', many, false)
    expect(hub.state.log.at(-1)!.payload.params).toMatchObject({ action: 'ask', all: true })
  })

  it('a company where I am only a member is refused, also when the app is bypassed', async () => {
    expect(await askForCompanies(port, BRN, '2026-09', ['C2222222'], false)).toMatchObject({ ok: false, failure: { kind: 'forbidden' } })
    // Even sent by hand, a load that was never allowed gets nothing.
    expect(await loadCompany(port, BRN, '2026-09', 'C2222222')).toMatchObject({ ok: false, failure: { kind: 'denied' } })
  })

  it('a company that was not allowed, or another month, is not sent', async () => {
    await askForCompanies(port, BRN, '2026-09', [BRN], false)
    expect(await loadCompany(port, BRN, '2026-09', 'C3333333')).toMatchObject({ ok: false, failure: { kind: 'denied' } })
    expect(await loadCompany(port, BRN, '2026-08', BRN)).toMatchObject({ ok: false, failure: { kind: 'denied' } })
  })

  it('a declined question or a locked dashboard stops everything before any payroll is sent', async () => {
    hub.state.prompt = 'deny'
    expect(await askForCompanies(port, BRN, '2026-09', [BRN], false)).toMatchObject({ ok: false, failure: { kind: 'denied' } })
    hub.state.prompt = 'allow'
    hub.state.gateOpen = false
    expect(await askForCompanies(port, BRN, '2026-09', [BRN], false)).toMatchObject({ ok: false, failure: { kind: 'locked' } })
    expect(hub.state.log.some((m) => m.payload.params?.action === 'load')).toBe(false)
  })

  it('each company comes with ITS OWN run, template and rates', async () => {
    const [abc, def] = await loadAll('2026-09', [BRN, 'C3333333'])
    expect(abc).toMatchObject({ brn: BRN, company: 'ABC Co Ltd', run: true, template: { name: 'Monthly payslip', version: 1 } })
    expect(def).toMatchObject({ brn: 'C3333333', company: 'DEF Ltd', run: true, template: { name: 'DEF layout', version: 4 } })
    expect(def.employees.every((row) => row.BRN === 'C3333333')).toBe(true)
    expect(abc.rates.length).toBe(DEFAULT_STATUTORY_RATES.length)
  })
})

describe('each company is built with its own template and rates, through the same checks', () => {
  it('keeps exactly the payslips the Payslips page would call ready, and says why the others are left out', async () => {
    const [abc] = await loadAll('2026-09', [BRN])
    const outcome = buildCompany(abc, OFF)
    // The one-company page, with the same data, template and rates, and nothing accepted.
    const imported = importPayrollRows(SEPTEMBER, { period: '2026-09' })
    if (!imported.ok) throw new Error('fixture')
    const single = preparePayslips(
      imported.data,
      { template: TABLE_TEMPLATE, mapping: DEFAULT_TABLE_MAPPING, rateVersions: DEFAULT_STATUTORY_RATES, period: '2026-09' },
      '2026-10-01',
    )
    const ready = single.filter((item) => isReady(item.computation, {})).map((item) => item.computation.employeeName)
    const notReady = single.filter((item) => !isReady(item.computation, {})).map((item) => item.computation.employeeName)
    expect(outcome.kind).not.toBe('skipped')
    if (outcome.kind === 'skipped') return
    expect(outcome.documents.map((doc) => doc.employeeName)).toEqual(ready)
    expect(outcome.leftOut.map((person) => person.name)).toEqual(notReady)
    expect(outcome.kind).toBe(notReady.length === 0 ? 'done' : 'partly')
    for (const person of outcome.leftOut) expect(person.reasons.join(' ')).toMatch(/differs from the payroll's|cannot be compared|has no/)
  })

  it("uses each company's own template: its labels are on its payslips", async () => {
    const [abc, def] = await loadAll('2026-09', [BRN, 'C3333333'])
    const a = buildCompany(abc, OFF)
    const d = buildCompany(def, OFF)
    if (a.kind === 'skipped' || d.kind === 'skipped') throw new Error('skipped')
    expect(JSON.stringify(a.documents[0])).toContain('ABC payslip')
    expect(JSON.stringify(d.documents[0])).toContain('DEF payslip')
    expect(JSON.stringify(d.documents[0])).toContain('DEF Ltd')
    expect(a.template).toBe('Monthly payslip, version 1')
    expect(d.template).toBe('DEF layout, version 4')
  })

  it("uses each company's own rates for the cross-check", async () => {
    // DEF corrected its July rates (revision 2, a lower NSF ceiling); ABC did not; GHI has none.
    hub.state.others[0].rates = [...RATES_WIRE, { ...RATES_WIRE.at(-1)!, revision: 2, nsf_ceiling: 28000 }]
    hub.state.others.push(other('GHI Ltd', 'C5555555', { rates: [], ...withTemplate('20000000-0000-4000-8000-000000000103', 'G', titled('G')) }))
    const [abc, def, ghi] = await loadAll('2026-09', [BRN, 'C3333333', 'C5555555']).then((bundles) => bundles.map((bundle) => buildCompany(bundle, OFF)))
    if (abc.kind === 'skipped' || def.kind === 'skipped' || ghi.kind === 'skipped') throw new Error('skipped')
    expect(abc.ratesUsed).toMatchObject({ revision: 1 })
    expect(def.ratesUsed).toMatchObject({ revision: 2, nsfCeiling: 28000 })
    expect(ghi.ratesUsed).toBeNull()
  })

  it('a payslip that fails its checks is left out with the reason, the others go through', async () => {
    hub.state.others[0].runs = {
      '2026-09': rowsOf('DEF Ltd', 'C3333333', (row) => (row.Surname === 'TESTER' ? { ...row, 'Net Pay': Number(row['Net Pay']) + 5 } : row)),
    }
    const [def] = await loadAll('2026-09', ['C3333333'])
    const outcome = buildCompany(def, OFF)
    if (outcome.kind === 'skipped') throw new Error('skipped')
    expect(outcome.kind).toBe('partly')
    const tester = outcome.leftOut.find((person) => person.name.startsWith('TESTER'))!
    expect(tester.reasons).toContain('Net Pay differs from the payroll\'s "Net Pay" by 5. Accept it on this company\'s Payslips page to include it.')
  })

  it('a payslip with a missing figure is left out, naming it', async () => {
    hub.state.others[0].runs = {
      '2026-09': rowsOf('DEF Ltd', 'C3333333', (row) => {
        if (row.Surname !== 'FICTIF') return row
        const { ['Employee CSG']: _gone, ...rest } = row
        void _gone
        return rest
      }),
    }
    const [def] = await loadAll('2026-09', ['C3333333'])
    const outcome = buildCompany(def, OFF)
    if (outcome.kind === 'skipped') throw new Error('skipped')
    expect(outcome.leftOut.find((person) => person.name.startsWith('FICTIF'))!.reasons.join(' ')).toContain('Employee CSG')
  })
})

describe('skipped companies', () => {
  it('a company with no saved run for that month is skipped, with the reason', async () => {
    hub.state.others[0].runs = {}
    const [def] = await loadAll('2026-09', ['C3333333'])
    expect(buildCompany(def, OFF)).toMatchObject({ kind: 'skipped', reason: 'No saved payroll for September 2026.' })
  })

  it('no template chosen: none published, or several and none chosen; one published is used', async () => {
    hub.state.others[0].templates = []
    hub.state.others[0].versions = []
    let [def] = await loadAll('2026-09', ['C3333333'])
    expect(buildCompany(def, OFF)).toMatchObject({ kind: 'skipped', reason: 'No template chosen: it has no published template.' })

    Object.assign(hub.state.others[0], {
      templates: [...withTemplate('20000000-0000-4000-8000-000000000201', 'A', titled('A')).templates, ...withTemplate('20000000-0000-4000-8000-000000000202', 'B', titled('B')).templates],
      versions: [...withTemplate('20000000-0000-4000-8000-000000000201', 'A', titled('A')).versions, ...withTemplate('20000000-0000-4000-8000-000000000202', 'B', titled('B')).versions],
    })
    ;[def] = await loadAll('2026-09', ['C3333333'])
    expect(buildCompany(def, OFF)).toMatchObject({
      kind: 'skipped',
      reason: 'No template chosen: it has more than one published template, and none is chosen for the payslips.',
    })

    // The one chosen for the payslips decides, even with several published.
    hub.state.others[0].inUse = { templateId: '20000000-0000-4000-8000-000000000202', version: 1 }
    ;[def] = await loadAll('2026-09', ['C3333333'])
    const chosen = buildCompany(def, OFF)
    expect(chosen).toMatchObject({ template: 'B, version 1' })
  })

  it('a company where no payslip passes is skipped, with each person and the reason', async () => {
    hub.state.others[0].runs = { '2026-09': rowsOf('DEF Ltd', 'C3333333', (row) => ({ ...row, 'Net Pay': Number(row['Net Pay']) + 1 })) }
    const [def] = await loadAll('2026-09', ['C3333333'])
    const outcome = buildCompany(def, OFF)
    expect(outcome).toMatchObject({ kind: 'skipped', reason: 'No payslip passed its checks.' })
    expect(outcome.leftOut).toHaveLength(SEPTEMBER.length)
  })
})

describe('the zip: a folder per company, its files, and the report', () => {
  it('has each employee PDF, one combined PDF and the Excel file per company, and the report', async () => {
    hub.state.others[0].runs = {
      '2026-09': rowsOf('DEF Ltd', 'C3333333', (row) => (row.Surname === 'TESTER' ? { ...row, 'Net Pay': Number(row['Net Pay']) + 5 } : row)),
    }
    hub.state.others.push(other('GHI Ltd', 'C5555555', { runs: {}, ...withTemplate('20000000-0000-4000-8000-000000000104', 'G', titled('G')) }))
    const brns = [BRN, 'C3333333', 'C5555555']
    const outcomes: CompanyOutcome[] = (await loadAll('2026-09', brns)).map((bundle) => buildCompany(bundle, OFF))
    const made = outcomes.flatMap((outcome) => (outcome.kind === 'skipped' ? [] : [outcome]))
    const folders = folderNames(made)
    expect(folders).toEqual(['ABC Co Ltd', 'DEF Ltd'])
    const report = reportText(outcomes, '2026-09', '2026-10-25')
    const zip = await writeCompaniesZip(
      made.map((outcome, index) => ({ ...companyPaths(folders[index], outcome.company, '2026-09', outcome.documents), documents: outcome.documents })),
      { path: reportFileName('2026-09'), text: report },
      { regular: readFont('regular'), bold: readFont('bold') },
    )
    const files = unzipSync(zip)
    const names = Object.keys(files).sort()
    const def = made[1]
    const abc = made[0]
    expect(names).toContain('Report - 2026-09.txt')
    expect(names).toContain('ABC Co Ltd/ABC Co Ltd - all payslips - 2026-09.pdf')
    expect(names).toContain('ABC Co Ltd/ABC Co Ltd - payslips - 2026-09.xlsx')
    expect(names).toContain('DEF Ltd/DEF Ltd - payslips - 2026-09.xlsx')
    const singles = (folder: string) => names.filter((name) => name.startsWith(folder) && name.endsWith(' - 2026-09.pdf') && !name.includes('all payslips'))
    expect(singles('ABC Co Ltd/')).toHaveLength(abc.documents.length)
    expect(singles('DEF Ltd/')).toHaveLength(def.documents.length)
    expect(names.some((name) => name.startsWith('GHI Ltd'))).toBe(false)
    expect(names.some((name) => name.includes('TESTER'))).toBe(abc.documents.some((doc) => doc.employeeName.startsWith('TESTER')))
    // The combined PDF has one page per payslip of that company.
    const combined = await PDFDocument.load(files['DEF Ltd/DEF Ltd - all payslips - 2026-09.pdf'])
    expect(combined.getPageCount()).toBe(def.documents.length)
    // A single payslip in the zip is the one-page PDF the single download makes.
    const single = await PDFDocument.load(files[names.find((name) => name.startsWith('DEF Ltd/') && name.endsWith('.pdf') && !name.includes('all payslips'))!])
    expect(single.getPageCount()).toBe(1)
    // The report in the zip is the one shown on screen; no national ID in it.
    const text = strFromU8(files['Report - 2026-09.txt'])
    expect(text).toBe(report)
    expect(text).toContain('Payslips for September 2026')
    expect(text).toContain('Downloaded only: nothing was issued.')
    expect(text).toContain(summaryLine(outcomes))
    expect(text).toContain('GHI Ltd (BRN C5555555): skipped. No saved payroll for September 2026.')
    expect(text).toContain('DEF Ltd (BRN C3333333): ')
    const testerLine = text.split('\r\n').find((line) => line.startsWith('  - TESTER SAM: ')) ?? ''
    expect(testerLine).toContain(`Net Pay differs from the payroll's "Net Pay" by 5.`)
    expect(text).not.toMatch(/X0{6}/)
  })

  it('two companies with the same name get their BRN in the folder name', () => {
    expect(folderNames([
      { company: 'Same Ltd', brn: 'B1' },
      { company: 'Same Ltd', brn: 'B2' },
      { company: 'Other: Ltd', brn: 'B3' },
    ])).toEqual(['Same Ltd (B1)', 'Same Ltd (B2)', 'Other Ltd'])
  })
})

describe('a 0.01 rounding difference, accepted when ticked', () => {
  /** The fixture's employees whose only differences are exactly 0.01 (known issue 2). */
  async function roundingOnly() {
    const imported = importPayrollRows(SEPTEMBER, { period: '2026-09' })
    if (!imported.ok) throw new Error('fixture')
    const single = preparePayslips(imported.data, { template: TABLE_TEMPLATE, mapping: DEFAULT_TABLE_MAPPING, rateVersions: DEFAULT_STATUTORY_RATES, period: '2026-09' }, '2026-10-01')
    return single.filter((item) => item.computation.errors.length === 0 && item.computation.checks.some((check) => check.kind === 'rounding') && item.computation.checks.every((check) => check.kind === 'match' || check.kind === 'rounding'))
  }

  it('ticked: an employee whose only differences are exactly 0.01 is included, and each one is listed', async () => {
    const expected = await roundingOnly()
    expect(expected.length).toBeGreaterThan(0)
    const [abc] = await loadAll('2026-09', [BRN])
    const outcome = buildCompany(abc, ON)
    if (outcome.kind === 'skipped') throw new Error('skipped')
    expect(outcome.kind).toBe('done')
    expect(outcome.leftOut).toEqual([])
    expect(outcome.documents).toHaveLength(SEPTEMBER.length)
    const listed = expected.flatMap((item) => item.computation.checks.filter((check) => check.kind === 'rounding').map((check) => ({ name: item.computation.employeeName, line: check.label })))
    expect(outcome.rounding).toEqual(listed)
    const report = reportText([outcome], '2026-09', '2026-10-25')
    for (const item of listed) expect(report).toContain(`  Accepted a 0.01 rounding difference: ${item.name}, ${item.line}\r\n`)
  })

  it('ticked: a difference of 0.02 still leaves the employee out, with the hint to accept it on the company page', async () => {
    const [first] = await roundingOnly()
    const name = first.computation.employeeName
    // The payroll's figure moved one more cent away from the payslip's: a difference of 0.02.
    const check = first.computation.checks.find((found) => found.kind === 'rounding')!
    const away = check.diffCents! > 0 ? -0.01 : 0.01
    hub.state.runs['2026-09'] = SEPTEMBER.map((row) =>
      `${row.Surname} ${row['Other names']}` === name ? { ...row, [check.payrollKey]: Math.round((Number(row[check.payrollKey]) + away) * 100) / 100 } : row,
    )
    const [abc] = await loadAll('2026-09', [BRN])
    const outcome = buildCompany(abc, ON)
    if (outcome.kind === 'skipped') throw new Error('skipped')
    const person = outcome.leftOut.find((item) => item.name === name)
    expect(person).toBeDefined()
    expect(person!.reasons.join(' ')).toMatch(/by 0\.02\. Accept it on this company's Payslips page to include it\./)
    expect(outcome.rounding.some((item) => item.name === name)).toBe(false)
  })

  it('ticked: a 0.01 rounding beside a larger difference is listed without the hint, and the employee is left out', async () => {
    const [first] = await roundingOnly()
    const name = first.computation.employeeName
    hub.state.runs['2026-09'] = SEPTEMBER.map((row) => (`${row.Surname} ${row['Other names']}` === name ? { ...row, 'Gross Pay': Number(row['Gross Pay']) + 3 } : row))
    const [abc] = await loadAll('2026-09', [BRN])
    const outcome = buildCompany(abc, ON)
    if (outcome.kind === 'skipped') throw new Error('skipped')
    const reasons = outcome.leftOut.find((item) => item.name === name)!.reasons
    const roundingReason = reasons.find((reason) => reason.includes('(rounding)'))!
    expect(roundingReason).not.toContain('Accept it on')
    expect(reasons.find((reason) => reason.includes('by 3'))).toContain("Accept it on this company's Payslips page to include it.")
  })

  it("unticked: today's behaviour, every 0.01 difference leaves the employee out with the hint", async () => {
    const expected = await roundingOnly()
    const [abc] = await loadAll('2026-09', [BRN])
    const outcome = buildCompany(abc, OFF)
    if (outcome.kind === 'skipped') throw new Error('skipped')
    expect(outcome.rounding).toEqual([])
    expect(outcome.leftOut.map((item) => item.name)).toEqual(expected.map((item) => item.computation.employeeName))
    for (const person of outcome.leftOut) expect(person.reasons.join(' ')).toContain("(rounding). Accept it on this company's Payslips page to include it.")
  })
})

describe('a payslip already issued for the month', () => {
  /** Issues the September payslips of ABC as the one-company page would, with an older drawing. */
  async function issueSeptember(drawing: number, change: (lines: Record<string, unknown>[]) => void = () => {}) {
    const [abc] = await loadAll('2026-09', [BRN])
    const imported = importPayrollRows(abc.employees, { period: '2026-09' })
    if (!imported.ok) throw new Error('fixture')
    const outcome = buildCompany(abc, ON)
    if (outcome.kind === 'skipped') throw new Error('skipped')
    // The template the batch uses is the company's own (titled "ABC payslip"): issue with its documents.
    outcome.documents.forEach((document, index) => {
      const row = imported.data.rows.find((r) => `${r.Surname} ${r['Other names']}` === document.employeeName)!
      const computation = buildCompanyComputations(abc)[index]
      const lines = encodeLines({ ...document, drawing }, figuresOf(computation))
      change(lines)
      hub.state.issued.push({ national_id: String(row.ID), period: '2026-09', revision: 2, template_id: '20000000-0000-4000-8000-000000000001', template_version: 1, rates: null, lines, accepted_differences: [], issued_at: '2026-10-02T09:00:00+04:00', by: 'you' })
    })
    return outcome
  }

  it('unchanged since it was issued: taken from the stored copy, exactly as issued (older drawing too), and listed', async () => {
    const made = await issueSeptember(3)
    const [abc] = await loadAll('2026-09', [BRN])
    const outcome = buildCompany(abc, ON)
    if (outcome.kind === 'skipped') throw new Error('skipped')
    expect(outcome.fromIssued.map((item) => item.name)).toEqual(made.documents.map((doc) => doc.employeeName))
    expect(outcome.fromIssued.every((item) => item.revision === 2)).toBe(true)
    expect(outcome.documents.every((doc) => doc.drawing === 3)).toBe(true)
    const report = reportText([outcome], '2026-09', '2026-10-25')
    expect(report).toContain(`  Taken from the issued copy (revision 2): ${made.documents[0].employeeName}\r\n`)
  })

  it("changed since it was issued: drawn again from this month's figures, and not listed", async () => {
    await issueSeptember(3, (lines) => {
      const figures = lines[1] as { totals: { net: number } }
      figures.totals = { ...figures.totals, net: figures.totals.net + 100 }
    })
    const [abc] = await loadAll('2026-09', [BRN])
    const outcome = buildCompany(abc, ON)
    if (outcome.kind === 'skipped') throw new Error('skipped')
    expect(outcome.fromIssued).toEqual([])
    expect(outcome.documents.every((doc) => doc.drawing === DRAWING_VERSION)).toBe(true)
  })

  it("not issued: drawn from this month's figures", async () => {
    const [abc] = await loadAll('2026-09', [BRN])
    const outcome = buildCompany(abc, ON)
    if (outcome.kind === 'skipped') throw new Error('skipped')
    expect(outcome.fromIssued).toEqual([])
  })
})

/** The computations of the payslips the batch makes for a company, in the same order. */
function buildCompanyComputations(bundle: CompanyBundle) {
  const imported = importPayrollRows(bundle.employees, { period: bundle.period })
  if (!imported.ok || !bundle.template) throw new Error('fixture')
  const read = readBody(bundle.template.body)
  if (!read.ok) throw new Error('body')
  const { template, mapping } = templateOf(read.body, { id: bundle.template.templateId, name: bundle.template.name, version: `v${bundle.template.version}` })
  return preparePayslips(imported.data, { template, mapping, rateVersions: DEFAULT_STATUTORY_RATES, period: bundle.period }, '2026-10-01')
    .filter((item) => item.document && item.computation.errors.length === 0)
    .map((item) => item.computation)
}
