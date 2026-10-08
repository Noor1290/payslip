// Reviewing the month: marks, bulk-approve (Unchanged rows only), what blocks issuing, and that the
// review never touches a payslip: this month is always built from this month's payroll figures.
// Fake data only (ABC Co Ltd).
import { describe, expect, it } from 'vitest'
import { failure } from '../src/lib/hubWire'
import { buildIssue, identicalAsk, type IssueBuild } from '../src/lib/issueBuild'
import { decodeLines, sameLines } from '../src/lib/issuedLines'
import { loadMonth, type IssuedPayslip } from '../src/lib/issueStore'
import { documentTexts } from '../src/lib/layoutModel'
import { baselineFromIssued, compareMonth, type MonthComparison, type ReviewRow } from '../src/lib/monthCompare'
import {
  approveUnchanged,
  bulkApprovable,
  isReviewed,
  markReviewed,
  reviewProblems,
  unmarkReviewed,
  withReview,
  type BaselineState,
  type ReviewMarks,
} from '../src/lib/monthReview'
import { BRN } from './fakeHubPort'
import { august, current, dashboard, issue, issuedAugust, LAST_PERIOD, monthFrom, PERIOD, september, type Month } from './monthFixtures'

const compare = (now: Month, issued: IssuedPayslip[]): MonthComparison => compareMonth(PERIOD, current(now), baselineFromIssued(LAST_PERIOD, issued))
const ready = (issued: IssuedPayslip[]): BaselineState => ({ status: 'ready', baseline: baselineFromIssued(LAST_PERIOD, issued) })
const rowOf = (comparison: MonthComparison, name: string): ReviewRow => comparison.rows.find((row) => row.employeeName === name)!
const reviewedNames = (marks: ReviewMarks, comparison: MonthComparison) => comparison.rows.filter((row) => isReviewed(marks, comparison, row)).map((row) => row.employeeName)
const everyone = [0, 1, 2, 3, 4, 5, 6]
const markAll = (marks: ReviewMarks, comparison: MonthComparison, names: string[]) => names.reduce((next, name) => markReviewed(next, comparison, rowOf(comparison, name)), marks)

/** September with one figure of one employee replaced. */
function septemberWith(surname: string, key: string, value: number): Month {
  const base = september()
  const rows = base.data.rows.map((row) => (row.Surname === surname ? { ...row, [key]: value } : row))
  return monthFrom({ ...base.data, rows }, PERIOD)
}

describe('marking a row as reviewed', () => {
  it('marks one row, and can be undone', async () => {
    const comparison = compare(september(), await issuedAugust())
    const row = rowOf(comparison, 'PALMYRE JEAN MARC')
    const marks = markReviewed({}, comparison, row)
    expect(reviewedNames(marks, comparison)).toEqual(['PALMYRE JEAN MARC'])
    expect(reviewedNames(unmarkReviewed(marks, comparison, row), comparison)).toEqual([])
  })

  it('bulk-approve marks the Unchanged rows and no other', async () => {
    const comparison = compare(september(), await issuedAugust())
    expect(bulkApprovable({}, comparison).map((row) => row.employeeName)).toEqual(['DOE JANE', 'TESTER SAM', 'FICTIF MARIE', 'TEMPO LEA'])
    const marks = approveUnchanged({}, comparison)
    expect(reviewedNames(marks, comparison)).toEqual(['DOE JANE', 'TESTER SAM', 'FICTIF MARIE', 'TEMPO LEA'])
    // Changed, New and Left stay to be looked at one by one.
    for (const name of ['PALMYRE JEAN MARC', 'SAMPLE ALEX', 'EXEMPLE PRIYA', 'ANCIEN PAUL']) expect(isReviewed(marks, comparison, rowOf(comparison, name))).toBe(false)
    expect(bulkApprovable(marks, comparison)).toEqual([])
  })

  it('bulk-approve never marks a row that cannot be compared', async () => {
    const issued = await issuedAugust()
    const broken = issued.map((payslip, index) => (index === 0 ? { ...payslip, lines: [{ kind: 'note' }, {}, {}] } : payslip))
    const comparison = compare(september(), broken)
    expect(rowOf(comparison, 'DOE JANE').status).toBe('cannot-compare')
    expect(isReviewed(approveUnchanged({}, comparison), comparison, rowOf(comparison, 'DOE JANE'))).toBe(false)
  })

  it('a mark holds while nothing changes', async () => {
    const issued = await issuedAugust()
    const first = compare(september(), issued)
    const marks = markAll(approveUnchanged({}, first), first, ['PALMYRE JEAN MARC'])
    const again = compare(september(), issued)
    expect(reviewedNames(marks, again)).toEqual(['DOE JANE', 'PALMYRE JEAN MARC', 'TESTER SAM', 'FICTIF MARIE', 'TEMPO LEA'])
  })

  it('a mark is dropped when a figure of this month changes, even by one cent, for that employee only', async () => {
    const issued = await issuedAugust()
    const first = compare(september(), issued)
    const marks = markAll(approveUnchanged({}, first), first, ['PALMYRE JEAN MARC'])
    // PALMYRE's Travelling goes from 0 to 0.01; payroll totals are left as they were.
    const next = compare(septemberWith('PALMYRE', 'Travelling', 0.01), issued)
    expect(isReviewed(marks, next, rowOf(next, 'PALMYRE JEAN MARC'))).toBe(false)
    expect(reviewedNames(marks, next)).toEqual(['DOE JANE', 'TESTER SAM', 'FICTIF MARIE', 'TEMPO LEA'])
    // An approved Unchanged row that becomes Changed is no longer approved.
    const moved = compare(septemberWith('DOE', 'Travelling', 2450.01), issued)
    expect(rowOf(moved, 'DOE JANE').status).toBe('changed')
    expect(isReviewed(marks, moved, rowOf(moved, 'DOE JANE'))).toBe(false)
  })

  it('a mark is dropped when last month was issued again since', async () => {
    const { port } = dashboard()
    const month = august()
    await issue(port, month)
    const load = async () => {
      const loaded = await loadMonth(port, BRN, LAST_PERIOD)
      if (!loaded.ok) throw new Error(loaded.failure.title)
      return loaded.payslips
    }
    const first = compare(september(), await load())
    const marks = approveUnchanged({}, first)
    await issue(port, month, [0])
    const next = compare(september(), await load())
    expect(rowOf(next, 'DOE JANE')).toMatchObject({ status: 'unchanged', baselineRevision: 2 })
    expect(isReviewed(marks, next, rowOf(next, 'DOE JANE'))).toBe(false)
    expect(isReviewed(marks, next, rowOf(next, 'TEMPO LEA'))).toBe(true)
  })
})

