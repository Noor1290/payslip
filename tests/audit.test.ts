// Audit of the payslip app with TEST data (company "TEST Co A" / "TEST Co B", employee IDs
// "TST..."): what it accepts, that the payslip totals and Net Pay match the payroll's, the two
// dates on the page, the month review's statuses, and what the Excel and PDF files hold.
//
// A test marked `it.fails` records a known problem: it states what SHOULD happen and passes only
// while the app still does otherwise. A test named "evidence" records what the app does today.

import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUTORY_RATES } from '../src/data/defaultStatutoryRates'
import { payslipFileNames, preparePayslips, type PreparedPayslip } from '../src/lib/build'
import { formatPeriod, formatShortDate, todayIso } from '../src/lib/dates'
import { buildIssue } from '../src/lib/issueBuild'
import { issueBatch, loadMonth, ratesSnapshot } from '../src/lib/issueStore'
import { documentTexts } from '../src/lib/layoutModel'
import { baselineFromIssued, compareMonth, currentPayslips, STATUS_TEXT, type MonthComparison } from '../src/lib/monthCompare'
import { importPayrollText, type ImportedPayroll, type PayrollRow } from '../src/lib/payrollFile'
import { ratesFor } from '../src/lib/statutoryRates'
import { DEFAULT_TABLE_MAPPING, mappableKeys, TABLE_TEMPLATE, type TemplateMapping } from '../src/lib/template'
import { BUILT_IN_BODY, templateOf } from '../src/lib/templateBody'
import { sheetNames, writePayslipWorkbook } from '../src/writers/excelWriter'
import { writePayslipPdf } from '../src/writers/pdfWriter'
import { fakeHub } from './fakeHubPort'
import { readFont } from './helpers'
import { readWorkbook } from './readExcel'
import { readPdf } from './readPdf'

const BRN_A = 'TEST-BRN-A'
const TEMPLATE_ID = '20000000-0000-4000-8000-0000000000aa'

/** One employee as the payroll app exports them, with the columns the payslip reads. */
function employee(id: string, other: string, figures: { basic: number; increment?: number; allowances?: number; travelling?: number; aged60?: boolean; paye?: number }): PayrollRow {
  const increment = figures.increment ?? 0
  const allowances = figures.allowances ?? 0
  const travelling = figures.travelling ?? 0
  const newBasic = figures.basic + increment
  const gross = newBasic + allowances + travelling
  const cents = (value: number) => Math.round(value * 100) / 100
  const csg = cents(newBasic * (newBasic > 50000 ? 0.03 : 0.015))
  const nsf = figures.aged60 ? 0 : cents(Math.min(gross, 29710) * 0.01)
  const paye = figures.paye ?? 0
  const deductions = cents(csg + nsf + paye)
  return {
    ID: id,
    Surname: 'TESTER',
    'Other names': other,
    'Basic Salary': figures.basic,
    'Govt Increment': increment,
    'New Basic Salary': newBasic,
    Allowances: allowances,
    Emoluments: newBasic + allowances,
    Travelling: travelling,
    'Gross Pay': gross,
    'Age 60+': figures.aged60 ? 'Yes' : 'No',
    'Employee CSG': csg,
    'Employee NSF': nsf,
    PAYE: paye,
    'Total deductions': deductions,
    'Net Pay': cents(gross - deductions),
    CSG: cents(newBasic * (newBasic > 50000 ? 0.06 : 0.03)),
    NSF: cents(gross * 0.025),
    'Company Name': 'TEST Co A',
    Address: '1 Test Street\nTestville',
    BRN: BRN_A,
  }
}

/** September 2026 for TEST Co A. Figures worked out by hand in the comments. */
const SEPTEMBER: PayrollRow[] = [
  // 18,115 + 635 = 18,750; + 1,250 travelling = 20,000 gross; CSG 281.25; NSF 200; net 19,518.75
  employee('TST001', 'Alpha', { basic: 18115, increment: 635, travelling: 1250 }),
  // 100,000 gross; CSG 3% = 3,000; aged 60+ so NSF 0; PAYE 8,600; net 88,400
  employee('TST002', 'Beta', { basic: 95000, increment: 5000, aged60: true, paye: 8600 }),
  // 60,000 + 2,500.50 = 62,500.50 gross; CSG 1,800; NSF 297.10; PAYE 2,450.05; net 57,953.35
  employee('TST003', 'Gamma', { basic: 60000, allowances: 2500.5, paye: 2450.05 }),
]

