// Date of Employment: set in the dashboard, only ever read here. A row has the key
// "Date of Employment" (text, YYYY-MM-DD) when the dashboard has the date; otherwise the key is
// left out and the line stays blank. Fake data only.
import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUTORY_RATES } from '../src/data/defaultStatutoryRates'
import { computeAll, documentFor } from '../src/lib/build'
import { readHubPayload } from '../src/lib/hubBridge'
import type { ImportedPayroll } from '../src/lib/payrollFile'
import { DEFAULT_TABLE_MAPPING, TABLE_TEMPLATE } from '../src/lib/template'
import { BUILT_IN_BODY, readBody } from '../src/lib/templateBody'
import { FIXTURE_NAME, readFixtureText } from './helpers'

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
const payslips = (data: ImportedPayroll) => {
  const settings = { template: TABLE_TEMPLATE, mapping: DEFAULT_TABLE_MAPPING, rateVersions: DEFAULT_STATUTORY_RATES, period: '2026-09' }
  return computeAll(data, settings).map((computation) => ({
    computation,
    row: computation.totals ? documentFor(data, computation, TABLE_TEMPLATE, '2026-09', '2026-09-28').rows.find((r) => r.id === 'employee-name')! : null,
  }))
}

describe('Date of Employment from the dashboard', () => {
  it('is shown as d-mmm-yy for the employees whose row has the key', () => {
    const [first, second] = payslips(
      fromHub((sent) => {
        sent[0][KEY] = '2021-03-15'
      }),
    )
    expect(first.computation.dateOfEmployment).toBe('2021-03-15')
    expect(first.row!.cells.map((cell) => cell.text)).toEqual(['Name :', first.computation.employeeName, 'Date of Employment :', '15-Mar-21'])
    expect(first.row!.cells[3]).toMatchObject({ kind: 'date', isoDate: '2021-03-15' })
    // The next employee has no key: the label is there, the date is blank, and nothing is wrong.
    expect(second.computation.dateOfEmployment).toBeNull()
    expect(second.row!.cells.map((cell) => cell.text)).toEqual(['Name :', second.computation.employeeName, 'Date of Employment :'])
    expect(second.computation.errors).toEqual([])
  })

  it('is left blank for everyone when no row has the key', () => {
    for (const { computation, row } of payslips(fromHub(() => {}))) {
      expect(computation.dateOfEmployment).toBeNull()
      expect(row!.cells).toHaveLength(3)
    }
  })

  it('a value that is not a real date is a visible error, never a guess', () => {
    for (const wrong of ['15/03/2021', '2021-02-30', '2021-3-15']) {
      const [first] = payslips(fromHub((sent) => (sent[0][KEY] = wrong)))
      expect(first.computation.errors.map((issue) => issue.code)).toEqual(['bad-date'])
      expect(first.computation.dateOfEmployment).toBeNull()
    }
  })

  it('is never set by the app: the key is read by its fixed name, and no template can change that', () => {
    expect(DEFAULT_TABLE_MAPPING.dateOfEmployment).toBe(KEY)
    expect(JSON.stringify(BUILT_IN_BODY)).not.toContain('"dateOfEmployment":"Date of Employment"')
    const body = { ...BUILT_IN_BODY, mapping: { ...BUILT_IN_BODY.mapping, dateOfEmployment: 'Basic Salary' } }
    expect(readBody(body)).toEqual({ ok: false, problems: ['Unexpected field in mapping.'] })
  })
})
