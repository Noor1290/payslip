import type { RatesVersion } from '../lib/statutoryRates'

// The ONLY place rate values are written down in this app. These are the owner's defaults
// (from the payroll column setup checked on 6 October 2026, not checked against legislation).
// Opened on its own, the app shows them as "Unsaved defaults" and cross-checks with them.
// Inside the dashboard they are never used for the cross-check: they only prefill the form for
// a company's first version.
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
  },
]