describe('what the review asks for before the month is issued', () => {
  const gate = (state: BaselineState, comparison: MonthComparison | null, marks: ReviewMarks, selected = everyone) =>
    reviewProblems({ state, lastPeriod: LAST_PERIOD, comparison, marks, selected })

  it('last month must be loaded first; a failed load blocks, an empty month does not', () => {
    expect(gate({ status: 'not-asked' }, null, {})).toEqual(['Compare with August 2026 first, in the month review. Issuing waits for it.'])
    expect(gate({ status: 'loading', what: 'issued' }, null, {})).toEqual(['The comparison with August 2026 is still being loaded.'])
    expect(gate({ status: 'failed', what: 'issued', failure: failure('denied') }, null, {})).toEqual([
      'The comparison with August 2026 could not be loaded, so nothing is issued yet. Ask again in the month review.',
    ])
    expect(gate({ status: 'nothing' }, null, {})).toEqual([])
  })

  it('names what is left to review: changed and new ones, the unchanged ones to approve, and who left', async () => {
    const issued = await issuedAugust()
    const comparison = compare(september(), issued)
    expect(gate(ready(issued), comparison, {})).toEqual([
      '3 selected payslips are changed, new or not comparable and not reviewed yet: PALMYRE JEAN MARC, SAMPLE ALEX, EXEMPLE PRIYA.',
      '4 unchanged payslips are not approved yet. Approve them in the month review.',
      '1 employee who left is not acknowledged yet: ANCIEN PAUL.',
    ])
  })

  it('bulk-approve alone is not enough: Changed, New and Left still wait', async () => {
    const issued = await issuedAugust()
    const comparison = compare(september(), issued)
    expect(gate(ready(issued), comparison, approveUnchanged({}, comparison))).toEqual([
      '3 selected payslips are changed, new or not comparable and not reviewed yet: PALMYRE JEAN MARC, SAMPLE ALEX, EXEMPLE PRIYA.',
      '1 employee who left is not acknowledged yet: ANCIEN PAUL.',
    ])
  })

  it('is satisfied when every selected row is reviewed and everyone who left is acknowledged', async () => {
    const issued = await issuedAugust()
    const comparison = compare(september(), issued)
    const most = markAll(approveUnchanged({}, comparison), comparison, ['PALMYRE JEAN MARC', 'SAMPLE ALEX', 'EXEMPLE PRIYA'])
    expect(gate(ready(issued), comparison, most)).toEqual(['1 employee who left is not acknowledged yet: ANCIEN PAUL.'])
    expect(gate(ready(issued), comparison, markAll(most, comparison, ['ANCIEN PAUL']))).toEqual([])
  })

  it('an employee who is not selected needs no review; someone who left always needs acknowledging', async () => {
    const issued = await issuedAugust()
    const comparison = compare(september(), issued)
    expect(gate(ready(issued), comparison, {}, [1])).toEqual([
      '1 selected payslip is changed, new or not comparable and not reviewed yet: PALMYRE JEAN MARC.',
      '1 employee who left is not acknowledged yet: ANCIEN PAUL.',
    ])
    expect(gate(ready(issued), comparison, markAll({}, comparison, ['PALMYRE JEAN MARC', 'ANCIEN PAUL']), [1])).toEqual([])
  })

  it('a selected payslip that cannot be compared must be reviewed too', async () => {
    const issued = await issuedAugust()
    const broken = issued.map((payslip, index) => (index === 0 ? { ...payslip, lines: [{ kind: 'note' }, {}, {}] } : payslip))
    const comparison = compare(september(), broken)
    expect(gate(ready(broken), comparison, {}, [0])[0]).toBe('1 selected payslip is changed, new or not comparable and not reviewed yet: DOE JANE.')
  })

  it('nothing is asked while the pay month is not chosen', () => {
    expect(reviewProblems({ state: { status: 'not-asked' }, lastPeriod: null, comparison: null, marks: {}, selected: everyone })).toEqual([])
  })
})

