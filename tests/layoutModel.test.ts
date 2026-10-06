import { describe, expect, it } from 'vitest'
import { payslipFileNames } from '../src/lib/build'
import { documentTexts, type PayslipDocument } from '../src/lib/layoutModel'
import { FONT_METRICS, layoutPage, measureText, PAGE } from '../src/writers/pageGeometry'
import { fixtureDocuments } from './fixtureDocuments'
import { expectRecorded, loadFixture, readRecorded } from './helpers'
// @ts-expect-error a plain .mjs script, no types
import { buildMetrics } from '../scripts/build-font-metrics.mjs'

describe('layout model (recorded)', () => {
  const docs = fixtureDocuments()

  it('is exactly the recorded model for the seven fake employees', () => {
    expectRecorded('layout-model', docs)
  })

  it('PROOF the recording can fail: one changed figure no longer matches it', () => {
    const recorded = readRecorded<PayslipDocument[]>('layout-model')
    const changed = structuredClone(docs)
    const cell = changed[0].rows.flatMap((r) => r.cells).find((c) => c.lineId === 'csg')!
    expect(cell.text).toBe('279.52')
    cell.text = '279.53'
    expect(changed).not.toEqual(recorded)
    expect(docs).toEqual(recorded)
  })

  it('has the reference rows: 31 rows, Excel rows 4 to 34', () => {
    for (const doc of docs) {
      expect(doc.rows).toHaveLength(31)
      expect(doc.firstExcelRow).toBe(4)
    }
  })

  it('prints the figures of the first employee as the display rule says', () => {
    const texts = documentTexts(docs[0])
    expect(texts).toEqual(
      expect.arrayContaining([
        'Payslip',
        'ABC Co Ltd',
        '12 Example Street',
        'Port Louis',
        'BRN : C1234567',
        'Pay period: September 2026',
        'DOE JANE',
        '15-Mar-21',
        'X0000000000001',
        '18,000',
        '635',
        '2,450',
        '279.52',
        '210.85',
        '21,085',
        '490.37',
        '20,594.63',
        '28-Sep-26',
      ]),
    )
    // Zero and unmapped lines show "-": allowances, 2 bonuses, advance, PAYE, absences, lateness.
    expect(texts.filter((t) => t === '-')).toHaveLength(7)
  })

  it('never puts an employer-side figure on the page', () => {
    const data = loadFixture()
    docs.forEach((doc, index) => {
      const row = data.rows[index]
      const amounts = doc.rows.flatMap((r) => r.cells).filter((c) => c.kind === 'money').map((c) => c.cents)
      for (const key of ['CSG', 'NSF', 'Levy', 'PRGF', 'Total MRA contributions', 'EDF', 'EDF (monthly)']) {
        const cents = Math.round((row[key] as number) * 100)
        if (cents !== 0) expect(amounts, `${key} of row ${index + 1}`).not.toContain(cents)
      }
    })
  })

  it('leaves Date of Employment blank when the payroll data has none', () => {
    const texts = documentTexts(docs[2])
    expect(texts).toContain('Date of Employment :')
    expect(docs[2].rows.find((r) => r.id === 'employee-name')!.cells).toHaveLength(3)
  })
})

describe('page geometry shared by the preview and the PDF (recorded)', () => {
  const docs = fixtureDocuments()

  it('is exactly the recorded drawing list for the first employee', () => {
    expectRecorded('page-geometry', layoutPage(docs[0]))
  })

  it('is an A4 portrait page and everything is inside it', () => {
    for (const doc of docs) {
      const page = layoutPage(doc)
      expect([page.width, page.height]).toEqual([595.28, 841.89])
      for (const text of page.texts) {
        const { width } = measureText(text.text, text.font, text.size)
        expect(text.x).toBeGreaterThanOrEqual(40)
        expect(text.x + width).toBeLessThanOrEqual(PAGE.width - 40)
      }
      expect(page.unsupported).toEqual([])
      expect(page.overflow).toEqual([])
    }
  })

  it('draws every text of the layout model, and nothing else', () => {
    for (const doc of docs) {
      expect(layoutPage(doc).texts.map((t) => t.text)).toEqual(documentTexts(doc))
    }
  })

  it('sets a long name smaller instead of cutting it or running into the next column', () => {
    const doc = structuredClone(docs[0])
    const nameCell = doc.rows.find((r) => r.id === 'employee-name')!.cells[1]
    nameCell.text = 'LONGSURNAME-EXAMPLE Marie Anne'
    const page = layoutPage(doc)
    const drawn = page.texts.find((t) => t.text === nameCell.text)!
    const next = page.texts.find((t) => t.text === 'Date of Employment :')!
    expect(drawn.size).toBeLessThan(10)
    expect(drawn.size).toBeGreaterThanOrEqual(6)
    expect(drawn.x + measureText(drawn.text, drawn.font, drawn.size).width).toBeLessThanOrEqual(next.x)
    expect(page.overflow).toEqual([])
  })

  it('reports a name that cannot fit even at the smallest size, instead of printing over the next column', () => {
    const doc = structuredClone(docs[0])
    const nameCell = doc.rows.find((r) => r.id === 'employee-name')!.cells[1]
    nameCell.text = 'VERYLONGSURNAME-HYPHENATED Firstname Secondname Thirdname Fourthname Fifthname'
    expect(layoutPage(doc).overflow).toEqual([nameCell.text])
  })

  it('reports a character the payslip font cannot print', () => {
    const doc = structuredClone(docs[0])
    doc.rows.find((r) => r.id === 'employee-name')!.cells[1].text = 'DOE 中'
    expect(layoutPage(doc).unsupported).toEqual(['中'])
  })

  it('uses a metrics table that matches the bundled font files', () => {
    expect(JSON.parse(JSON.stringify(buildMetrics()))).toEqual(FONT_METRICS)
  })
})

describe('file names', () => {
  it('are "SURNAME Other names - YYYY-MM.pdf", with (2) on a clash and never the NIC', () => {
    expect(payslipFileNames(['DOE JANE', 'SAMPLE ALEX', 'DOE JANE', 'A/B: C?'], '2026-09')).toEqual([
      'DOE JANE - 2026-09.pdf',
      'SAMPLE ALEX - 2026-09.pdf',
      'DOE JANE - 2026-09 (2).pdf',
      'A B C - 2026-09.pdf',
    ])
  })
})
