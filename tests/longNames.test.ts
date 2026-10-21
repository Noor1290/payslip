// A long name on two lines (drawing version 2, known issue 1). A name that does not fit on one
// line, even at the smallest size, goes on two: broken at a space, the surname whole on the first
// line, at the normal size or smaller. Its row is twice as tall and the rows below it move down by
// one row; a name that fits on one line is drawn exactly as before. Fake names only (ABC Co Ltd).
import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUTORY_RATES } from '../src/data/defaultStatutoryRates'
import { preparePayslips, type PreparedPayslip } from '../src/lib/build'
import { issueStatuses } from '../src/lib/issueBuild'
import { decodeLines, encodeLines, figuresOf, sameLines } from '../src/lib/issuedLines'
import { documentTexts, type PayslipDocument } from '../src/lib/layoutModel'
import { baselineFromIssued, compareMonth } from '../src/lib/monthCompare'
import type { ImportedPayroll } from '../src/lib/payrollFile'
import { DEFAULT_TABLE_MAPPING, TABLE_TEMPLATE } from '../src/lib/template'
import { writePayslipWorkbook } from '../src/writers/excelWriter'
import { FONT_METRICS, layoutPage, measureText, type DrawList } from '../src/writers/pageGeometry'
import { writePayslipPdf } from '../src/writers/pdfWriter'
import { ISSUE_DATE, PERIOD } from './fixtureDocuments'
import { expectFrozen, loadFixture, readFont } from './helpers'
import { current, issuedAugust, LAST_PERIOD, september } from './monthFixtures'
import { readWorkbook, type SheetRecord } from './readExcel'
import { readPdf, type PdfRecord } from './readPdf'

/** Fake names. Each is [surname, other names]. */
const NAMES = {
  fiveWords39: ['BHAGWANSINGH', 'Marie Anne Josee Claudette'],
  sixty: ['LAMARQUE-FONTAINE', 'Jean Pierre Marie Emmanuel Christophe Alex'],
  twoLinesAtNormalSize: ['PERSAUD', 'Marie Anne Josee Claudette Lise'],
  longWordSurname: ['ABRACADABRALONGFAKESURNAME', 'Marie Anne'],
  hyphenated: ['RAMKHELAWON-DOE-PERSAUD', 'Marie Anne Josee'],
  surnameOfWords: ['DE LA ROSE DU MONTSAINTANDRE', 'Marie Anne'],
  oneWordTooLong: ['ABRACADABRAVERYLONGFAKESURNAMEWITHOUTANYSPACEATALL', 'Marie'],
} as const
const full = ([surname, other]: readonly [string, string]) => `${surname} ${other}`

const fonts = { regular: readFont('regular'), bold: readFont('bold') }

/** The fake September payroll with DOE JANE (the first row) renamed. */
function renamed(surname: string, other: string): ImportedPayroll {
  const data = loadFixture()
  data.rows[0] = { ...data.rows[0], Surname: surname, 'Other names': other }
  return data
}

function prepared(data: ImportedPayroll): PreparedPayslip[] {
  return preparePayslips(data, { template: TABLE_TEMPLATE, mapping: DEFAULT_TABLE_MAPPING, rateVersions: DEFAULT_STATUTORY_RATES, period: PERIOD }, ISSUE_DATE)
}

/** The first payslip, which must be ready. */
function payslip([surname, other]: readonly [string, string]): { doc: PayslipDocument; page: DrawList; item: PreparedPayslip } {
  const item = prepared(renamed(surname, other))[0]
  expect(item.computation.errors.map((error) => error.message)).toEqual([])
  return { doc: item.document!, page: item.page!, item }
}

const nameCellOf = (doc: PayslipDocument) => doc.rows.find((row) => row.id === 'employee-name')!.cells.find((cell) => cell.col === 1)!
const textOf = (page: DrawList, text: string) => {
  const found = page.texts.find((t) => t.text === text)
  if (!found) throw new Error(`"${text}" is not on the page`)
  return found
}

