// The fallback of the month review: last month's PAYROLL figures, used only when no payslip at
// all was issued last month. The request, each way it can end, and the comparison it gives.
// Fake data only (ABC Co Ltd).
import { describe, expect, it } from 'vitest'
import { baselineFromPayroll, loadPayrollMonth } from '../src/lib/baseline'
import type { HubPort } from '../src/lib/hubWire'
import { loadMonth } from '../src/lib/issueStore'
import { baselineFromIssued, compareMonth } from '../src/lib/monthCompare'
import { approveUnchanged, baselineState, comparisonOf, isReviewed, reviewProblems, type PayrollBaseline } from '../src/lib/monthReview'
import { templateOf } from '../src/lib/templateBody'
import type { MonthState } from '../src/lib/useIssuing'
import { BRN } from './fakeHubPort'
import { readFixtureText } from './helpers'
import { august, AUGUST_FIXTURE, current, dashboard, issue, LAST_PERIOD, PERIOD, september, V1, V2_RENAMED } from './monthFixtures'

const augustRows = (): Record<string, unknown>[] => JSON.parse(readFixtureText(AUGUST_FIXTURE))
const { template, mapping } = templateOf(V1.body, { id: V1.id, name: V1.name, version: 'v1' })
const answering = (reply: unknown): HubPort => ({ send: () => Promise.resolve(reply) })
const ok = (rows: unknown[], period = LAST_PERIOD) => ({ ok: true, dataType: 'payroll-result', rows, meta: { period, label: 'ABC Co Ltd' } })

/** A dashboard that has August's payroll saved, and no issued payslip. */
function withAugustPayroll() {
  const made = dashboard()
  made.hub.state.runs[LAST_PERIOD] = augustRows()
  return made
}
async function loaded(port: HubPort) {
  const result = await loadPayrollMonth(port, BRN, LAST_PERIOD)
  if (!result.ok || result.data === null) throw new Error('August payroll was not loaded')
  return result.data
}
const payrollBaseline = async (port: HubPort): Promise<PayrollBaseline> => ({ status: 'loaded', baseline: baselineFromPayroll(LAST_PERIOD, await loaded(port), template, mapping) })
const EMPTY: MonthState = { status: 'loaded', payslips: [] }

