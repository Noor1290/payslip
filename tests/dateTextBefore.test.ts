// Known issue 47: a date format can start with a text ("Pay period: September 2026").
import { describe, expect, it } from 'vitest'
import { formatSchema, type DateFormatPiece } from '../src/lib/sheetBody'
import { datePieces, excelDateFormat, textBefore, withDate, withLastPieceRemoved, withPieceAdded, withTextBefore, writeDate } from '../src/lib/sheetFormats'

const MONTH: DateFormatPiece[] = [{ piece: 'MMMM' }, { text: ' ' }, { piece: 'YYYY' }]

describe('a text before the date (known issue 47)', () => {
  it('is written before the date, in the preview, the PDF and Excel', () => {
    const pieces = withTextBefore(MONTH, 'Pay period: ')
    expect(pieces).toEqual([{ text: 'Pay period: ' }, ...MONTH])
    expect(writeDate(pieces, '2026-09-30')).toBe('Pay period: September 2026')
    expect(excelDateFormat(pieces)).toBe('[$-409]"Pay period: "mmmm" "yyyy')
  })

  it('is read back from the format, and the date after it is kept apart', () => {
    const pieces = withTextBefore(MONTH, 'Pay period: ')
    expect(textBefore(pieces)).toBe('Pay period: ')
    expect(datePieces(pieces)).toEqual(MONTH)
    expect(textBefore(MONTH)).toBe('')
    expect(datePieces(MONTH)).toEqual(MONTH)
  })

  it('changing it replaces it, and an empty box takes it away', () => {
    const once = withTextBefore(MONTH, 'Pay period: ')
    expect(withTextBefore(once, 'Month: ')).toEqual([{ text: 'Month: ' }, ...MONTH])
    expect(withTextBefore(once, '')).toEqual(MONTH)
    expect(withTextBefore(MONTH, '')).toEqual(MONTH)
  })

  it('is kept when a preset is chosen or a piece is added or removed', () => {
    const pieces = withTextBefore(MONTH, 'Pay period: ')
    expect(withDate(pieces, [{ piece: 'DD' }, { text: '/' }, { piece: 'MM' }])).toEqual([{ text: 'Pay period: ' }, { piece: 'DD' }, { text: '/' }, { piece: 'MM' }])
    expect(withPieceAdded(pieces, 'D')).toEqual([...pieces, { text: ' ' }, { piece: 'D' }])
    expect(withLastPieceRemoved(pieces)).toEqual([{ text: 'Pay period: ' }, { piece: 'MMMM' }])
    // The first part of the date always stays.
    expect(withLastPieceRemoved([{ text: 'Pay period: ' }, { piece: 'MMMM' }])).toEqual([{ text: 'Pay period: ' }, { piece: 'MMMM' }])
  })

  it('never makes a format longer than a saved layout allows (12 pieces)', () => {
    let pieces: DateFormatPiece[] = [{ piece: 'D' }]
    for (let i = 0; i < 10; i += 1) pieces = withPieceAdded(pieces, 'D')
    expect(pieces).toHaveLength(11)
    const withText = withTextBefore(pieces, 'On ')
    expect(withText).toHaveLength(12)
    expect(withPieceAdded(withText, 'D')).toHaveLength(12)
    expect(withTextBefore(pieces, 'x'.repeat(30))[0]).toEqual({ text: 'x'.repeat(20) })
  })

  it('a saved layout may hold it: the stored format accepts it as it is', () => {
    const pieces = withTextBefore(MONTH, 'Pay period: ')
    expect(formatSchema.parse({ type: 'date', pieces })).toEqual({ type: 'date', pieces })
  })
})
