import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUTORY_RATES } from '../src/data/defaultStatutoryRates'
import {
  crossCheckCsg,
  crossCheckNsf,
  maxNsf,
  ratesFor,
  readRatesForm,
  validateRates,
  type RatesVersion,
} from '../src/lib/statutoryRates'

// Hand-calculated. The rates come from the settings data, never from the code under test.
const rates = ratesFor(DEFAULT_STATUTORY_RATES, '2026-09')!

describe('default rates (unsaved defaults)', () => {
  it('are the owner-confirmed values', () => {
    expect(rates).toMatchObject({
      nsfEmployeeRate: 1,
      nsfCeiling: 29710,
      nsfExemptAt60: true,
      csgEmployeeRateLow: 1.5,
      csgEmployeeRateHigh: 3,
      csgThreshold: 50000,
    })
    expect(maxNsf(rates)).toBe(297.1)
  })
})

describe('employee NSF cross-check: 1% of min(base, ceiling)', () => {
  it('ceiling boundary 29,709 / 29,710 / 29,711', () => {
    expect(crossCheckNsf(29709, false, rates)).toBe(297.09)
    expect(crossCheckNsf(29710, false, rates)).toBe(297.1)
    expect(crossCheckNsf(29711, false, rates)).toBe(297.1)
  })
  it('stays at the maximum far above the ceiling (the payroll bug gave 0 here)', () => {
    expect(crossCheckNsf(100000, false, rates)).toBe(297.1)
  })
  it('is 0 for a 60+ employee while the exemption is on', () => {
    expect(crossCheckNsf(45000, true, rates)).toBe(0)
    expect(crossCheckNsf(45000, true, { ...rates, nsfExemptAt60: false })).toBe(297.1)
  })
  it('is 0 for a zero or negative base', () => {
    expect(crossCheckNsf(0, false, rates)).toBe(0)
    expect(crossCheckNsf(-5, false, rates)).toBe(0)
  })
  it('below the ceiling: 1% of the base', () => {
    expect(crossCheckNsf(21085, false, rates)).toBe(210.85)
    expect(crossCheckNsf(10475.75, false, rates)).toBe(104.76) // 104.7575
  })
})

describe('employee CSG cross-check: 1.5% at or below the threshold, 3% strictly above, whole base', () => {
  it('threshold boundary 49,999.99 / 50,000 / 50,000.01', () => {
    expect(crossCheckCsg(49999.99, rates)).toBe(750) // 749.99985
    expect(crossCheckCsg(50000, rates)).toBe(750)
    expect(crossCheckCsg(50000.01, rates)).toBe(1500) // 1,500.0003, not marginal
  })
  it('repeats the payroll arithmetic, not half-up: 18,635 x 1.5% = 279.525 exports as 279.52', () => {
    expect(crossCheckCsg(18635, rates)).toBe(279.52)
    expect(crossCheckCsg(20115, rates)).toBe(301.72) // 301.725
  })
  it('is 0 for a zero or negative base', () => {
    expect(crossCheckCsg(0, rates)).toBe(0)
    expect(crossCheckCsg(-100, rates)).toBe(0)
  })
  it('has no cap', () => {
    expect(crossCheckCsg(250000, rates)).toBe(7500)
  })
})

describe('ratesFor: the version in force for the pay month', () => {
  const v = (effectiveFrom: string, revision: number, nsfCeiling: number): RatesVersion => ({
    ...rates,
    effectiveFrom,
    revision,
    nsfCeiling,
  })
  const versions = [v('2026-01', 1, 29000), v('2026-10', 1, 31000), v('2026-01', 2, 29710)]

  it('uses the latest effective-from month at or before the period', () => {
    expect(ratesFor(versions, '2026-09')?.nsfCeiling).toBe(29710)
    expect(ratesFor(versions, '2026-10')?.nsfCeiling).toBe(31000)
    expect(ratesFor(versions, '2027-03')?.nsfCeiling).toBe(31000)
  })
  it('uses the highest revision of that month (a correction is a new row)', () => {
    expect(ratesFor(versions, '2026-01')?.revision).toBe(2)
  })
  it('an old month keeps its old result after a new version is added', () => {
    expect(crossCheckNsf(40000, false, ratesFor(versions, '2026-09')!)).toBe(297.1)
    expect(crossCheckNsf(40000, false, ratesFor(versions, '2026-10')!)).toBe(310)
  })
  it('returns null when no version is in force', () => {
    expect(ratesFor(versions, '2025-12')).toBeNull()
  })
})

