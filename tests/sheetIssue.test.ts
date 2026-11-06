// "From your file", Stage 2 prompt, Stage 3: issuing payslips of a layout from a file (lines format
// 2), reopening them exactly as issued (PDF and Excel byte for byte), "Changed since" without
// today's date, and the month review. Fake data only (ABC Co Ltd).

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildIssue, issueStatuses, monthProblems, type IssueInput } from '../src/lib/issueBuild'
import { decodeAnyLines, decodeLines, sameLines } from '../src/lib/issuedLines'
import { PAYSLIP_MAX_BYTES, planIssue, type IssuedPayslip } from '../src/lib/issueStore'
import { baselineFromIssued, compareMonth, currentPayslips } from '../src/lib/monthCompare'
import type { PayrollRow } from '../src/lib/payrollFile'
import { checkKey, ROUNDING_REASON, withReason, zeroKey, type Reasons } from '../src/lib/reasons'
import { formatFor, type SheetBody, type Source } from '../src/lib/sheetBody'
import { setCell } from '../src/lib/sheetEdit'
import { isSheetDocument, prepareSheetPayslips, type SheetDocument, type SheetInUse } from '../src/lib/sheetDocument'
import { SHEET_LINES_FORMAT } from '../src/lib/sheetIssued'
import { readSheetFile } from '../src/lib/sheetRead'
import { DEFAULT_STATUTORY_RATES } from '../src/data/defaultStatutoryRates'
import type { TemplateChoice } from '../src/lib/templateUse'
import type { AcceptedChecks } from '../src/lib/payslip'
import { writePayslipWorkbook } from '../src/writers/excelWriter'
import { writePayslipPdf } from '../src/writers/pdfWriter'
import { fakeLayoutBytes } from '../scripts/lib/fake-layout.mjs'
import { loadFixture } from './helpers'

const PERIOD = '2026-09'
const TODAY = '2026-09-30'
const TEMPLATE_ID = '20000000-0000-4000-8000-000000000009'
const fontsDir = resolve(import.meta.dirname, '../src/assets/fonts')
const font = (name: string) => new Uint8Array(readFileSync(resolve(fontsDir, `texgyrepagella-${name}.otf`)))
const fonts = { regular: font('regular'), bold: font('bold'), italic: font('italic'), boldItalic: font('bolditalic') }
const data = loadFixture()

afterEach(() => {
  vi.useRealTimers()
})

/** The fake layout with its cells chosen as the owner would, the three totals marked. */
async function layout(): Promise<SheetBody> {
  let { body } = await readSheetFile('Monthly payslip.xlsx', await fakeLayoutBytes())
  const set = (ref: string, source: Source, extra: object = {}) => {
    const row = Number(ref.slice(1)) - 1 - body.firstRow
    const col = ref.charCodeAt(0) - 65 - body.firstColumn
    body = setCell(body, row, col, (cell) => ({ ...cell, source, format: formatFor(source), ...extra }))
  }
  set('B5', { type: 'company', field: 'name' })
  set('B6', { type: 'company', field: 'address' })
  set('C10', { type: 'name' })
  set('E10', { type: 'date', of: 'employment' })
  set('C11', { type: 'employee', key: 'ID' })
  set('C14', { type: 'payroll', key: 'Basic Salary' }, { side: 'earnings' })
  set('C15', { type: 'payroll', key: 'Govt Increment' }, { side: 'earnings' })
  set('C16', { type: 'payroll', key: 'Allowances' }, { side: 'earnings' })
  set('E14', { type: 'payroll', key: 'Employee CSG' }, { side: 'deductions' })
  set('E15', { type: 'payroll', key: 'Employee NSF' }, { side: 'deductions' })
  set('E16', { type: 'payroll', key: 'PAYE' }, { side: 'deductions' })
  set('C18', { type: 'payroll', key: 'Gross Pay' }, { total: 'earnings' })
  set('E18', { type: 'payroll', key: 'Total deductions' }, { total: 'deductions' })
  set('E20', { type: 'payroll', key: 'Net Pay' }, { total: 'net' })
  set('C23', { type: 'date', of: 'today' })
  return body
}

const sheetOf = (body: SheetBody, version = 1): SheetInUse => ({ body, own: {}, id: TEMPLATE_ID, version: `v${version}` })
const choiceOf = (body: SheetBody, version = 1): TemplateChoice => ({ kind: 'published', templateId: TEMPLATE_ID, name: 'Monthly payslip', version, body })

