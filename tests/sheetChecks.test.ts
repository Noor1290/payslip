// "From your file", Stage 2 prompt, Stage 2: the cross-checks of the three totals the layout marks,
// required cells, and "Treat as zero" for a cell. Fake data only (ABC Co Ltd).

import { describe, expect, it } from 'vitest'
import { preparePayslips } from '../src/lib/build'
import { buildIssue, monthProblems, UNMARKED_TOTALS, type IssueInput } from '../src/lib/issueBuild'
import { isReady, pendingChecks } from '../src/lib/payslip'
import type { PayrollRow } from '../src/lib/payrollFile'
import { acceptedDifferences, ROUNDING_REASON, zeroKey } from '../src/lib/reasons'
import { formatFor, sheetProblems, type SheetBody, type SheetCell, type Source } from '../src/lib/sheetBody'
import { NO_TOTALS, prepareSheetPayslips, type SheetInUse } from '../src/lib/sheetDocument'
import { BUILT_IN_BODY, templateOf } from '../src/lib/templateBody'
import type { TemplateChoice } from '../src/lib/templateUse'
import { loadFixture } from './helpers'

const PERIOD = '2026-09'
const TODAY = '2026-09-30'
const data = loadFixture()
// The fixture's first employee: Gross Pay 21,085, Total deductions 490.38, Net Pay 20,594.63
// (one cent more than 21,085 - 490.38, as a payroll that rounds its net pay can give).
const first = data.rows[0]

type Cell = Omit<SheetCell, 'id' | 'col' | 'style' | 'format'> & { format?: SheetCell['format'] }

/** A layout of one row: a label and a value per cell given. */
function layout(cells: Cell[]): SheetBody {
  return {
    schema: 2,
    kind: 'file',
    orientation: 'portrait',
    firstRow: 0,
    firstColumn: 0,
    columns: [20, 14],
    rows: cells.map((cell, index) => ({
      height: 15,
      cells: [
        { id: `l${index}`, col: 0, style: 0, source: { type: 'text', value: `Label ${index + 1}` }, format: { type: 'text', capitals: false } },
        { id: `c${index}`, col: 1, style: 0, format: formatFor(cell.source), ...cell },
      ],
    })),
    merges: [],
    styles: [{ font: { name: 'Book Antiqua', size: 11 } }],
  }
}

const sheet = (body: SheetBody): SheetInUse => ({ body, own: {}, id: 't', version: 'v1' })
const payroll = (key: string): Source => ({ type: 'payroll', key })
const prepare = (body: SheetBody, rows: PayrollRow[] = [first], zero = new Map<number, Set<string>>()) => prepareSheetPayslips({ ...data, rows }, sheet(body), PERIOD, TODAY, zero)

const TOTALS: Cell[] = [
  { source: payroll('Gross Pay'), total: 'earnings' },
  { source: payroll('Total deductions'), total: 'deductions' },
  { source: { type: 'calc', terms: [{ sign: 1, of: { type: 'column', key: 'Gross Pay' }, times: null, round: 'none' }, { sign: -1, of: { type: 'column', key: 'Total deductions' }, times: null, round: 'none' }] }, total: 'net' },
]

