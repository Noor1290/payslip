import { describe, expect, it } from 'vitest'
import { computePayslip, isReady, type PayslipComputation } from '../src/lib/payslip'
import type { PayrollRow } from '../src/lib/payrollFile'
import { DEFAULT_TABLE_MAPPING, TABLE_TEMPLATE } from '../src/lib/template'
import { HUB_SAMPLE_NAME, fixtureRow, loadFixture, septemberRates } from './helpers'

function compute(row: PayrollRow, treatAsZero: string[] = []): PayslipComputation {
  return computePayslip({
    row,
    rowIndex: 0,
    template: TABLE_TEMPLATE,
    mapping: DEFAULT_TABLE_MAPPING,
    rates: septemberRates,
    treatAsZero: new Set(treatAsZero),
  })
}

const line = (c: PayslipComputation, id: string) => c.lines.find((l) => l.id === id)!
const check = (c: PayslipComputation, id: string) => c.checks.find((k) => k.id === id)!
const codes = (issues: { code: string; lineId?: string }[]) => issues.map((i) => `${i.code}:${i.lineId ?? ''}`)

describe('totals are plain addition of the lines shown, in whole cents', () => {
  // DOE JANE, hand-calculated: earnings 18,000 + 635 + 0 + 2,450 = 21,085.00
  // deductions 279.52 + 210.85 + 0 = 490.37 ; net 21,085.00 - 490.37 = 20,594.63
  const c = compute(fixtureRow('DOE'))

  it('copies every line exactly', () => {
    expect(line(c, 'basic').cents).toBe(1800000)
    expect(line(c, 'increment').cents).toBe(63500)
    expect(line(c, 'allowances').cents).toBe(0)
    expect(line(c, 'transport').cents).toBe(245000)
    expect(line(c, 'csg').cents).toBe(27952)
    expect(line(c, 'nsf').cents).toBe(21085)
    expect(line(c, 'paye').cents).toBe(0)
  })

  it('adds them up', () => {
    expect(c.totals).toEqual({ earnings: 2108500, deductions: 49037, net: 2059463 })
  })

  it('takes CSG and NSF from the employee columns, never from the employer columns', () => {
    expect(line(c, 'csg').sourceKey).toBe('Employee CSG')
    expect(line(c, 'nsf').sourceKey).toBe('Employee NSF')
    const row = fixtureRow('DOE')
    expect(line(c, 'csg').cents).not.toBe(Math.round((row.CSG as number) * 100))
  })

  it('shows a zero and an unmapped line as "-"', () => {
    expect(line(c, 'paye').display).toBe('-')
    expect(line(c, 'allowances').display).toBe('-')
    expect(line(c, 'advance')).toMatchObject({ status: 'unmapped', display: '-', cents: 0 })
    expect(line(c, 'basic').display).toBe('18,000')
    expect(line(c, 'csg').display).toBe('279.52')
  })
})

describe('reconciliation with the payroll totals', () => {
  it('matches Gross Pay and Net Pay, and reports the 0.01 on Total deductions as rounding', () => {
    // Payroll Total deductions is 490.375 rounded once (490.38); the lines shown add to 490.37.
    const c = compute(fixtureRow('DOE'))
    expect(check(c, 'gross')).toMatchObject({ kind: 'match', diffCents: 0, payrollCents: 2108500 })
    expect(check(c, 'deductions')).toMatchObject({ kind: 'rounding', diffCents: -1, payrollCents: 49038 })
    expect(check(c, 'net')).toMatchObject({ kind: 'match', diffCents: 0, payrollCents: 2059463 })
  })

  it('is not ready until the rounding difference is accepted', () => {
    const c = compute(fixtureRow('DOE'))
    expect(isReady(c, {})).toBe(false)
    expect(isReady(c, { deductions: -1 })).toBe(true)
    // An acceptance of a different amount does not count.
    expect(isReady(c, { deductions: 1 })).toBe(false)
  })

  it('is ready straight away when everything matches', () => {
    const c = compute(fixtureRow('TESTER'))
    expect(c.checks.map((k) => k.kind)).toEqual(['match', 'match', 'match'])
    expect(c.errors).toEqual([])
    expect(isReady(c, {})).toBe(true)
  })

  it('reports a real mismatch as a difference, and never adjusts a line', () => {
    const row = { ...fixtureRow('TESTER'), 'Net Pay': 47707.9 } // payroll says 5.00 more
    const c = compute(row)
    expect(check(c, 'net')).toMatchObject({ kind: 'difference', diffCents: -500 })
    expect(c.totals).toEqual({ earnings: 5000000, deductions: 229710, net: 4770290 })
    expect(isReady(c, {})).toBe(false)
    expect(isReady(c, { net: -500 })).toBe(true)
  })

  it('only a difference of exactly 0.01 is "rounding"; 0.02 is a difference', () => {
    // TESTER SAM's payslip net is 47,702.90.
    const oneCent = compute({ ...fixtureRow('TESTER'), 'Net Pay': 47702.89 })
    expect(check(oneCent, 'net')).toMatchObject({ kind: 'rounding', diffCents: 1 })
    const twoCents = compute({ ...fixtureRow('TESTER'), 'Net Pay': 47702.92 })
    expect(check(twoCents, 'net')).toMatchObject({ kind: 'difference', diffCents: -2 })
  })

  it('a payroll total that is missing or not a number is an error', () => {
    const row = { ...fixtureRow('TESTER'), 'Gross Pay': 'fifty thousand' }
    const c = compute(row)
    expect(check(c, 'gross').kind).toBe('unavailable')
    expect(codes(c.errors)).toContain('not-a-number:check-gross')
    expect(isReady(c, {})).toBe(false)
  })
})

