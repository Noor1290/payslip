import { strFromU8, unzipSync } from 'fflate'
import { beforeAll, describe, expect, it } from 'vitest'
import { FORMAT_DECIMALS, FORMAT_WHOLE, sheetNames, writePayslipWorkbook } from '../src/writers/excelWriter'
import { fixtureDocuments } from './fixtureDocuments'
import { expectRecorded, readRecorded } from './helpers'
import { readWorkbook, type SheetRecord } from './readExcel'

/**
 * The recording keeps every style of the first sheet, and the values, formulas and number
 * formats of all seven. (All sheets share one style; a separate test checks that.)
 */
function slim(sheets: SheetRecord[]): SheetRecord[] {
  return sheets.map((sheet, index) =>
    index === 0
      ? sheet
      : {
          ...sheet,
          cells: Object.fromEntries(
            Object.entries(sheet.cells)
              .map(([address, { value, formula, result, numFmt }]) => [address, JSON.parse(JSON.stringify({ value, formula, result, numFmt }))])
              .filter(([, cell]) => Object.keys(cell as object).length > 0),
          ),
        },
  )
}

describe('Excel file read back (recorded)', () => {
  let bytes: Uint8Array
  let sheets: SheetRecord[]
  beforeAll(async () => {
    bytes = await writePayslipWorkbook(fixtureDocuments())
    sheets = JSON.parse(JSON.stringify(await readWorkbook(bytes))) as SheetRecord[]
  })

  it('is exactly the recorded workbook: values, formulas, merges, formats, fonts, fills, borders', () => {
    expectRecorded('excel-workbook', slim(sheets))
  })

  it('styles every sheet the same way as the first one', () => {
    const styleOf = (sheet: SheetRecord) =>
      Object.fromEntries(Object.entries(sheet.cells).map(([address, cell]) => [address, [cell.font, cell.fill, cell.border, cell.alignment]]))
    // Sheets 4 and 6 have the same blank cells as sheet 1 (no date of employment differs only in E11).
    const withoutDate = (styles: Record<string, unknown>) => ({ ...styles, E11: null })
    for (const sheet of sheets.slice(1)) expect(withoutDate(styleOf(sheet))).toEqual(withoutDate(styleOf(sheets[0])))
  })

  it('PROOF the recording can fail: one changed cell value, or one changed fill, no longer matches it', () => {
    const recorded = readRecorded<SheetRecord[]>('excel-workbook')
    const value = slim(structuredClone(sheets))
    expect(value[0].cells.E18.value).toBe(279.52)
    value[0].cells.E18.value = 279.53
    expect(value).not.toEqual(recorded)

    const style = slim(structuredClone(sheets))
    const fill = style[0].cells.B4.fill as { fgColor: { argb: string } }
    expect(fill.fgColor.argb).toBe('FF66CCFF')
    fill.fgColor.argb = 'FF66CCFE'
    expect(style).not.toEqual(recorded)

    expect(slim(sheets)).toEqual(recorded)
  })

  it('has one sheet per employee, named after the employee, on one A4 portrait page', () => {
    expect(sheets.map((s) => s.name)).toEqual([
      'DOE JANE',
      'PALMYRE JEAN MARC',
      'SAMPLE ALEX',
      'TESTER SAM',
      'EXEMPLE PRIYA',
      'FICTIF MARIE',
      'TEMPO LEA',
    ])
    for (const sheet of sheets) {
      expect(sheet.pageSetup).toMatchObject({
        paperSize: 9,
        orientation: 'portrait',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 1,
      })
    }
  })

  it('stores plain numbers for every figure and live formulas for the three totals only', () => {
    const { cells } = sheets[0]
    expect(cells.C16.value).toBe(18000)
    expect(cells.C17.value).toBe(635)
    expect(cells.C19.value).toBe(2450)
    expect(cells.E18.value).toBe(279.52)
    expect(cells.E19.value).toBe(210.85)
    expect(cells.E20.value).toBe(0)
    expect(cells.C26).toMatchObject({ formula: 'C16+C17+C18+C19+C20+C21+C22', result: 21085 })
    expect(cells.E26).toMatchObject({ formula: 'E18+E19+E20+E23+E24', result: 490.37 })
    expect(cells.E29).toMatchObject({ formula: 'C26-E26', result: 20594.63 })
    const formulas = Object.entries(cells)
      .filter(([, c]) => c.formula)
      .map(([address]) => address)
    expect(formulas.sort()).toEqual(['C26', 'E26', 'E29'])
  })

  it('formats whole amounts with 0 decimals and fractional ones with 2, zero as "-"', () => {
    const { cells } = sheets[0]
    expect(cells.C16.numFmt).toBe(FORMAT_WHOLE)
    expect(cells.E18.numFmt).toBe(FORMAT_DECIMALS)
    expect(cells.E20.numFmt).toBe(FORMAT_WHOLE)
    expect(cells.C26.numFmt).toBe(FORMAT_WHOLE)
    expect(cells.E29.numFmt).toBe(FORMAT_DECIMALS)
    expect(FORMAT_WHOLE).toContain('"-"')
    expect(FORMAT_DECIMALS).toContain('"-"')
  })

  it('keeps the reference look: Book Antiqua, blue bands, merged headings, thick divider', () => {
    const { cells, merges } = sheets[0]
    expect(cells.B4.font).toMatchObject({ name: 'Book Antiqua', size: 12, bold: true })
    expect(cells.B16.font).toMatchObject({ name: 'Book Antiqua', size: 11 })
    expect(cells.B4.fill).toMatchObject({ pattern: 'solid', fgColor: { argb: 'FF66CCFF' } })
    expect(cells.B10.fill).toMatchObject({ pattern: 'solid', fgColor: { argb: 'FF66CCFF' } })
    expect(merges).toEqual(['B10:E10', 'B14:C14', 'B4:E4', 'B5:E5', 'B6:E6', 'B7:E7', 'B8:E8', 'D14:E14'])
    expect((cells.C20.border as { right: { style: string } }).right.style).toBe('thick')
    expect((cells.B20.border as { left: { style: string } }).left.style).toBe('medium')
    expect((cells.E34.border as { bottom: { style: string } }).bottom.style).toBe('medium')
  })

  it('writes dates as real dates in d-mmm-yy', () => {
    const { cells } = sheets[0]
    expect(cells.C32).toMatchObject({ value: '2026-09-28T00:00:00.000Z', numFmt: 'd-mmm-yy' })
    expect(cells.E11).toMatchObject({ value: '2021-03-15T00:00:00.000Z', numFmt: 'd-mmm-yy' })
  })

  it('carries the display rule into conditional formats on the three totals', () => {
    const files = unzipSync(bytes)
    const sheetXml = strFromU8(files['xl/worksheets/sheet1.xml'])
    const stylesXml = strFromU8(files['xl/styles.xml'])
    expect(sheetXml.match(/<conditionalFormatting /g)).toHaveLength(3)
    expect(sheetXml).toContain('C26=TRUNC(C26)')
    expect(stylesXml).toMatch(/<dxf>.*<numFmt /s)
  })

  it('holds no personal details in the file properties', () => {
    const core = strFromU8(unzipSync(bytes)['docProps/core.xml'])
    expect(core).toContain('Payslip app')
    expect(core).not.toMatch(/noor/i)
  })
})

describe('sheet names', () => {
  it('are unique, at most 31 characters, without the characters Excel forbids', () => {
    expect(sheetNames(['DOE JANE', 'DOE JANE', 'A/B [C]: D?', 'X'.repeat(40), 'X'.repeat(40)])).toEqual([
      'DOE JANE',
      'DOE JANE (2)',
      'A B C D',
      'X'.repeat(31),
      `${'X'.repeat(27)} (2)`,
    ])
  })
})
