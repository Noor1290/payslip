// "From your file", Stage 2 prompt, Stage 4: several companies at once with a layout from a file
// (each company's own values, its own checks, the issued copy when unchanged, the report and the
// zip), against the stand-in dashboard. TEST companies and fake data only.

import { strFromU8, unzipSync } from 'fflate'
import { PDFDocument } from 'pdf-lib'
import { beforeEach, describe, expect, it } from 'vitest'
import type { FakeHub } from '../scripts/lib/fake-hub.mjs'
import { fakeLayoutBytes } from '../scripts/lib/fake-layout.mjs'
import { DEFAULT_STATUTORY_RATES } from '../src/data/defaultStatutoryRates'
import { writeCompaniesZip } from '../src/lib/exports'
import type { HubPort } from '../src/lib/hubWire'
import { buildIssue } from '../src/lib/issueBuild'
import { buildCompany, companyPaths, folderNames, reportText, type CompanyOutcome } from '../src/lib/manyPayslips'
import { askForCompanies, loadCompany, type CompanyBundle } from '../src/lib/manyStore'
import { importPayrollRows } from '../src/lib/payrollFile'
import { checkKey, ROUNDING_REASON, withReason, type Reasons } from '../src/lib/reasons'
import { formatFor, type SheetBody, type Source } from '../src/lib/sheetBody'
import { isSheetDocument, prepareSheetPayslips, type SheetDocument } from '../src/lib/sheetDocument'
import { setCell } from '../src/lib/sheetEdit'
import { readSheetFile } from '../src/lib/sheetRead'
import type { AcceptedChecks } from '../src/lib/payslip'
import { BUILT_IN_BODY } from '../src/lib/templateBody'
import { checkCompanies, initialTicks, planCompanies, publishToCompanies } from '../src/lib/publishMany'
import { OWN_VALUES_NOTE } from '../src/components/PublishManyDialog'
import { BRN, fakeHub } from './fakeHubPort'
import { readFixtureText, readFont } from './helpers'

const SEPTEMBER = JSON.parse(readFixtureText('ABC Co Ltd-pdf-fill-2026-09.json')) as Record<string, unknown>[]
const rowsOf = (name: string, brn: string) => SEPTEMBER.map((row) => ({ ...row, 'Company Name': name, BRN: brn, Address: `${name} House, Fake Road, Port Louis` }))
const LAYOUT_ID = '20000000-0000-4000-8000-000000000201'
const TABLE_ID = '20000000-0000-4000-8000-000000000202'
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
const ON = { issueDate: '2026-10-01', acceptRounding: true }
const OFF = { issueDate: '2026-10-01', acceptRounding: false }

/** The fake layout, its cells chosen as the owner would, B11 a fixed value, an empty required cell. */
async function layout(): Promise<SheetBody> {
  let { body } = await readSheetFile('Monthly payslip.xlsx', await fakeLayoutBytes())
  const set = (ref: string, source: Source, extra: object = {}) => {
    const row = Number(ref.slice(1)) - 1 - body.firstRow
    const col = ref.charCodeAt(0) - 65 - body.firstColumn
    body = setCell(body, row, col, (cell) => ({ ...cell, source, format: formatFor(source), ...extra }))
  }
  set('B5', { type: 'company', field: 'name' })
  set('B6', { type: 'company', field: 'address' })
  set('C10', { type: 'name' })
  set('B11', { type: 'fixed', value: 'NIC :' })
  set('C11', { type: 'employee', key: 'ID' })
  set('C14', { type: 'payroll', key: 'Basic Salary' }, { side: 'earnings' })
  set('E14', { type: 'payroll', key: 'Employee CSG' }, { side: 'deductions' })
  set('C18', { type: 'payroll', key: 'Gross Pay' }, { total: 'earnings' })
  set('E18', { type: 'payroll', key: 'Total deductions' }, { total: 'deductions' })
  set('E20', { type: 'calc', terms: [{ sign: 1, of: { type: 'column', key: 'Gross Pay' }, times: null, round: 'none' }, { sign: -1, of: { type: 'column', key: 'Total deductions' }, times: null, round: 'none' }] }, { total: 'net' })
  set('C23', { type: 'date', of: 'today' })
  set('E22', { type: 'fixed', value: '' }, { required: true })
  return body
}
const idAt = (body: SheetBody, ref: string) => body.rows[Number(ref.slice(1)) - 1 - body.firstRow].cells.find((cell) => cell.col === ref.charCodeAt(0) - 65 - body.firstColumn)!.id

