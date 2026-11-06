// "From your file", Stage 2, part 1: long names, the address split at its last comma, and the page
// settings (orientation, Normal or Narrow margins, fitted to one page or at 100%). Fake data only.

import ExcelJS from 'exceljs'
import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { scaleWords } from '../src/components/SheetPageSettings'
import { formatFor, readSheetBody, sheetProblems, type SheetBody, type Source } from '../src/lib/sheetBody'
import { buildSheetDocument, prepareSheetPayslips, TOO_LARGE_AT_FULL_SIZE, type SheetDocument, type SheetInUse } from '../src/lib/sheetDocument'
import { evaluateSheet } from '../src/lib/sheetEvaluate'
import { readSheetFile } from '../src/lib/sheetRead'
import type { PayrollRow } from '../src/lib/payrollFile'
import { writePayslipWorkbook } from '../src/writers/excelWriter'
import { columnPoints, layoutSheet, pageOf, textWidth } from '../src/writers/sheetGeometry'
import { fakeLayoutBytes } from '../scripts/lib/fake-layout.mjs'
import { loadFixture } from './helpers'

const PERIOD = '2026-09'
const TODAY = '2026-09-30'

/** A layout with one cell per row, each in a column of `width` (Excel's unit), and a text below. */
function layout(sources: Source[], width: number, extra: Partial<SheetBody> = {}): SheetBody {
  return {
    schema: 2,
    kind: 'file',
    orientation: 'portrait',
    firstRow: 0,
    firstColumn: 0,
    columns: [width, 10],
    rows: [
      ...sources.map((source, index) => ({ height: 15, cells: [{ id: `c${index}`, col: 0, style: 0, source, format: formatFor(source) }] })),
      { height: 15, cells: [{ id: 'below', col: 0, style: 0, source: { type: 'text', value: 'Below' } as Source, format: { type: 'text', capitals: false } as const }] },
    ],
    merges: [],
    // The second column is never empty, so no text flows over it.
    styles: [{ font: { name: 'Book Antiqua', size: 11 } }],
    ...extra,
  }
}

/** The layout with the second column filled on every row, so a text keeps to the first column. */
function walled(body: SheetBody): SheetBody {
  return {
    ...body,
    rows: body.rows.map((row, index) => ({ ...row, cells: [...row.cells, { id: `w${index}`, col: 1, style: 0, source: { type: 'text', value: 'x' }, format: { type: 'text', capitals: false } }] })),
  }
}

const sheet = (body: SheetBody): SheetInUse => ({ body, own: {}, id: 't', version: 'v1' })
const build = (body: SheetBody, row: PayrollRow) => buildSheetDocument(sheet(body), row, PERIOD, TODAY).document

/** The width of column A, in Excel's unit, in which this text just fits on one line at `size`, inside the padding. */
function widthFitting(text: string, size: number): number {
  for (let width = 1; width < 200; width += 0.25) if (columnPoints(width) - 4 >= textWidth(text, 'regular', size)) return width
  throw new Error('no width')
}

const person = (surname: string, other: string): PayrollRow => ({ ID: 'X0000000000001', Surname: surname, 'Other names': other })
/** The sizes texts print at, in points of the sheet, whatever the page's scale. */
const sheetSizes = (doc: SheetDocument, found: string[]) => {
  const page = layoutSheet(doc)
  const scale = pageOf(doc).scale
  return page.texts.filter((text) => found.includes(text.text)).map((text) => Math.round((text.size / scale) * 100) / 100)
}