/** Every difference accepted as rounding, each with the fixed reason, as the bulk button does. */
function roundingAccepted(prepared: ReturnType<typeof prepareSheetPayslips>): { accepted: Record<number, AcceptedChecks>; reasons: Reasons } {
  const accepted: Record<number, AcceptedChecks> = {}
  let reasons: Reasons = {}
  for (const { computation } of prepared) {
    for (const check of computation.checks) {
      if (check.kind !== 'rounding') continue
      accepted[computation.rowIndex] = { ...accepted[computation.rowIndex], [check.id]: check.diffCents! }
      reasons = withReason(reasons, computation.rowIndex, checkKey(check.id), ROUNDING_REASON)
    }
  }
  return { accepted, reasons }
}

async function issueInput(change: { rows?: PayrollRow[]; today?: string; body?: SheetBody; zero?: Map<number, Set<string>>; reasons?: Reasons; month?: IssuedPayslip[] } = {}): Promise<IssueInput> {
  const body = change.body ?? (await layout())
  const rows = change.rows ?? data.rows
  const prepared = prepareSheetPayslips({ ...data, rows }, sheetOf(body), PERIOD, change.today ?? TODAY, change.zero)
  const rounding = roundingAccepted(prepared)
  const reasons: Reasons = { ...rounding.reasons }
  for (const [row, more] of Object.entries(change.reasons ?? {})) reasons[Number(row)] = { ...reasons[Number(row)], ...more }
  return {
    data: { ...data, rows },
    period: PERIOD,
    prepared,
    selected: rows.map((_, index) => index),
    accepted: rounding.accepted,
    reasons,
    choice: choiceOf(body),
    previewingDraft: false,
    rates: null,
    month: change.month ?? [],
  }
}

function built(input: IssueInput) {
  const result = buildIssue(input)
  if (!result.ok) throw new Error(result.problems.join(' '))
  return result.payslips
}

/** What the dashboard keeps for each payslip issued, revision 1, as payslip-issue load gives it. */
const asIssued = (payslips: ReturnType<typeof built>, revision = 1): IssuedPayslip[] =>
  payslips.map((payslip) => ({
    nationalId: payslip.nationalId,
    revision,
    templateId: payslip.templateId,
    templateVersion: payslip.templateVersion,
    rates: payslip.rates,
    lines: JSON.parse(JSON.stringify(payslip.lines)),
    acceptedDifferences: payslip.acceptedDifferences,
    issuedAt: '2026-09-30T10:00:00+04:00',
    issuedByYou: true,
  }))

describe('issuing payslips of a layout from a file', () => {
  it('the month can be issued: no more "next stage", with a published version and the three totals marked', async () => {
    const input = await issueInput()
    expect(monthProblems(input)).toEqual([])
    const payslips = built(input)
    expect(payslips).toHaveLength(data.rows.length)
    expect(payslips[0]).toMatchObject({ templateId: TEMPLATE_ID, templateVersion: 1, rates: null })
    expect(payslips[0].lines[0]).toMatchObject({ kind: 'document', format: SHEET_LINES_FORMAT, drawing: 1, template: { id: TEMPLATE_ID, version: 'v1' } })
    // The figures stored are the sides of the payslip, with the payroll column each came from.
    expect((payslips[0].lines[1] as { lines: { label: string; source: string | null }[] }).lines.map((line) => [line.label, line.source])).toEqual([
      // Row by row, as the sheet reads.
      ['Basic Salary', 'Basic Salary'],
      ['CSG', 'Employee CSG'],
      ['Govt Increment', 'Govt Increment'],
      ['NSF', 'Employee NSF'],
      ['Allowances', 'Allowances'],
      ['PAYE', 'PAYE'],
    ])
  })

  it("the payslip's totals are the cells it marks, as printed, not only the figures marked Earnings or Deductions", async () => {
    const input = await issueInput()
    const { computation } = input.prepared[0]
    // DOE JANE: Gross Pay 21,085 includes figures the layout does not show on a side (Travelling).
    expect(computation.totals).toEqual({ earnings: 2_108_500, deductions: 49_038, net: 2_059_463 })
    expect((built(input)[0].lines[1] as { totals: unknown }).totals).toEqual({ earnings: 2_108_500, deductions: 49_038, net: 2_059_463 })
  })

  it('no statutory rates are stored with them: this option is not cross-checked against the rates', async () => {
    const input = await issueInput()
    const payslips = built({ ...input, rates: DEFAULT_STATUTORY_RATES[0] })
    expect(payslips.every((payslip) => payslip.rates === null)).toBe(true)
  })

  it('each payslip stays inside the dashboard limits; a layout too heavy is refused before anything is sent', async () => {
    const payslips = built(await issueInput())
    for (const payslip of payslips) {
      expect(new TextEncoder().encode(JSON.stringify(payslip.lines)).length).toBeLessThan(PAYSLIP_MAX_BYTES)
      expect(payslips[0].lines.length).toBeLessThanOrEqual(200)
    }
    expect(planIssue('C1234567', PERIOD, payslips).ok).toBe(true)
    const heavy = { ...payslips[0], lines: [...payslips[0].lines, { height: 15, cells: [{ col: 0, style: 0, text: 'x'.repeat(16_000) }] }] }
    expect(planIssue('C1234567', PERIOD, [heavy])).toEqual({ ok: false, tooLarge: [{ name: heavy.name, bytes: expect.any(Number) }] })
  })

  it('a missing figure treated as zero is stored with its reason, on a side or not', async () => {
    const body = await layout()
    const { Allowances: _allowances, ...without } = data.rows[0]
    const rows = [without, ...data.rows.slice(1)]
    const zero = new Map([[0, new Set(['c'])]])
    // The cell of C16 by its id.
    const id = body.rows[16 - 1 - body.firstRow].cells.find((cell) => cell.col === 2 - body.firstColumn)!.id
    zero.set(0, new Set([id]))
    expect(buildIssue(await issueInput({ body, rows, zero })).ok).toBe(false)
    const payslips = built(await issueInput({ body, rows, zero, reasons: { 0: { [zeroKey(id)]: 'No allowance this month' } } }))
    const figures = payslips[0].lines[1] as { lines: { id: string; status?: string; reason?: string }[] }
    expect(figures.lines.find((line) => line.id === id)).toMatchObject({ status: 'treated-as-zero', reason: 'No allowance this month' })
  })
})