describe('mapping errors are visible, never a blank or a zero', () => {
  it('a missing mapped key is an error naming the line, with a "treat as zero" accept', () => {
    const row = fixtureRow('TESTER')
    delete row.PAYE
    const c = compute(row)
    expect(codes(c.errors)).toEqual(['missing-key:paye'])
    expect(c.errors[0].message).toContain('PAYE')
    expect(c.totals).toBeNull()

    const accepted = compute(row, ['paye'])
    expect(accepted.errors).toEqual([])
    expect(line(accepted, 'paye')).toMatchObject({ status: 'treated-as-zero', cents: 0, display: '-' })
  })

  it('a missing Employee CSG or Employee NSF is an error that cannot be treated as zero', () => {
    const row = fixtureRow('TESTER')
    delete row['Employee CSG']
    delete row['Employee NSF']
    expect(codes(compute(row).errors)).toEqual(['missing-key:csg', 'missing-key:nsf'])
    expect(codes(compute(row, ['csg', 'nsf']).errors)).toEqual(['missing-key:csg', 'missing-key:nsf'])
  })

  it('the hub sample has no employee columns: every row is blocked, the employer CSG is not used', () => {
    const data = loadFixture(HUB_SAMPLE_NAME)
    for (const row of data.rows) {
      const c = compute(row)
      expect(codes(c.errors)).toEqual(['missing-key:csg', 'missing-key:nsf'])
      expect(isReady(c, {})).toBe(false)
    }
  })

  it('text in a money field is an error', () => {
    const c = compute({ ...fixtureRow('TESTER'), 'Basic Salary': '49,365' })
    expect(codes(c.errors)).toEqual(['not-a-number:basic'])
    expect(c.errors[0].message).toContain('Basic Salary')
  })

  it('a figure with more than 2 decimals is an error and is never rounded', () => {
    const c = compute({ ...fixtureRow('DOE'), Travelling: 2450.125 })
    expect(codes(c.errors)).toEqual(['too-many-decimals:transport'])
    expect(c.totals).toBeNull()
  })

  it('old column names are accepted as aliases with an "old name" warning', () => {
    const row = fixtureRow('TESTER')
    row['CSG - 1.5 %/ 3%'] = row['Employee CSG']
    row['NSF - 1%'] = row['Employee NSF']
    delete row['Employee CSG']
    delete row['Employee NSF']
    const c = compute(row)
    expect(c.errors).toEqual([])
    expect(line(c, 'csg')).toMatchObject({ cents: 75000, sourceKey: 'CSG - 1.5 %/ 3%' })
    expect(line(c, 'nsf')).toMatchObject({ cents: 29710, sourceKey: 'NSF - 1%' })
    expect(codes(c.warnings)).toEqual(expect.arrayContaining(['old-name:csg', 'old-name:nsf']))
  })

  it('Travelling as Transport Allowance carries a "to confirm" warning', () => {
    expect(codes(compute(fixtureRow('DOE')).warnings)).toContain('to-confirm:transport')
  })
})

describe('cross-check: a warning only, the copied figure is never replaced', () => {
  it('is silent when the payroll figures follow the rules', () => {
    for (const row of loadFixture().rows) {
      const c = compute(row)
      expect(codes(c.warnings).filter((w) => w.startsWith('cross-check'))).toEqual([])
    }
  })

  it('flags the payroll bug: NSF 0 above the ceiling', () => {
    const row = { ...fixtureRow('SAMPLE'), 'Employee NSF': 0 }
    const c = compute(row)
    expect(codes(c.warnings)).toContain('cross-check-nsf:nsf')
    expect(c.warnings.find((w) => w.code === 'cross-check-nsf')!.message).toContain('297.10')
    expect(line(c, 'nsf').cents).toBe(0) // still the copied figure
    expect(c.errors).toEqual([])
  })

  it('flags a 60+ employee with an NSF above 0', () => {
    const row = { ...fixtureRow('FICTIF'), 'Employee NSF': 297.1 }
    const c = compute(row)
    expect(codes(c.warnings)).toContain('cross-check-nsf:nsf')
    expect(line(c, 'nsf').cents).toBe(29710)
  })

  it('flags a CSG at the wrong tier (3% at exactly 50,000)', () => {
    const row = { ...fixtureRow('TESTER'), 'Employee CSG': 1500 }
    expect(codes(compute(row).warnings)).toContain('cross-check-csg:csg')
  })

  it('never blocks: a cross-check warning leaves readiness to the three totals', () => {
    const row = { ...fixtureRow('FICTIF'), 'Employee NSF': 297.1, 'Total deductions': 1772.1, 'Net Pay': 45227.9 }
    const c = compute(row)
    expect(codes(c.warnings)).toContain('cross-check-nsf:nsf')
    expect(isReady(c, {})).toBe(true)
  })

  it('says so when no rates are in force for the month', () => {
    const c = computePayslip({
      row: fixtureRow('DOE'),
      rowIndex: 0,
      template: TABLE_TEMPLATE,
      mapping: DEFAULT_TABLE_MAPPING,
      rates: null,
      treatAsZero: new Set(),
    })
    expect(codes(c.warnings)).toContain('no-rates:')
  })
})
