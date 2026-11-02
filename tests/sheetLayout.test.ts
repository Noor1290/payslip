import ExcelJS from 'exceljs'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseDecimal } from '../src/lib/decimal'
import { cellsOf, DATE_PIECES, formatFor, readSheetBody, sheetProblems, type DateFormatPiece, type SheetBody, type Source } from '../src/lib/sheetBody'
import { buildSheetDocument, prepareSheetPayslips, type SheetInUse } from '../src/lib/sheetDocument'
import { insertColumn, insertRow, removeColumn, removeRow, setCell } from '../src/lib/sheetEdit'
import { calculationProblems, evaluateSheet, type SheetContext } from '../src/lib/sheetEvaluate'
import { excelDateFormat, excelNumberFormat, writeDate, writeNumber } from '../src/lib/sheetFormats'
import { readSheetFile, SheetProblem } from '../src/lib/sheetRead'
import { readAnyBody } from '../src/lib/templateBody'
import { activeTemplate } from '../src/lib/templateUse'
import { writePayslipPdf } from '../src/writers/pdfWriter'
import { writePayslipWorkbook } from '../src/writers/excelWriter'
import { columnPoints, layoutSheet } from '../src/writers/sheetGeometry'
import { cffHeaderProblem } from '../src/writers/fontProgram'
import { fakeLayoutBytes } from '../scripts/lib/fake-layout.mjs'
import { readCffStrict } from './cff'
import { readPdfFonts } from './pdfFonts'
import { loadFixture } from './helpers'

const fontsDir = resolve(import.meta.dirname, '../src/assets/fonts')
const font = (name: string) => new Uint8Array(readFileSync(resolve(fontsDir, `texgyrepagella-${name}.otf`)))
const fonts = { regular: font('regular'), bold: font('bold'), italic: font('italic'), boldItalic: font('bolditalic') }

const data = () => loadFixture()

const CONTEXT: SheetContext = { company: { name: 'ABC Co Ltd', address: '1 Fake Street', brn: 'C1234567', vat: '' }, period: '2026-09', today: '2026-09-30', own: {} }

/** A layout of one row, with these sources from column 0. */
function row(sources: Source[]): SheetBody {
  return {
    schema: 2,
    kind: 'file',
    orientation: 'portrait',
    firstRow: 0,
    firstColumn: 0,
    columns: sources.map(() => 20),
    rows: [{ height: 15, cells: sources.map((source, col) => ({ id: `c${col}`, col, style: 0, source, format: formatFor(source) })) }],
    merges: [],
    styles: [{ font: { name: 'Book Antiqua', size: 11 } }],
  }
}

const value = (body: SheetBody, payroll: Record<string, string | number | boolean | null>, id: string, context = CONTEXT) => evaluateSheet(body, context, payroll).get(id)!

async function uploaded() {
  return readSheetFile('Monthly payslip.xlsx', await fakeLayoutBytes())
}

/** The fake layout with the cells chosen as the owner would, as one published version. */
async function chosen(): Promise<SheetInUse> {
  let { body } = await uploaded()
  const place = (ref: string) => {
    const col = ref.charCodeAt(0) - 65 - body.firstColumn
    return { row: Number(ref.slice(1)) - 1 - body.firstRow, col }
  }
  const set = (ref: string, source: Source, side?: 'earnings' | 'deductions') => {
    const { row: r, col } = place(ref)
    body = setCell(body, r, col, (cell) => ({ ...cell, source, format: formatFor(source), ...(side ? { side } : {}) }))
  }
  set('B5', { type: 'company', field: 'name' })
  set('B6', { type: 'company', field: 'address' })
  set('C10', { type: 'name' })
  set('E10', { type: 'date', of: 'employment' })
  set('C11', { type: 'employee', key: 'ID' })
  set('C14', { type: 'payroll', key: 'Basic Salary' }, 'earnings')
  set('C15', { type: 'payroll', key: 'Govt Increment' }, 'earnings')
  set('C16', { type: 'payroll', key: 'Allowances' }, 'earnings')
  set('E14', { type: 'payroll', key: 'Employee CSG' }, 'deductions')
  set('E15', { type: 'payroll', key: 'Employee NSF' }, 'deductions')
  set('E16', { type: 'payroll', key: 'PAYE' }, 'deductions')
  set('C18', { type: 'payroll', key: 'Gross Pay' })
  set('E18', { type: 'payroll', key: 'Total deductions' })
  set('E20', { type: 'payroll', key: 'Net Pay' })
  set('C23', { type: 'date', of: 'today' })
  return { body, own: {}, id: 'layout', version: 'v1' }
}