describe('the cross-checks of the totals the layout marks', () => {
  it('each marked cell, as printed, against the payroll: Gross Pay, Total deductions and Net Pay', () => {
    const [{ computation }] = prepare(layout(TOTALS))
    expect(computation.checks.map(({ id, payrollKey, payslipCents, payrollCents, kind }) => ({ id, payrollKey, payslipCents, payrollCents, kind }))).toEqual([
      { id: 'gross', payrollKey: 'Gross Pay', payslipCents: 2_108_500, payrollCents: 2_108_500, kind: 'match' },
      { id: 'deductions', payrollKey: 'Total deductions', payslipCents: 49_038, payrollCents: 49_038, kind: 'match' },
      // 21,085 - 490.38 = 20,594.62 on the payslip; the payroll says 20,594.63.
      { id: 'net', payrollKey: 'Net Pay', payslipCents: 2_059_462, payrollCents: 2_059_463, kind: 'rounding' },
    ])
    expect(computation.checks.map((check) => check.label)).toEqual(['Total Earnings, cell B1', 'Total Deductions, cell B2', 'Net Pay, cell B3'])
  })

  it('a difference blocks the payslip until it is accepted, exactly as on the Table payslip', () => {
    const [{ computation }] = prepare(layout(TOTALS))
    expect(isReady(computation, {})).toBe(false)
    expect(pendingChecks(computation, {}).map((check) => check.id)).toEqual(['net'])
    expect(isReady(computation, { net: -1 })).toBe(true)
    // Accepted for another difference, it is not accepted.
    expect(isReady(computation, { net: 1 })).toBe(false)
    const { differences, missing } = acceptedDifferences(computation, { net: -1 }, { 'check-net': ROUNDING_REASON })
    expect(missing).toEqual([])
    expect(differences).toEqual([{ what: 'Net Pay, cell B3', payroll: 20_594.63, payslip: 20_594.62, reason: ROUNDING_REASON }])
  })

  it('only exactly 0.01 is rounding: 0.02 is a difference', () => {
    const [{ computation }] = prepare(layout(TOTALS), [{ ...first, 'Net Pay': 20_594.64 }])
    expect(computation.checks[2]).toMatchObject({ diffCents: -2, kind: 'difference' })
  })

  it('the figure is compared as the cell prints it: in whole rupees, 490.38 is 490, a difference', () => {
    const whole: Cell = { source: payroll('Total deductions'), total: 'deductions', format: { type: 'number', decimals: 0, thousands: true, rs: false, dash: true } }
    const [{ computation }] = prepare(layout([whole]))
    expect(computation.checks[0]).toMatchObject({ payslipCents: 49_000, payrollCents: 49_038, diffCents: -38, kind: 'difference' })
  })

  it('a payroll without the total to check against is an error, never a guess', () => {
    const { 'Gross Pay': _gross, ...without } = first
    const [{ computation, document }] = prepare(layout([{ source: payroll('Basic Salary'), total: 'earnings' }]), [without])
    expect(computation.errors.map((error) => error.message)).toContain('Total Earnings cannot be checked: the payroll data has no "Gross Pay" for this employee.')
    expect(document).toBeNull()
  })

  it('a layout that marks no total says it is not checked; issuing waits until all three are marked', () => {
    const [{ computation }] = prepare(layout([{ source: payroll('Basic Salary') }]))
    expect(computation.checks).toEqual([])
    expect(computation.warnings.map((warning) => warning.message)).toContain(NO_TOTALS)
    const choice = (body: SheetBody): TemplateChoice => ({ kind: 'published', templateId: 'x', name: 'Layout', version: 1, body })
    const base = { data, period: PERIOD, previewingDraft: false }
    expect(monthProblems({ ...base, choice: choice(layout([TOTALS[0], TOTALS[1]])) })).toContain(UNMARKED_TOTALS)
    expect(monthProblems({ ...base, choice: choice(layout(TOTALS)) })).not.toContain(UNMARKED_TOTALS)
  })

  it('a total must be a figure, and only one cell can be each total', () => {
    expect(sheetProblems(layout([{ source: { type: 'text', value: '21,085' }, total: 'earnings' }]))).toContain('Cell B1 is marked as Total earnings, but it shows no payroll figure or calculation.')
    expect(sheetProblems(layout([TOTALS[0], { source: payroll('Basic Salary'), total: 'earnings' }]))).toContain('Only one cell can be Total earnings: B1, B2 are.')
    expect(sheetProblems(layout(TOTALS))).toEqual([])
  })
})

describe('required cells', () => {
  const body = layout([
    { source: { type: 'employee', key: 'Department' }, required: true },
    { source: { type: 'employee', key: 'Team' } },
    ...TOTALS,
  ])

  it('an empty required cell is listed, named by its cell and label, and never blocks a download', () => {
    const [item] = prepare(body)
    expect(item.computation.requiredEmpty).toEqual(['B1 (Label 1)'])
    expect(item.computation.warnings.map((warning) => warning.message)).toContain('Cell B1 (Label 1) is required, and it is empty.')
    // Not required and empty: nothing is said.
    expect(item.computation.warnings.some((warning) => warning.message.includes('B2'))).toBe(false)
    expect(item.computation.errors).toEqual([])
    expect(item.document).not.toBeNull()
    expect(isReady(item.computation, { net: -1 })).toBe(true)
  })

  it('filled in, it is not listed', () => {
    const [item] = prepare(body, [{ ...first, Department: 'Accounts' }])
    expect(item.computation.requiredEmpty).toEqual([])
  })

  it('a payslip with an empty required cell is never issued', () => {
    const { template, mapping } = templateOf(BUILT_IN_BODY, { id: 'x', name: 'Monthly payslip', version: 'v1' })
    const [table] = preparePayslips({ ...data, rows: [first] }, { template, mapping, rateVersions: [], period: PERIOD }, TODAY)
    const prepared = [{ ...table, computation: { ...table.computation, requiredEmpty: ['B1 (Label 1)', 'B2 (Label 2)'] } }]
    const input: IssueInput = {
      data: { ...data, rows: [first] },
      period: PERIOD,
      prepared,
      selected: [0],
      accepted: {},
      reasons: {},
      choice: { kind: 'published', templateId: '20000000-0000-4000-8000-000000000001', name: 'Monthly payslip', version: 1, body: BUILT_IN_BODY },
      previewingDraft: false,
      rates: null,
      month: [],
    }
    expect(buildIssue(input)).toEqual({ ok: false, problems: [`${first.Surname} ${first['Other names']}: required cells are empty: B1 (Label 1), B2 (Label 2).`] })
  })
})

