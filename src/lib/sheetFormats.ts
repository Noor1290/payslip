// How a cell of a "From your file" layout is written: a date from its pieces, a number with its
// decimals, thousands separators, "Rs" and dash. Each format has its Excel number format too, so
// the preview, the PDF and the Excel sheet show the same text.

import { isZero, roundHalfUp, toFixed, type Decimal } from './decimal'
import type { CellFormat, DateFormatPiece, DatePiece } from './sheetBody'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "2020-03-22" with the pieces D - MMM - YY -> "22-Mar-20". */
export function writeDate(pieces: readonly DateFormatPiece[], iso: string): string {
  const [year, month, day] = iso.split('-')
  const write = (piece: DatePiece): string => {
    switch (piece) {
      case 'D':
        return String(Number(day))
      case 'DD':
        return day
      case 'M':
        return String(Number(month))
      case 'MM':
        return month
      case 'MMM':
        return MONTHS[Number(month) - 1].slice(0, 3)
      case 'MMMM':
        return MONTHS[Number(month) - 1]
      case 'YY':
        return year.slice(2)
      case 'YYYY':
        return year
    }
  }
  return pieces.map((one) => ('piece' in one ? write(one.piece) : one.text)).join('')
}

const quoted = (text: string) => `"${text.replace(/"/g, '""')}"`

/** The same pieces as an Excel number format, with English month names whatever the computer's language. */
export function excelDateFormat(pieces: readonly DateFormatPiece[]): string {
  return `[$-409]${pieces.map((one) => ('piece' in one ? one.piece.toLowerCase() : quoted(one.text))).join('')}`
}

/** Whether a format shows the day: a pay month has none to show. */
export const showsDay = (pieces: readonly DateFormatPiece[]) => pieces.some((one) => 'piece' in one && (one.piece === 'D' || one.piece === 'DD'))

type NumberFormat = Extract<CellFormat, { type: 'number' }>

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/** The value as it is printed, and the number that says: an amount kept to the decimals shown. */
export function writeNumber(value: Decimal, format: NumberFormat): { text: string; value: Decimal; places: 0 | 2 } {
  const twoDecimals = roundHalfUp(value, 2)
  const places: 0 | 2 = format.decimals === 'auto' ? (twoDecimals.scale === 0 ? 0 : 2) : format.decimals
  const rounded = roundHalfUp(value, places)
  if (format.dash && isZero(rounded)) return { text: '-', value: rounded, places }
  const fixed = toFixed(rounded, places)
  const negative = fixed.startsWith('-')
  const [whole, fraction] = (negative ? fixed.slice(1) : fixed).split('.')
  const amount = `${format.thousands ? group(whole) : whole}${fraction ? `.${fraction}` : ''}`
  return { text: `${negative ? '-' : ''}${format.rs ? 'Rs ' : ''}${amount}`, value: rounded, places }
}

/** The same format as an Excel number format, for an amount with `places` decimals. */
export function excelNumberFormat(format: NumberFormat, places: 0 | 2): string {
  const digits = `${format.thousands ? '#,##0' : '0'}${places === 2 ? '.00' : ''}`
  const positive = `${format.rs ? '"Rs "' : ''}${digits}`
  return format.dash ? `${positive};-${positive};"-"` : `${positive};-${positive}`
}

// Editing a date format. A format may start with a text ("Pay period: "); the date itself starts
// with a part of the date and its separators go between the parts.

/** The text written before the date, or '' when the format starts with a part of the date. */
export const textBefore = (pieces: readonly DateFormatPiece[]): string => {
  const first = pieces[0]
  return first !== undefined && 'text' in first ? first.text : ''
}

/** The pieces after the text before the date. */
export const datePieces = (pieces: readonly DateFormatPiece[]): DateFormatPiece[] => (textBefore(pieces) === '' ? [...pieces] : pieces.slice(1))

/** The most pieces a date format holds, the text before the date included. */
export const MOST_DATE_PIECES = 12

/** The same date with another text before it; '' removes it. */
export function withTextBefore(pieces: readonly DateFormatPiece[], text: string): DateFormatPiece[] {
  const date = datePieces(pieces)
  return text === '' ? date : [{ text: text.slice(0, 20) }, ...date.slice(0, MOST_DATE_PIECES - 1)]
}

/** A preset or a changed date, keeping the text before it. */
export const withDate = (pieces: readonly DateFormatPiece[], date: readonly DateFormatPiece[]): DateFormatPiece[] => withTextBefore(date, textBefore(pieces))

/** One more part of the date at the end, after a space. */
export function withPieceAdded(pieces: readonly DateFormatPiece[], piece: DatePiece): DateFormatPiece[] {
  if (pieces.length + 2 > MOST_DATE_PIECES) return [...pieces]
  return [...pieces, { text: ' ' }, { piece }]
}

/** The last part of the date and its separator taken away; the first part always stays. */
export function withLastPieceRemoved(pieces: readonly DateFormatPiece[]): DateFormatPiece[] {
  const date = datePieces(pieces)
  return date.length <= 1 ? [...pieces] : withDate(pieces, date.slice(0, -2))
}