function imported(rows: readonly PayrollRow[], fileName = 'TEST Co A-pdf-fill-2026-09.json'): ImportedPayroll {
  const result = importPayrollText(JSON.stringify(rows), fileName)
  if (!result.ok) throw new Error(`The TEST rows did not import: ${JSON.stringify(result.errors)}`)
  return result.data
}

function prepare(rows: readonly PayrollRow[], period = '2026-09', mapping: TemplateMapping = DEFAULT_TABLE_MAPPING, issueDate = '2026-09-28'): PreparedPayslip[] {
  return preparePayslips(imported(rows), { template: TABLE_TEMPLATE, mapping, rateVersions: DEFAULT_STATUTORY_RATES, period }, issueDate)
}

describe('importing the payroll export', () => {
  it('reads the company, its two address lines and the month from the file name', () => {
    const data = imported(SEPTEMBER)
    expect(data.company).toEqual({ name: 'TEST Co A', brn: BRN_A, addressLines: ['1 Test Street', 'Testville'] })
    expect(data.period).toBe('2026-09')
    expect(data.rows.map((row) => row.ID)).toEqual(['TST001', 'TST002', 'TST003'])
  })

  it('reads the same employee ID in two companies as two separate files, each with its own figures', () => {
    const a = imported(SEPTEMBER.slice(0, 1))
    const b = imported([{ ...employee('TST001', 'Other', { basic: 77000 }), 'Company Name': 'TEST Co B', BRN: 'TEST-BRN-B' }], 'TEST Co B-pdf-fill-2026-09.json')
    expect([a.company.brn, a.rows[0]['Net Pay']]).toEqual([BRN_A, 19518.75])
    expect([b.company.brn, b.rows[0]['Net Pay']]).toEqual(['TEST-BRN-B', 74392.9])
  })

  it('refuses one file that holds two companies, and the same ID twice, without printing an ID', () => {
    const mixed = importPayrollText(JSON.stringify([SEPTEMBER[0], { ...SEPTEMBER[1], 'Company Name': 'TEST Co B', BRN: 'TEST-BRN-B' }]), 'x-2026-09.json')
    expect(mixed.ok).toBe(false)
    if (!mixed.ok) expect(mixed.errors.map((error) => error.message).join(' ')).toContain('mixes more than one company')

    const twice = importPayrollText(JSON.stringify([SEPTEMBER[0], SEPTEMBER[0]]), 'x-2026-09.json')
    expect(twice.ok).toBe(false)
    if (!twice.ok) {
      expect(twice.errors.map((error) => error.message)).toEqual(['Row 2: ID is the same as row 1.'])
      expect(JSON.stringify(twice.errors)).not.toContain('TST001')
    }
  })

  it('refuses a file exported without Company Details, and says what to tick', () => {
    const bare = SEPTEMBER.map(({ 'Company Name': _name, Address: _address, BRN: _brn, ...rest }) => rest)
    const result = importPayrollText(JSON.stringify(bare), 'x-2026-09.json')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0].message).toBe('"Company Name" is missing from the data. To include it, tick Company Details in the payroll export.')
  })
})

