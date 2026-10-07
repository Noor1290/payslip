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
  /** Where the values come from ("Finance Act 2026"), or null. */
  sourceNote?: string | null
  createdAt?: string
  /** True when the person signed in to the dashboard added it. The hub never sends who else did. */
  createdByYou?: boolean
}

export type RatesInput = RatesValues & { effectiveFrom: string; sourceNote?: string | null }

export const SOURCE_NOTE_MAX = 300
/** The dashboard's own limit on an amount. */
const AMOUNT_MAX = 9_999_999_999.99

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

/** The highest revision seen for a month, 0 when the month has none: the save's expected_revision. */
export function highestRevision(versions: readonly RatesVersion[], effectiveFrom: string): number {
  return versions.reduce((best, v) => (v.effectiveFrom === effectiveFrom && v.revision > best ? v.revision : best), 0)
}

/** How many decimals a number is written with ("1.25" has 2). Nothing is rounded to make it fit. */
export function decimalsOf(value: number): number {
  const text = String(Math.abs(value))
  if (text.includes('e')) return text.includes('e-') ? Number.POSITIVE_INFINITY : 0
  return (text.split('.')[1] ?? '').length
}

/** A typed figure as a number, or null when it is not a plain decimal number ("1,5", "1e2", ""). */
export function parseDecimalText(text: string): number | null {
  const trimmed = text.trim()
  return /^\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : null
}

/** The six values, for comparing two versions. */
export const RATE_VALUE_KEYS = [
  'nsfEmployeeRate',
  'nsfCeiling',
  'nsfExemptAt60',
  'csgEmployeeRateLow',
  'csgEmployeeRateHigh',
  'csgThreshold',
] as const satisfies readonly (keyof RatesValues)[]

/** A note as the dashboard stores it: trimmed, and null when empty. */
export function storedNote(note: string | null | undefined): string | null {
  return (note ?? '').trim() || null
}

/** True when two versions hold the same six values and the same note. */
export function sameRates(a: RatesInput, b: RatesInput): boolean {
  return RATE_VALUE_KEYS.every((key) => a[key] === b[key]) && storedNote(a.sourceNote) === storedNote(b.sourceNote)
}

/** Field name -> message, empty when the input is valid. */
export function validateRates(input: RatesInput): Partial<Record<keyof RatesInput, string>> {
  const errors: Partial<Record<keyof RatesInput, string>> = {}
  if (!isMonth(input.effectiveFrom)) errors.effectiveFrom = 'Choose the first month these rates apply to.'

  const rate = (field: 'nsfEmployeeRate' | 'csgEmployeeRateLow' | 'csgEmployeeRateHigh') => {
    const value = input[field]
    if (!Number.isFinite(value) || value < 0 || value > 100) errors[field] = 'Enter a rate between 0 and 100 %.'
    else if (decimalsOf(value) > 4) errors[field] = 'A rate can have at most 4 decimals. It is not rounded for you.'
  }
  rate('nsfEmployeeRate')
  rate('csgEmployeeRateLow')
  rate('csgEmployeeRateHigh')

  const amount = (field: 'nsfCeiling' | 'csgThreshold') => {
    const value = input[field]
    if (!Number.isFinite(value) || value < 0) errors[field] = 'Enter an amount of 0 or more.'
    else if (value > AMOUNT_MAX) errors[field] = 'This amount is too large.'
    else if (decimalsOf(value) > 2) errors[field] = 'An amount can have at most 2 decimals. It is not rounded for you.'
  }
  amount('nsfCeiling')
  amount('csgThreshold')
  if ((input.sourceNote ?? '').trim().length > SOURCE_NOTE_MAX) {
    errors.sourceNote = `Keep the note to ${SOURCE_NOTE_MAX} characters or fewer.`
  }
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

/** The "Add rates" form as typed. Figures stay text until they are checked: nothing is rounded. */
export interface RatesFormText {
  effectiveFrom: string
  nsfEmployeeRate: string
  nsfCeiling: string
  nsfExemptAt60: boolean
  csgEmployeeRateLow: string
  csgEmployeeRateHigh: string
  csgThreshold: string
  sourceNote: string
}

export type RatesFormErrors = Partial<Record<keyof RatesFormText, string>>

const NUMBER_FIELDS = ['nsfEmployeeRate', 'nsfCeiling', 'csgEmployeeRateLow', 'csgEmployeeRateHigh', 'csgThreshold'] as const

export function ratesFormOf(values: RatesValues, effectiveFrom: string): RatesFormText {
  return {
    effectiveFrom,
    nsfEmployeeRate: String(values.nsfEmployeeRate),
    nsfCeiling: String(values.nsfCeiling),
    nsfExemptAt60: values.nsfExemptAt60,
    csgEmployeeRateLow: String(values.csgEmployeeRateLow),
    csgEmployeeRateHigh: String(values.csgEmployeeRateHigh),
    csgThreshold: String(values.csgThreshold),
    sourceNote: '',
  }
}

/** Reads the form as typed. Either the values to save, or a message per field. */
export function readRatesForm(form: RatesFormText): { ok: true; input: RatesInput } | { ok: false; errors: RatesFormErrors } {
  const errors: RatesFormErrors = {}
  const numbers = {} as Record<(typeof NUMBER_FIELDS)[number], number>
  for (const field of NUMBER_FIELDS) {
    const value = parseDecimalText(form[field])
    if (value === null) errors[field] = 'Enter a number with a decimal point, for example 1.5.'
    numbers[field] = value ?? 0
  }
  const input: RatesInput = {
    effectiveFrom: form.effectiveFrom,
    ...numbers,
    nsfExemptAt60: form.nsfExemptAt60,
    sourceNote: storedNote(form.sourceNote),
  }
  const found = { ...validateRates(input), ...errors }
  return Object.keys(found).length > 0 ? { ok: false, errors: found } : { ok: true, input }
}
