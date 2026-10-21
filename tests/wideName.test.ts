// A wider place for a long name (drawing version 4). A name that fits its column at the normal size
// or smaller down to 8 points is drawn as in drawing 3. Otherwise it starts closer to "Name :", and
// "Date of Employment :" with its date moves right on the same row, so the name has the space
// between them: one line there, down to 8 points; then two lines there, down to 8 points; then the
// usual "too long" error. Fake names only (ABC Co Ltd).
import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUTORY_RATES } from '../src/data/defaultStatutoryRates'
import { preparePayslips, type PreparedPayslip } from '../src/lib/build'
import { issueStatuses } from '../src/lib/issueBuild'
import { decodeLines, encodeLines, figuresOf, sameLines } from '../src/lib/issuedLines'
import { loadMonth, type IssuedPayslip } from '../src/lib/issueStore'
import { documentTexts, DRAWING_VERSION, type PayslipDocument } from '../src/lib/layoutModel'
import { importPayrollText, type ImportedPayroll } from '../src/lib/payrollFile'
import { DEFAULT_TABLE_MAPPING, TABLE_TEMPLATE } from '../src/lib/template'
import { FORMAT_DATE, writePayslipWorkbook } from '../src/writers/excelWriter'
import { layoutPage, measureText, PAGE, type DrawList, type DrawText } from '../src/writers/pageGeometry'
import { writePayslipPdf } from '../src/writers/pdfWriter'
import { BRN } from './fakeHubPort'
import { ISSUE_DATE, PERIOD } from './fixtureDocuments'
import { expectFrozen, FIXTURE_NAME, loadFixture, readFixtureText, readFont, readFrozen } from './helpers'
import { dashboard, issue, monthFrom } from './monthFixtures'
import { overlaps } from './overlaps'
import { readWorkbook, type SheetRecord } from './readExcel'
import { readPdf, type PdfRecord } from './readPdf'

/** Fake names. Each is [surname, other names]. */
const NAMES = {
  fiveWords39: ['BHAGWANSINGH', 'Marie Anne Josee Claudette'],
  longSurname: ['LONGSURNAME-EXAMPLE', 'Marie Anne'],
  sixty: ['MOHAMMUDHAWAMBOO-WAHAB', 'MARIE MAGDALENA WILHELMINA MAXIMILIEN'],
  sixtyMixedCase: ['LAMARQUE-FONTAINE', 'Jean Pierre Marie Emmanuel Christophe Alex'],
  sixtyCapitals: ['LAMARQUE-FONTAINE', 'JEAN PIERRE MARIE EMMANUEL CHRISTOPHE ALEX'],
  oneWordTooLong: ['ABRACADABRAVERYLONGFAKESURNAMEWITHOUTANYSPACEATALLEVERYWHERE', 'Marie'],
  hyphenated: ['RAMKHELAWON-DOE-PERSAUD', 'Marie Anne Josee'],
  hyphenatedTwoLines: ['RAMKHELAWON-DOE-PERSAUD-BHAGWANSINGH', 'JEAN PIERRE MARIE EMMANUEL CHRISTOPHE'],
  smallerInColumn: ['PALMYRE-DOE', 'Jean Marc'],
  belowNineInColumn: ['PALMYRE-LONG', 'Jean Marc'],
  short: ['DOE', 'JANE'],
} as const
const full = ([surname, other]: readonly [string, string]) => `${surname} ${other}`

const fonts = { regular: readFont('regular'), bold: readFont('bold') }

/** The fake September payroll with DOE JANE (the first row) renamed. */
function renamed(surname: string, other: string): ImportedPayroll {
  const data = loadFixture()
  data.rows[0] = { ...data.rows[0], Surname: surname, 'Other names': other }
  return data
}

function prepared([surname, other]: readonly [string, string]): PreparedPayslip {
  return preparePayslips(renamed(surname, other), { template: TABLE_TEMPLATE, mapping: DEFAULT_TABLE_MAPPING, rateVersions: DEFAULT_STATUTORY_RATES, period: PERIOD }, ISSUE_DATE)[0]
}