describe('the payslip against the payroll', () => {
  const prepared = prepare(SEPTEMBER)

  it('every payslip is ready: no error, and the three totals match the payroll exactly', () => {
    for (const { computation, document } of prepared) {
      expect(computation.errors, computation.employeeName).toEqual([])
      expect(document, computation.employeeName).not.toBeNull()
      expect(computation.checks.map((check) => [check.id, check.kind, check.diffCents])).toEqual([
        ['gross', 'match', 0],
        ['deductions', 'match', 0],
        ['net', 'match', 0],
      ])
    }
  })

  it('Total Earnings, Total Deductions and Net Pay are the payroll figures, to the cent', () => {
    expect(prepared.map(({ computation }) => computation.totals)).toEqual([
      { earnings: 2_000_000, deductions: 48_125, net: 1_951_875 },
      { earnings: 10_000_000, deductions: 1_160_000, net: 8_840_000 },
      { earnings: 6_250_050, deductions: 454_715, net: 5_795_335 },
    ])
    prepared.forEach(({ computation }, index) => {
      expect(computation.totals!.net).toBe(Math.round(Number(SEPTEMBER[index]['Net Pay']) * 100))
    })
  })

  it('the CSG and NSF lines are the EMPLOYEE figures; the employer columns "CSG" and "NSF" are never used', () => {
    const lines = (index: number) => Object.fromEntries(prepared[index].computation.lines.map((line) => [line.id, [line.sourceKey, line.cents]]))
    expect(lines(0).csg).toEqual(['Employee CSG', 28_125])
    expect(lines(0).nsf).toEqual(['Employee NSF', 20_000])
    expect(lines(1).nsf).toEqual(['Employee NSF', 0])
    expect(lines(2).csg).toEqual(['Employee CSG', 180_000])
    // The employer's CSG for TST001 is 562.50: it is nowhere on the payslip.
    expect(documentTexts(prepared[0].document!).join('|')).not.toContain('562.50')
  })

  it('a difference of one rupee from the payroll total is reported, not hidden, and blocks until accepted', () => {
    const [off] = prepare([{ ...SEPTEMBER[0], 'Net Pay': 19519.75 }])
    expect(off.computation.checks.find((check) => check.id === 'net')).toMatchObject({ kind: 'difference', diffCents: -100, payslipCents: 1_951_875, payrollCents: 1_951_975 })
  })

  it('a missing employee CSG is an error naming the employee and the line; the payslip is not drawn with a zero', () => {
    const { 'Employee CSG': _gone, ...withoutCsg } = SEPTEMBER[0]
    const [broken] = prepare([withoutCsg])
    expect(broken.document).toBeNull()
    expect(broken.computation.totals).toBeNull()
    expect(broken.computation.errors.map((error) => [error.code, error.lineId])).toEqual([['missing-key', 'csg']])
    expect(broken.computation.errors[0].message).toContain('Employee CSG')
  })

  it('the text "Error" in a figure (what the payroll app now exports for a figure in error) is an error here too, never a zero', () => {
    const [broken] = prepare([{ ...SEPTEMBER[0], PAYE: 'Error' }])
    expect(broken.document).toBeNull()
    expect(broken.computation.errors).toHaveLength(1)
    expect(broken.computation.errors[0].lineId).toBe('paye')
  })

  it('a figure with more than 2 decimals is an error, never rounded', () => {
    const [broken] = prepare([{ ...SEPTEMBER[0], 'Basic Salary': 18115.005 }])
    expect(broken.document).toBeNull()
    expect(broken.computation.errors[0].lineId).toBe('basic')
  })
})

describe('two payroll columns both called "CSG"', () => {
  // The payroll app now exports two columns that share a name as "CSG (Employee Contribution)"
  // and "CSG (Employer Contribution)". The built-in template reads the employee's CSG from
  // "Employee CSG" only.
  const { 'Employee CSG': employeeCsg, CSG: employerCsg, ...rest } = SEPTEMBER[0]
  const clashing: PayrollRow = { ...rest, 'CSG (Employee Contribution)': employeeCsg, 'CSG (Employer Contribution)': employerCsg }

  it('both figures arrive, separately, under their new names', () => {
    const data = imported([clashing])
    expect(data.keys).toEqual(expect.arrayContaining(['CSG (Employee Contribution)', 'CSG (Employer Contribution)']))
    expect([data.rows[0]['CSG (Employee Contribution)'], data.rows[0]['CSG (Employer Contribution)']]).toEqual([281.25, 562.5])
  })

  it('with the built-in template the payslip is held back with an error about "Employee CSG": nothing is guessed', () => {
    const [held] = prepare([clashing])
    expect(held.document).toBeNull()
    expect(held.computation.errors.map((error) => error.lineId)).toEqual(['csg'])
    expect(held.computation.errors[0].message).toContain('Employee CSG')
  })

  it('once the CSG line is pointed at "CSG (Employee Contribution)", the payslip matches the payroll', () => {
    const mapping: TemplateMapping = { ...DEFAULT_TABLE_MAPPING, lines: { ...DEFAULT_TABLE_MAPPING.lines, csg: { key: 'CSG (Employee Contribution)', required: true } } }
    const [ready] = prepare([clashing], '2026-09', mapping)
    expect(ready.computation.errors).toEqual([])
    expect(ready.computation.totals).toEqual({ earnings: 2_000_000, deductions: 48_125, net: 1_951_875 })
    expect(ready.computation.checks.every((check) => check.kind === 'match')).toBe(true)
  })

  // The template editor never offers the employer columns "CSG" and "NSF" for a payslip line.
  // That protection goes by the exact names, so it does not know the employer column under its
  // new name.
  it.fails('BUG: the employer column "CSG (Employer Contribution)" is not offered for a payslip line', () => {
    const data = imported([clashing])
    expect(mappableKeys(data.keys, data.rows, DEFAULT_TABLE_MAPPING)).not.toContain('CSG (Employer Contribution)')
  })

  it('evidence: the plain employer names are blocked, as designed', () => {
    const data = imported(SEPTEMBER)
    const offered = mappableKeys(data.keys, data.rows, DEFAULT_TABLE_MAPPING)
    expect(offered).not.toContain('CSG')
    expect(offered).not.toContain('NSF')
    expect(offered).toEqual(expect.arrayContaining(['Employee CSG', 'Employee NSF', 'Basic Salary']))
  })
})