type Other = FakeHub['state']['others'][number]
const published = (id: string, name: string, body: object) => ({
  templates: [{ id, name, body, revision: 1, updatedAt: '', by: 'other' as const }],
  versions: [{ templateId: id, version: 1, name, body, publishedAt: '', by: 'other' as const }],
})
const company = (name: string, brn: string, more: Partial<Other>): Other => ({
  name,
  brn,
  role: 'admin',
  templates: [],
  versions: [],
  inUse: null,
  payroll: null,
  runs: { '2026-09': rowsOf(name, brn) },
  rates: [],
  ...more,
})

let hub: FakeHub
let port: HubPort
let body: SheetBody

beforeEach(async () => {
  ;({ hub, port } = fakeHub())
  body = await layout()
  hub.state.runs['2026-09'] = SEPTEMBER
  // TEST LAYOUT Ltd uses the layout, with its own value for B11; TEST TABLE Ltd the Table template.
  hub.state.others.push(
    company('TEST LAYOUT Ltd', 'C4444444', { ...published(LAYOUT_ID, 'Monthly payslip', body), ownValues: { [LAYOUT_ID]: { own_values: { [idAt(body, 'B11')]: 'National ID :' }, values_revision: 2 } } }),
    company('TEST TABLE Ltd', 'C5555555', published(TABLE_ID, 'Table', BUILT_IN_BODY)),
  )
})

async function loadAll(brns: string[]): Promise<CompanyBundle[]> {
  const allowed = await askForCompanies(port, BRN, '2026-09', brns, false)
  if (!allowed.ok) throw new Error(allowed.failure.title)
  const bundles: CompanyBundle[] = []
  for (const brn of brns) {
    const loaded = await loadCompany(port, BRN, '2026-09', brn)
    if (!loaded.ok) throw new Error(`${brn}: ${loaded.failure.title}`)
    bundles.push(loaded.bundle)
  }
  return bundles
}
const made = (outcome: CompanyOutcome) => {
  if (outcome.kind === 'skipped') throw new Error(`skipped: ${outcome.reason}`)
  return outcome
}
const textOf = (doc: SheetDocument) => doc.rows.flatMap((row) => row.cells.map((cell) => cell.text)).join(' | ')

