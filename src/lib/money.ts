// Money is held as whole cents (integers), so adding lines never meets floating point.
// A payroll figure is copied exactly: it is either a number with at most 2 decimals, or an error.

export type MoneyProblem = 'missing' | 'not-a-number' | 'too-many-decimals' | 'out-of-range'

export type MoneyResult = { ok: true; cents: number } | { ok: false; reason: MoneyProblem }

/**
 * Turns a value from the payroll data into cents without rounding it.
 * The number's shortest decimal text (what JSON shows) decides how many decimals it has.
 */
export function parseMoney(value: unknown): MoneyResult {
  if (value === undefined || value === null || value === '') return { ok: false, reason: 'missing' }
  if (typeof value !== 'number' || Number.isNaN(value)) return { ok: false, reason: 'not-a-number' }
  if (!Number.isFinite(value)) return { ok: false, reason: 'out-of-range' }

  const text = String(Math.abs(value))
  if (text.includes('e')) {
    return { ok: false, reason: text.includes('e-') ? 'too-many-decimals' : 'out-of-range' }
  }
  const [whole, fraction = ''] = text.split('.')
  if (fraction.length > 2) return { ok: false, reason: 'too-many-decimals' }

  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents)) return { ok: false, reason: 'out-of-range' }
  return { ok: true, cents: value < 0 ? -cents : cents }
}

/**
 * The display rule, shared by the preview, the PDF and the Excel file:
 * zero is "-", a whole amount has no decimals, anything else has 2.
 */
export function formatCents(cents: number): string {
  if (cents === 0) return '-'
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const rupees = Math.floor(abs / 100)
  const rest = abs % 100
  const grouped = String(rupees).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return rest === 0 ? `${sign}${grouped}` : `${sign}${grouped}.${String(rest).padStart(2, '0')}`
}

export function isWholeRupees(cents: number): boolean {
  return cents % 100 === 0
}

/** Cents to the 2-decimal number stored in an Excel cell (exact for any amount a payslip holds). */
export function centsToNumber(cents: number): number {
  return cents / 100
}