/** Every pair of things on the page that touch: two texts, or a text and a line. Empty when nothing overlaps. */
function overlaps(page: DrawList): string[] {
  const boxes = page.texts.map((t) => {
    const { ascent, descent, unitsPerEm } = FONT_METRICS[t.font] as unknown as { ascent: number; descent: number; unitsPerEm: number }
    const width = measureText(t.text, t.font, t.size).width
    return { name: t.text, x1: t.x, x2: t.x + width, y1: t.y - (ascent * t.size) / unitsPerEm, y2: t.y - (descent * t.size) / unitsPerEm }
  })
  const found: string[] = []
  boxes.forEach((a, i) => {
    for (const b of boxes.slice(i + 1)) {
      if (a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2) found.push(`"${a.name}" and "${b.name}"`)
    }
    for (const line of page.lines) {
      const half = line.width / 2
      const lx1 = Math.min(line.x1, line.x2) - half
      const lx2 = Math.max(line.x1, line.x2) + half
      const ly1 = Math.min(line.y1, line.y2) - half
      const ly2 = Math.max(line.y1, line.y2) + half
      if (a.x1 < lx2 && lx1 < a.x2 && a.y1 < ly2 && ly1 < a.y2) found.push(`"${a.name}" and a line at ${line.x1},${line.y1}`)
    }
  })
  return found
}

/** What a page or a PDF holds below the name: each text, as it is, or moved up by `by` points. */
const below = <T extends { text: string; y: number }>(texts: readonly T[], from: number, by = 0) =>
  texts.filter((t) => t.y > from).map((t) => ({ ...t, y: Math.round((t.y - by) * 2) / 2 }))