describe('"Treat as zero" for a cell', () => {
  const body = layout([{ source: payroll('Overtime'), side: 'earnings' }, { source: payroll('Bonus') }, ...TOTALS])
  const zero = (ids: string[]) => new Map([[0, new Set(ids)]])

  it('a missing figure is an error, and the cell may be treated as zero', () => {
    const [item] = prepare(body)
    expect(item.computation.errors.map((error) => error.message)).toEqual([
      'Cell B1: the payroll data has no "Overtime" for this employee.',
      'Cell B2: the payroll data has no "Bonus" for this employee.',
    ])
    expect(item.computation.zeroable).toEqual({ c0: 'B1 (Label 1)', c1: 'B2 (Label 2)' })
    expect(item.document).toBeNull()
  })

  it('treated as zero for this employee only: the cell prints 0 as its format writes it, the line says so', () => {
    const [one, other] = prepare(body, [first, { ...first, ID: 'X2' }], zero(['c0', 'c1']))
    expect(one.computation.errors).toEqual([])
    expect(one.document!.rows[0].cells[1]).toMatchObject({ text: '-', number: 0 })
    expect(one.computation.lines.find((line) => line.id === 'c0')).toMatchObject({ status: 'treated-as-zero', cents: 0 })
    // A cell on neither side is listed on its own, so that its reason is asked and stored.
    expect(one.computation.zeroCells).toEqual([{ id: 'c1', label: 'B2 (Label 2)' }])
    expect(other.computation.errors).toHaveLength(2)
  })

  it('each zero needs a reason before the payslip can be issued', () => {
    const [item] = prepare(body, [first], zero(['c0', 'c1']))
    expect(acceptedDifferences(item.computation, { net: -1 }, { 'check-net': ROUNDING_REASON }).missing).toEqual([
      'Label 1 was treated as zero without a reason',
      'B2 (Label 2) was treated as zero without a reason',
    ])
    const reasons = { 'check-net': ROUNDING_REASON, [zeroKey('c0')]: 'No overtime this month', [zeroKey('c1')]: 'No bonus' }
    expect(acceptedDifferences(item.computation, { net: -1 }, reasons)).toMatchObject({ missing: [], zeroReasons: { c0: 'No overtime this month', c1: 'No bonus' } })
  })

  it('in a calculation, only the missing column is zero; other figures are kept', () => {
    const calc: Cell = { source: { type: 'calc', terms: [{ sign: 1, of: { type: 'column', key: 'Basic Salary' }, times: null, round: 'none' }, { sign: 1, of: { type: 'column', key: 'Overtime' }, times: null, round: 'none' }] } }
    const [item] = prepare(layout([calc]), [first], zero(['c0']))
    expect(item.computation.errors).toEqual([])
    expect(item.document!.rows[0].cells[1].text).toBe('18,000')
  })

  it('text in a money field, or more than 2 decimals, is never treated as zero', () => {
    const [item] = prepare(body, [{ ...first, Overtime: 'n/a', Bonus: 12.345 }], zero(['c0', 'c1']))
    expect(item.computation.errors.map((error) => error.code)).toEqual(['not-a-number', 'too-many-decimals'])
    expect(item.computation.zeroable).toEqual({})
  })

  it('employee CSG and NSF are never treated as zero, as on the Table payslip', () => {
    const { 'Employee CSG': _csg, 'Employee NSF': _nsf, ...without } = first
    const [item] = prepare(layout([{ source: payroll('Employee CSG') }, { source: payroll('Employee NSF') }]), [without], zero(['c0', 'c1']))
    expect(item.computation.errors.map((error) => error.code)).toEqual(['missing-key', 'missing-key'])
    expect(item.computation.zeroable).toEqual({})
  })
})
