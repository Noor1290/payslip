// Date of Employment, as the payroll data holds it. From the dashboard ("Get from dashboard") it is
// "YYYY-MM-DD"; in a PDF fill file from the payroll app it is "DD/MM/YYYY", as typed there; its name
// may be written "Date of employment". It is printed d-mmm-yy, the reference's format, on the
// payslip, in its PDF and in its Excel file. When the data has no date, the line stays blank and the
// payslip says so; when it is not a clear date, that is an error, never a guess. Fake data only.
import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUTORY_RATES } from '../src/data/defaultStatutoryRates'
import { computeAll, documentFor } from '../src/lib/build'
import { readDateOfEmployment } from '../src/lib/dates'
import { readHubPayload } from '../src/lib/hubBridge'
import { documentTexts } from '../src/lib/layoutModel'
import { importPayrollText, type ImportedPayroll } from '../src/lib/payrollFile'
import { DEFAULT_TABLE_MAPPING, TABLE_TEMPLATE } from '../src/lib/template'
import { BUILT_IN_BODY, readBody } from '../src/lib/templateBody'
import { writePayslipWorkbook } from '../src/writers/excelWriter'
import { writePayslipPdf } from '../src/writers/pdfWriter'
import { FIXTURE_NAME, readFixtureText, readFont } from './helpers'
import { readWorkbook } from './readExcel'
import { readPdf } from './readPdf'

const KEY = 'Date of Employment'
const rows = () =>
  (JSON.parse(readFixtureText(FIXTURE_NAME)) as Record<string, unknown>[]).map((row) => {
    const copy = { ...row }
    delete copy[KEY]
    return copy
  })
const fromHub = (change: (rows: Record<string, unknown>[]) => void): ImportedPayroll => {
  const sent = rows()
  change(sent)
  return readHubPayload({ dataType: 'payroll-result', rows: sent, meta: { period: '2026-09', brn: 'C1234567' } })
}
// A PDF fill JSON file from the payroll app, imported straight into this app.
const fromFile = (change: (rows: Record<string, unknown>[]) => void): ImportedPayroll => {
  const file = rows()
  change(file)
  const result = importPayrollText(JSON.stringify(file), FIXTURE_NAME)
  if (!result.ok) throw new Error(JSON.stringify(result.errors))
  return result.data
}
const settings = { template: TABLE_TEMPLATE, mapping: DEFAULT_TABLE_MAPPING, rateVersions: DEFAULT_STATUTORY_RATES, period: '2026-09' }
const payslips = (data: ImportedPayroll) =>
  computeAll(data, settings).map((computation) => {
    const document = computation.totals ? documentFor(data, computation, TABLE_TEMPLATE, '2026-09', '2026-09-28') : null
    return { computation, document, row: document ? document.rows.find((r) => r.id === 'employee-name')! : null }
  })
const NO_DATE = 'No Date of Employment in the payroll data for this employee, so that line is left blank. Type it in the payroll app.'

describe('reading a date of employment', () => {
  it.each([
    ['2021-03-15', '2021-03-15'],
    ['15/03/2021', '2021-03-15'],
    ['1/8/2026', '2026-08-01'],
    ['01-08-2026', '2026-08-01'],
    [' 29/02/2024 ', '2024-02-29'],
  ])('%j is %j', (raw, iso) => expect(readDateOfEmployment(raw)).toBe(iso))

  it.each(['31/02/2026', '13/13/2020', '2021-02-30', '2021-3-15', '15/03/21', '03/15/2021', 'since 2018', '46235'])('%j is not a clear date', (raw) =>
    expect(readDateOfEmployment(raw)).toBeNull()
  )
})