describe('a long name goes on two lines (drawing 2)', () => {
  const short = payslip(['DOE', 'JANE'])

  it('the fake names are what the cases say', () => {
    expect(full(NAMES.fiveWords39)).toHaveLength(39)
    expect(full(NAMES.fiveWords39).split(' ')).toHaveLength(5)
    expect(full(NAMES.sixty)).toHaveLength(60)
    expect(NAMES.longWordSurname[0]).not.toMatch(/[\s-]/)
    expect(NAMES.oneWordTooLong[0]).not.toMatch(/[\s-]/)
  })

  it('a 39-character name of 5 words: two lines, the surname first, only a little smaller', () => {
    const { doc, page } = payslip(NAMES.fiveWords39)
    expect(nameCellOf(doc).text).toBe('BHAGWANSINGH Marie\nAnne Josee Claudette')
    expect(doc.employeeName).toBe(full(NAMES.fiveWords39))
    const [first, second] = [textOf(page, 'BHAGWANSINGH Marie'), textOf(page, 'Anne Josee Claudette')]
    expect([first.size, second.size]).toEqual([9.7, 9.7])
    expect(second.x).toBe(first.x)
    expect(second.y - first.y).toBeCloseTo(17, 5)
  })

  it('two lines at the normal size when they fit, before any smaller size', () => {
    const { doc, page } = payslip(NAMES.twoLinesAtNormalSize)
    expect(nameCellOf(doc).text).toBe('PERSAUD Marie Anne\nJosee Claudette Lise')
    expect([textOf(page, 'PERSAUD Marie Anne').size, textOf(page, 'Josee Claudette Lise').size]).toEqual([10, 10])
    // Two places to break both fit at the normal size: the first line is the fuller one.
    expect(nameCellOf(payslip(['SEEPAUL', 'Josee Eva Paul Lea Amy Lea Paul']).doc).text).toBe('SEEPAUL Josee Eva Paul\nLea Amy Lea Paul')
  })

  it('a 60-character name: two lines, set smaller, never below the smallest size', () => {
    const { doc, page } = payslip(NAMES.sixty)
    const [first, second] = nameCellOf(doc).text.split('\n')
    expect(first.startsWith(`${NAMES.sixty[0]} `)).toBe(true)
    expect(`${first} ${second}`).toBe(full(NAMES.sixty))
    const size = textOf(page, first).size
    expect(size).toBeLessThan(10)
    expect(size).toBeGreaterThanOrEqual(6)
    expect(textOf(page, second).size).toBe(size)
  })

  it('a single very long word: never broken inside; on its own line when there is more, refused when it is the whole first line and still too wide', () => {
    const { doc } = payslip(NAMES.longWordSurname)
    expect(nameCellOf(doc).text).toBe('ABRACADABRALONGFAKESURNAME\nMarie Anne')
    const [refused] = prepared(renamed(...NAMES.oneWordTooLong))
    expect(refused.document).toBeNull()
    expect(refused.computation.errors.map((error) => error.message)).toEqual([
      `"${full(NAMES.oneWordTooLong)}" is too long to fit on the payslip, even at the smallest size.`,
    ])
  })

  it('a hyphenated surname stays whole on the first line, and so does a surname of several words', () => {
    expect(nameCellOf(payslip(NAMES.hyphenated).doc).text).toBe('RAMKHELAWON-DOE-PERSAUD\nMarie Anne Josee')
    // Breaking inside the surname, after "DE LA ROSE DU", would allow 7.4 points: the surname is kept whole instead, at 6.4.
    const { doc, page } = payslip(NAMES.surnameOfWords)
    expect(nameCellOf(doc).text).toBe('DE LA ROSE DU MONTSAINTANDRE\nMarie Anne')
    expect(textOf(page, 'Marie Anne').size).toBe(6.4)
    const splitIfAllowed = payslip(['DE', 'LA ROSE DU MONTSAINTANDRE Marie Anne']).doc
    expect(nameCellOf(splitIfAllowed).text).toBe('DE LA ROSE DU\nMONTSAINTANDRE Marie Anne')
  })

  it('a short name: one line, the payslip drawn exactly as drawing 1 draws it', async () => {
    expect(nameCellOf(short.doc).text).toBe('DOE JANE')
    const asDrawing1 = { ...short.doc, drawing: 1 }
    expect(layoutPage(short.doc)).toEqual(layoutPage(asDrawing1))
    expect(await readPdf(await writePayslipPdf(short.doc, fonts))).toEqual(await readPdf(await writePayslipPdf(asDrawing1, fonts)))
    expect(await readWorkbook(await writePayslipWorkbook([short.doc]))).toEqual(await readWorkbook(await writePayslipWorkbook([asDrawing1])))
  })

  it('a name that fits on one line at a smaller size stays on one line, as in drawing 1', () => {
    const { doc, page } = payslip(['LONGSURNAME-EXAMPLE', 'Marie Anne'])
    expect(nameCellOf(doc).text).toBe('LONGSURNAME-EXAMPLE Marie Anne')
    expect(textOf(page, 'LONGSURNAME-EXAMPLE Marie Anne').size).toBeLessThan(10)
    expect(page).toEqual(layoutPage({ ...doc, drawing: 1 }))
  })

  it('Excel sets a name the page sets smaller on one line smaller too, rounded down to a whole size (known issue 40); drawing 1 keeps 11', async () => {
    const { doc, page } = payslip(['LONGSURNAME-EXAMPLE', 'Marie Anne'])
    const size = textOf(page, 'LONGSURNAME-EXAMPLE Marie Anne').size
    expect(size).toBe(6)
    const [sheet] = await readWorkbook(await writePayslipWorkbook([doc]))
    expect(sheet.cells.C11.font).toEqual({ name: 'Book Antiqua', size: 6 })
    expect(sheet.cells.C11.alignment).toEqual({ horizontal: 'left', vertical: 'middle' })
    expect(sheet.rowHeights[11]).toBeUndefined()
    const [asDrawing1] = await readWorkbook(await writePayslipWorkbook([{ ...doc, drawing: 1 }]))
    expect(asDrawing1.cells.C11.font).toEqual({ name: 'Book Antiqua', size: 11 })
    // Only the name cell differs from drawing 1.
    expect({ ...sheet.cells, C11: null }).toEqual({ ...asDrawing1.cells, C11: null })
    // A name a little too wide: 10.x on the page would round up past the column, so it rounds down.
    const near = payslip(['PALMYRE-LONGNAME', 'Jean Marc'])
    const nearSize = textOf(near.page, 'PALMYRE-LONGNAME Jean Marc').size
    expect(nearSize).toBeLessThan(10)
    const [nearSheet] = await readWorkbook(await writePayslipWorkbook([near.doc]))
    expect((nearSheet.cells.C11.font as { size: number }).size).toBe(Math.floor((11 * nearSize) / 10))
  })

  it('nothing overlaps on any of these payslips, and every text stays inside its column', () => {
    for (const name of [NAMES.fiveWords39, NAMES.twoLinesAtNormalSize, NAMES.sixty, NAMES.longWordSurname, NAMES.hyphenated, NAMES.surnameOfWords]) {
      const { page } = payslip(name)
      expect(overlaps(page), full(name)).toEqual([])
      const date = textOf(page, 'Date of Employment :')
      for (const line of nameCellOf(payslip(name).doc).text.split('\n')) {
        const drawn = textOf(page, line)
        expect(drawn.x + measureText(drawn.text, drawn.font, drawn.size).width).toBeLessThan(date.x - 4)
      }
    }
    expect(overlaps(short.page)).toEqual([])
  })

  it('above the name nothing moves; below it, everything moves down by exactly one row (17 points)', () => {
    const { page } = payslip(NAMES.fiveWords39)
    const nameY = textOf(page, 'Name :').y
    // Above the name, and the other texts of its row ("Name :", "Date of Employment :", the date).
    const upToName = (p: DrawList) => p.texts.filter((t) => t.y <= nameY && t.text !== 'DOE JANE' && t.text !== 'BHAGWANSINGH Marie')
    expect(upToName(page)).toEqual(upToName(short.page))
    expect(below(page.texts, nameY + 17, 17)).toEqual(below(short.page.texts, nameY))
    expect(below(short.page.texts, nameY).map((t) => t.text)).toContain('X0000000000001')
    // The box and the divider end one row lower too; the page still has room to spare.
    const bottomOf = (p: DrawList) => Math.max(...p.lines.map((l) => Math.max(l.y1, l.y2)))
    expect(bottomOf(page) - bottomOf(short.page)).toBeCloseTo(17, 5)
    expect(bottomOf(page)).toBeLessThan(page.height - 150)
  })

  it('the preview, the PDF and the Excel sheet all show the two lines', async () => {
    const { doc, page } = payslip(NAMES.fiveWords39)
    // The preview draws this same list, so the screen has the two lines where the PDF has them.
    expect(page.texts.map((t) => t.text)).toEqual(documentTexts(doc))
    const pdf = await readPdf(await writePayslipPdf(doc, fonts))
    expect(pdf.texts.map((t) => t.text)).toEqual(documentTexts(doc))
    const [first, second] = [pdf.texts.find((t) => t.text === 'BHAGWANSINGH Marie')!, pdf.texts.find((t) => t.text === 'Anne Josee Claudette')!]
    expect(second.x).toBe(first.x)
    expect(second.y - first.y).toBe(17)
    // In the PDF, as on the page: what is below the name moved down one row, nothing else changed.
    const shortPdf = await readPdf(await writePayslipPdf(short.doc, fonts))
    expect(below(pdf.texts, first.y + 17, 17)).toEqual(below(shortPdf.texts, first.y))

    const [sheet] = await readWorkbook(await writePayslipWorkbook([doc]))
    expect(sheet.cells.C11.value).toBe('BHAGWANSINGH Marie\nAnne Josee Claudette')
    expect(sheet.cells.C11.alignment).toEqual({ horizontal: 'left', vertical: 'top', wrapText: true })
    expect(sheet.rowHeights[11]).toBe(36)
    for (const ref of ['B11', 'D11', 'E11']) expect(sheet.cells[ref].alignment).toEqual({ horizontal: 'left', vertical: 'top' })
  })

  it('Excel: the rest of the sheet is the sheet of a short name; a smaller name is smaller there too', async () => {
    const strip = (sheet: SheetRecord) => {
      const cells = { ...sheet.cells }
      for (const ref of ['B11', 'C11', 'D11', 'E11']) delete cells[ref]
      const rowHeights = { ...sheet.rowHeights }
      delete rowHeights[11]
      return { ...sheet, name: '', cells, rowHeights }
    }
    const [long] = await readWorkbook(await writePayslipWorkbook([payslip(NAMES.fiveWords39).doc]))
    const [shortSheet] = await readWorkbook(await writePayslipWorkbook([short.doc]))
    expect(strip(long)).toEqual(strip(shortSheet))
    for (const ref of ['B11', 'D11', 'E11']) expect(long.cells[ref].font).toEqual(shortSheet.cells[ref].font)
    // 9.7 points on the page is 10 in Excel, where the usual size is 11 (whole points).
    expect(long.cells.C11.font).toEqual({ ...(shortSheet.cells.C11.font as object), size: 10 })
    const [normal] = await readWorkbook(await writePayslipWorkbook([payslip(NAMES.twoLinesAtNormalSize).doc]))
    expect(normal.cells.C11.font).toEqual(shortSheet.cells.C11.font)
    const [smaller] = await readWorkbook(await writePayslipWorkbook([payslip(NAMES.sixty).doc]))
    expect(smaller.cells.C11.font).toEqual({ ...(shortSheet.cells.C11.font as object), size: 7 })
  })

  it('is stored as it is drawn: the line break is in the stored text, and the reopened payslip is identical', async () => {
    const { doc, item } = payslip(NAMES.fiveWords39)
    const lines = encodeLines(doc, figuresOf(item.computation))
    expect(lines[0]).toMatchObject({ format: 1, drawing: 2, employeeName: full(NAMES.fiveWords39) })
    const read = decodeLines(JSON.parse(JSON.stringify(lines)))
    if (!read.ok) throw new Error(read.problem)
    expect(read.document).toEqual(doc)
    expect(layoutPage(read.document)).toEqual(layoutPage(doc))
  })
})