describe('asking the dashboard for last month\'s payroll', () => {
  it('asks for exactly that month of payroll results, and nothing else', async () => {
    const { hub, port } = withAugustPayroll()
    const result = await loadPayrollMonth(port, BRN, LAST_PERIOD)
    expect(hub.state.log).toEqual([{ type: 'request-data', payload: { dataType: 'payroll-result', period: '2026-08' } }])
    expect(result.ok && result.data).toMatchObject({ period: '2026-08', company: { name: 'ABC Co Ltd', brn: 'C1234567' } })
    expect(result.ok && result.data?.rows).toHaveLength(7)
  })

  it('"no saved run" is an answer: there is no payroll for that month', async () => {
    const { port } = dashboard()
    expect(await loadPayrollMonth(port, BRN, LAST_PERIOD)).toEqual({ ok: true, data: null })
    expect(await loadPayrollMonth(answering({ ok: false, error: 'That run has no employees.' }), BRN, LAST_PERIOD)).toEqual({ ok: true, data: null })
    expect(await loadPayrollMonth(answering({ ok: false, code: 'not-found', error: 'No run.' }), BRN, LAST_PERIOD)).toEqual({ ok: true, data: null })
  })

  it.each([
    ['deny', 'denied'],
    ['timeout', 'timeout'],
  ] as const)('answered "%s" in the dashboard is a failure, never "no payroll"', async (prompt, kind) => {
    const { hub, port } = withAugustPayroll()
    hub.state.prompt = prompt
    expect(await loadPayrollMonth(port, BRN, LAST_PERIOD)).toMatchObject({ ok: false, failure: { kind } })
  })

  it('a locked dashboard, and any other refusal, is a failure', async () => {
    const { hub, port } = withAugustPayroll()
    hub.state.gateOpen = false
    expect(await loadPayrollMonth(port, BRN, LAST_PERIOD)).toMatchObject({ ok: false, failure: { kind: 'locked' } })
    expect(await loadPayrollMonth(answering({ ok: false, error: 'The dashboard did not answer in time.' }), BRN, LAST_PERIOD)).toMatchObject({
      ok: false,
      failure: { kind: 'no-answer', hubError: 'The dashboard did not answer in time.' },
    })
    expect(await loadPayrollMonth(answering({ ok: false, code: 'unavailable', error: 'There is no saved run for 2026-08.' }), BRN, LAST_PERIOD)).toMatchObject({
      ok: false,
      failure: { kind: 'unavailable' },
    })
    const broken: HubPort = { send: () => Promise.reject(new Error('gone')) }
    expect(await loadPayrollMonth(broken, BRN, LAST_PERIOD)).toMatchObject({ ok: false, failure: { kind: 'no-answer' } })
  })

  it('an answer about another month is not used', async () => {
    expect(await loadPayrollMonth(answering(ok(augustRows(), '2026-07')), BRN, LAST_PERIOD)).toMatchObject({ ok: false, failure: { kind: 'bad-answer' } })
    expect(await loadPayrollMonth(answering({ ok: true, dataType: 'payroll-result', rows: augustRows() }), BRN, LAST_PERIOD)).toMatchObject({ ok: false, failure: { kind: 'bad-answer' } })
  })

  it('rows of another company are not used', async () => {
    const other = augustRows().map((row) => ({ ...row, BRN: 'C7654321' }))
    expect(await loadPayrollMonth(answering(ok(other)), BRN, LAST_PERIOD)).toMatchObject({ ok: false, failure: { kind: 'other-company' } })
    expect(await loadPayrollMonth(answering({ ...ok(augustRows()), meta: { period: LAST_PERIOD, brn: 'C7654321' } }), BRN, LAST_PERIOD)).toMatchObject({
      ok: false,
      failure: { kind: 'other-company' },
    })
  })

  it('rows that are not payroll rows, or another kind of data, are not used; the reason names no figure', async () => {
    const noCompany = augustRows().map(({ 'Company Name': _name, ...row }) => row)
    const refused = await loadPayrollMonth(answering(ok(noCompany)), BRN, LAST_PERIOD)
    expect(refused).toMatchObject({ ok: false, failure: { kind: 'bad-answer' } })
    expect(!refused.ok && refused.failure.detail).toMatch(/^Last month's payroll figures were not used: "Company Name" is missing/)
    expect(!refused.ok && refused.failure.detail).not.toMatch(/18,000|X0000000000001/)
    expect(await loadPayrollMonth(answering({ ...ok(augustRows()), dataType: 'payslip-issue' }), BRN, LAST_PERIOD)).toMatchObject({ ok: false, failure: { kind: 'bad-answer' } })
    expect(await loadPayrollMonth(answering(ok([])), BRN, LAST_PERIOD)).toMatchObject({ ok: false, failure: { kind: 'bad-answer' } })
  })
})

describe('the payroll figures as the baseline', () => {
  it('puts each row on the template in use now, with no revision, template or rates of its own', async () => {
    const { port } = withAugustPayroll()
    const baseline = baselineFromPayroll(LAST_PERIOD, await loaded(port), template, mapping)
    expect(baseline).toMatchObject({ period: LAST_PERIOD, source: 'payroll' })
    expect(baseline.payslips.map((payslip) => [payslip.employeeName, payslip.revision, payslip.side?.template, payslip.side?.rates])).toEqual(
      ['DOE JANE', 'PALMYRE JEAN MARC', 'SAMPLE ALEX', 'TESTER SAMUEL', 'FICTIF MARIE', 'TEMPO LEA', 'ANCIEN PAUL'].map((name) => [name, null, null, null]),
    )
    expect(baseline.payslips[0].side?.figures.totals).toEqual({ earnings: 2108500, deductions: 49037, net: 2059463 })
  })

  it('gives the same statuses and figures as the issued payslips of that month would', async () => {
    const { port } = withAugustPayroll()
    const fromPayroll = compareMonth(PERIOD, current(september()), baselineFromPayroll(LAST_PERIOD, await loaded(port), template, mapping))
    expect(fromPayroll.source).toBe('payroll')
    expect(fromPayroll.rows.map((row) => [row.employeeName, row.status])).toEqual([
      ['DOE JANE', 'unchanged'],
      ['PALMYRE JEAN MARC', 'changed'],
      ['SAMPLE ALEX', 'changed'],
      ['TESTER SAM', 'unchanged'],
      ['EXEMPLE PRIYA', 'new'],
      ['FICTIF MARIE', 'unchanged'],
      ['TEMPO LEA', 'unchanged'],
      ['ANCIEN PAUL', 'left'],
    ])
    // The same lines and totals as against the issued payslips; only what a payslip alone has differs.
    const issuedHub = dashboard()
    await issue(issuedHub.port, august())
    const issued = await loadMonth(issuedHub.port, BRN, LAST_PERIOD)
    if (!issued.ok) throw new Error(issued.failure.title)
    const fromIssued = compareMonth(PERIOD, current(september()), baselineFromIssued(LAST_PERIOD, issued.payslips))
    expect(fromPayroll.rows.map((row) => [row.lines, row.totals])).toEqual(fromIssued.rows.map((row) => [row.lines, row.totals]))
    expect(fromPayroll.rows.map((row) => row.baselineRevision)).toEqual([null, null, null, null, null, null, null, null])
    expect(fromPayroll.rows.every((row) => row.matchedBy === null || row.matchedBy === 'id')).toBe(true)
  })

  it('has no template or rates to differ from: no banner, and only the notes a payroll row can give', async () => {
    const { port } = withAugustPayroll()
    const now = september(V2_RENAMED)
    const made = templateOf(V2_RENAMED.body, { id: V2_RENAMED.id, name: V2_RENAMED.name, version: 'v2' })
    const comparison = compareMonth(PERIOD, current(now), baselineFromPayroll(LAST_PERIOD, await loaded(port), made.template, made.mapping))
    expect(comparison.banner).toEqual([])
    expect(comparison.rows.find((row) => row.employeeName === 'TESTER SAM')?.notes).toEqual(['Name: "TESTER SAMUEL" last month, "TESTER SAM" now.'])
    expect(comparison.rows.find((row) => row.employeeName === 'DOE JANE')?.notes).toEqual([])
    // The figures are on the template in use now, reworded label and all.
    expect(comparison.rows[0].lines.find((line) => line.label === 'Travelling allowance')).toMatchObject({ match: 'id', lastLabel: null, last: 245000, current: 245000 })
  })

  it('a payroll row that cannot be put on the template is said, not compared', async () => {
    const { hub, port } = withAugustPayroll()
    hub.state.runs[LAST_PERIOD] = augustRows().map((row, index) => (index === 0 ? Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'Employee CSG')) : row))
    const comparison = compareMonth(PERIOD, current(september()), baselineFromPayroll(LAST_PERIOD, await loaded(port), template, mapping))
    expect(comparison.rows[0]).toMatchObject({ employeeName: 'DOE JANE', status: 'cannot-compare' })
    expect(comparison.rows[0].problem).toBe('Last month\'s payroll figures cannot be put on this template. CSG: the payroll data has no "Employee CSG" for this employee.')
  })

  it('text in a money field of a payroll row is said the same way, without the value', async () => {
    const { hub, port } = withAugustPayroll()
    hub.state.runs[LAST_PERIOD] = augustRows().map((row, index) => (index === 1 ? { ...row, 'Basic Salary': '18,365' } : row))
    const comparison = compareMonth(PERIOD, current(september()), baselineFromPayroll(LAST_PERIOD, await loaded(port), template, mapping))
    expect(comparison.rows[1]).toMatchObject({ employeeName: 'PALMYRE JEAN MARC', status: 'cannot-compare' })
    expect(comparison.rows[1].problem).toBe('Last month\'s payroll figures cannot be put on this template. Basic Salary: "Basic Salary" is text, not a number.')
    expect(comparison.rows[0].status).toBe('unchanged')
  })
})

