// The stored "lines" of an issued payslip: decoding what was encoded gives the identical layout
// model and the identical PDF text, whatever the dashboard's database does to key order.
// The measured sizes are printed, because the dashboard refuses a payslip over 16 KB.
import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUTORY_RATES } from '../src/data/defaultStatutoryRates'
import { computeAll, documentFor } from '../src/lib/build'
import { canonicalJson, jsonBytes } from '../src/lib/hubWire'
import { decodeLines, encodeLines, figuresOf, LINES_FORMAT, MAX_LINE_OBJECTS } from '../src/lib/issuedLines'
import type { PayslipDocument } from '../src/lib/layoutModel'
import { DEFAULT_TABLE_MAPPING, TABLE_TEMPLATE } from '../src/lib/template'
import { BUILT_IN_BODY, MAX_BODY_ROWS, templateOf } from '../src/lib/templateBody'
import { addLine, setLineKey } from '../src/lib/templateEdit'
import { layoutPage } from '../src/writers/pageGeometry'
import { writePayslipPdf } from '../src/writers/pdfWriter'
import { fixtureDocuments, ISSUE_DATE, PERIOD } from './fixtureDocuments'
import { expectRecorded, loadFixture, readFont } from './helpers'
import { readPdf } from './readPdf'

const data = loadFixture()
const settings = { template: TABLE_TEMPLATE, mapping: DEFAULT_TABLE_MAPPING, rateVersions: DEFAULT_STATUTORY_RATES, period: PERIOD }
const computations = computeAll(data, settings)
const documents = fixtureDocuments()
const encoded = documents.map((doc, index) => encodeLines(doc, figuresOf(computations[index])))

/** As the database returns it: through JSON, with its own key order. */
const stored = (value: unknown): unknown => {
  const reorder = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(reorder) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().reverse().map((k) => [k, reorder((v as Record<string, unknown>)[k])])) : v
  return reorder(JSON.parse(JSON.stringify(value)))
}
const decoded = (lines: unknown): PayslipDocument => {
  const read = decodeLines(lines)
  if (!read.ok) throw new Error(read.problem)
  return read.document
}