describe('drawing version 2, as stored (frozen)', () => {
  // Like tests/format1.test.ts: written once, never re-recorded. The 39-character fake name.
  it('the lines, the page, the PDF and the Excel sheet are the ones it was first written with', async () => {
    const { doc, item } = payslip(NAMES.fiveWords39)
    expectFrozen('format-1-drawing-2/lines', encodeLines(doc, figuresOf(item.computation)))
    const read = decodeLines(JSON.parse(JSON.stringify(encodeLines(doc, figuresOf(item.computation)))))
    if (!read.ok) throw new Error(read.problem)
    expectFrozen('format-1-drawing-2/page', layoutPage(read.document))
    expectFrozen('format-1-drawing-2/pdf', (await readPdf(await writePayslipPdf(read.document, fonts))) satisfies PdfRecord)
    expectFrozen('format-1-drawing-2/excel', JSON.parse(JSON.stringify(await readWorkbook(await writePayslipWorkbook([read.document])))))
  })
})

describe('the new drawing version does not make anyone Changed', () => {
  /** Stored payslips as if they had been issued with drawing 1, before this version. */
  const asDrawing1 = <T extends { lines: unknown }>(payslips: readonly T[]) =>
    payslips.map((payslip) => ({ ...payslip, lines: [{ ...(payslip.lines as object[])[0], drawing: 1 }, ...(payslip.lines as object[]).slice(1)] }))

  it('the month review gives the same statuses, lines and notes as against payslips of drawing 2', async () => {
    const august = await issuedAugust()
    expect((august[0].lines as { drawing: number }[])[0].drawing).toBe(2)
    const review = (issued: typeof august) => compareMonth(PERIOD, current(september()), baselineFromIssued(LAST_PERIOD, issued), () => 'Monthly payslip')
    const withDrawing1 = review(asDrawing1(august))
    expect(withDrawing1).toEqual(review(august))
    expect(withDrawing1.rows.find((row) => row.employeeName === 'DOE JANE')).toMatchObject({ status: 'unchanged', notes: [] })
  })

  it('a payslip issued with drawing 1 is still "Issued", not "Changed since", and the same payslip when it is issued again', async () => {
    const month = september()
    expect(month.prepared[0].document!.drawing).toBe(2)
    const { issue, dashboard } = await import('./monthFixtures')
    const { port } = dashboard()
    await issue(port, month)
    const { loadMonth } = await import('../src/lib/issueStore')
    const { BRN } = await import('./fakeHubPort')
    const loaded = await loadMonth(port, BRN, PERIOD)
    if (!loaded.ok) throw new Error(loaded.failure.title)
    const statuses = issueStatuses(month.data, month.prepared, asDrawing1(loaded.payslips), month.accepted, month.reasons)
    expect([...statuses.values()].every((status) => status.kind === 'issued' && status.same)).toBe(true)
    // Any real difference still counts.
    const other = asDrawing1(loaded.payslips)[0].lines as Record<string, unknown>[]
    const renamedLines = [{ ...other[0], employeeName: 'DOE JANET' }, ...other.slice(1)]
    expect(sameLines(renamedLines, loaded.payslips[0].lines)).toBe(false)
    // A version this app does not know is never taken for the same look.
    const later = [{ ...other[0], drawing: 3 }, ...other.slice(1)]
    expect(sameLines(later, loaded.payslips[0].lines)).toBe(false)
  })
})