describe('when the fallback is used', () => {
  it('only when NO payslip at all was issued last month', async () => {
    const { port } = withAugustPayroll()
    const payroll = await payrollBaseline(port)
    // Nothing issued: the payroll figures are the baseline.
    expect(baselineState(LAST_PERIOD, EMPTY, payroll)).toMatchObject({ status: 'ready', baseline: { source: 'payroll' } })
    // One payslip issued: the issued payslips are the baseline, whatever payroll was loaded.
    await issue(port, august(), [0])
    const issued = await loadMonth(port, BRN, LAST_PERIOD)
    if (!issued.ok) throw new Error(issued.failure.title)
    const state = baselineState(LAST_PERIOD, { status: 'loaded', payslips: issued.payslips }, payroll)
    expect(state).toMatchObject({ status: 'ready', baseline: { source: 'issued' } })
    expect(state.status === 'ready' && state.baseline.payslips).toHaveLength(1)
    // So everyone else is New: "not issued last month".
    const comparison = comparisonOf(state, PERIOD, current(september()))!
    expect(comparison.counts).toMatchObject({ unchanged: 1, new: 6, left: 0 })
  })

  it('is not used when the issued payslips could not be loaded', async () => {
    const { port } = withAugustPayroll()
    const failed: MonthState = { status: 'failed', failure: { kind: 'denied', title: '', detail: '', hubError: null, index: null } }
    expect(baselineState(LAST_PERIOD, failed, await payrollBaseline(port))).toMatchObject({ status: 'failed', what: 'issued' })
    expect(baselineState(LAST_PERIOD, undefined, await payrollBaseline(port))).toEqual({ status: 'not-asked' })
  })

  it('follows each answer about the payroll: not asked yet, loading, failed, none, loaded', () => {
    expect(baselineState(LAST_PERIOD, EMPTY)).toEqual({ status: 'none-issued' })
    expect(baselineState(LAST_PERIOD, EMPTY, { status: 'loading' })).toEqual({ status: 'loading', what: 'payroll' })
    const failure = { kind: 'locked' as const, title: 'The dashboard is locked', detail: '', hubError: null, index: null }
    expect(baselineState(LAST_PERIOD, EMPTY, { status: 'failed', failure })).toEqual({ status: 'failed', what: 'payroll', failure })
    expect(baselineState(LAST_PERIOD, EMPTY, { status: 'none' })).toEqual({ status: 'nothing' })
  })

  it('the issue waits for the payroll answer, and only "no payroll either" needs no review', async () => {
    const gate = (state: ReturnType<typeof baselineState>) => reviewProblems({ state, lastPeriod: LAST_PERIOD, comparison: comparisonOf(state, PERIOD, current(september())), marks: {}, selected: [0] })
    expect(gate(baselineState(LAST_PERIOD, EMPTY))).toEqual(['No payslip was issued for August 2026. Compare with its payroll figures in the month review first. Issuing waits for it.'])
    expect(gate(baselineState(LAST_PERIOD, EMPTY, { status: 'loading' }))).toEqual(['The comparison with August 2026 is still being loaded.'])
    expect(gate(baselineState(LAST_PERIOD, EMPTY, { status: 'none' }))).toEqual([])
    const { port } = withAugustPayroll()
    expect(gate(baselineState(LAST_PERIOD, EMPTY, await payrollBaseline(port)))).toEqual([
      '1 unchanged payslip is not approved yet. Approve them in the month review.',
      '1 employee who left is not acknowledged yet: ANCIEN PAUL.',
    ])
  })

  it('a row approved against payroll figures is not approved against issued payslips', async () => {
    const { port } = withAugustPayroll()
    const payroll = await payrollBaseline(port)
    const first = comparisonOf(baselineState(LAST_PERIOD, EMPTY, payroll), PERIOD, current(september()))!
    const marks = approveUnchanged({}, first)
    expect(isReviewed(marks, first, first.rows[0])).toBe(true)
    await issue(port, august())
    const issued = await loadMonth(port, BRN, LAST_PERIOD)
    if (!issued.ok) throw new Error(issued.failure.title)
    const next = comparisonOf(baselineState(LAST_PERIOD, { status: 'loaded', payslips: issued.payslips }, payroll), PERIOD, current(september()))!
    expect(next.rows[0]).toMatchObject({ employeeName: 'DOE JANE', status: 'unchanged' })
    expect(isReviewed(marks, next, next.rows[0])).toBe(false)
  })
})