/** The first payslip, which must be ready. */
function payslip(name: readonly [string, string]): { doc: PayslipDocument; page: DrawList; item: PreparedPayslip } {
  const item = prepared(name)
  expect(item.computation.errors.map((error) => error.message)).toEqual([])
  return { doc: item.document!, page: item.page!, item }
}

const nameCellOf = (doc: PayslipDocument) => doc.rows.find((row) => row.id === 'employee-name')!.cells.find((cell) => cell.col === 1)!
const textOf = <T extends { text: string }>(texts: readonly T[], text: string): T => {
  const found = texts.find((t) => t.text === text)
  if (!found) throw new Error(`"${text}" is not on the page`)
  return found
}
const rightOf = (t: DrawText) => t.x + measureText(t.text, t.font, t.size).width
/** The page of the same payslip as drawing 3 draws the same stored lines. */
const asDrawing3 = (doc: PayslipDocument) => ({ ...doc, drawing: 3 })

/** The name row as the page draws it: the label, each line of the name, the date's label and the date. */
function nameRow(doc: PayslipDocument, page: DrawList) {
  const lines = nameCellOf(doc).text.split('\n').map((line) => textOf(page.texts, line))
  const date = page.texts.find((t) => /^\d{1,2}-[A-Z][a-z]{2}-\d{2}$/.test(t.text) && Math.abs(t.y - lines[0].y) < 1.5)!
  return { label: textOf(page.texts, 'Name :'), lines, dateLabel: textOf(page.texts, 'Date of Employment :'), date }
}

