// Exact decimal numbers for the return files. A payroll figure such as 281.25 is held as the
// whole number 28125 and the number of decimal places, 2, so adding, subtracting, multiplying and
// rounding never meet the small errors of floating point (0.1 + 0.2 is exactly 0.3 here).
//
// Rounding is HALF UP, away from zero for negatives: 2.5 -> 3, 2.49 -> 2, -2.5 -> -3. It happens
// only where a template cell says so; nothing here rounds by itself.

export interface Decimal {
  /** The digits, as a whole number. */
  readonly units: bigint
  /** How many of those digits are after the decimal point (0 or more). */
  readonly scale: number
}

/** More decimals than any payroll figure or rate needs; a longer input is refused. */
const MAX_SCALE = 20

const TEN = 10n

const pow10 = (n: number) => TEN ** BigInt(n)

export const ZERO: Decimal = { units: 0n, scale: 0 }

/**
 * Reads a decimal from text: "18750", "-281.25", "0.045", "1e-3", with spaces around it. A
 * thousands separator, a currency or a percent sign is not a number here. Null when it is not
 * a number.
 */
export function parseDecimal(text: string): Decimal | null {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d{1,3}))?$/.exec(text.trim())
  if (!match) return null
  const [, sign, whole, fraction = '', exponent = '0'] = match
  if (whole === '' && fraction === '') return null
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, '') || '0'
  let scale = fraction.length - Number(exponent)
  let units = BigInt(digits)
  if (scale < 0) {
    units *= pow10(-scale)
    scale = 0
  }
  if (scale > MAX_SCALE) return null
  return normalise({ units: sign === '-' ? -units : units, scale })
}

/**
 * A number as the dashboard sends it (JSON): its shortest exact text, which is the decimal the
 * payroll app meant. 266.175 stays 266.175 (not the 266.17499... that the computer holds).
 */
export function fromNumber(value: number): Decimal | null {
  if (!Number.isFinite(value)) return null
  return parseDecimal(String(value))
}

/** The same value with trailing zero decimals removed: 18750.00 and 18750 are equal. */
function normalise(d: Decimal): Decimal {
  let { units, scale } = d
  while (scale > 0 && units % TEN === 0n) {
    units /= TEN
    scale -= 1
  }
  return { units, scale }
}

function align(a: Decimal, b: Decimal): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale)
  return [a.units * pow10(scale - a.scale), b.units * pow10(scale - b.scale), scale]
}

export function add(a: Decimal, b: Decimal): Decimal {
  const [x, y, scale] = align(a, b)
  return normalise({ units: x + y, scale })
}

export function subtract(a: Decimal, b: Decimal): Decimal {
  const [x, y, scale] = align(a, b)
  return normalise({ units: x - y, scale })
}

/** Exact: the decimals add up (18750 x 0.045 = 843.750). Refused past MAX_SCALE decimals. */
export function multiply(a: Decimal, b: Decimal): Decimal | null {
  const product = normalise({ units: a.units * b.units, scale: a.scale + b.scale })
  return product.scale > MAX_SCALE ? null : product
}

/** Half up, away from zero for negatives, to `places` decimals (0 = whole rupees). */
export function roundHalfUp(d: Decimal, places: number): Decimal {
  if (d.scale <= places) return d
  const drop = pow10(d.scale - places)
  const negative = d.units < 0n
  const size = negative ? -d.units : d.units
  let kept = size / drop
  // The part dropped is at least half: round away from zero.
  if ((size % drop) * 2n >= drop) kept += 1n
  return normalise({ units: negative ? -kept : kept, scale: places })
}

export function isZero(d: Decimal): boolean {
  return d.units === 0n
}

/** Whether the value ends in exactly .5 (.50, .500...): what the double-rounding note looks for. */
export function endsInHalf(d: Decimal): boolean {
  if (d.scale !== 1) return false
  const last = (d.units < 0n ? -d.units : d.units) % TEN
  return last === 5n
}

/**
 * The value as text with exactly `places` decimals, no thousands separators: 18750 with 0 is
 * "18750", 281.2 with 2 is "281.20". It must already have no more decimals than that.
 */
export function toFixed(d: Decimal, places: number): string {
  if (d.scale > places) throw new Error('Round the value before writing it with fewer decimals.')
  const negative = d.units < 0n
  const digits = ((negative ? -d.units : d.units) * pow10(places - d.scale)).toString().padStart(places + 1, '0')
  const whole = digits.slice(0, digits.length - places)
  const fraction = places > 0 ? `.${digits.slice(-places)}` : ''
  return `${negative ? '-' : ''}${whole}${fraction}`
}

/** The value as written, with only the decimals it has: 281.25, 18750, 0.045. */
export function toText(d: Decimal): string {
  return toFixed(d, d.scale)
}
