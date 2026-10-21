// The company address on lines 3 and 4 of the header (drawing version 3): split at the LAST comma.
// When line 3 is too wide at the normal size, its last words move down to the start of line 4,
// at a comma if possible; only when that does not fit either are both lines set smaller, never
// below 8 points. Fake addresses only (ABC Co Ltd).
import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUTORY_RATES } from '../src/data/defaultStatutoryRates'
import { preparePayslips, type PreparedPayslip } from '../src/lib/build'
import { decodeLines, encodeLines, figuresOf, sameLines } from '../src/lib/issuedLines'
import { documentTexts, type PayslipDocument } from '../src/lib/layoutModel'
import { importPayrollText } from '../src/lib/payrollFile'
import { DEFAULT_TABLE_MAPPING, TABLE_TEMPLATE } from '../src/lib/template'
import { writePayslipWorkbook } from '../src/writers/excelWriter'
import { layoutPage, measureText, PAGE, type DrawList } from '../src/writers/pageGeometry'
import { writePayslipPdf } from '../src/writers/pdfWriter'
import { ISSUE_DATE, PERIOD } from './fixtureDocuments'
import { expectFrozen, FIXTURE_NAME, readFixtureText, readFont } from './helpers'
import { readWorkbook } from './readExcel'
import { readPdf } from './readPdf'

const ADDRESSES = {
  threeCommas: 'Impasse Fictive 2, Avenue Exemple Remy Sample, Bonne Terre, Vacoas',
  oneComma: '12 Example Street, Port Louis',
  noComma: '12 Example Street Port Louis',
  trailingComma: 'Impasse Fictive 2, Avenue Exemple, Bonne Terre, Vacoas,',
  extraSpaces: '  Impasse   Fictive 2 ,  Avenue  Exemple ,Bonne Terre,    Vacoas  ',
  movedAtComma: 'Lot 12 Residence Les Flamboyants Exemple, Avenue des Jacarandas Fictive Prolongee, Quartier Sample Nord, Bonne Terre, Vacoas',
  movedBetweenWords: 'Lot 12 Residence Les Flamboyants Morcellement Exemple Avenue des Jacarandas Fictive Prolongee Quartier Sample Nord, Vacoas',
  smaller:
    'Lot 12 Residence Les Flamboyants Morcellement Exemple, Avenue des Jacarandas Fictive Prolongee Sud, Quartier Sample Nord Est, Domaine Fictif Bonne Terre, Vacoas Phoenix District Plaines Wilhems',
  longLastPart: 'Lot 5, Quartier Residentiel Sample Nord Est des Jacarandas Fictifs Prolonges Domaine Exemple Plaines Wilhems Vacoas',
  tooLong:
    'Lot 12 Residence Les Flamboyants Morcellement Exemple, Avenue des Jacarandas Fictive Prolongee Sud, Quartier Sample Nord Est Ouest Centre, Domaine Fictif Bonne Terre Sample, Lotissement Exemple Numero Quatre Cent, Vacoas Phoenix District Plaines Wilhems Republique',
}

const fonts = { regular: readFont('regular'), bold: readFont('bold') }

/** The fake September payroll with another company address, read through the importer as a file would be. */
function prepared(address: string): PreparedPayslip[] {
  const rows = (JSON.parse(readFixtureText(FIXTURE_NAME)) as object[]).map((row) => ({ ...row, Address: address }))
  const imported = importPayrollText(JSON.stringify(rows), FIXTURE_NAME)
  if (!imported.ok) throw new Error(JSON.stringify(imported.errors))
  return preparePayslips(imported.data, { template: TABLE_TEMPLATE, mapping: DEFAULT_TABLE_MAPPING, rateVersions: DEFAULT_STATUTORY_RATES, period: PERIOD }, ISSUE_DATE)
}

function payslip(address: string): { doc: PayslipDocument; page: DrawList; item: PreparedPayslip } {
  const item = prepared(address)[0]
  expect(item.computation.errors.map((error) => error.message)).toEqual([])
  return { doc: item.document!, page: item.page!, item }
}

const linesOf = (doc: PayslipDocument) => ['address-1', 'address-2'].map((id) => doc.rows.find((row) => row.id === id)!.cells[0].text)
/** The drawn address texts with their sizes; an empty line is not drawn. */
const drawnAddress = (doc: PayslipDocument, page: DrawList) =>
  linesOf(doc)
    .filter((text) => text !== '')
    .map((text) => {
      const drawn = page.texts.find((found) => found.text === text)!
      return { text, size: drawn.size, left: drawn.x, right: drawn.x + measureText(text, drawn.font, drawn.size).width }
    })