describe('several companies with a layout from a file', () => {
  it("the dashboard sends the company's own values with its template", async () => {
    const [bundle] = await loadAll(['C4444444'])
    expect(bundle.template?.own).toEqual({ [idAt(body, 'B11')]: 'National ID :' })
  })

  it("each company's payslips are its layout's, with its own values, next to a company on the Table template", async () => {
    // Both have statutory rates in force; the layout is still not cross-checked against them.
    for (const other of hub.state.others) other.rates = RATES_WIRE
    const [layoutCo, tableCo] = await loadAll(['C4444444', 'C5555555'])
    const a = made(buildCompany(layoutCo, ON))
    const b = made(buildCompany(tableCo, ON))
    expect(a.documents.every(isSheetDocument)).toBe(true)
    expect(b.documents.some(isSheetDocument)).toBe(false)
    const first = a.documents[0] as SheetDocument
    expect(textOf(first)).toContain('National ID :')
    expect(textOf(first)).toContain('TEST LAYOUT Ltd')
    expect(textOf(first)).not.toContain('NIC :')
    // Not cross-checked against the rates.
    expect(a.ratesUsed).toBeNull()
    expect(b.ratesUsed).not.toBeNull()
  })

  it('the same checks as its Payslips page: a 0.01 net pay is included only when roundings are accepted, and listed', async () => {
    const [layoutCo] = await loadAll(['C4444444'])
    const imported = importPayrollRows(layoutCo.employees, { period: '2026-09' })
    if (!imported.ok) throw new Error('rows')
    const single = prepareSheetPayslips(imported.data, { body, own: layoutCo.template!.own, id: LAYOUT_ID, version: 'v1' }, '2026-09', '2026-10-01')
    const rounding = single.filter((item) => item.computation.checks.some((check) => check.kind === 'rounding')).map((item) => item.computation.employeeName)
    expect(rounding.length).toBeGreaterThan(0)
    const off = buildCompany(layoutCo, OFF)
    const on = made(buildCompany(layoutCo, ON))
    if (off.kind !== 'skipped') expect(off.leftOut.map((person) => person.name)).toEqual(rounding)
    expect(on.rounding.map((item) => item.name)).toEqual(expect.arrayContaining(rounding))
    expect(on.rounding[0].line).toMatch(/^Net Pay, cell E20$/)
  })

  it('the report lists each empty required cell, downloaded anyway, and the small print once for the company', async () => {
    const [layoutCo] = await loadAll(['C4444444'])
    const outcome = made(buildCompany(layoutCo, ON))
    expect(outcome.required).toHaveLength(outcome.documents.length)
    expect(outcome.smallPrint).toMatch(/^This layout prints at \d+% of its size in Excel/)
    const report = reportText([outcome], '2026-09', '2026-10-01')
    expect(report).toContain(`A required cell is empty, downloaded anyway: ${outcome.documents[0].employeeName}, cell E22 (Signature Employer)`)
    expect(report.split(outcome.smallPrint!).length - 1).toBe(1)
  })

  it('the zip holds the PDFs of the layout, one A4 page each, the combined PDF and the Excel file', async () => {
    const [layoutCo, tableCo] = await loadAll(['C4444444', 'C5555555'])
    const outcomes = [made(buildCompany(layoutCo, ON)), made(buildCompany(tableCo, ON))]
    const folders = folderNames(outcomes)
    const files = outcomes.map((outcome, index) => ({ ...companyPaths(folders[index], outcome.company, '2026-09', outcome.documents), documents: outcome.documents }))
    const fonts = { regular: readFont('regular'), bold: readFont('bold'), italic: readFont('italic' as never), boldItalic: readFont('bolditalic' as never) }
    const zip = unzipSync(await writeCompaniesZip(files, { path: 'Report - 2026-09.txt', text: reportText(outcomes, '2026-09', '2026-10-01') }, fonts))
    const pdf = await PDFDocument.load(zip[files[0].payslips[0]])
    expect(pdf.getPageCount()).toBe(1)
    expect(pdf.getPage(0).getSize()).toMatchObject({ width: 595.28, height: 841.89 })
    expect((await PDFDocument.load(zip[files[0].combined])).getPageCount()).toBe(outcomes[0].documents.length)
    expect(zip[files[0].workbook].length).toBeGreaterThan(0)
    expect(strFromU8(zip['Report - 2026-09.txt'])).toContain('TEST LAYOUT Ltd (BRN C4444444)')
  })

  it('a payslip issued for the month and unchanged is taken from its stored copy, exactly as issued', async () => {
    const [layoutCo] = await loadAll(['C4444444'])
    const imported = importPayrollRows(layoutCo.employees, { period: '2026-09' })
    if (!imported.ok) throw new Error('rows')
    // Issued on 30 September, from the company's own Payslips page.
    const prepared = prepareSheetPayslips(imported.data, { body, own: layoutCo.template!.own, id: LAYOUT_ID, version: 'v1' }, '2026-09', '2026-09-30')
    const accepted: Record<number, AcceptedChecks> = {}
    let reasons: Reasons = {}
    for (const { computation } of prepared) {
      for (const check of computation.checks) {
        if (check.kind !== 'rounding') continue
        accepted[computation.rowIndex] = { ...accepted[computation.rowIndex], [check.id]: check.diffCents! }
        reasons = withReason(reasons, computation.rowIndex, checkKey(check.id), ROUNDING_REASON)
      }
    }
    // The required cell, filled in for that company only, as its admin would have.
    const filled = prepareSheetPayslips(imported.data, { body, own: { ...layoutCo.template!.own, [idAt(body, 'E22')]: 'Director' }, id: LAYOUT_ID, version: 'v1' }, '2026-09', '2026-09-30')
    const issue = buildIssue({
      data: imported.data,
      period: '2026-09',
      prepared: filled,
      selected: [0],
      accepted,
      reasons,
      choice: { kind: 'published', templateId: LAYOUT_ID, name: 'Monthly payslip', version: 1, body },
      previewingDraft: false,
      rates: null,
      month: [],
    })
    if (!issue.ok) throw new Error(issue.problems.join(' '))
    const [payslip] = issue.payslips
    hub.state.others[hub.state.others.length - 2].issued = [
      { national_id: payslip.nationalId, period: '2026-09', revision: 1, template_id: LAYOUT_ID, template_version: 1, rates: null, lines: payslip.lines, accepted_differences: payslip.acceptedDifferences, issued_at: '2026-09-30T10:00:00+04:00', by: 'you' },
    ]
    hub.state.others[hub.state.others.length - 2].ownValues![LAYOUT_ID].own_values[idAt(body, 'E22')] = 'Director'
    const [again] = await loadAll(['C4444444'])
    // Made on 1 October: today's date differs, so only the stored copy has 30 September.
    const outcome = made(buildCompany(again, ON))
    expect(outcome.fromIssued).toEqual([{ name: payslip.name, revision: 1 }])
    const document = outcome.documents.find((doc) => doc.employeeName === payslip.name) as SheetDocument
    expect(textOf(document)).toContain('30-Sep-26')
    expect(textOf(outcome.documents.find((doc) => doc.employeeName !== payslip.name) as SheetDocument)).toContain('1-Oct-26')
    expect(prepared).toHaveLength(imported.data.rows.length)
  })
})

