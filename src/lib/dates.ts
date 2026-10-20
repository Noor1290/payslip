// Dates and months are handled as plain text ("2026-09-28", "2026-09") so no time zone can
// move a date by a day.

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (month < 1 || month > 12 || day < 1) return false
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * A date of employment as the payroll data holds it: "YYYY-MM-DD" (from the dashboard, or the
 * payroll app's "Send to dashboard") or "DD/MM/YYYY", day first, as the payroll app's "Export for
 * PDF fill" writes it (also "1/8/2026", or with "-" or "." between). Returns "YYYY-MM-DD", or null
 * when it is not a clear date: nothing is guessed (no two-digit year, no month first).
 */
export function readDateOfEmployment(value: string): string | null {
  const text = value.trim()
  if (isIsoDate(text)) return text
  const match = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4})$/.exec(text)
  if (!match) return null
  const pad = (n: string) => n.padStart(2, '0')
  const iso = `${match[4]}-${pad(match[3])}-${pad(match[1])}`
  return isIsoDate(iso) ? iso : null
}

/** "2026-09-28" -> "28-Sep-26", the reference's d-mmm-yy. */
export function formatShortDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  return `${Number(day)}-${MONTHS[Number(month) - 1].slice(0, 3)}-${year.slice(2)}`
}

/** "2026-09" -> "September 2026". */
export function formatPeriod(period: string): string {
  const [year, month] = period.split('-')
  return `${MONTHS[Number(month) - 1]} ${year}`
}

/** This month and the `count - 1` before it, newest first, as "YYYY-MM" (the months "Get from dashboard" offers). */
export function recentMonths(now = new Date(), count = 24): string[] {
  const months: string[] = []
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return months
}

/** Today's date in the user's own time zone, as "YYYY-MM-DD". */
export function todayIso(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