describe('a long name has a wider place on its row (drawing 4)', () => {
  const short = payslip(NAMES.short)
  const shortRow = nameRow(short.doc, short.page)

  it('the fake names are what the cases say', () => {
    expect(DRAWING_VERSION).toBe(4)
    expect(full(NAMES.fiveWords39)).toHaveLength(39)
    expect(full(NAMES.fiveWords39).split(' ')).toHaveLength(5)
    expect(full(NAMES.sixty)).toHaveLength(60)
    expect(full(NAMES.sixtyMixedCase)).toHaveLength(60)
    expect(NAMES.oneWordTooLong[0]).not.toMatch(/[\s-]/)
  })

  it('a 39-character name of 5 words: one line at the normal size, closer to "Name :", the date of employment on the same row, moved right', () => {
    const { doc, page } = payslip(NAMES.fiveWords39)
    expect(nameCellOf(doc).text).toBe(full(NAMES.fiveWords39))
    const row = nameRow(doc, page)
    expect(row.lines).toHaveLength(1)
    const [name] = row.lines
    expect(name.size).toBe(10)
    // Closer to "Name :" than the usual column, with a gap of 8 points.
    expect(name.x).toBeLessThan(shortRow.lines[0].x)
    expect(name.x - rightOf(row.label)).toBeCloseTo(8, 1)
    // The date's label and the date: on the same row, at the same size, moved right; the date ends where the row's last column ends.
    for (const moved of [row.dateLabel, row.date]) expect(moved.y).toBe(name.y)
    expect([row.dateLabel.size, row.date.size]).toEqual([10, 10])
    expect(row.dateLabel.x).toBeGreaterThan(shortRow.dateLabel.x)
    expect(row.date.x).toBeGreaterThan(shortRow.date.x)
    expect(rightOf(row.date)).toBeCloseTo(PAGE.width - 40 - 4, 1)
    // A small gap between each of them, nothing overlaps.
    expect(row.dateLabel.x - rightOf(name)).toBeGreaterThanOrEqual(8)
    expect(row.date.x - rightOf(row.dateLabel)).toBeCloseTo(8, 1)
    expect(overlaps(page)).toEqual([])
  })

  it('"LONGSURNAME-EXAMPLE Marie Anne": no longer 6 points in its column, but the normal size in the wide place', () => {
    const { doc, page } = payslip(NAMES.longSurname)
    expect(layoutPage(asDrawing3(doc)).texts.find((t) => t.text === full(NAMES.longSurname))!.size).toBe(6)
    const [name] = nameRow(doc, page).lines
    expect(name.size).toBe(10)
    expect(nameCellOf(doc).text).toBe(full(NAMES.longSurname))
  })

  it('a name the wide place takes only smaller stays on one line, never below 8 points', () => {
    const { doc, page } = payslip(NAMES.sixtyMixedCase)
    const { lines } = nameRow(doc, page)
    expect(lines.map((line) => line.text)).toEqual([full(NAMES.sixtyMixedCase)])
    expect(lines[0].size).toBeLessThan(10)
    expect(lines[0].size).toBeGreaterThanOrEqual(9)
  })

  it('a 60-character name too wide for one line at 8 points: two lines in the wide place, the surname first, the rows below one row lower', () => {
    const { doc, page } = payslip(NAMES.sixty)
    const [first, second] = nameCellOf(doc).text.split('\n')
    expect(first.startsWith(`${NAMES.sixty[0]} `)).toBe(true)
    expect(`${first} ${second}`).toBe(full(NAMES.sixty))
    const row = nameRow(doc, page)
    expect(row.lines).toHaveLength(2)
    const [one, two] = row.lines
    expect(one.size).toBeGreaterThanOrEqual(8)
    expect(two.size).toBe(one.size)
    expect(two.x).toBe(one.x)
    expect(two.y - one.y).toBeCloseTo(17, 5)
    // At 8 points the name would need more than the wide place on one line.
    expect(measureText(full(NAMES.sixty), 'regular', 8).width).toBeGreaterThan(row.dateLabel.x - 8 - one.x)
    // The date of employment stays on the first line of the row; what is below moves down one row.
    expect(row.dateLabel.y).toBe(one.y)
    expect(textOf(page.texts, 'NIC :').y - textOf(short.page.texts, 'NIC :').y).toBeCloseTo(17, 5)
    expect(overlaps(page)).toEqual([])
  })

  it('with no date of employment, the label alone moves right, to where the row ends; Excel has the label alone in E', async () => {
    const data = renamed(...NAMES.sixty)
    delete data.rows[0]['Date of Employment']
    const [item] = preparePayslips(data, { template: TABLE_TEMPLATE, mapping: DEFAULT_TABLE_MAPPING, rateVersions: DEFAULT_STATUTORY_RATES, period: PERIOD }, ISSUE_DATE)
    const doc = item.document!
    const label = textOf(item.page!.texts, 'Date of Employment :')
    expect(rightOf(label)).toBeCloseTo(PAGE.width - 40 - 4, 1)
    // More room than with a date: the first line holds one more word.
    expect(nameCellOf(doc).text).toBe('MOHAMMUDHAWAMBOO-WAHAB MARIE MAGDALENA WILHELMINA\nMAXIMILIEN')
    expect(overlaps(item.page!)).toEqual([])
    const [sheet] = await readWorkbook(await writePayslipWorkbook([doc]))
    expect(sheet.cells.E11).toMatchObject({ value: 'Date of Employment :', alignment: { horizontal: 'right', vertical: 'top' } })
    expect(sheet.cells.E11.numFmt).toBeUndefined()
  })

  it('a single very long word: refused with the usual "too long" error', () => {
    const refused = prepared(NAMES.oneWordTooLong)
    expect(refused.document).toBeNull()
    expect(refused.computation.errors.map((error) => error.message)).toEqual([
      `"${full(NAMES.oneWordTooLong)}" is too long to fit on the payslip, even at the smallest size.`,
    ])
  })

  it('a hyphenated surname is never broken: on one line when it fits, whole on the first line when not', () => {
    const one = payslip(NAMES.hyphenated)
    expect(nameRow(one.doc, one.page).lines.map((line) => [line.text, line.size])).toEqual([[full(NAMES.hyphenated), 10]])
    const two = payslip(NAMES.hyphenatedTwoLines)
    expect(nameCellOf(two.doc).text.split('\n')[0].startsWith(`${NAMES.hyphenatedTwoLines[0]} `)).toBe(true)
    // Both breaks after the surname fit at the normal size: the first line is the fuller one.
    expect(nameCellOf(two.doc).text).toBe('RAMKHELAWON-DOE-PERSAUD-BHAGWANSINGH JEAN\nPIERRE MARIE EMMANUEL CHRISTOPHE')
    expect(nameRow(two.doc, two.page).lines.map((line) => line.size)).toEqual([10, 10])
    // A surname of several words stays whole too, although a break inside it would allow the normal size.
    const words = payslip(['DE LA ROSE DU MONTSAINTANDRE-BHAGWANSINGH DE LA FONTAINE', 'MARIE ANNE'])
    expect(nameCellOf(words.doc).text).toBe('DE LA ROSE DU MONTSAINTANDRE-BHAGWANSINGH DE LA FONTAINE\nMARIE ANNE')
    const size = nameRow(words.doc, words.page).lines[0].size
    expect(size).toBeLessThan(10)
    expect(size).toBeGreaterThanOrEqual(8)
    expect(overlaps(words.page)).toEqual([])
    expect(overlaps(one.page)).toEqual([])
    expect(overlaps(two.page)).toEqual([])
  })

  it('a short name, and a name its column takes at 9 points or more: drawn exactly as drawing 3 draws them', async () => {
    for (const name of [NAMES.short, NAMES.smallerInColumn]) {
      const { doc, page } = payslip(name)
      expect(page).toEqual(layoutPage(asDrawing3(doc)))
      expect(await readPdf(await writePayslipPdf(doc, fonts))).toEqual(await readPdf(await writePayslipPdf(asDrawing3(doc), fonts)))
      expect(await readWorkbook(await writePayslipWorkbook([doc]))).toEqual(await readWorkbook(await writePayslipWorkbook([asDrawing3(doc)])))
    }
    const smaller = payslip(NAMES.smallerInColumn)
    const size = textOf(smaller.page.texts, full(NAMES.smallerInColumn)).size
    expect(size).toBeLessThan(10)
    expect(size).toBeGreaterThanOrEqual(9)
  })

  it('one line never below 9 points: a name its column takes only at 8.8 goes to the wide place, at the normal size', () => {
    const { doc, page } = payslip(NAMES.belowNineInColumn)
    expect(layoutPage(asDrawing3(doc)).texts.find((t) => t.text === full(NAMES.belowNineInColumn))!.size).toBe(8.8)
    const [name] = nameRow(doc, page).lines
    expect(name.size).toBe(10)
    expect(name.x).toBeLessThan(shortRow.lines[0].x)
  })

  it('a name the wide place takes on one line only below 9 points goes on two lines there, at the normal size', () => {
    // At 9 points this name is wider than the wide place; it would fit at 8.1, but one line stops at 9.
    const { doc, page } = payslip(NAMES.sixtyCapitals)
    const room = nameRow(doc, page).dateLabel.x - 8 - nameRow(doc, page).lines[0].x
    expect(measureText(full(NAMES.sixtyCapitals), 'regular', 9).width).toBeGreaterThan(room)
    expect(measureText(full(NAMES.sixtyCapitals), 'regular', 8.1).width).toBeLessThan(room)
    expect(nameCellOf(doc).text.split('\n')).toHaveLength(2)
    expect(nameRow(doc, page).lines.map((line) => line.size)).toEqual([10, 10])
  })

  it('nothing else on the page moves: only the texts of the name row differ from a short name', () => {
    for (const name of [NAMES.fiveWords39, NAMES.longSurname, NAMES.sixtyMixedCase]) {
      const { doc, page } = payslip(name)
      const y = nameRow(doc, page).lines[0].y
      const others = (p: DrawList) => p.texts.filter((t) => Math.abs(t.y - y) > 1.5)
      expect(others(page)).toEqual(others(short.page))
      expect(page.lines).toEqual(short.page.lines)
      expect(page.rects).toEqual(short.page.rects)
      expect(textOf(page.texts, 'Name :')).toEqual(shortRow.label)
    }
  })

  it('the PDF draws the name row where the page (and so the screen) does, and nothing overlaps there either', async () => {
    for (const name of [NAMES.fiveWords39, NAMES.longSurname, NAMES.sixty, NAMES.short]) {
      const { doc, page } = payslip(name)
      // The preview draws this same list, so the screen has the name where the PDF has it.
      expect(page.texts.map((t) => t.text)).toEqual(documentTexts(doc))
      const pdf = await readPdf(await writePayslipPdf(doc, fonts))
      expect(pdf.texts.map((t) => t.text)).toEqual(documentTexts(doc))
      pdf.texts.forEach((t, index) => {
        const drawn = page.texts[index]
        expect(Math.abs(t.x - drawn.x), t.text).toBeLessThanOrEqual(0.5)
        expect(Math.abs(t.y - drawn.y), t.text).toBeLessThanOrEqual(0.5)
        expect(t.size).toBe(drawn.size)
      })
      // The same overlap check on the texts as the PDF places them.
      const fromPdf: DrawList = { ...page, texts: pdf.texts.map((t, index) => ({ ...page.texts[index], x: t.x, y: t.y, size: t.size })) }
      expect(overlaps(fromPdf), full(name)).toEqual([])
    }
  })
})