describe('reading an Excel layout', () => {
  it('keeps the look: merges, fills, fonts, borders, widths, heights, where it starts', async () => {
    const { body } = await uploaded()
    expect(body.firstRow).toBe(3)
    expect(body.firstColumn).toBe(1)
    expect(body.columns).toEqual([28.8, 32.8, 35.7, 40.6])
    expect(body.merges).toContainEqual({ row: 0, col: 0, rows: 1, cols: 4 })
    const title = body.rows[0].cells[0]
    const style = body.styles[title.style]
    expect(style.fill).toBe('66CCFF')
    expect(style.font).toEqual({ name: 'Book Antiqua', size: 12, bold: true })
    expect(style.horizontal).toBe('center')
    expect(body.styles[body.rows[10].cells[2].style].font.italic).toBe(true)
    expect(body.styles.some((one) => one.right?.style === 'thick')).toBe(true)
  })

  it('keeps typed text, and starts every number, date and formula Empty, so no real figure is stored', async () => {
    const { body, hints, notes } = await uploaded()
    const texts = cellsOf(body).flatMap(({ cell }) => (cell.source.type === 'text' ? [cell.source.value] : []))
    expect(texts).toContain('Basic Salary')
    expect(texts).toContain('Date of Employment :')
    const json = JSON.stringify(body)
    for (const figure of ['18000', '18500', '18050', '270', 'C14+C15']) expect(json).not.toContain(`"${figure}"`)
    expect(json).not.toContain('formula')
    expect(Object.values(hints)).toContain('18000')
    expect(notes.join(' ')).toContain('start Empty')
  })

  it('says which fonts print as Pagella', async () => {
    const { notes } = await uploaded()
    expect(notes.join(' ')).toContain('Book Antiqua in TeX Gyre Pagella')
  })

  it('refuses what is not an Excel file, in words', async () => {
    await expect(readSheetFile('x.xlsx', new TextEncoder().encode('not a workbook'))).rejects.toBeInstanceOf(SheetProblem)
  })

  it('refuses a sheet too large for one payslip, in words', async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('Big').getCell('A200').value = 'too far down'
    const bytes = new Uint8Array((await workbook.xlsx.writeBuffer()) as ArrayBuffer)
    await expect(readSheetFile('x.xlsx', bytes)).resolves.toBeTruthy() // one cell: the grid is one row
    const sheet = workbook.worksheets[0]
    sheet.getCell('A1').value = 'top'
    const tall = new Uint8Array((await workbook.xlsx.writeBuffer()) as ArrayBuffer)
    await expect(readSheetFile('x.xlsx', tall)).rejects.toThrow('at most 80 rows')
  })

  it('a layout is read back from the dashboard as it was saved, and a tampered one is refused', async () => {
    const { body } = await uploaded()
    const read = readAnyBody(JSON.parse(JSON.stringify(body)))
    expect(read.ok && read.body).toEqual(body)
    expect(readSheetBody({ ...body, surprise: 1 }).ok).toBe(false)
  })
})