describe('Date of Employment from the dashboard ("Get from dashboard")', () => {
  it('is shown as d-mmm-yy for the employees whose row has the key; one without it is blank and says so', () => {
    const [first, second] = payslips(
      fromHub((sent) => {
        sent[0][KEY] = '2021-03-15'
      }),
    )
    expect(first.computation.dateOfEmployment).toBe('2021-03-15')
    expect(first.row!.cells.map((cell) => cell.text)).toEqual(['Name :', first.computation.employeeName, 'Date of Employment :', '15-Mar-21'])
    expect(first.row!.cells[3]).toMatchObject({ kind: 'date', isoDate: '2021-03-15' })
    expect(first.computation.warnings.filter((w) => w.code === 'no-date')).toEqual([])
    // The next employee has no date: the label is there, the date is blank, and the payslip says why.
    expect(second.computation.dateOfEmployment).toBeNull()
    expect(second.row!.cells.map((cell) => cell.text)).toEqual(['Name :', second.computation.employeeName, 'Date of Employment :'])
    expect(second.computation.errors).toEqual([])
    expect(second.computation.warnings.filter((w) => w.code === 'no-date')).toEqual([{ code: 'no-date', lineId: 'dateOfEmployment', message: NO_DATE }])
  })

  it('is left blank for everyone when no row has the key, and each payslip says so', () => {
    for (const { computation, row } of payslips(fromHub(() => {}))) {
      expect(computation.dateOfEmployment).toBeNull()
      expect(row!.cells).toHaveLength(3)
      expect(computation.warnings.map((w) => w.message)).toContain(NO_DATE)
    }
  })
})

describe('Date of Employment in a PDF fill file imported straight into this app', () => {
  it('"DD/MM/YYYY", under "Date of employment" (lower-case e), is read and printed d-mmm-yy', () => {
    const [first, second] = payslips(
      fromFile((file) => {
        file[0]['Date of employment'] = '15/03/2021'
        file[1]['Date of employment'] = '2019-11-04'
      }),
    )
    expect(first.computation.dateOfEmployment).toBe('2021-03-15')
    expect(first.row!.cells.map((cell) => cell.text).slice(2)).toEqual(['Date of Employment :', '15-Mar-21'])
    expect(second.computation.dateOfEmployment).toBe('2019-11-04')
    expect(second.row!.cells[3].text).toBe('4-Nov-19')
  })

  it('a value that is not a clear date is a visible error, never a guess', () => {
    for (const wrong of ['31/02/2026', '13/13/2020', '2021-02-30', 'since 2018']) {
      const [first] = payslips(fromFile((file) => (file[0]['Date of employment'] = wrong)))
      expect(first.computation.errors).toEqual([
        {
          code: 'bad-date',
          lineId: 'dateOfEmployment',
          message: "Date of Employment can't be read as a date. Write it as DD/MM/YYYY (for example 15/03/2021) or YYYY-MM-DD in the payroll app.",
        },
      ])
      expect(first.computation.dateOfEmployment).toBeNull()
    }
  })

  it('an empty value is no date: blank, and the payslip says so', () => {
    const [first] = payslips(fromFile((file) => (file[0]['Date of employment'] = '')))
    expect(first.computation.dateOfEmployment).toBeNull()
    expect(first.computation.errors).toEqual([])
    expect(first.computation.warnings.map((w) => w.message)).toContain(NO_DATE)
  })

  it('the PDF and the Excel file show the same date, as the payslip prints it', async () => {
    const [first] = payslips(fromFile((file) => (file[0]['Date of employment'] = '15/03/2021')))
    expect(documentTexts(first.document!)).toContain('15-Mar-21')
    const pdf = await readPdf(await writePayslipPdf(first.document!, { regular: readFont('regular'), bold: readFont('bold') }))
    expect(pdf.texts.map((t) => t.text)).toContain('15-Mar-21')
    const [sheet] = await readWorkbook(await writePayslipWorkbook([first.document!]))
    const dateCell = Object.values(sheet.cells).find((cell) => typeof cell.value === 'string' && cell.value.startsWith('2021-03-15'))
    expect(dateCell).toBeTruthy()
    expect(dateCell!.numFmt).toMatch(/d-mmm-yy/)
  })
})

describe('which key it is read from', () => {
  it('is never set by the app: the key is read by its fixed name, and no template can change that', () => {
    expect(DEFAULT_TABLE_MAPPING.dateOfEmployment).toBe(KEY)
    expect(JSON.stringify(BUILT_IN_BODY)).not.toContain('"dateOfEmployment":"Date of Employment"')
    const body = { ...BUILT_IN_BODY, mapping: { ...BUILT_IN_BODY.mapping, dateOfEmployment: 'Basic Salary' } }
    expect(readBody(body)).toEqual({ ok: false, problems: ['Unexpected field in mapping.'] })
  })
})