describe('validateRates', () => {
  const input = {
    effectiveFrom: '2026-11',
    nsfEmployeeRate: 1,
    nsfCeiling: 29710,
    nsfExemptAt60: true,
    csgEmployeeRateLow: 1.5,
    csgEmployeeRateHigh: 3,
    csgThreshold: 50000,
  }
  it('accepts a valid version', () => {
    expect(validateRates(input)).toEqual({})
  })
  it('refuses a rate outside 0 to 100, a negative ceiling or threshold, and a bad month', () => {
    expect(validateRates({ ...input, nsfEmployeeRate: 101 }).nsfEmployeeRate).toBeTruthy()
    expect(validateRates({ ...input, csgEmployeeRateLow: -1 }).csgEmployeeRateLow).toBeTruthy()
    expect(validateRates({ ...input, nsfCeiling: -1 }).nsfCeiling).toBeTruthy()
    expect(validateRates({ ...input, csgThreshold: -0.01 }).csgThreshold).toBeTruthy()
    expect(validateRates({ ...input, effectiveFrom: '2026-13' }).effectiveFrom).toBeTruthy()
    expect(validateRates({ ...input, csgEmployeeRateHigh: Number.NaN }).csgEmployeeRateHigh).toBeTruthy()
  })
})

describe('the "Add rates" form, read as typed', () => {
  const form = {
    effectiveFrom: '2026-07',
    nsfEmployeeRate: '1',
    nsfCeiling: '29710',
    nsfExemptAt60: true,
    csgEmployeeRateLow: '1.5',
    csgEmployeeRateHigh: '3',
    csgThreshold: '50000',
    sourceNote: '  Sample figures  ',
  }

  it('gives the values exactly as typed, with the note trimmed', () => {
    const read = readRatesForm({ ...form, csgEmployeeRateLow: '1.2345', nsfCeiling: '29710.55' })
    expect(read).toEqual({
      ok: true,
      input: {
        effectiveFrom: '2026-07',
        nsfEmployeeRate: 1,
        nsfCeiling: 29710.55,
        nsfExemptAt60: true,
        csgEmployeeRateLow: 1.2345,
        csgEmployeeRateHigh: 3,
        csgThreshold: 50000,
        sourceNote: 'Sample figures',
      },
    })
    expect(readRatesForm({ ...form, sourceNote: '   ' })).toMatchObject({ ok: true, input: { sourceNote: null } })
  })

  it('refuses a rate with more than 4 decimals and an amount with more than 2: never rounded', () => {
    expect(readRatesForm({ ...form, csgEmployeeRateLow: '1.23456' })).toMatchObject({ ok: false, errors: { csgEmployeeRateLow: expect.stringContaining('at most 4 decimals') } })
    expect(readRatesForm({ ...form, nsfCeiling: '29710.555' })).toMatchObject({ ok: false, errors: { nsfCeiling: expect.stringContaining('at most 2 decimals') } })
    expect(readRatesForm({ ...form, csgThreshold: '50000.001' }).ok).toBe(false)
  })

  it('refuses what is not a plain number, a rate out of range, a missing month and a note that is too long', () => {
    for (const typed of ['', '1,5', '1e2', '-1', 'abc', '1.']) {
      expect(readRatesForm({ ...form, nsfEmployeeRate: typed }).ok).toBe(false)
    }
    expect(readRatesForm({ ...form, csgEmployeeRateHigh: '100.01' }).ok).toBe(false)
    expect(readRatesForm({ ...form, effectiveFrom: '' })).toMatchObject({ ok: false, errors: { effectiveFrom: expect.any(String) } })
    expect(readRatesForm({ ...form, sourceNote: 'x'.repeat(301) })).toMatchObject({ ok: false, errors: { sourceNote: expect.any(String) } })
    expect(readRatesForm({ ...form, sourceNote: 'x'.repeat(300) }).ok).toBe(true)
  })
})