describe('every date format', () => {
  const ISO = '2021-03-05'
  const expected: Record<(typeof DATE_PIECES)[number], string> = { D: '5', DD: '05', M: '3', MM: '03', MMM: 'Mar', MMMM: 'March', YY: '21', YYYY: '2021' }

  it.each(DATE_PIECES)('the piece %s', (piece) => {
    expect(writeDate([{ piece }], ISO)).toBe(expected[piece])
  })

  it.each([
    [[{ piece: 'D' }, { text: '-' }, { piece: 'MMM' }, { text: '-' }, { piece: 'YY' }], '15-Mar-21', '[$-409]d"-"mmm"-"yy'],
    [[{ piece: 'DD' }, { text: '/' }, { piece: 'MM' }, { text: '/' }, { piece: 'YYYY' }], '15/03/2021', '[$-409]dd"/"mm"/"yyyy'],
    [[{ piece: 'MMMM' }, { text: ' ' }, { piece: 'YYYY' }], 'March 2021', '[$-409]mmmm" "yyyy'],
    [[{ text: 'Date: ' }, { piece: 'D' }], 'Date: 15', '[$-409]"Date: "d'],
  ] as [DateFormatPiece[], string, string][])('%#: any separator, on the page and in Excel', (pieces, text, excel) => {
    expect(writeDate(pieces, '2021-03-15')).toBe(text)
    expect(excelDateFormat(pieces)).toBe(excel)
  })

  it('a D in a separator stays a D: pieces are not found in a typed string', () => {
    expect(writeDate([{ text: 'Day MM ' }, { piece: 'DD' }], '2021-03-15')).toBe('Day MM 15')
  })

  it('date of employment, pay month, today and any other date field', () => {
    const body = row([{ type: 'date', of: 'employment' }, { type: 'date', of: 'month' }, { type: 'date', of: 'today' }, { type: 'date', of: 'field', key: 'Started' }])
    const payroll = { 'Date of Employment': '15/03/2021', Started: '2020-01-02' }
    expect(value(body, payroll, 'c0').text).toBe('15-Mar-21')
    expect(value(body, payroll, 'c1').text).toBe('September 2026')
    expect(value(body, payroll, 'c2').text).toBe('30-Sep-26')
    expect(value(body, payroll, 'c3').text).toBe('2-Jan-20')
  })

  it('no date is a blank; a date that cannot be read is a problem, never a guess', () => {
    const body = row([{ type: 'date', of: 'employment' }])
    expect(value(body, {}, 'c0')).toMatchObject({ text: '', problem: null })
    expect(value(body, { 'Date of Employment': '3rd March' }, 'c0').problem).toBe('not-a-date')
  })
})

describe('number formats', () => {
  const d = (text: string) => parseDecimal(text)!
  const auto = { type: 'number', decimals: 'auto', thousands: true, rs: false, dash: true } as const

  it.each([
    ['18750', auto, '18,750', '#,##0;-#,##0;"-"'],
    ['18750.5', auto, '18,750.50', '#,##0.00;-#,##0.00;"-"'],
    ['0', auto, '-', '#,##0;-#,##0;"-"'],
    ['0', { ...auto, dash: false }, '0', '#,##0;-#,##0'],
    ['18750.5', { ...auto, decimals: 0 }, '18,751', '#,##0;-#,##0;"-"'],
    ['18750', { ...auto, decimals: 2 }, '18,750.00', '#,##0.00;-#,##0.00;"-"'],
    ['18750', { ...auto, thousands: false }, '18750', '0;-0;"-"'],
    ['18750', { ...auto, rs: true }, 'Rs 18,750', '"Rs "#,##0;-"Rs "#,##0;"-"'],
    ['-1250.75', { ...auto, rs: true }, '-Rs 1,250.75', '"Rs "#,##0.00;-"Rs "#,##0.00;"-"'],
  ] as const)('%s', (text, format, printed, excel) => {
    const written = writeNumber(d(text), format)
    expect(written.text).toBe(printed)
    expect(excelNumberFormat(format, written.places)).toBe(excel)
  })

  it('rounds half up, and a value that rounds to 0 is a dash', () => {
    expect(writeNumber(d('2.5'), { ...auto, decimals: 0 }).text).toBe('3')
    expect(writeNumber(d('0.004'), auto).text).toBe('-')
  })
})

describe('what a cell can hold', () => {
  it('text, company details, employee fields, the full name and a payroll figure', () => {
    const body = row([
      { type: 'text', value: 'Name :' },
      { type: 'company', field: 'brn' },
      { type: 'employee', key: 'ID' },
      { type: 'name' },
      { type: 'payroll', key: 'PAYE' },
      { type: 'empty' },
    ])
    const payroll = { ID: 'X1', Surname: 'DOE', 'Other names': 'Jane', PAYE: 1250.5 }
    expect(['c0', 'c1', 'c2', 'c3', 'c4', 'c5'].map((id) => value(body, payroll, id).text)).toEqual(['Name :', 'C1234567', 'X1', 'DOE Jane', '1,250.50', ''])
  })

  it('a fixed value for all companies, or for this company only', () => {
    const body = row([{ type: 'fixed', value: 'Head office' }])
    expect(value(body, {}, 'c0').text).toBe('Head office')
    expect(value(body, {}, 'c0', { ...CONTEXT, own: { c0: 'Port Louis branch' } }).text).toBe('Port Louis branch')
  })

  it('a missing figure, text in a money field and more than 2 decimals are problems, never a blank or a zero', () => {
    const body = row([{ type: 'payroll', key: 'PAYE' }])
    expect(value(body, {}, 'c0').problem).toBe('missing-key')
    expect(value(body, { PAYE: 'none' }, 'c0').problem).toBe('not-a-number')
    expect(value(body, { PAYE: 1.234 }, 'c0').problem).toBe('too-many-decimals')
  })

  it('a column that must never be on a payslip cannot be chosen, in a cell or in a calculation', () => {
    expect(sheetProblems(row([{ type: 'payroll', key: 'Levy' }])).join()).toContain('must never be on a payslip')
    const calc: Source = { type: 'calc', terms: [{ sign: 1, of: { type: 'column', key: 'CSG (Employer Contribution)' }, times: null, round: 'none' }] }
    expect(sheetProblems(row([calc])).join()).toContain('must never be on a payslip')
  })
})

