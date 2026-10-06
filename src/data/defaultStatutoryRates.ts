import type { RatesVersion } from '../lib/statutoryRates'

// The ONLY place rate values are written down in this app. These are the owner's defaults
// (from the payroll column setup checked on 6 October 2026, not checked against legislation).
// They are shown as "unsaved defaults" until the hub stores real versions (Phase 3).
export const DEFAULT_STATUTORY_RATES: readonly RatesVersion[] = [
  {
    effectiveFrom: '2026-01',
    revision: 1,
    nsfEmployeeRate: 1,
    nsfCeiling: 29710,
    nsfExemptAt60: true,
    csgEmployeeRateLow: 1.5,
    csgEmployeeRateHigh: 3,
    csgThreshold: 50000,
    createdBy: 'Built-in default',
  },
]