describe('Excel: merged cells for the wide name, the columns unchanged', () => {
  const sheetOf = async (doc: PayslipDocument): Promise<SheetRecord> => (await readWorkbook(await writePayslipWorkbook([doc])))[0]
  const ROW = ['B11', 'C11', 'D11', 'E11']
  const strip = (sheet: SheetRecord) => {
    const cells = { ...sheet.cells }
    for (const ref of ROW) delete cells[ref]
    const rowHeights = { ...sheet.rowHeights }
    delete rowHeights[11]
    return { ...sheet, name: '', cells, rowHeights, merges: sheet.merges.filter((merge) => !merge.startsWith('C11')) }
  }

  it('the 39-character name: C and D merged at 11 points, the date in E with its label, a date still, right-aligned', async () => {
    const { doc } = payslip(NAMES.fiveWords39)
    const sheet = await sheetOf(doc)
    expect(sheet.merges).toContain('C11:D11')
    expect(sheet.cells.C11).toMatchObject({ value: full(NAMES.fiveWords39), font: { name: 'Book Antiqua', size: 11 }, alignment: { horizontal: 'left', vertical: 'middle' } })
    expect(sheet.cells.D11.value).toBeUndefined()
    expect(sheet.cells.E11.value).toBe('2021-03-15T00:00:00.000Z')
    expect(sheet.cells.E11.numFmt).toBe(`"Date of Employment : "${FORMAT_DATE}`)
    expect(sheet.cells.E11.alignment).toEqual({ horizontal: 'right', vertical: 'middle' })
    // The label and the date together are a little wider than column E at 11 points, by the page's measure: 10, never cut off.
    expect(sheet.cells.E11.font).toEqual({ name: 'Book Antiqua', size: 10 })
    expect(sheet.cells.B11.value).toBe('Name :')
  })

  it('the columns, and every other cell of the sheet, are those of a short name', async () => {
    const shortSheet = await sheetOf(payslip(NAMES.short).doc)
    for (const name of [NAMES.fiveWords39, NAMES.longSurname, NAMES.sixty]) {
      const sheet = await sheetOf(payslip(name).doc)
      expect(sheet.columnWidths).toEqual(shortSheet.columnWidths)
      expect(strip(sheet)).toEqual(strip(shortSheet))
    }
  })

  it('"LONGSURNAME-EXAMPLE Marie Anne" is 11 points in Excel, no longer 6', async () => {
    const sheet = await sheetOf(payslip(NAMES.longSurname).doc)
    expect(sheet.cells.C11.font).toEqual({ name: 'Book Antiqua', size: 11 })
  })

  it('the 60-character name: two lines, wrapped, the row 36 points, whole sizes no larger than fit C and D', async () => {
    const { doc, page } = payslip(NAMES.sixty)
    const sheet = await sheetOf(doc)
    expect(sheet.cells.C11.value).toBe(nameCellOf(doc).text)
    expect(sheet.cells.C11.alignment).toEqual({ horizontal: 'left', vertical: 'top', wrapText: true })
    expect(sheet.rowHeights[11]).toBe(36)
    const size = (sheet.cells.C11.font as { size: number }).size
    expect(Number.isInteger(size)).toBe(true)
    expect(size).toBeLessThanOrEqual(Math.floor((11 * nameRow(doc, page).lines[0].size) / 10))
    // The widest line at that size (11 in Excel is 10 on the page) fits C and D between their paddings.
    const widest = Math.max(...nameCellOf(doc).text.split('\n').map((line) => measureText(line, 'regular', (size * 10) / 11).width))
    const cd = ((PAGE.width - 80) * (32.77734375 + 35.6640625)) / (28.77734375 + 32.77734375 + 35.6640625 + 40.5546875) - 8
    expect(widest).toBeLessThanOrEqual(cd)
  })

  it('the 60-character mixed-case name: one line on the page, two lines in Excel rather than below 9 points there', async () => {
    const { doc, page } = payslip(NAMES.sixtyMixedCase)
    expect(nameRow(doc, page).lines).toHaveLength(1)
    const sheet = await sheetOf(doc)
    expect(sheet.cells.C11.value).toBe('LAMARQUE-FONTAINE Jean Pierre Marie Emmanuel\nChristophe Alex')
    expect(sheet.cells.C11.font).toEqual({ name: 'Book Antiqua', size: 10 })
    expect(sheet.cells.C11.alignment).toEqual({ horizontal: 'left', vertical: 'top', wrapText: true })
    expect(sheet.rowHeights[11]).toBe(36)
    // The page alone is not changed by it.
    expect(page.texts.find((t) => t.text === 'NIC :')).toEqual(short().page.texts.find((t) => t.text === 'NIC :'))
  })

  it('Excel never sets a name below 8 points, nor on one line below 9, and every line fits C and D', async () => {
    const cd = ((PAGE.width - 80) * (32.77734375 + 35.6640625)) / (28.77734375 + 32.77734375 + 35.6640625 + 40.5546875) - 8
    for (const name of Object.values(NAMES).filter((found) => found !== NAMES.oneWordTooLong)) {
      const sheet = await sheetOf(payslip(name).doc)
      const lines = String(sheet.cells.C11.value).split('\n')
      const size = (sheet.cells.C11.font as { size: number }).size
      expect(size, full(name)).toBeGreaterThanOrEqual(lines.length === 1 ? 9 : 8)
      expect(lines.join(' ')).toBe(full(name))
      for (const line of lines) expect(measureText(line, 'regular', (size * 10) / 11).width, line).toBeLessThanOrEqual(cd + 0.01)
      if (lines.length > 1) expect(sheet.rowHeights[11]).toBe(18 * lines.length)
    }
  })

  it('a name Excel cannot take on two lines at 8 points goes on three there, the row three lines tall', async () => {
    const name = ['MOHAMMUDHAWAMBOO-WAHAB', 'MARIE MAGDALENA WILHELMINA MAXIMILIENNE JOSEPHINE AUGUSTINE BERNADETTE MAXIMILIA WILMA'] as const
    const { doc, page } = payslip(name)
    expect(nameRow(doc, page).lines.map((line) => line.size)).toEqual([8.4, 8.4])
    const sheet = await sheetOf(doc)
    expect(sheet.cells.C11.value).toBe('MOHAMMUDHAWAMBOO-WAHAB MARIE MAGDALENA\nWILHELMINA MAXIMILIENNE JOSEPHINE AUGUSTINE\nBERNADETTE MAXIMILIA WILMA')
    expect(sheet.cells.C11.font).toEqual({ name: 'Book Antiqua', size: 9 })
    expect(sheet.rowHeights[11]).toBe(54)
  })

  it('a name whose two lines need less than 8 points on the page is refused, never printed smaller', () => {
    const name = ['MOHAMMUDHAWAMBOO-WAHAB', 'MARIE MAGDALENA WILHELMINA MAXIMILIENNE JOSEPHINE AUGUSTINE BERNADETTE MAXIMILIA WILMA MAY'] as const
    const refused = prepared(name)
    expect(refused.document).toBeNull()
    expect(refused.computation.errors.map((error) => error.message)).toEqual([`"${full(name)}" is too long to fit on the payslip, even at the smallest size.`])
  })

  it('a word wider than C and D at 8 points in Excel is refused, as on the page, never printed smaller', () => {
    // 50 capitals: the page could take it on its own line at 8.8 points, Excel could not at 8.
    const refused = prepared(['ABRACADABRAVERYLONGFAKESURNAMEWITHOUTANYSPACEATALL', 'Marie'])
    expect(refused.document).toBeNull()
    expect(refused.computation.errors.map((error) => error.message)).toEqual([
      '"ABRACADABRAVERYLONGFAKESURNAMEWITHOUTANYSPACEATALL Marie" is too long to fit on the payslip, even at the smallest size.',
    ])
  })

  it('a short name: the sheet of drawing 3, nothing merged in its row', async () => {
    const sheet = await sheetOf(short().doc)
    expect(sheet.merges.some((merge) => merge.startsWith('C11'))).toBe(false)
    expect(sheet.cells.E11.numFmt).toBe(FORMAT_DATE)
  })
})