describe('a small calculation', () => {
  const term = (of: Extract<Source, { type: 'calc' }>['terms'][number]['of'], rest: Partial<Extract<Source, { type: 'calc' }>['terms'][number]> = {}) => ({ sign: 1 as const, of, times: null, round: 'none' as const, ...rest })
  const payroll = { A: 20000.5, B: 1000.5 }

  it('adds, subtracts and multiplies by a rate, exactly', () => {
    const body = row([{ type: 'calc', terms: [term({ type: 'column', key: 'A' }), term({ type: 'column', key: 'B' }, { sign: -1 }), term({ type: 'number', value: '1000' }, { times: '0.045' })] }])
    expect(value(body, payroll, 'c0').text).toBe('19,045')
  })

  it('rounds each part, or the total once', () => {
    const parts: Source = { type: 'calc', terms: [term({ type: 'column', key: 'A' }, { round: 'whole' }), term({ type: 'column', key: 'B' }, { round: 'whole' })] }
    const once: Source = { type: 'calc', once: true, terms: [term({ type: 'column', key: 'A' }), term({ type: 'column', key: 'B' })] }
    const whole = { type: 'number', decimals: 0, thousands: true, rs: false, dash: true } as const
    const of = (source: Source) => {
      const body = row([source])
      return value({ ...body, rows: [{ ...body.rows[0], cells: [{ ...body.rows[0].cells[0], format: whole }] }] }, payroll, 'c0').text
    }
    expect(of(parts)).toBe('21,002')
    expect(of(once)).toBe('21,001')
  })

  it('uses other cells, as printed', () => {
    const body = row([
      { type: 'payroll', key: 'A' },
      { type: 'calc', terms: [term({ type: 'cell', id: 'c0' }), term({ type: 'number', value: '0.5' })] },
    ])
    expect(value(body, payroll, 'c1').text).toBe('20,001')
  })

  it('finds a loop, its own cell and a cell that was removed, without running anything', () => {
    const loop = row([
      { type: 'calc', terms: [term({ type: 'cell', id: 'c1' })] },
      { type: 'calc', terms: [term({ type: 'cell', id: 'c0' })] },
    ])
    expect(calculationProblems(loop).join()).toContain('in a circle')
    expect(calculationProblems(row([{ type: 'calc', terms: [term({ type: 'cell', id: 'c0' })] }])).join()).toContain('its own cell')
    expect(calculationProblems(row([{ type: 'calc', terms: [term({ type: 'cell', id: 'gone' })] }])).join()).toContain('no longer in the layout')
  })

  it('a text in a term is data: nothing is ever evaluated', () => {
    const body = row([{ type: 'text', value: 'process.exit(1)' }, { type: 'calc', terms: [term({ type: 'cell', id: 'c0' })] }])
    expect(value(body, {}, 'c1').problem).toBe('not-a-number')
  })
})

describe('rows and columns', () => {
  it('a new row takes the look of the row above; merges and calculations follow', async () => {
    const { body } = await uploaded()
    const added = insertRow(body, 2)
    expect(added.rows).toHaveLength(body.rows.length + 1)
    expect(added.rows[2].cells.every((cell) => cell.source.type === 'empty')).toBe(true)
    expect(added.merges.find((merge) => merge.row === 3)).toBeTruthy()
    expect(new Set(cellsOf(added).map(({ cell }) => cell.id)).size).toBe(cellsOf(added).length)
    expect(sheetProblems(added)).toEqual([])
  })

  it('a row and a column added and removed give the layout back', async () => {
    const { body } = await uploaded()
    const back = (next: SheetBody) => JSON.stringify(next)
    expect(back(removeRow(insertRow(body, 5), 5))).toBe(back(body))
    expect(back(removeColumn(insertColumn(body, 2), 2))).toBe(back(body))
  })

  it('removing a column shrinks a merged block, and a block of one cell is no block', async () => {
    const { body } = await uploaded()
    const less = removeColumn(removeColumn(body, 3), 2)
    expect(less.merges.find((merge) => merge.row === 0)?.cols).toBe(2)
    const one = removeColumn(less, 1)
    expect(one.merges.find((merge) => merge.row === 0)).toBeUndefined()
    expect(sheetProblems(one)).toEqual([])
  })
})