describe('reopened exactly as issued', () => {
  it('the stored lines give back the very document that was issued', async () => {
    const input = await issueInput()
    const payslips = built(input)
    const decoded = decodeAnyLines(JSON.parse(JSON.stringify(payslips[0].lines)))
    if (!decoded.ok || !isSheetDocument(decoded.document)) throw new Error('not decoded')
    expect(decoded.document).toEqual(input.prepared[0].document)
  })

  it('the PDF and the Excel file of a reopened payslip are the same, byte for byte, made at another time', async () => {
    const input = await issueInput()
    const original = input.prepared[0].document as SheetDocument
    const decoded = decodeAnyLines(JSON.parse(JSON.stringify(built(input)[0].lines)))
    if (!decoded.ok || !isSheetDocument(decoded.document)) throw new Error('not decoded')
    const pdfDate = new Date(`${PERIOD}-01T00:00:00Z`)
    const firstPdf = await writePayslipPdf(original, fonts, pdfDate)
    const firstExcel = await writePayslipWorkbook([original])
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2027-03-04T05:06:07Z'))
    expect(Buffer.from(await writePayslipPdf(decoded.document, fonts, pdfDate)).equals(Buffer.from(firstPdf))).toBe(true)
    expect(Buffer.from(await writePayslipWorkbook([decoded.document])).equals(Buffer.from(firstExcel))).toBe(true)
  })

  it('a long name on two lines and the address are reopened as they were fitted', async () => {
    const body = await layout()
    const rows = [{ ...data.rows[0], Surname: 'SAMPLELONGSURNAME', 'Other names': 'Annabelle Marie-Claire Josephine Example' }]
    const input = await issueInput({ body, rows })
    const original = input.prepared[0].document as SheetDocument
    expect(original.rows.some((row) => row.cells.some((cell) => cell.text.includes('\n')))).toBe(true)
    const decoded = decodeAnyLines(JSON.parse(JSON.stringify(built(input)[0].lines)))
    expect(decoded.ok && decoded.document).toEqual(original)
  })

  it('stored lines that do not match format 2 are refused, never guessed at', async () => {
    const lines = JSON.parse(JSON.stringify(built(await issueInput())[0].lines)) as Record<string, unknown>[]
    const change = (edit: (copy: Record<string, unknown>[]) => void) => {
      const copy = JSON.parse(JSON.stringify(lines)) as Record<string, unknown>[]
      edit(copy)
      return decodeAnyLines(copy)
    }
    const refused = 'The stored payslip does not match its format. It is not shown, rather than guessed at.'
    expect(change((copy) => (copy[0].extra = 1))).toEqual({ ok: false, problem: refused })
    expect(change((copy) => ((copy[2] as { cells: { style: number }[] }).cells[0].style = 999))).toEqual({ ok: false, problem: refused })
    expect(change((copy) => ((copy[0].merges as { cols: number }[])[0].cols = 40))).toEqual({ ok: false, problem: refused })
    expect(change((copy) => (copy[0].drawing = 2))).toEqual({
      ok: false,
      problem: 'This payslip was issued with drawing version 2, which this version of the app cannot draw. It is not shown, rather than drawn another way.',
    })
    // The Table's own reader never takes a payslip of format 2 for one of its own.
    expect(decodeLines(lines).ok).toBe(false)
  })
})