describe('a long name', () => {
  const name = 'SAMPLELONGNAME Annabelle Marie-Claire'

  it('that fits keeps its size, on one line', () => {
    const body = walled(layout([{ type: 'name' }], widthFitting(name, 11)))
    const doc = build(body, person('SAMPLELONGNAME', 'Annabelle Marie-Claire'))
    expect(doc.rows[0].cells[0]).not.toHaveProperty('size')
    expect(doc.rows[0].height).toBe(15)
    expect(sheetSizes(doc, [name])).toEqual([11])
  })

  it('is set smaller on one line, down to 9 points of the sheet', () => {
    const body = walled(layout([{ type: 'name' }], widthFitting(name, 9.5)))
    const doc = build(body, person('SAMPLELONGNAME', 'Annabelle Marie-Claire'))
    expect(doc.rows[0].cells[0].text).toBe(name)
    expect(doc.rows[0].cells[0].size).toBe(9.5)
    expect(sheetSizes(doc, [name])).toEqual([9.5])
  })

  it('never below 9 points: then on two lines, broken after the surname, and its row grows', () => {
    // On one line it would fit at 8.5 points; the rule says 9 at least.
    const body = walled(layout([{ type: 'name' }], widthFitting(name, 8.5)))
    const doc = build(body, person('SAMPLELONGNAME', 'Annabelle Marie-Claire'))
    expect(doc.rows[0].cells[0].text).toBe('SAMPLELONGNAME Annabelle\nMarie-Claire')
    expect(doc.rows[0].cells[0].size).toBe(11)
    expect(doc.rows[0].height).toBeGreaterThanOrEqual(2 * 11 * 1.2)
    const page = layoutSheet(doc)
    expect(page.overflow).toEqual([])
    const lines = page.texts.filter((text) => text.text.startsWith('SAMPLE') || text.text === 'Marie-Claire')
    expect(lines.map((text) => text.text)).toEqual(['SAMPLELONGNAME Annabelle', 'Marie-Claire'])
    expect(Math.min(...page.texts.map((text) => text.size / pageOf(doc).scale))).toBeGreaterThanOrEqual(9)
  })

  it('pushes the rows below down by as much as its row grew', () => {
    const narrow = walled(layout([{ type: 'name' }], widthFitting(name, 8.5)))
    const short = build(narrow, person('SAMPLE', 'Ann'))
    const long = build(narrow, person('SAMPLELONGNAME', 'Annabelle Marie-Claire'))
    const below = (doc: SheetDocument) => layoutSheet(doc).texts.find((text) => text.text === 'Below')!.y
    const grown = (long.rows[0].height - short.rows[0].height) * pageOf(long).scale
    expect(grown).toBeGreaterThan(0)
    expect(below(long) - below(short)).toBeCloseTo(grown, 1)
  })

  it('the surname alone, or the other names alone, follow the same rule', () => {
    const other = 'Annabelle Marie-Claire Josephine'
    const body = walled(layout([{ type: 'employee', key: 'Other names' }], widthFitting(other, 8.5)))
    const doc = build(body, person('SAMPLE', other))
    expect(doc.rows[0].cells[0].text).toContain('\n')
    expect(doc.rows[0].cells[0].size).toBeGreaterThanOrEqual(9)
  })

  it('too long even on two lines at 9 points: the payslip is refused, never cut', () => {
    const body = walled(layout([{ type: 'name' }], 6))
    const prepared = prepareSheetPayslips({ ...loadFixture(), rows: [person('SAMPLELONGNAME', 'Annabelle Marie-Claire')] }, sheet(body), PERIOD, TODAY)
    expect(prepared[0].computation.errors.map((error) => error.code)).toContain('too-long')
    expect(prepared[0].document).toBeNull()
  })

  it('a cell whose own size is below 9 points keeps that size: it is never set larger', () => {
    const body = walled({ ...layout([{ type: 'name' }], widthFitting(name, 8)), styles: [{ font: { name: 'Book Antiqua', size: 8 } }] })
    const doc = build(body, person('SAMPLELONGNAME', 'Annabelle Marie-Claire'))
    expect(doc.rows[0].cells[0].size).toBeUndefined()
    expect(sheetSizes(doc, [name])).toEqual([8])
  })

  it('in Excel: the size chosen, the two lines kept as two, and the taller row', async () => {
    const body = walled(layout([{ type: 'name' }], widthFitting(name, 8.5)))
    const doc = build(body, person('SAMPLELONGNAME', 'Annabelle Marie-Claire'))
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load((await writePayslipWorkbook([doc])) as unknown as ArrayBuffer)
    const cell = workbook.worksheets[0].getCell('A1')
    expect(cell.value).toBe('SAMPLELONGNAME Annabelle\nMarie-Claire')
    expect(cell.alignment).toMatchObject({ wrapText: true })
    expect(cell.font.size).toBe(11)
    expect(workbook.worksheets[0].getRow(1).height).toBe(doc.rows[0].height)

    const smaller = build(walled(layout([{ type: 'name' }], widthFitting(name, 9.5))), person('SAMPLELONGNAME', 'Annabelle Marie-Claire'))
    // ExcelJS reads a size back as a whole number, so the file itself is read: Excel shows 9.5.
    const styles = new TextDecoder().decode(unzipSync(await writePayslipWorkbook([smaller]))['xl/styles.xml'])
    expect(styles).toContain('<sz val="9.5"/>')
  })
})