describe('the two dates on the payslip', () => {
  it('"Pay period" shows the selected month, whatever today is', () => {
    for (const period of ['2026-09', '2026-10', '2027-01']) {
      const [first] = prepare(SEPTEMBER.slice(0, 1), period)
      expect(documentTexts(first.document!)).toContain(`Pay period: ${formatPeriod(period)}`)
    }
  })

  it('the date beside the signatures is the date given, shown as d-mmm-yy; the app starts it at today', () => {
    const today = todayIso()
    const [first] = prepare(SEPTEMBER.slice(0, 1), '2026-09', DEFAULT_TABLE_MAPPING, today)
    expect(documentTexts(first.document!)).toContain(formatShortDate(today))
    expect(formatShortDate('2026-10-11')).toBe('11-Oct-26')
    expect(todayIso(new Date(2026, 9, 11, 23, 59))).toBe('2026-10-11')
  })

  it('the pay month and the date are independent: a September payslip can carry an October date', () => {
    const [first] = prepare(SEPTEMBER.slice(0, 1), '2026-09', DEFAULT_TABLE_MAPPING, '2026-10-05')
    const texts = documentTexts(first.document!)
    expect(texts).toContain('Pay period: September 2026')
    expect(texts).toContain('5-Oct-26')
  })
})