describe('the review and the payslips to issue', () => {
  const build = (now: Month, month: IssuedPayslip[] = []): IssueBuild =>
    buildIssue({ data: now.data, period: PERIOD, prepared: now.prepared, selected: everyone, accepted: now.accepted, reasons: now.reasons, choice: now.choice, previewingDraft: false, rates: now.rates, month })

  it('blocks the issue with its reasons, after any reason the payslips themselves give', () => {
    const now = september()
    const fine = build(now)
    expect(fine.ok).toBe(true)
    expect(withReview(fine, [])).toBe(fine)
    expect(withReview(fine, ['Not reviewed.'])).toEqual({ ok: false, problems: ['Not reviewed.'] })
    const none = buildIssue({ data: now.data, period: PERIOD, prepared: now.prepared, selected: [], accepted: now.accepted, reasons: now.reasons, choice: now.choice, previewingDraft: false, rates: now.rates, month: [] })
    expect(withReview(none, ['Not reviewed.'])).toEqual({ ok: false, problems: ['Select at least one employee.', 'Not reviewed.'] })
  })

  it('never changes a payslip: what is issued is the same with or without a review', async () => {
    const now = september()
    const before = JSON.stringify(build(now))
    const issued = await issuedAugust()
    const comparison = compare(now, issued)
    const marks = markAll(approveUnchanged({}, comparison), comparison, ['PALMYRE JEAN MARC', 'SAMPLE ALEX', 'EXEMPLE PRIYA', 'ANCIEN PAUL'])
    expect(reviewProblems({ state: ready(issued), lastPeriod: LAST_PERIOD, comparison, marks, selected: everyone })).toEqual([])
    expect(JSON.stringify(withReview(build(now), []))).toBe(before)
  })

  it('an Unchanged employee still gets THIS month\'s payslip, not last month\'s with a new date', async () => {
    const now = september()
    const issued = await issuedAugust()
    expect(rowOf(compare(now, issued), 'DOE JANE').status).toBe('unchanged')
    const built = build(now)
    if (!built.ok) throw new Error(built.problems.join(' '))
    const mine = built.payslips[0]
    const last = issued.find((payslip) => payslip.nationalId === mine.nationalId)!
    expect(sameLines(mine.lines, last.lines)).toBe(false)
    const [thisMonth, lastMonth] = [decodeLines(mine.lines), decodeLines(last.lines)]
    if (!thisMonth.ok || !lastMonth.ok) throw new Error('not readable')
    expect(thisMonth.document.period).toBe('2026-09')
    expect(documentTexts(thisMonth.document)).toContain('Pay period: September 2026')
    expect(documentTexts(lastMonth.document)).toContain('Pay period: August 2026')
    // Every figure comes from September's payroll row, the source column named beside it.
    expect(thisMonth.figures.lines.find((line) => line.id === 'basic')).toMatchObject({ cents: 1800000, source: 'Basic Salary' })
    expect(mine.expectedRevision).toBe(0)
  })

  it('a reviewed month that was already issued is still asked about a second time', async () => {
    const { port } = dashboard()
    await issue(port, august())
    const now = september()
    await issue(port, now)
    const loaded = await loadMonth(port, BRN, PERIOD)
    if (!loaded.ok) throw new Error(loaded.failure.title)
    const again = withReview(build(now, loaded.payslips), [])
    if (!again.ok) throw new Error(again.problems.join(' '))
    expect(again.identical).toHaveLength(7)
    expect(identicalAsk(again.identical)).toMatchObject({ title: 'Issue 7 identical payslips again?', question: 'Nothing has changed since revision 1. Issue an identical revision 2 anyway?' })
  })
})