describe('a payslip from the fake layout', () => {
  it('prints exactly the figures of the payroll', async () => {
    const sheet = await chosen()
    const payroll = data()
    const { document, errors } = buildSheetDocument(sheet, payroll.rows[0], '2026-09', '2026-09-30')
    expect(errors).toEqual([])
    const printed = document.rows.flatMap((one) => one.cells.map((cell) => cell.text))
    expect(printed).toContain('DOE JANE')
    expect(printed).toContain('Payslip')
    expect(printed).toContain('30-Sep-26')
    const net = document.rows.flatMap((one) => one.cells).find((cell) => cell.number === payroll.rows[0]['Net Pay'])
    expect(net).toBeTruthy()
  })

  it('every employee of the sample fits, with no error', async () => {
    const prepared = prepareSheetPayslips(data(), await chosen(), '2026-09', '2026-09-30')
    expect(prepared.map((item) => item.computation.errors)).toEqual(prepared.map(() => []))
    expect(prepared.every((item) => item.document !== null)).toBe(true)
  })

  it('a missing figure names the cell and blocks that payslip', async () => {
    const payroll = data()
    payroll.rows[0] = { ...payroll.rows[0] }
    delete payroll.rows[0]['Net Pay']
    const [first] = prepareSheetPayslips(payroll, await chosen(), '2026-09', '2026-09-30')
    expect(first.document).toBeNull()
    expect(first.computation.errors[0].message).toBe('Cell E20: the payroll data has no "Net Pay" for this employee.')
  })

  it('the page is A4, keeps the proportions of the sheet, and fits inside the paper', async () => {
    const { document } = buildSheetDocument(await chosen(), data().rows[0], '2026-09', '2026-09-30')
    const page = layoutSheet(document)
    expect([page.width, page.height]).toEqual([595.28, 841.89])
    expect(page.overflow).toEqual([])
    for (const text of page.texts) {
      expect(text.x).toBeGreaterThanOrEqual(0)
      expect(text.y).toBeLessThanOrEqual(page.height)
    }
    expect(page.rects.filter((rect) => rect.fill === '66CCFF')).toHaveLength(2)
    expect(page.texts.some((text) => text.font === 'italic' && text.text === 'CSG')).toBe(true)
    const full = document.columns.reduce((sum, width) => sum + columnPoints(width), 0)
    const band = page.rects[0]
    expect(band.w / full).toBeCloseTo(Math.min(1, (595.28 - 56) / full), 2)
  })

  it('a text flows over the empty cells beside it; a text with no room is set smaller, then refused', () => {
    const body = row([{ type: 'text', value: 'A long label that needs more than one column to be read' }, { type: 'empty' }])
    const sheet: SheetInUse = { body, own: {}, id: 't', version: 'v1' }
    expect(layoutSheet(buildSheetDocument(sheet, {}, '2026-09', '2026-09-30').document).overflow).toEqual([])
    const full = row([{ type: 'text', value: 'A long label that needs more than one column to be read and much much more than that' }, { type: 'text', value: 'Next' }])
    expect(layoutSheet(buildSheetDocument({ ...sheet, body: full }, {}, '2026-09', '2026-09-30').document).overflow).toHaveLength(1)
  })

  it('a figure is never cut: too wide for its cell at the smallest size, it is refused', () => {
    const body: SheetBody = { ...row([{ type: 'payroll', key: 'A' }]), columns: [2] }
    const prepared = prepareSheetPayslips({ ...data(), rows: [{ ID: 'X', A: 123456789 }] }, { body, own: {}, id: 't', version: 'v1' }, '2026-09', '2026-09-30')
    expect(prepared[0].computation.errors.map((error) => error.code)).toEqual(['too-long'])
  })

  it('the PDF has one A4 page, with the bundled fonts it prints and the same text', async () => {
    const { PDFDocument } = await import('pdf-lib')
    const { document } = buildSheetDocument(await chosen(), data().rows[0], '2026-09', '2026-09-30')
    const bytes = await writePayslipPdf(document, fonts, new Date('2026-09-01T00:00:00Z'))
    const pdf = await PDFDocument.load(bytes)
    expect(pdf.getPageCount()).toBe(1)
    expect(pdf.getPage(0).getSize()).toEqual({ width: 595.28, height: 841.89 })
  })

  it('every font in the PDF, italics too, has a header a strict viewer accepts', async () => {
    const { document } = buildSheetDocument(await chosen(), data().rows[0], '2026-09', '2026-09-30')
    const { fonts: found, runs } = await readPdfFonts(await writePayslipPdf(document, fonts, new Date('2026-09-01T00:00:00Z')))
    expect(found.map((one) => one.name).sort()).toEqual(['TeXGyrePagella-Bold', 'TeXGyrePagella-Italic', 'TeXGyrePagella-Regular'])
    for (const font of found) {
      expect(font.program).toBeInstanceOf(Uint8Array)
      expect(cffHeaderProblem(font.program!)).toBeNull()
      expect(() => readCffStrict(font.program!)).not.toThrow()
    }
    expect(runs.find((run) => run.text === 'CSG')?.font.name).toBe('TeXGyrePagella-Italic')
  })

  it('the same payslip gives the same PDF, byte for byte, at any time', async () => {
    const { document } = buildSheetDocument(await chosen(), data().rows[0], '2026-09', '2026-09-30')
    const date = new Date('2026-09-01T00:00:00Z')
    vi.useFakeTimers({ now: new Date('2030-01-01T00:00:00Z') })
    const first = await writePayslipPdf(document, fonts, date)
    vi.setSystemTime(new Date('2031-06-15T12:00:00Z'))
    const second = await writePayslipPdf(JSON.parse(JSON.stringify(document)), fonts, date)
    vi.useRealTimers()
    expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true)
  })

  it('the Excel sheet has the look of the layout, with plain numbers and real dates', async () => {
    const payroll = data()
    const { document } = buildSheetDocument(await chosen(), payroll.rows[0], '2026-09', '2026-09-30')
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load((await writePayslipWorkbook([document, document])) as unknown as ArrayBuffer)
    expect(workbook.worksheets).toHaveLength(2)
    const sheet = workbook.worksheets[0]
    expect(sheet.getCell('B4').value).toBe('Payslip')
    expect(sheet.getCell('B4').font).toMatchObject({ name: 'Book Antiqua', size: 12, bold: true })
    expect(sheet.getCell('B4').fill).toMatchObject({ fgColor: { argb: 'FF66CCFF' } })
    expect(sheet.getCell('C4').isMerged).toBe(true)
    expect(sheet.getColumn(2).width).toBe(28.8)
    expect(sheet.getCell('C14').value).toBe(payroll.rows[0]['Basic Salary'])
    expect(sheet.getCell('C14').numFmt).toContain('#,##0')
    expect(sheet.getCell('C23').value).toEqual(new Date(Date.UTC(2026, 8, 30)))
    expect(sheet.getCell('C23').numFmt).toBe('[$-409]d"-"mmm"-"yy')
    expect(sheet.getCell('C18').formula).toBeUndefined()
  })

  it('one payslip as JSON stays well inside the 16 KB the dashboard accepts', async () => {
    const { document } = buildSheetDocument(await chosen(), data().rows[0], '2026-09', '2026-09-30')
    expect(new TextEncoder().encode(JSON.stringify(document)).length).toBeLessThan(16_000)
  })
})

describe('the template in use', () => {
  it('a published layout is used, a draft of one can be previewed and never exported', async () => {
    const { body } = await chosen()
    const published = activeTemplate({ embedded: true, choice: { kind: 'published', templateId: 't', name: 'Mine', version: 3, body, own: { c1: 'x' } }, choiceNeeded: false, draft: null })
    expect(published.sheet).toMatchObject({ id: 't', version: 'v3', own: { c1: 'x' } })
    expect(published.exportBlock).toBeNull()
    const draft = activeTemplate({ embedded: true, choice: { kind: 'built-in' }, choiceNeeded: false, draft: { templateId: 't', name: 'Mine', body, draftRevision: 2 } })
    expect(draft.sheet).toBeTruthy()
    expect(draft.exportBlock).not.toBeNull()
  })

  it('the Table template stays as it was', () => {
    expect(activeTemplate({ embedded: true, choice: { kind: 'built-in' }, choiceNeeded: false, draft: null }).sheet).toBeUndefined()
  })
})