describe('the address split at its last comma', () => {
  const row = (address: string): PayrollRow => ({ ID: 'X1', Surname: 'SAMPLE', 'Other names': 'Ann', Address: address })

  it('in two cells: the part before the last comma, and the part after it', () => {
    const body = walled(layout([{ type: 'company', field: 'address1' }, { type: 'company', field: 'address2' }], 40))
    const doc = build(body, row('1 Fake Street, Rose Hill, Port Example'))
    expect([doc.rows[0].cells[0].text, doc.rows[1].cells[0].text]).toEqual(['1 Fake Street, Rose Hill', 'Port Example'])
  })

  it('the cell panel shows each part as the payslip prints it', () => {
    const body = walled(layout([{ type: 'company', field: 'address1' }, { type: 'company', field: 'address2' }, { type: 'company', field: 'addressLines' }], 40))
    const context = { company: { name: 'ABC Co Ltd', address: '1 Fake Street, Rose Hill, Port Example', brn: '', vat: '' }, period: PERIOD, today: TODAY, own: {} }
    const values = evaluateSheet(body, context, {})
    expect([values.get('c0')!.text, values.get('c1')!.text, values.get('c2')!.text]).toEqual(['1 Fake Street, Rose Hill', 'Port Example', '1 Fake Street, Rose Hill\nPort Example'])
  })

  it('an address with no comma stays whole in the first cell', () => {
    const body = walled(layout([{ type: 'company', field: 'address1' }, { type: 'company', field: 'address2' }], 40))
    const doc = build(body, row('1 Fake Street Port Example'))
    expect([doc.rows[0].cells[0].text, doc.rows[1].cells[0].text]).toEqual(['1 Fake Street Port Example', ''])
  })

  it('too long for the first cell even at 8 points: a part moves down, as drawing 3 does', () => {
    const address = '1 Fake Street Building Number Twelve, Rose Hill, Port Example'
    const body = walled(layout([{ type: 'company', field: 'address1' }, { type: 'company', field: 'address2' }], widthFitting('1 Fake Street Building Number Twelve', 11)))
    const doc = build(body, row(address))
    expect([doc.rows[0].cells[0].text, doc.rows[1].cells[0].text]).toEqual(['1 Fake Street Building Number Twelve', 'Rose Hill, Port Example'])
    expect(layoutSheet(doc).overflow).toEqual([])
  })

  it('on two lines of one cell; the row grows when they need more height', async () => {
    const body = walled(layout([{ type: 'company', field: 'addressLines' }], 40))
    const doc = build(body, row('1 Fake Street, Port Example'))
    expect(doc.rows[0].cells[0].text).toBe('1 Fake Street\nPort Example')
    expect(doc.rows[0].height).toBeGreaterThanOrEqual(2 * 11 * 1.2)
    expect(layoutSheet(doc).texts.map((text) => text.text)).toEqual(expect.arrayContaining(['1 Fake Street', 'Port Example']))
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load((await writePayslipWorkbook([doc])) as unknown as ArrayBuffer)
    expect(workbook.worksheets[0].getCell('A1').alignment).toMatchObject({ wrapText: true })
  })

  it('in capitals when the cell says so', () => {
    const body = walled(layout([{ type: 'company', field: 'address1' }, { type: 'company', field: 'address2' }], 40))
    const capital = { ...body, rows: body.rows.map((r) => ({ ...r, cells: r.cells.map((c) => (c.id === 'c1' ? { ...c, format: { type: 'text' as const, capitals: true } } : c)) })) }
    expect(build(capital, row('1 Fake Street, Port Example')).rows[1].cells[0].text).toBe('PORT EXAMPLE')
  })

  it('the part before the comma without a cell for the part after it is a problem of the layout', () => {
    const body = walled(layout([{ type: 'company', field: 'address1' }], 40))
    expect(sheetProblems(body)).toContain('The address split at its last comma needs one cell for the part before the comma and one cell for the part after it.')
    expect(sheetProblems(walled(layout([{ type: 'company', field: 'address1' }, { type: 'company', field: 'address2' }], 40)))).toEqual([])
  })
})

