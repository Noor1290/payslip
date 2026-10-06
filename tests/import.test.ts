import { describe, expect, it } from 'vitest'
import { importPayrollText, periodFromFileName } from '../src/lib/payrollFile'
import { FIXTURE_NAME, readFixtureText } from './helpers'

const rows = () => JSON.parse(readFixtureText(FIXTURE_NAME)) as Record<string, unknown>[]
const importRows = (list: unknown, name = FIXTURE_NAME) => importPayrollText(JSON.stringify(list), name)
const messages = (result: ReturnType<typeof importPayrollText>) =>
  result.ok ? [] : result.errors.map((e) => e.message)

describe('importing a payroll JSON file', () => {
  it('reads the fake fixture', () => {
    const result = importPayrollText(readFixtureText(FIXTURE_NAME), FIXTURE_NAME)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.rows).toHaveLength(7)
    expect(result.data.period).toBe('2026-09')
    expect(result.data.company).toEqual({
      name: 'ABC Co Ltd',
      addressLines: ['12 Example Street', 'Port Louis'],
      brn: 'C1234567',
    })
    expect(result.data.keys).toContain('Employee CSG')
  })

  it('takes the month from the file name', () => {
    expect(periodFromFileName('ABC Co Ltd-pdf-fill-2026-09.json')).toBe('2026-09')
    expect(periodFromFileName('export.json')).toBeNull()
    expect(periodFromFileName('x-2026-13.json')).toBeNull()
  })

  it('trims strings and keys', () => {
    const list = rows()
    list[0] = { ...list[0], Surname: '  DOE ', 'Full time / Part time': 'Full Time ' }
    const result = importRows(list)
    expect(result.ok && result.data.rows[0].Surname).toBe('DOE')
    expect(result.ok && result.data.rows[0]['Full time / Part time']).toBe('Full Time')
  })

  it('a one-part address leaves line 2 blank', () => {
    const list = rows().map((r) => ({ ...r, Address: 'Mauritius' }))
    const result = importRows(list)
    expect(result.ok && result.data.company.addressLines).toEqual(['Mauritius', ''])
  })

  it('refuses text that is not JSON, not a list, or empty', () => {
    expect(messages(importPayrollText('not json', 'a.json'))[0]).toMatch(/not valid JSON/)
    expect(messages(importPayrollText('{"a":1}', 'a.json'))[0]).toMatch(/list of employees/)
    expect(messages(importPayrollText('[]', 'a.json'))[0]).toMatch(/no employees/)
  })

  it('refuses a row that is not an object, or holds a nested value', () => {
    expect(messages(importRows([...rows(), 5]))[0]).toMatch(/Row 8/)
    const list = rows()
    list[1] = { ...list[1], Travelling: { amount: 5 } }
    expect(messages(importRows(list))[0]).toMatch(/Row 2.*Travelling/)
  })

  it('missing company details are an error with the export hint', () => {
    const list = rows().map((r) => {
      const { 'Company Name': _n, Address: _a, BRN: _b, ...rest } = r
      return rest
    })
    const text = messages(importRows(list)).join(' ')
    expect(text).toMatch(/Company Name/)
    expect(text).toMatch(/Address/)
    expect(text).toMatch(/BRN/)
    expect(text).toMatch(/tick Company Details in the payroll export/)
  })

  it('refuses a file that mixes companies', () => {
    const list = rows()
    list[3] = { ...list[3], BRN: 'C7654321' }
    expect(messages(importRows(list)).join(' ')).toMatch(/more than one company/)
  })

  it('refuses a missing ID or surname, and a repeated ID, without printing the ID', () => {
    const list = rows()
    list[2] = { ...list[2], ID: '' }
    list[4] = { ...list[4], ID: list[0].ID }
    const text = messages(importRows(list)).join(' | ')
    expect(text).toMatch(/Row 3: ID is missing/)
    expect(text).toMatch(/Row 5: ID is the same as row 1/)
    expect(text).not.toContain(String(list[0].ID))
  })

  it('two keys with the same name in a row are an error', () => {
    const raw = readFixtureText(FIXTURE_NAME).replace('"PAYE": 0,', '"PAYE": 0,\n    "PAYE": 12,')
    expect(messages(importPayrollText(raw, FIXTURE_NAME)).join(' ')).toMatch(/Row 1 has two columns named "PAYE"/)
  })

  it('two keys that differ only by case or spaces are an error too', () => {
    const list = rows()
    list[0] = { ...list[0], 'paye ': 12 }
    expect(messages(importRows(list)).join(' ')).toMatch(/Row 1 has two columns named "PAYE"/i)
  })
})