describe('"Changed since"', () => {
  it('the same payslip made on another day is the same: today\'s date does not count', async () => {
    const issued = asIssued(built(await issueInput()))
    const later = await issueInput({ today: '2026-10-15', month: issued })
    const statuses = issueStatuses(later.data, later.prepared, issued, later.accepted, later.reasons)
    expect([...statuses.values()].every((status) => status.kind === 'issued' && status.same)).toBe(true)
    // The page itself shows the new date.
    const today = (later.prepared[0].document as SheetDocument).rows.flatMap((row) => row.cells).find((cell) => cell.today)!
    expect(today.text).toBe('15-Oct-26')
  })

  it('a changed figure, a changed own value or another version is changed since', async () => {
    const body = await layout()
    const issued = asIssued(built(await issueInput({ body })))
    const figure = await issueInput({ body, rows: [{ ...data.rows[0], PAYE: 125 }, ...data.rows.slice(1)], month: issued })
    const changed = issueStatuses(figure.data, figure.prepared, issued, figure.accepted, figure.reasons)
    expect(changed.get(0)).toMatchObject({ kind: 'issued', same: false })
    expect(changed.get(1)).toMatchObject({ kind: 'issued', same: true })

    const ownCell = body.rows[5 - 1 - body.firstRow].cells[0].id
    const fixed = setCell(body, 5 - 1 - body.firstRow, 0, (cell) => ({ ...cell, source: { type: 'fixed', value: 'ABC Co Ltd' }, format: { type: 'text', capitals: false } }))
    const before = asIssued(built(await issueInput({ body: fixed })))
    const prepared = prepareSheetPayslips(data, { ...sheetOf(fixed), own: { [ownCell]: 'ABC Company Limited' } }, PERIOD, TODAY)
    const rounding = roundingAccepted(prepared)
    expect(issueStatuses(data, prepared, before, rounding.accepted, rounding.reasons).get(0)).toMatchObject({ same: false })

    const v2 = prepareSheetPayslips(data, sheetOf(body, 2), PERIOD, TODAY)
    const again = roundingAccepted(v2)
    expect(issueStatuses(data, v2, issued, again.accepted, again.reasons).get(0)).toMatchObject({ same: false })
  })

  it('a payslip of the Table template and one of a layout are never the same payslip', async () => {
    const lines = built(await issueInput())[0].lines
    expect(sameLines(lines, [{ ...lines[0], format: 1 }, ...lines.slice(1)])).toBe(false)
    expect(sameLines(lines, JSON.parse(JSON.stringify(lines)))).toBe(true)
  })

  it('issuing an identical payslip again is asked about a second time, as for the Table template', async () => {
    const issued = asIssued(built(await issueInput()))
    const again = buildIssue(await issueInput({ today: '2026-10-02', month: issued }))
    expect(again.ok && again.identical.length).toBe(data.rows.length)
  })
})

describe('the month review', () => {
  it('last month issued from the layout, this month from the same layout: compared figure by figure', async () => {
    const august = asIssued(built({ ...(await issueInput()), period: PERIOD }))
    // Last month's payslips, as if issued for August.
    const lastMonth = august.map((payslip) => ({ ...payslip, lines: [{ ...(payslip.lines[0] as object), period: '2026-08' }, ...payslip.lines.slice(1)] }))
    const september = await issueInput({ rows: [{ ...data.rows[0], 'Basic Salary': 18_500, 'Gross Pay': 21_585 }, ...data.rows.slice(1)] })
    const current = currentPayslips(september.data, september.prepared, { id: TEMPLATE_ID, version: 'v1' }, null)
    const comparison = compareMonth(PERIOD, current, baselineFromIssued('2026-08', lastMonth))
    expect(comparison.counts).toMatchObject({ changed: 1, unchanged: data.rows.length - 1, 'cannot-compare': 0 })
    const changed = comparison.rows.find((row) => row.status === 'changed')!
    expect(changed.lines.filter((line) => line.changed).map((line) => [line.label, line.last, line.current])).toEqual([['Basic Salary', 1_800_000, 1_850_000]])
  })
})