describe('the lines of an issued payslip', () => {
  it('are exactly the recorded ones for the first fake employee', () => {
    expectRecorded('issued-lines-doe-jane', encoded[0])
  })

  it('decode to the identical layout model, for all seven fake employees', () => {
    documents.forEach((doc, index) => {
      expect(decoded(encoded[index])).toEqual(doc)
      expect(canonicalJson(decoded(stored(encoded[index])))).toBe(canonicalJson(doc))
    })
  })

  it('print the identical PDF text, positions, fonts and sizes', async () => {
    const fonts = { regular: readFont('regular'), bold: readFont('bold') }
    for (const index of [0, 6]) {
      const reopened = decoded(stored(encoded[index]))
      expect(layoutPage(reopened)).toEqual(layoutPage(documents[index]))
      const [issued, again] = await Promise.all([writePayslipPdf(documents[index], fonts), writePayslipPdf(reopened, fonts)])
      expect(await readPdf(again)).toEqual(await readPdf(issued))
    }
  })

  it('carry the figures line by line, with ids, for a later month-to-month comparison', () => {
    const read = decodeLines(stored(encoded[0]))
    if (!read.ok) throw new Error(read.problem)
    expect(read.figures.lines.map((line) => line.id)).toEqual(computations[0].lines.map((line) => line.id))
    expect(read.figures.lines[0]).toEqual({ id: 'basic', label: 'Basic Salary', side: 'earnings', cents: 1800000, source: 'Basic Salary', status: 'ok' })
    expect(read.figures.totals).toEqual(computations[0].totals)
    // The totals stored are the plain addition of the lines stored.
    const sum = (side: string) => read.figures.lines.filter((line) => line.side === side).reduce((total, line) => total + line.cents, 0)
    expect(read.figures.totals).toEqual({ earnings: sum('earnings'), deductions: sum('deductions'), net: sum('earnings') - sum('deductions') })
  })

  it('keep the reason for a missing figure that was accepted as zero', () => {
    const row = { ...data.rows[0] }
    delete row.Travelling
    const [computation] = computeAll({ ...data, rows: [row] }, { ...settings, treatAsZero: new Map([[0, new Set(['transport'])]]) })
    const figures = figuresOf(computation, { transport: '  No travel this month  ' })
    expect(figures.lines.find((line) => line.id === 'transport')).toEqual({
      id: 'transport',
      label: 'Transport Allowance',
      side: 'earnings',
      cents: 0,
      source: 'Travelling',
      status: 'treated-as-zero',
      reason: 'No travel this month',
    })
  })

  it('leave defaults out, and stay well under the 16 KB the dashboard allows per payslip', () => {
    const sizes = encoded.map((lines) => jsonBytes(lines))
    const full = documents.map((doc) => jsonBytes(doc))
    console.log(`  encoded lines, bytes per payslip: ${sizes.join(', ')} (the layout model itself: ${full.join(', ')})`)
    for (const size of sizes) expect(size).toBeLessThan(6_000)
    expect(JSON.stringify(encoded[0])).not.toContain('"status":"ok"')
    for (const lines of encoded) expect(lines.length).toBeLessThanOrEqual(MAX_LINE_OBJECTS)
    expect(JSON.stringify(encoded[0])).not.toContain('"bold":false')
    expect(JSON.stringify(encoded[0])).not.toContain('"span":1')

    // The largest template the editor allows: 20 rows of lines on each side.
    let body = BUILT_IN_BODY
    for (let n = 0; body.earnings.length < MAX_BODY_ROWS; n++) body = setLineKey(addLine(body, { side: 'earnings' }, `line-e${n}`), `line-e${n}`, 'Basic Salary')
    for (let n = 0; n < 40; n++) body = setLineKey(addLine(body, { side: 'deductions', group: 1 }, `line-d${n}`), `line-d${n}`, 'PAYE')
    const { template, mapping } = templateOf(body, { id: '20000000-0000-4000-8000-000000000001', name: 'Largest', version: 'v1' })
    const [largest] = computeAll(data, { ...settings, template, mapping })
    const lines = encodeLines(documentFor(data, largest, template, PERIOD, ISSUE_DATE), figuresOf(largest))
    console.log(`  largest template (20 rows each side): ${jsonBytes(lines)} bytes, ${lines.length} objects`)
    expect(jsonBytes(lines)).toBeLessThan(12_000)
    expect(decoded(stored(lines)).rows).toHaveLength(lines.length - 2)
  })
})

describe('stored lines are refused, never guessed at', () => {
  const change = (edit: (lines: Record<string, unknown>[]) => void) => {
    const lines = JSON.parse(JSON.stringify(encoded[0])) as Record<string, unknown>[]
    edit(lines)
    return decodeLines(lines)
  }

  it('in a format this app does not know', () => {
    expect(change((lines) => (lines[0].format = LINES_FORMAT + 1))).toEqual({
      ok: false,
      problem: 'This payslip was issued by a newer version of the app (format 2). This version reads format 1.',
    })
    expect(decodeLines([{ kind: 'note', text: 'issued elsewhere' }, { kind: 'figures' }, { id: 'title' }])).toMatchObject({ ok: false, problem: expect.stringContaining('not issued by this app') })
    expect(decodeLines('lines')).toMatchObject({ ok: false })
    expect(decodeLines([])).toMatchObject({ ok: false })
  })

  it('with an unknown field, a wrong type, or a missing part', () => {
    expect(change((lines) => (lines[3].colour = 'red')).ok).toBe(false)
    expect(change((lines) => ((lines[1].totals as Record<string, unknown>).net = '20594.63')).ok).toBe(false)
    expect(change((lines) => ((lines[1].totals as Record<string, unknown>).net = 20594.63)).ok).toBe(false)
    expect(change((lines) => delete lines[0].columnWidths).ok).toBe(false)
    expect(change((lines) => lines.splice(1, 1)).ok).toBe(false)
    expect(change(() => {}).ok).toBe(true)
  })
})