const short = () => payslip(NAMES.short)

describe('stored and reopened', () => {
  it('a wide name is stored as printed (its line break, when it has one) and the reopened payslip is identical', () => {
    for (const name of [NAMES.fiveWords39, NAMES.sixty]) {
      const { doc, item } = payslip(name)
      const lines = encodeLines(doc, figuresOf(item.computation))
      expect(lines[0]).toMatchObject({ format: 1, drawing: 4, employeeName: full(name) })
      const read = decodeLines(JSON.parse(JSON.stringify(lines)))
      if (!read.ok) throw new Error(read.problem)
      expect(read.document).toEqual(doc)
      expect(layoutPage(read.document)).toEqual(layoutPage(doc))
    }
  })
})

describe('drawing version 4, as stored (frozen)', () => {
  // Like tests/format1.test.ts: written once, never re-recorded. The 39-character fake name on one
  // line in the wide place, as stored when drawing 4 is the drawing of new payslips.
  it('the lines, the page, the PDF and the Excel sheet are the ones it was first written with', async () => {
    const { doc, item } = payslip(NAMES.fiveWords39)
    expectFrozen('format-1-drawing-4/lines', encodeLines({ ...doc, drawing: 4 }, figuresOf(item.computation)))
    const stored = readFrozen<Record<string, unknown>[]>('format-1-drawing-4/lines')
    expect(stored[0]).toMatchObject({ format: 1, drawing: 4, employeeName: full(NAMES.fiveWords39) })
    const read = decodeLines(stored)
    if (!read.ok) throw new Error(read.problem)
    expectFrozen('format-1-drawing-4/page', layoutPage(read.document))
    expectFrozen('format-1-drawing-4/pdf', (await readPdf(await writePayslipPdf(read.document, fonts))) satisfies PdfRecord)
    expectFrozen('format-1-drawing-4/excel', JSON.parse(JSON.stringify(await readWorkbook(await writePayslipWorkbook([read.document])))))
  })
})

