// Issued payslips are drawn from their stored format, and format 1 must always render
// identically (CLAUDE.md, hard rules). This test holds one payslip exactly as the dashboard
// stores it (tests/frozen/format-1/lines.json, fake data: DOE JANE of ABC Co Ltd) and the page,
// the PDF and the Excel sheet it must give for ever (the other files in that folder).
//
// NEVER update these files. If this test fails, the drawing of format 1 has changed: put the old
// drawing back, and add the change as a new drawing version beside it.
import { beforeAll, describe, expect, it } from 'vitest'
import { decodeLines, LINES_FORMAT } from '../src/lib/issuedLines'
import { DRAWING_VERSION, type PayslipDocument } from '../src/lib/layoutModel'
import { writePayslipWorkbook } from '../src/writers/excelWriter'
import { layoutPage, type DrawList } from '../src/writers/pageGeometry'
import { writePayslipPdf } from '../src/writers/pdfWriter'
import { expectFrozen, readFont, readFrozen } from './helpers'
import { readWorkbook } from './readExcel'
import { readPdf, type PdfRecord } from './readPdf'

const stored = () => readFrozen<Record<string, unknown>[]>('format-1/lines')
const documentOf = (lines: unknown): PayslipDocument => {
  const read = decodeLines(lines)
  if (!read.ok) throw new Error(read.problem)
  return read.document
}

describe('a payslip stored in format 1 is always drawn the same way', () => {
  const fonts = { regular: readFont('regular'), bold: readFont('bold') }
  let doc: PayslipDocument
  let pdf: PdfRecord

  beforeAll(async () => {
    doc = documentOf(stored())
    pdf = await readPdf(await writePayslipPdf(doc, fonts))
  })

  it('is format 1, drawing version 1, and the fixture is the fake employee', () => {
    expect(stored()[0]).toMatchObject({ kind: 'document', format: 1, drawing: 1, employeeName: 'DOE JANE', period: '2026-09' })
    expect(doc.drawing).toBe(1)
    // The numbers of today. When one goes up, this fixture stays and a new one is added for it.
    expect([LINES_FORMAT, DRAWING_VERSION]).toEqual([1, 1])
  })

  it('the page: every rectangle, line and text where it was', () => {
    expectFrozen('format-1/page', layoutPage(doc))
  })

  it('the PDF: fonts, text, positions and sizes', () => {
    expectFrozen('format-1/pdf', pdf)
  })

  it('the Excel sheet: values, formulas, merges, formats, fonts, fills, borders', async () => {
    expectFrozen('format-1/excel', JSON.parse(JSON.stringify(await readWorkbook(await writePayslipWorkbook([doc])))))
  })

  it('a payslip issued before the drawing version was recorded is drawing 1 too, and drawn the same', () => {
    const before = stored()
    delete before[0].drawing
    expect(documentOf(before)).toEqual(doc)
    expect(layoutPage(documentOf(before))).toEqual(readFrozen<DrawList>('format-1/page'))
  })

  it('a drawing version this app does not have is refused, never drawn another way', async () => {
    const later = stored()
    later[0].drawing = 2
    expect(decodeLines(later)).toEqual({
      ok: false,
      problem: 'This payslip was issued with drawing version 2, which this version of the app cannot draw. It is not shown, rather than drawn another way.',
    })
    expect(() => layoutPage({ ...doc, drawing: 2 })).toThrow(/drawing version 2/)
    await expect(writePayslipPdf({ ...doc, drawing: 2 }, fonts)).rejects.toThrow(/drawing version 2/)
    await expect(writePayslipWorkbook([{ ...doc, drawing: 2 }])).rejects.toThrow(/drawing version 2/)
  })

  it('PROOF the frozen page can fail: one text half a point lower, or one size changed, no longer matches', () => {
    const frozen = readFrozen<DrawList>('format-1/page')
    const page = layoutPage(doc)
    expect(page).toEqual(frozen)
    const lower = structuredClone(page)
    lower.texts[0].y += 0.5
    expect(lower).not.toEqual(frozen)
    const larger = structuredClone(page)
    larger.texts.find((text) => text.text === 'Basic Salary')!.size = 10.5
    expect(larger).not.toEqual(frozen)
    const moved = structuredClone(pdf)
    moved.texts.find((text) => text.text === 'Net Pay :')!.x += 0.5
    expect(moved).not.toEqual(readFrozen<PdfRecord>('format-1/pdf'))
  })
})
