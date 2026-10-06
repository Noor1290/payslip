import { describe, expect, it } from 'vitest'
import { formatCents, parseMoney } from '../src/lib/money'

describe('parseMoney: a copied figure becomes whole cents, or an error, never a rounded value', () => {
  it('accepts numbers with up to 2 decimals', () => {
    expect(parseMoney(18000)).toEqual({ ok: true, cents: 1800000 })
    expect(parseMoney(465.88)).toEqual({ ok: true, cents: 46588 })
    expect(parseMoney(297.1)).toEqual({ ok: true, cents: 29710 })
    expect(parseMoney(0)).toEqual({ ok: true, cents: 0 })
    expect(parseMoney(-12.5)).toEqual({ ok: true, cents: -1250 })
    expect(parseMoney(50000.01)).toEqual({ ok: true, cents: 5000001 })
  })

  it('refuses more than 2 decimals instead of rounding', () => {
    expect(parseMoney(465.875)).toEqual({ ok: false, reason: 'too-many-decimals' })
    expect(parseMoney(0.1 + 0.2)).toEqual({ ok: false, reason: 'too-many-decimals' })
    expect(parseMoney(1e-7)).toEqual({ ok: false, reason: 'too-many-decimals' })
  })

  it('refuses text, blanks and non-finite numbers', () => {
    expect(parseMoney('18,000')).toEqual({ ok: false, reason: 'not-a-number' })
    expect(parseMoney('18000')).toEqual({ ok: false, reason: 'not-a-number' })
    expect(parseMoney(true)).toEqual({ ok: false, reason: 'not-a-number' })
    expect(parseMoney(Number.NaN)).toEqual({ ok: false, reason: 'not-a-number' })
    expect(parseMoney(null)).toEqual({ ok: false, reason: 'missing' })
    expect(parseMoney(undefined)).toEqual({ ok: false, reason: 'missing' })
    expect(parseMoney('')).toEqual({ ok: false, reason: 'missing' })
    expect(parseMoney(1e21)).toEqual({ ok: false, reason: 'out-of-range' })
  })
})

describe('formatCents: the display rule', () => {
  it('shows a zero as "-"', () => {
    expect(formatCents(0)).toBe('-')
  })
  it('shows whole amounts with no decimals', () => {
    expect(formatCents(100000)).toBe('1,000')
    expect(formatCents(1800000)).toBe('18,000')
    expect(formatCents(-125000)).toBe('-1,250')
  })
  it('shows fractional amounts with 2 decimals', () => {
    expect(formatCents(100050)).toBe('1,000.50')
    expect(formatCents(5)).toBe('0.05')
    expect(formatCents(29710)).toBe('297.10')
    expect(formatCents(123456789)).toBe('1,234,567.89')
    expect(formatCents(-49037)).toBe('-490.37')
  })
})
