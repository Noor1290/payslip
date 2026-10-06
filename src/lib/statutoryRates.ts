// Statutory rates are settings with an effective-from month, never constants in the code.
// They feed the cross-check only: a warning beside the copied payroll figure, never a replacement.

export interface RatesValues {
  /** Employee NSF rate, in percent. */
  nsfEmployeeRate: number
  /** Monthly salary ceiling for NSF, in rupees. */
  nsfCeiling: number
  /** NSF is 0 for an employee marked Age 60+. */
  nsfExemptAt60: boolean
  /** Employee CSG rate at or below the threshold, in percent. */
  csgEmployeeRateLow: number
  /** Employee CSG rate strictly above the threshold, in percent. */
  csgEmployeeRateHigh: number
  /** Monthly salary threshold between the two CSG rates, in rupees. */
  csgThreshold: number
}

export interface RatesVersion extends RatesValues {
  /** First month the version applies to, "YYYY-MM". */
  effectiveFrom: string
  /** A correction for the same month is a new row with the next revision, never an edit. */
  revision: number
  createdAt?: string
  createdBy?: string
}

export type RatesInput = RatesValues & { effectiveFrom: string }

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

export function isMonth(value: string): boolean {
  return MONTH.test(value)
}

/** The version in force for a pay month: latest effective-from at or before it, highest revision. */
export function ratesFor(versions: readonly RatesVersion[], period: string): RatesVersion | null {
  let best: RatesVersion | null = null
  for (const version of versions) {
    if (version.effectiveFrom > period) continue
    if (
      !best ||
      version.effectiveFrom > best.effectiveFrom ||
      (version.effectiveFrom === best.effectiveFrom && version.revision > best.revision)
    ) {
      best = version
    }
  }
  return best
}

/** The revision number a new version for this month would get. */
export function nextRevision(versions: readonly RatesVersion[], effectiveFrom: string): number {
  const same = versions.filter((v) => v.effectiveFrom === effectiveFrom).map((v) => v.revision)
  return same.length === 0 ? 1 : Math.max(...same) + 1
}

/** Field name -> message, empty when the input is valid. */
export function validateRates(input: RatesInput): Partial<Record<keyof RatesInput, string>> {
  const errors: Partial<Record<keyof RatesInput, string>> = {}
  if (!isMonth(input.effectiveFrom)) errors.effectiveFrom = 'Choose the first month these rates apply to.'

  const rate = (field: 'nsfEmployeeRate' | 'csgEmployeeRateLow' | 'csgEmployeeRateHigh') => {
    const value = input[field]
    if (!Number.isFinite(value) || value < 0 || value > 100) errors[field] = 'Enter a rate between 0 and 100 %.'
  }
  rate('nsfEmployeeRate')
  rate('csgEmployeeRateLow')
  rate('csgEmployeeRateHigh')

  const amount = (field: 'nsfCeiling' | 'csgThreshold') => {
    const value = input[field]
    if (!Number.isFinite(value) || value < 0) errors[field] = 'Enter an amount of 0 or more.'
  }
  amount('nsfCeiling')
  amount('csgThreshold')
  return errors
}

/**
 * The payroll app rounds each exported column with toFixed(2) on a floating-point value.
 * The cross-check repeats that on purpose (it is not half-up), so a correct payroll figure matches
 * to the cent. The three payslip totals do NOT use this: they are integer cents.
 */
export function payrollRound2(value: number): number {
  return Number(value.toFixed(2))
}

/** Employee NSF as the payroll app should calculate it: rate x min(base, ceiling). */
export function crossCheckNsf(base: number, isAged60: boolean, rates: RatesValues): number {
  if (!(base > 0)) return 0
  if (isAged60 && rates.nsfExemptAt60) return 0
  return payrollRound2(Math.min(base, rates.nsfCeiling) * (rates.nsfEmployeeRate / 100))
}

/** Employee CSG as the payroll app should calculate it: one rate on the whole base, no cap. */
export function crossCheckCsg(base: number, rates: RatesValues): number {
  if (!(base > 0)) return 0
  const rate = base > rates.csgThreshold ? rates.csgEmployeeRateHigh : rates.csgEmployeeRateLow
  return payrollRound2(base * (rate / 100))
}

/** The highest NSF the ceiling allows, shown beside the ceiling on the settings page. */
export function maxNsf(rates: RatesValues): number {
  return payrollRound2(rates.nsfCeiling * (rates.nsfEmployeeRate / 100))
}