describe('the page settings', () => {
  const wide = (extra: Partial<SheetBody> = {}): SheetBody => ({ ...layout([{ type: 'text', value: 'Payslip' }], 150), columns: [150, 10], ...extra })

  it('Normal margins by default, Narrow on request: the sheet prints larger with narrow ones', () => {
    const normal = pageOf(wide())
    const narrow = pageOf(wide({ margins: 'narrow' }))
    expect([normal.x, normal.y, narrow.x, narrow.y]).toEqual([50.4, 54, 18, 54])
    expect(narrow.scale).toBeGreaterThan(normal.scale)
    const full = columnPoints(150) + columnPoints(10)
    expect(normal.scale).toBeCloseTo((595.28 - 100.8) / full, 6)
    expect(narrow.scale).toBeCloseTo((595.28 - 36) / full, 6)
  })

  it('landscape gives the page its long side across', () => {
    const page = pageOf(wide({ orientation: 'landscape' }))
    expect([page.width, page.height]).toEqual([841.89, 595.28])
    expect(page.scale).toBeGreaterThan(pageOf(wide()).scale)
  })

  it('fitted to one page it is made smaller, never larger; at 100% a sheet too large is refused, in words', () => {
    expect(pageOf(layout([{ type: 'text', value: 'Small' }], 10)).scale).toBe(1)
    const atFull = wide({ fit: false })
    expect(pageOf(atFull)).toMatchObject({ scale: 1, fits: false })
    const prepared = prepareSheetPayslips({ ...loadFixture(), rows: [person('SAMPLE', 'Ann')] }, sheet(atFull), PERIOD, TODAY)
    expect(prepared[0].computation.errors.map((error) => error.message)).toContain(TOO_LARGE_AT_FULL_SIZE)
    expect(pageOf(layout([{ type: 'text', value: 'Small' }], 10, { fit: false }))).toMatchObject({ scale: 1, fits: true })
  })

  it('the scale is shown, and below 85% a warning says how small 11-point text prints', () => {
    const small = scaleWords(wide())
    const percent = Math.floor(pageOf(wide()).scale * 100)
    expect(small.text).toBe(`It prints at ${percent}% of its size in Excel.`)
    expect(small.warning).toMatch(/^Below 85%, the payslip prints small: 11-point text prints at about \d+(\.\d)? points\. Try narrow margins or landscape, or make the columns narrower in Excel\.$/)
    const fine = scaleWords(layout([{ type: 'text', value: 'Small' }], 10))
    expect(fine).toEqual({ text: 'It prints at 100% of its size in Excel.', warning: null, tooLarge: null })
    expect(scaleWords(wide({ fit: false })).tooLarge).toBe(TOO_LARGE_AT_FULL_SIZE)
  })

  it('the warning starts just below 85%, not at it', () => {
    const at = (scale: number) => {
      const usable = 595.28 - 100.8
      // Columns as wide as gives this scale: whole Excel units are coarse, so search finely.
      for (let width = 50; width < 400; width += 0.01) {
        const body = { ...layout([{ type: 'text', value: 'x' }], width), columns: [width] }
        const found = pageOf(body).scale
        if (found <= scale) return body
      }
      throw new Error(`no width for ${usable}`)
    }
    expect(scaleWords(at(0.86)).warning).toBeNull()
    expect(scaleWords(at(0.849)).warning).not.toBeNull()
  })

  it('the Excel sheet has the same page settings', async () => {
    const doc = (extra: Partial<SheetBody>) => build(wide(extra), person('SAMPLE', 'Ann'))
    const read = async (document: SheetDocument) => {
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load((await writePayslipWorkbook([document])) as unknown as ArrayBuffer)
      return workbook.worksheets[0].pageSetup
    }
    expect(await read(doc({}))).toMatchObject({ orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1, margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75 } })
    expect(await read(doc({ margins: 'narrow', orientation: 'landscape' }))).toMatchObject({ orientation: 'landscape', margins: { left: 0.25, right: 0.25 } })
    const atFull = await read(doc({ fit: false }))
    expect(atFull.fitToPage).toBe(false)
    expect(atFull.scale).toBe(100)
  })

  it('an upload takes the nearer of the two margins from the file, and is fitted to one page', async () => {
    const plain = await readSheetFile('Payslip.xlsx', await fakeLayoutBytes())
    expect(plain.body.margins).toBeUndefined()
    expect(plain.body.fit).toBeUndefined()

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load((await fakeLayoutBytes()) as unknown as ArrayBuffer)
    workbook.worksheets[0].pageSetup.margins = { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 }
    const narrow = await readSheetFile('Payslip.xlsx', new Uint8Array(await workbook.xlsx.writeBuffer()))
    expect(narrow.body.margins).toBe('narrow')
  })

  it('a layout from the dashboard keeps its settings, and refuses any other value', () => {
    const body = wide({ margins: 'narrow', fit: false })
    expect(readSheetBody(body)).toEqual({ ok: true, body })
    expect(readSheetBody({ ...body, margins: 'wide' }).ok).toBe(false)
    expect(readSheetBody({ ...body, fit: true }).ok).toBe(false)
  })
})
