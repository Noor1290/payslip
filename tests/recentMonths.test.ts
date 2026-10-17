// The months "Get from dashboard" offers (rehearsal fix F3). Fake dates only.
import { describe, expect, it } from 'vitest'
import { formatPeriod, recentMonths } from '../src/lib/dates'

describe('recentMonths: the months offered by "Get from dashboard"', () => {
  it('starts with this month and goes back, newest first, across a year end', () => {
    const months = recentMonths(new Date(2026, 1, 10), 4)
    expect(months).toEqual(['2026-02', '2026-01', '2025-12', '2025-11'])
    expect(months.map(formatPeriod)).toEqual(['February 2026', 'January 2026', 'December 2025', 'November 2025'])
  })
  it('offers two years by default', () => {
    const months = recentMonths(new Date(2026, 9, 17))
    expect(months).toHaveLength(24)
    expect(months[0]).toBe('2026-10')
    expect(months[23]).toBe('2024-11')
  })
})