describe('the employee list after the switch to drawing 4', () => {
  /** September of the fake payroll with the first employee renamed, read through the importer. */
  function month([surname, other]: readonly [string, string]) {
    const rows = (JSON.parse(readFixtureText(FIXTURE_NAME)) as Record<string, unknown>[]).map((row, index) => (index === 0 ? { ...row, Surname: surname, 'Other names': other } : row))
    const imported = importPayrollText(JSON.stringify(rows), FIXTURE_NAME)
    if (!imported.ok) throw new Error(JSON.stringify(imported.errors))
    return monthFrom(imported.data, PERIOD)
  }

  /** The month issued through the stand-in dashboard, then stored as an earlier drawing stored it: that number, and the name's text as given. */
  async function issuedAs(drawing: number, name: readonly [string, string], storedName: string): Promise<IssuedPayslip[]> {
    const { port } = dashboard()
    await issue(port, month(name))
    const loaded = await loadMonth(port, BRN, PERIOD)
    if (!loaded.ok) throw new Error(loaded.failure.title)
    return loaded.payslips.map((payslip, index) => ({
      ...payslip,
      lines: (payslip.lines as Record<string, unknown>[]).map((line, at) => {
        if (at === 0) return { ...line, drawing }
        if (index !== 0 || line.id !== 'employee-name') return line
        return { ...line, cells: (line.cells as { col: number }[]).map((cell) => (cell.col === 1 ? { ...cell, text: storedName } : cell)) }
      }),
    }))
  }

  const statusesOf = (now: ReturnType<typeof month>, issued: IssuedPayslip[]) =>
    [...issueStatuses(now.data, now.prepared, issued, now.accepted, now.reasons).values()].map((status) => (status.kind === 'issued' && status.same ? 'issued' : 'changed'))

  it('a name drawing 2 or 3 put on two lines, now on one line in the wide place, is still "Issued"', async () => {
    const now = month(NAMES.fiveWords39)
    expect(nameCellOf(now.prepared[0].document!).text).toBe(full(NAMES.fiveWords39))
    for (const drawing of [2, 3]) {
      const issued = await issuedAs(drawing, NAMES.fiveWords39, 'BHAGWANSINGH Marie\nAnne Josee Claudette')
      expect(statusesOf(now, issued)).toEqual(Array(7).fill('issued'))
    }
  })

  it('a name drawing 3 set at 6 points in its column, now in the wide place, is still "Issued"; so is a short name', async () => {
    const issued = await issuedAs(3, NAMES.longSurname, full(NAMES.longSurname))
    expect(statusesOf(month(NAMES.longSurname), issued)).toEqual(Array(7).fill('issued'))
    expect(statusesOf(month(NAMES.short), await issuedAs(1, NAMES.short, full(NAMES.short)))).toEqual(Array(7).fill('issued'))
  })

  it('a real change still shows: another name, another break that changes the words', async () => {
    const issued = await issuedAs(3, NAMES.fiveWords39, 'BHAGWANSINGH Marie\nAnne Josee Claudette')
    expect(statusesOf(month(['BHAGWANSINGH', 'Marie Anne Josee Claudine']), issued)[0]).toBe('changed')
    const otherWords = await issuedAs(3, NAMES.fiveWords39, 'BHAGWANSINGH Marie\nAnne Claudette')
    expect(statusesOf(month(NAMES.fiveWords39), otherWords)[0]).toBe('changed')
  })

  it('drawings 1 to 4 count as the same payslip; a drawing this app does not know does not', () => {
    const { doc, item } = payslip(NAMES.short)
    const lines = encodeLines(doc, figuresOf(item.computation)) as Record<string, unknown>[]
    const as = (drawing: number) => [{ ...lines[0], drawing }, ...lines.slice(1)]
    for (const drawing of [1, 2, 3]) expect(sameLines(as(drawing), lines)).toBe(true)
    expect(sameLines(as(5), lines)).toBe(false)
  })
})