describe('the address is split at its last comma (drawing 3)', () => {
  it('3 commas: line 3 is everything before the last comma, commas kept; line 4 what comes after it', () => {
    const { doc, page } = payslip(ADDRESSES.threeCommas)
    expect(doc.drawing).toBe(3)
    expect(linesOf(doc)).toEqual(['Impasse Fictive 2, Avenue Exemple Remy Sample, Bonne Terre', 'Vacoas'])
    expect(drawnAddress(doc, page).map((line) => line.size)).toEqual([11, 11])
  })

  it('1 comma, and no comma: the same as before', () => {
    expect(linesOf(payslip(ADDRESSES.oneComma).doc)).toEqual(['12 Example Street', 'Port Louis'])
    const none = payslip(ADDRESSES.noComma)
    expect(linesOf(none.doc)).toEqual(['12 Example Street Port Louis', ''])
    expect(none.page.texts.map((text) => text.text)).not.toContain('')
    // A payslip with one comma is drawn by drawing 3 exactly as by drawing 2.
    const one = payslip(ADDRESSES.oneComma)
    expect(one.page).toEqual(layoutPage({ ...one.doc, drawing: 2 }))
  })

  it('a trailing comma and extra spaces are left out', () => {
    expect(linesOf(payslip(ADDRESSES.trailingComma).doc)).toEqual(['Impasse Fictive 2, Avenue Exemple, Bonne Terre', 'Vacoas'])
    expect(linesOf(payslip(ADDRESSES.extraSpaces).doc)).toEqual(['Impasse Fictive 2, Avenue Exemple, Bonne Terre', 'Vacoas'])
  })

  it('line 3 too wide: its last part moves down to line 4, at a comma, at the normal size', () => {
    const { doc, page } = payslip(ADDRESSES.movedAtComma)
    expect(linesOf(doc)).toEqual(['Lot 12 Residence Les Flamboyants Exemple, Avenue des Jacarandas Fictive Prolongee', 'Quartier Sample Nord, Bonne Terre, Vacoas'])
    expect(drawnAddress(doc, page).map((line) => line.size)).toEqual([11, 11])
  })

  it('line 3 too wide with no comma to break at: its last words move down, between words', () => {
    const { doc, page } = payslip(ADDRESSES.movedBetweenWords)
    const [line3, line4] = linesOf(doc)
    expect(line4.endsWith(', Vacoas')).toBe(true)
    expect(`${line3} ${line4}`).toBe(ADDRESSES.movedBetweenWords)
    expect(drawnAddress(doc, page).map((line) => line.size)).toEqual([11, 11])
  })

  it('a very long address: both lines smaller, the same size, not below 8 points, broken at a comma', () => {
    const { doc, page } = payslip(ADDRESSES.smaller)
    const [line3, line4] = linesOf(doc)
    expect(`${line3}, ${line4}`).toBe(ADDRESSES.smaller)
    const [first, second] = drawnAddress(doc, page)
    expect(first.size).toBe(second.size)
    expect(first.size).toBeLessThan(11)
    expect(first.size).toBeGreaterThanOrEqual(8)
  })

  it('a long part after the last comma: both lines are set smaller together, line 3 too', () => {
    const { doc, page } = payslip(ADDRESSES.longLastPart)
    expect(linesOf(doc)).toEqual(['Lot 5', ADDRESSES.longLastPart.slice('Lot 5, '.length)])
    const [first, second] = drawnAddress(doc, page)
    expect(second.size).toBeLessThan(11)
    expect(first.size).toBe(second.size)
  })

  it('too long even at 8 points: the payslip is refused, as a long text is today, never printed below 8 points', () => {
    const [item] = prepared(ADDRESSES.tooLong)
    expect(item.document).toBeNull()
    expect(item.computation.errors.map((error) => error.message)).toEqual([
      `"${ADDRESSES.tooLong.slice(0, ADDRESSES.tooLong.lastIndexOf(','))}" is too long to fit on the payslip, even at the smallest size.`,
      `"${ADDRESSES.tooLong.slice(ADDRESSES.tooLong.lastIndexOf(',') + 2)}" is too long to fit on the payslip, even at the smallest size.`,
    ])
  })

  it('every address line is centred inside the box, and nothing above the employee band moves', () => {
    const short = payslip(ADDRESSES.oneComma)
    for (const address of [ADDRESSES.threeCommas, ADDRESSES.movedAtComma, ADDRESSES.movedBetweenWords, ADDRESSES.smaller]) {
      const { doc, page } = payslip(address)
      for (const line of drawnAddress(doc, page)) {
        expect(line.left).toBeGreaterThanOrEqual(44)
        expect(line.right).toBeLessThanOrEqual(PAGE.width - 44)
        expect(Math.abs(line.left + line.right - PAGE.width)).toBeLessThan(0.05)
      }
      // The same rows at the same heights: only the two address texts differ from a short address.
      const others = (p: DrawList, d: PayslipDocument) => p.texts.filter((text) => !linesOf(d).includes(text.text))
      expect(others(page, doc)).toEqual(others(short.page, short.doc))
      expect(page.lines).toEqual(short.page.lines)
      // At the normal size the lines sit where they always did; set smaller, their capitals stay centred in the same rows.
      const ys = (p: DrawList, d: PayslipDocument) => p.texts.filter((text) => linesOf(d).includes(text.text)).map((text) => text.y)
      const shortYs = ys(short.page, short.doc)
      if (drawnAddress(doc, page)[0].size === 11) expect(ys(page, doc)).toEqual(shortYs)
      else ys(page, doc).forEach((y, index) => expect(Math.abs(y - shortYs[index])).toBeLessThan(1))
    }
  })

  it('the screen, the PDF and the Excel sheet show the same two lines; Excel sets them smaller when the page does, in whole points', async () => {
    for (const address of [ADDRESSES.threeCommas, ADDRESSES.smaller]) {
      const { doc, page } = payslip(address)
      expect(page.texts.map((text) => text.text)).toEqual(documentTexts(doc))
      const pdf = await readPdf(await writePayslipPdf(doc, fonts))
      expect(pdf.texts.map((text) => text.text)).toEqual(documentTexts(doc))
      const [line3, line4] = linesOf(doc)
      const size = drawnAddress(doc, page)[0].size
      expect(pdf.texts.filter((text) => text.text === line3 || text.text === line4).map((text) => text.size)).toEqual([size, size])
      const [sheet] = await readWorkbook(await writePayslipWorkbook([doc]))
      expect([sheet.cells.B6.value, sheet.cells.B7.value]).toEqual([line3, line4])
      const excelSize = size === 11 ? 12 : Math.floor((12 * size) / 11)
      expect([sheet.cells.B6.font, sheet.cells.B7.font]).toEqual([
        { name: 'Book Antiqua', size: excelSize, bold: true },
        { name: 'Book Antiqua', size: excelSize, bold: true },
      ])
    }
  })

  it('is stored as it is printed, and an issued payslip of drawing 2 is drawn as before', () => {
    const { doc, item } = payslip(ADDRESSES.threeCommas)
    expect(doc.drawing).toBe(3)
    const lines = encodeLines(doc, figuresOf(item.computation))
    const read = decodeLines(JSON.parse(JSON.stringify(lines)))
    if (!read.ok) throw new Error(read.problem)
    expect(read.document).toEqual(doc)
    // The same stored lines with drawing 2: the texts are drawn where drawing 2 draws them.
    expect(layoutPage({ ...read.document, drawing: 2 }).texts.map((text) => text.text)).toEqual(documentTexts(doc))
  })

  it('drawings 1, 2 and 3 count as the same payslip when their lines are the same', () => {
    const { doc, item } = payslip(ADDRESSES.oneComma)
    const lines = encodeLines(doc, figuresOf(item.computation)) as Record<string, unknown>[]
    expect(lines[0].drawing).toBe(3)
    const as = (drawing: number) => [{ ...lines[0], drawing }, ...lines.slice(1)]
    expect(sameLines(as(1), lines)).toBe(true)
    expect(sameLines(as(2), lines)).toBe(true)
    expect(sameLines(as(4), lines)).toBe(false)
  })
})

describe('drawing version 3, as stored (frozen)', () => {
  // Like tests/format1.test.ts: written once, never re-recorded. The 3-comma fake address.
  it('the lines, the page, the PDF and the Excel sheet are the ones it was first written with', async () => {
    const { doc, item } = payslip(ADDRESSES.threeCommas)
    expectFrozen('format-1-drawing-3/lines', encodeLines(doc, figuresOf(item.computation)))
    const read = decodeLines(JSON.parse(JSON.stringify(encodeLines(doc, figuresOf(item.computation)))))
    if (!read.ok) throw new Error(read.problem)
    expect(read.document.drawing).toBe(3)
    expectFrozen('format-1-drawing-3/page', layoutPage(read.document))
    expectFrozen('format-1-drawing-3/pdf', await readPdf(await writePayslipPdf(read.document, fonts)))
    expectFrozen('format-1-drawing-3/excel', JSON.parse(JSON.stringify(await readWorkbook(await writePayslipWorkbook([read.document])))))
  })
})