describe('the month review', () => {
  const { template, mapping } = templateOf(BUILT_IN_BODY, { id: TEMPLATE_ID, name: 'Monthly payslip', version: 'v1' })
  const templateRef = { id: TEMPLATE_ID, version: 'v1' }

  /** A stand-in dashboard for TEST Co A with one published template. */
  function dashboard() {
    const made = fakeHub()
    made.hub.state.company = { name: 'TEST Co A', brn: BRN_A }
    made.hub.state.templates.push({ id: TEMPLATE_ID, name: 'Monthly payslip', body: { ...BUILT_IN_BODY }, revision: 1, updatedAt: '2026-08-20T09:00:00+04:00', by: 'you' })
    made.hub.state.versions.push({ templateId: TEMPLATE_ID, version: 1, name: 'Monthly payslip', body: { ...BUILT_IN_BODY }, publishedAt: '2026-08-20T09:05:00+04:00', by: 'you' })
    return made
  }
  const month = (rows: readonly PayrollRow[], period: string) => {
    const data = imported(rows, `TEST Co A-pdf-fill-${period}.json`)
    const prepared = preparePayslips(data, { template, mapping, rateVersions: DEFAULT_STATUTORY_RATES, period }, `${period}-28`)
    return { data, prepared, period, rates: ratesFor(DEFAULT_STATUTORY_RATES, period) }
  }
  type Month = ReturnType<typeof month>

  /** Issues a month into the stand-in dashboard, everyone selected (or only the rows given). */
  async function issue(port: ReturnType<typeof fakeHub>['port'], m: Month, selected?: number[]): Promise<void> {
    const loaded = await loadMonth(port, BRN_A, m.period)
    if (!loaded.ok) throw new Error(loaded.failure.title)
    const built = buildIssue({
      data: m.data,
      period: m.period,
      prepared: m.prepared,
      selected: selected ?? m.data.rows.map((_, index) => index),
      accepted: {},
      reasons: {},
      choice: { kind: 'published', templateId: TEMPLATE_ID, name: 'Monthly payslip', version: 1, body: BUILT_IN_BODY },
      previewingDraft: false,
      rates: m.rates,
      month: loaded.payslips,
    })
    if (!built.ok) throw new Error(built.problems.join(' '))
    const outcome = await issueBatch(port, { brn: BRN_A, period: m.period, payslips: built.payslips })
    if (outcome.end !== 'saved') throw new Error(`Not issued: ${outcome.end}`)
  }

  /** This month compared with what the dashboard holds for last month. */
  async function review(port: ReturnType<typeof fakeHub>['port'], m: Month, lastPeriod: string): Promise<MonthComparison> {
    const last = await loadMonth(port, BRN_A, lastPeriod)
    if (!last.ok) throw new Error(last.failure.title)
    return compareMonth(m.period, currentPayslips(m.data, m.prepared, templateRef, ratesSnapshot(m.rates)), baselineFromIssued(lastPeriod, last.payslips))
  }
  const statuses = (comparison: MonthComparison) => comparison.rows.map((row) => [row.employeeName, STATUS_TEXT[row.status]])

  it('first month: nothing was issued before, so everyone is New', async () => {
    const { port } = dashboard()
    const comparison = await review(port, month(SEPTEMBER, '2026-09'), '2026-08')
    expect(statuses(comparison)).toEqual([
      ['TESTER Alpha', 'New'],
      ['TESTER Beta', 'New'],
      ['TESTER Gamma', 'New'],
    ])
  })

  it('the same figures the month after: everyone is Unchanged', async () => {
    const { port } = dashboard()
    await issue(port, month(SEPTEMBER, '2026-09'))
    const comparison = await review(port, month(SEPTEMBER, '2026-10'), '2026-09')
    expect(statuses(comparison)).toEqual([
      ['TESTER Alpha', 'Unchanged'],
      ['TESTER Beta', 'Unchanged'],
      ['TESTER Gamma', 'Unchanged'],
    ])
    expect(comparison.counts).toMatchObject({ unchanged: 3, changed: 0, new: 0, left: 0 })
  })

  it('one Basic Salary changed: only that employee is Changed, with the right differences', async () => {
    const { port } = dashboard()
    await issue(port, month(SEPTEMBER, '2026-09'))
    // TST001 gets a rise of 1,000: basic 19,115; new basic 19,750; CSG 296.25 (+15); NSF 210 (+10).
    const october = [employee('TST001', 'Alpha', { basic: 19115, increment: 635, travelling: 1250 }), SEPTEMBER[1], SEPTEMBER[2]]
    const comparison = await review(port, month(october, '2026-10'), '2026-09')
    expect(statuses(comparison)).toEqual([
      ['TESTER Alpha', 'Changed'],
      ['TESTER Beta', 'Unchanged'],
      ['TESTER Gamma', 'Unchanged'],
    ])
    const changed = comparison.rows[0]
    expect(changed.lines.filter((line) => line.changed).map((line) => [line.label, line.last, line.current, line.difference])).toEqual([
      ['Basic Salary', 1_811_500, 1_911_500, 100_000],
      ['CSG', 28_125, 29_625, 1_500],
      ['NSF', 20_000, 21_000, 1_000],
    ])
    expect(changed.totals.map((total) => [total.label, total.difference])).toEqual([
      ['Total Earnings', 100_000],
      ['Total Deductions', 2_500],
      ['Net Pay', 97_500],
    ])
    // The others show no changed line at all.
    for (const row of comparison.rows.slice(1)) expect(row.lines.some((line) => line.changed)).toBe(false)
  })

  it('a change of one cent is a change; a new joiner is New; someone no longer in the data has Left', async () => {
    const { port } = dashboard()
    await issue(port, month(SEPTEMBER, '2026-09'))
    const october = [
      SEPTEMBER[0],
      employee('TST002', 'Beta', { basic: 95000, increment: 5000, aged60: true, paye: 8600.01 }),
      employee('TST004', 'Delta', { basic: 30000 }),
    ]
    const comparison = await review(port, month(october, '2026-10'), '2026-09')
    expect(statuses(comparison)).toEqual([
      ['TESTER Alpha', 'Unchanged'],
      ['TESTER Beta', 'Changed'],
      ['TESTER Delta', 'New'],
      ['TESTER Gamma', 'Left'],
    ])
  })

  it('only the employees ticked are issued: the others stay not issued and are New next month', async () => {
    const { port, hub } = dashboard()
    const september = month(SEPTEMBER, '2026-09')
    await issue(port, september, [0, 2])
    expect(hub.state.issued.map((row) => row.national_id).sort()).toEqual(['TST001', 'TST003'])
    const comparison = await review(port, month(SEPTEMBER, '2026-10'), '2026-09')
    expect(statuses(comparison)).toEqual([
      ['TESTER Alpha', 'Unchanged'],
      ['TESTER Beta', 'New'],
      ['TESTER Gamma', 'Unchanged'],
    ])
  })

  it('the history is kept per month: issuing October leaves September as it was issued', async () => {
    const { port } = dashboard()
    await issue(port, month(SEPTEMBER, '2026-09'))
    const october = [employee('TST001', 'Alpha', { basic: 19115, increment: 635, travelling: 1250 }), SEPTEMBER[1], SEPTEMBER[2]]
    await issue(port, month(october, '2026-10'))
    const [sept, oct] = [await loadMonth(port, BRN_A, '2026-09'), await loadMonth(port, BRN_A, '2026-10')]
    if (!sept.ok || !oct.ok) throw new Error('A month could not be loaded')
    const basicOf = (payslips: typeof sept.payslips) => baselineFromIssued('', payslips).payslips.length
    expect([basicOf(sept.payslips), basicOf(oct.payslips)]).toEqual([3, 3])
    const net = (period: string, payslips: typeof sept.payslips) =>
      baselineFromIssued(period, payslips).payslips.find((p) => p.nationalId === 'TST001')!.side!.figures.totals.net
    expect([net('2026-09', sept.payslips), net('2026-10', oct.payslips)]).toEqual([1_951_875, 2_049_375])
  })
})