describe('"Publish to" with a layout from a file', () => {
  const COLUMNS = ['ID', 'Surname', 'Other names', 'Basic Salary', 'Gross Pay', 'Employee CSG', 'Employee NSF', 'PAYE', 'Total deductions', 'Net Pay']
  const SELF_ID = '20000000-0000-4000-8000-000000000001'

  beforeEach(() => {
    hub.state.templates.push({ id: SELF_ID, name: 'Monthly payslip', body, revision: 1, updatedAt: '', by: 'you' })
    hub.state.versions.push({ templateId: SELF_ID, version: 1, name: 'Monthly payslip', body, publishedAt: '', by: 'you' })
    hub.state.ids = 1
    for (const other of hub.state.others) other.payroll = { period: '2026-09', employees: 7, columns: COLUMNS }
    // A third TEST company, with no template yet, and one whose payroll has no Gross Pay.
    hub.state.others.push(company('TEST NEW Ltd', 'C6666666', { payroll: { period: '2026-09', employees: 7, columns: COLUMNS } }))
    hub.state.others.push(company('TEST SHORT Ltd', 'C7777777', { payroll: { period: '2026-09', employees: 7, columns: COLUMNS.filter((key) => key !== 'Gross Pay') } }))
  })

  it('checks each company against the columns the layout reads, publishes the cells, and never copies own values', async () => {
    const checked = await checkCompanies(port, BRN, 'Monthly payslip')
    if (!checked.ok) throw new Error(checked.failure.title)
    const plans = planCompanies(checked.companies, { name: 'Monthly payslip', body, draftRevision: 1, publishedVersion: 1 })
    // A payroll without a column the layout reads: said, and not ticked at first, as for the Table template.
    const short = plans.find((plan) => plan.brn === 'C7777777')!
    expect(short.reasons).toEqual(['Its payroll of September 2026 has no column "Gross Pay"'])
    expect(initialTicks(plans, 'all').has('C7777777')).toBe(false)
    expect(initialTicks(plans, 'all').has('C6666666')).toBe(true)
    const ticked = new Set(['C4444444', 'C6666666'])
    const results = await publishToCompanies(port, { brn: BRN, name: 'Monthly payslip', body }, plans, ticked)
    expect(results.filter((result) => result.outcome === 'updated').map((result) => result.brn).sort()).toEqual([BRN, 'C4444444', 'C6666666'].sort())

    // Each company's payslips: its own value where it has one, the value for all companies otherwise.
    const [kept, fresh] = await loadAll(['C4444444', 'C6666666'])
    expect(kept.template?.body).toEqual(JSON.parse(JSON.stringify(body)))
    expect(kept.template?.own).toEqual({ [idAt(body, 'B11')]: 'National ID :' })
    expect(fresh.template?.own).toEqual({})
    expect(textOf(made(buildCompany(kept, ON)).documents[0] as SheetDocument)).toContain('National ID :')
    expect(textOf(made(buildCompany(fresh, ON)).documents[0] as SheetDocument)).toContain('NIC :')
  })

  it('the dialog says that own values are not copied, in words', () => {
    expect(OWN_VALUES_NOTE).toBe('A value for one company only is not copied: each ticked company keeps its own, and a company that has none shows the value for all companies.')
  })
})