describe('the files', () => {
  const prepared = prepare(SEPTEMBER)
  const docs = prepared.map((p) => p.document!)

  it('Excel: one sheet per employee; the three totals are live formulas with the right figure cached', async () => {
    const bytes = await writePayslipWorkbook(docs)
    expect(sheetNames(docs.map((doc) => doc.employeeName))).toHaveLength(3)
    const sheets = await readWorkbook(bytes)
    expect(sheets).toHaveLength(3)
    sheets.forEach((sheet, index) => {
      const formulas = Object.values(sheet.cells).filter((cell) => cell.formula)
      const totals = prepared[index].computation.totals!
      expect(formulas.map((cell) => cell.result).sort((a, b) => Number(a) - Number(b))).toEqual(
        [totals.deductions / 100, totals.net / 100, totals.earnings / 100].sort((a, b) => a - b),
      )
      // Every other figure is a plain number copied from the payroll.
      const values = Object.values(sheet.cells).map((cell) => cell.value)
      expect(values).toContain(Number(SEPTEMBER[index]['Basic Salary']))
      expect(values).toContain(Number(SEPTEMBER[index]['Employee CSG']) || 0)
    })
  })

  // The brief asks for an "Excel with VLOOKUP" format: one payslip sheet that fills in from an
  // employee ID. That is the lookup template, Phase 6, shown as "Coming soon".
  it('evidence (MISSING): there is no lookup workbook: no VLOOKUP, INDEX/MATCH or IFERROR in the Excel file', async () => {
    const sheets = await readWorkbook(await writePayslipWorkbook(docs))
    const formulas = sheets.flatMap((sheet) => Object.values(sheet.cells).map((cell) => cell.formula ?? ''))
    expect(formulas.some((formula) => /LOOKUP|INDEX|MATCH|IFERROR/i.test(formula))).toBe(false)
  })

  it('PDF: one A4 page per employee, with the name, the pay period, the date and the payroll\'s Net Pay', async () => {
    const fonts = { regular: readFont('regular'), bold: readFont('bold') }
    for (const [index, doc] of docs.entries()) {
      const pdf = await readPdf(await writePayslipPdf(doc, fonts))
      const texts = pdf.texts.map((t) => t.text)
      expect(pdf.pages).toBe(1)
      expect(texts).toContain(prepared[index].computation.employeeName)
      expect(texts).toContain('Pay period: September 2026')
      expect(texts).toContain('28-Sep-26')
      expect(texts).toContain(['19,518.75', '88,400', '57,953.35'][index])
    }
  })

  it('PDF file names carry the name and the month, never the ID; two people with one name get (2)', () => {
    expect(payslipFileNames(prepared.map((p) => p.computation.employeeName), '2026-09')).toEqual([
      'TESTER Alpha - 2026-09.pdf',
      'TESTER Beta - 2026-09.pdf',
      'TESTER Gamma - 2026-09.pdf',
    ])
    expect(payslipFileNames(['TESTER Alpha', 'tester alpha'], '2026-09')).toEqual(['TESTER Alpha - 2026-09.pdf', 'tester alpha - 2026-09 (2).pdf'])
  })
})
