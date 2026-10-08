// The month review's comparison: September 2026 beside August 2026 as it was issued. Statuses,
// line matching (by id in one template, by label across templates), a one-cent change, a template
// change, a rates change, and what cannot be compared. Fake data only (ABC Co Ltd).
import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUTORY_RATES } from '../src/data/defaultStatutoryRates'
import { preparePayslips } from '../src/lib/build'
import { ratesSnapshot, type IssuedPayslip } from '../src/lib/issueStore'
import type { IssuedFigure } from '../src/lib/issuedLines'
import {
  baselineFromIssued,
  compareLines,
  compareMonth,
  normaliseLabel,
  previousMonth,
  shownCents,
  signedCents,
  type MonthComparison,
  type ReviewRow,
} from '../src/lib/monthCompare'
import { templateOf } from '../src/lib/templateBody'
import { expectRecorded } from './helpers'
import { current, issuedAugust, LAST_PERIOD, OTHER, PERIOD, september, V1, V2_RENAMED, V3_ADDED } from './monthFixtures'

const names: Record<string, string> = { [V1.id]: V1.name, [OTHER.id]: OTHER.name }
const templateName = (id: string) => names[id] ?? null

async function review(now = september(), issued?: IssuedPayslip[]): Promise<MonthComparison> {
  return compareMonth(PERIOD, current(now), baselineFromIssued(LAST_PERIOD, issued ?? (await issuedAugust())), templateName)
}
const rowOf = (comparison: MonthComparison, name: string): ReviewRow => {
  const row = comparison.rows.find((found) => found.employeeName === name)
  if (!row) throw new Error(`No row for ${name}`)
  return row
}
const lineOf = (row: ReviewRow, label: string) => {
  const line = row.lines.find((found) => found.label === label)
  if (!line) throw new Error(`No line ${label}`)
  return line
}
const totalOf = (row: ReviewRow, id: string) => row.totals.find((found) => found.id === id)!
const changedLabels = (row: ReviewRow) => row.lines.filter((line) => line.changed).map((line) => line.label)

describe('last month', () => {
  it('is the calendar month before the pay month, across a year end too', () => {
    expect(previousMonth('2026-09')).toBe('2026-08')
    expect(previousMonth('2026-01')).toBe('2025-12')
    expect(previousMonth('2026-10')).toBe('2026-09')
    expect(previousMonth('2026-13')).toBeNull()
    expect(previousMonth('')).toBeNull()
  })
})

describe('one row per employee, with a status', () => {
  it('is exactly the recorded review of the two fake months', async () => {
    expectRecorded('month-review', await review())
  })

  it('says Unchanged, Changed, New or Left for each employee', async () => {
    const comparison = await review()
    expect(comparison.rows.map((row) => [row.employeeName, row.status])).toEqual([
      ['DOE JANE', 'unchanged'],
      ['PALMYRE JEAN MARC', 'changed'],
      ['SAMPLE ALEX', 'changed'],
      ['TESTER SAM', 'unchanged'],
      ['EXEMPLE PRIYA', 'new'],
      ['FICTIF MARIE', 'unchanged'],
      ['TEMPO LEA', 'unchanged'],
      ['ANCIEN PAUL', 'left'],
    ])
    expect(comparison.counts).toEqual({ unchanged: 4, changed: 2, new: 1, left: 1, 'cannot-compare': 0 })
    expect(comparison).toMatchObject({ period: PERIOD, lastPeriod: LAST_PERIOD, source: 'issued', banner: [] })
  })

  it('Unchanged: every line and every total is the same to the cent', async () => {
    const row = rowOf(await review(), 'DOE JANE')
    expect(row.lines).toHaveLength(12)
    expect(row.lines.every((line) => line.match === 'id' && line.difference === 0 && !line.changed)).toBe(true)
    expect(row.totals.map((total) => [total.id, total.last, total.current, total.difference, total.changed])).toEqual([
      ['earnings', 2108500, 2108500, 0, false],
      ['deductions', 49037, 49037, 0, false],
      ['net', 2059463, 2059463, 0, false],
    ])
    expect(row).toMatchObject({ matchedBy: 'id', baselineRevision: 1, notes: [], problem: null })
  })

  it('Changed: each changed line has last month, this month and the difference (hand-calculated)', async () => {
    const row = rowOf(await review(), 'PALMYRE JEAN MARC')
    expect(changedLabels(row)).toEqual(['Basic Salary', 'CSG', 'NSF'])
    // 19,480 - 18,365 = 1,115. CSG 301.72 - 285 = 16.72. NSF 201.15 - 190 = 11.15.
    expect(lineOf(row, 'Basic Salary')).toMatchObject({ last: 1836500, current: 1948000, difference: 111500, changed: true })
    expect(lineOf(row, 'CSG')).toMatchObject({ last: 28500, current: 30172, difference: 1672 })
    expect(lineOf(row, 'NSF')).toMatchObject({ last: 19000, current: 20115, difference: 1115 })
    expect(lineOf(row, 'Govt Increment')).toMatchObject({ last: 63500, current: 63500, difference: 0, changed: false })
    // Earnings 20,115 - 19,000. Deductions 502.87 - 475. Net 19,612.13 - 18,525.
    expect(row.totals.map((total) => total.difference)).toEqual([111500, 2787, 108713])
    expect(row.totals.every((total) => total.changed)).toBe(true)
  })

  it('a change of one cent is a change', async () => {
    const row = rowOf(await review(), 'SAMPLE ALEX')
    expect(row.status).toBe('changed')
    expect(changedLabels(row)).toEqual(['Transport Allowance'])
    expect(lineOf(row, 'Transport Allowance')).toMatchObject({ last: 120001, current: 120000, difference: -1, changed: true })
    expect(totalOf(row, 'earnings')).toMatchObject({ difference: -1, changed: true })
    expect(totalOf(row, 'deductions')).toMatchObject({ difference: 0, changed: false })
    expect(totalOf(row, 'net')).toMatchObject({ last: 3356339, current: 3356338, difference: -1, changed: true })
    expect(signedCents(-1)).toBe('-0.01')
    expect(shownCents(120001)).toBe('1,200.01')
  })

  it('New: on this month\'s payroll, with no payslip last month; the lines show this month only', async () => {
    const row = rowOf(await review(), 'EXEMPLE PRIYA')
    expect(row).toMatchObject({ status: 'new', baselineRevision: null, matchedBy: null })
    expect(row.rowIndex).toBe(4)
    expect(row.lines.every((line) => line.last === null && line.difference === null && !line.changed)).toBe(true)
    expect(lineOf(row, 'Basic Salary').current).toBe(4936501)
    expect(totalOf(row, 'net')).toMatchObject({ last: null, current: 4695291, difference: null })
  })

  it('Left: issued last month and not in this month\'s data; named from the stored payslip', async () => {
    const row = rowOf(await review(), 'ANCIEN PAUL')
    expect(row).toMatchObject({ status: 'left', rowIndex: null, baselineRevision: 1, key: 'left-X0000000000008' })
    expect(row.lines.every((line) => line.current === null && line.difference === null)).toBe(true)
    expect(lineOf(row, 'Basic Salary').last).toBe(2436500)
    expect(totalOf(row, 'net')).toMatchObject({ last: 2437500, current: null })
  })

  it('an employee left out of this month\'s data is Left, and nobody is listed twice', async () => {
    const now = september()
    const fewer = { ...now, data: { ...now.data, rows: now.data.rows.slice(0, 2) }, prepared: now.prepared.slice(0, 2) }
    const comparison = await review(fewer)
    expect(comparison.rows.map((row) => [row.employeeName, row.status])).toEqual([
      ['DOE JANE', 'unchanged'],
      ['PALMYRE JEAN MARC', 'changed'],
      ['SAMPLE ALEX', 'left'],
      ['TESTER SAMUEL', 'left'],
      ['FICTIF MARIE', 'left'],
      ['TEMPO LEA', 'left'],
      ['ANCIEN PAUL', 'left'],
    ])
    expect(new Set(comparison.rows.map((row) => row.key)).size).toBe(comparison.rows.length)
  })
})

describe('what is not money is a note, never a status', () => {
  it('a name written another way last month', async () => {
    const row = rowOf(await review(), 'TESTER SAM')
    expect(row.status).toBe('unchanged')
    expect(row.notes).toEqual(['Name: "TESTER SAMUEL" last month, "TESTER SAM" now.'])
  })

  it('a date of employment that is not the one printed last month', async () => {
    const row = rowOf(await review(), 'FICTIF MARIE')
    expect(row.status).toBe('unchanged')
    expect(row.notes).toEqual(['Date of employment: 1-Feb-18 last month, none now.'])
  })
})

describe('a template change', () => {
  it('a new version of the same template: lines are matched by id, the reworded label is a note, and a banner says so', async () => {
    const comparison = await review(september(V2_RENAMED))
    const row = rowOf(comparison, 'DOE JANE')
    expect(row).toMatchObject({ status: 'unchanged', matchedBy: 'id' })
    expect(lineOf(row, 'Travelling allowance')).toMatchObject({ match: 'id', lastLabel: 'Transport Allowance', last: 245000, current: 245000, changed: false })
    expect(row.notes).toEqual(['"Transport Allowance" last month is "Travelling allowance" now.', 'Template: version 1 last month, version 2 now.'])
    expect(comparison.banner).toEqual([
      {
        kind: 'template',
        text: 'The template version is not the one August 2026 was issued with. Lines are still matched by their ids.',
        details: ['August 2026: 7 payslips with this template, version 1.', 'September 2026: Monthly payslip, version 2.'],
      },
    ])
    // The statuses are the ones of the unchanged template: a reworded label changes nobody.
    expect(comparison.counts).toEqual({ unchanged: 4, changed: 2, new: 1, left: 1, 'cannot-compare': 0 })
  })

  it('a line that last month did not have is listed as not matched, and makes the row Changed', async () => {
    const comparison = await review(september(V3_ADDED))
    const row = rowOf(comparison, 'DOE JANE')
    expect(row.status).toBe('changed')
    expect(lineOf(row, 'Night shift')).toEqual({
      side: 'earnings',
      label: 'Night shift',
      lastLabel: null,
      match: 'only-current',
      unmatched: "Not on last month's payslip.",
      last: null,
      current: 0,
      difference: null,
      changed: true,
    })
    expect(row.totals.every((total) => !total.changed)).toBe(true)
    expect(comparison.counts).toMatchObject({ unchanged: 0, changed: 6 })
  })

  it('a line this month no longer has is listed too, with last month\'s amount', async () => {
    const comparison = await review(september(V1), await issuedAugust(V3_ADDED))
    const line = lineOf(rowOf(comparison, 'DOE JANE'), 'Night shift')
    expect(line).toMatchObject({ match: 'only-last', unmatched: "Not on this month's payslip.", last: 0, current: null, changed: true })
  })

  it('ANOTHER template: lines are matched by label, not by id, and the banner says so', async () => {
    const comparison = await review(september(OTHER))
    const row = rowOf(comparison, 'DOE JANE')
    // In the other template the id "allowances" is the line called Transport Allowance (2,450).
    expect(row).toMatchObject({ status: 'unchanged', matchedBy: 'label' })
    expect(lineOf(row, 'Transport Allowance')).toMatchObject({ match: 'label', last: 245000, current: 245000, difference: 0 })
    expect(lineOf(row, 'Allowances')).toMatchObject({ match: 'label', last: 0, current: 0 })
    // Capitals and extra spaces are ignored; the label shown is this month's, the old one is a note.
    expect(lineOf(row, 'basic  SALARY')).toMatchObject({ match: 'label', lastLabel: 'Basic Salary', last: 1800000, current: 1800000, changed: false })
    expect(row.notes).toContain('Template: another template last month, so the lines are matched by label.')
    expect(comparison.banner[0]).toEqual({
      kind: 'template',
      text: 'Some of August 2026 was issued with another template. Those payslips are compared line by line by label.',
      details: ['August 2026: 7 payslips with Monthly payslip, version 1.', 'September 2026: Payslip B, version 1.'],
    })
    expect(comparison.counts).toEqual({ unchanged: 4, changed: 2, new: 1, left: 1, 'cannot-compare': 0 })
  })
})

describe('matching lines by label', () => {
  const line = (id: string, label: string, cents: number, side: IssuedFigure['side'] = 'earnings'): IssuedFigure => ({ id, label, side, cents, source: null, status: 'ok' })

  it('ignores capitals and extra spaces, and nothing else', () => {
    expect(normaliseLabel('  Basic   SALARY ')).toBe('basic salary')
    expect(normaliseLabel('Absences :')).not.toBe(normaliseLabel('Absences'))
  })

  it('a label with no partner is listed on both sides as not matched, with its amount', () => {
    const lines = compareLines([line('a', 'Advance', 50000)], [line('b', 'Salary advance', 50000)], 'label')
    expect(lines).toEqual([
      { side: 'earnings', label: 'Salary advance', lastLabel: null, match: 'only-current', unmatched: 'No line with this label last month.', last: null, current: 50000, difference: null, changed: true },
      { side: 'earnings', label: 'Advance', lastLabel: null, match: 'only-last', unmatched: 'No line with this label this month.', last: 50000, current: null, difference: null, changed: true },
    ])
  })

  it('a label used twice is not matched, rather than paired by guess', () => {
    const lines = compareLines([line('a', 'Bonus', 100), line('b', 'Bonus', 200)], [line('c', 'bonus', 100)], 'label')
    expect(lines.map((found) => [found.match, found.unmatched, found.last, found.current])).toEqual([
      ['only-current', 'More than one line has this label, so it is not matched.', null, 100],
      ['only-last', 'More than one line has this label, so it is not matched.', 100, null],
      ['only-last', 'More than one line has this label, so it is not matched.', 200, null],
    ])
  })

  it('the same label on the other side of the page is another line', () => {
    const lines = compareLines([line('a', 'Advance', 100, 'earnings')], [line('a', 'Advance', 100, 'deductions')], 'label')
    expect(lines.map((found) => [found.side, found.match])).toEqual([
      ['earnings', 'only-last'],
      ['deductions', 'only-current'],
    ])
  })

  it('by id, a reworded line is still the same line', () => {
    const lines = compareLines([line('a', 'Advance', 100)], [line('a', 'Salary advance', 150)], 'id')
    expect(lines).toEqual([
      { side: 'earnings', label: 'Salary advance', lastLabel: 'Advance', match: 'id', unmatched: null, last: 100, current: 150, difference: 50, changed: true },
    ])
  })
})

describe('a rates change', () => {
  it('is a banner and a note; it changes no status, because no figure comes from the rates', async () => {
    const now = september()
    const newer = { ...ratesSnapshot(now.rates)!, effective_from: '2026-09', revision: 2, nsf_ceiling: 30000 }
    const comparison = compareMonth(PERIOD, current(now, newer), baselineFromIssued(LAST_PERIOD, await issuedAugust()), templateName)
    expect(comparison.counts).toEqual({ unchanged: 4, changed: 2, new: 1, left: 1, 'cannot-compare': 0 })
    expect(comparison.banner).toEqual([
      {
        kind: 'rates',
        text: 'The statutory rates version is not the one August 2026 was cross-checked with. Rates only feed the cross-check warnings: no figure on a payslip comes from them.',
        details: [
          'August 2026: 7 payslips cross-checked with the rates of January 2026, revision 1.',
          'September 2026: the rates of September 2026, revision 2.',
          'NSF ceiling: 29,710 then, 30,000 now.',
        ],
      },
    ])
    expect(rowOf(comparison, 'DOE JANE').notes).toEqual(['Cross-check: the rates of January 2026, revision 1 last month, the rates of September 2026, revision 2 now.'])
    expect(rowOf(comparison, 'DOE JANE').status).toBe('unchanged')
  })

  it('a month that was not cross-checked is said so', async () => {
    const comparison = compareMonth(PERIOD, current(september(), null), baselineFromIssued(LAST_PERIOD, await issuedAugust()), templateName)
    expect(comparison.banner[0].details).toEqual([
      'August 2026: 7 payslips cross-checked with the rates of January 2026, revision 1.',
      'September 2026: not cross-checked.',
    ])
  })
})

describe('what cannot be compared is said, never guessed', () => {
  it('a stored payslip in a format this app does not know', async () => {
    const issued = await issuedAugust()
    const broken = issued.map((payslip, index) => (index === 0 ? { ...payslip, lines: [{ ...(payslip.lines[0] as object), format: 2 }, ...payslip.lines.slice(1)] } : payslip))
    const row = rowOf(await review(september(), broken), 'DOE JANE')
    expect(row).toMatchObject({ status: 'cannot-compare', lines: [], totals: [], baselineRevision: 1 })
    expect(row.problem).toBe('This payslip was issued by a newer version of the app (format 2). This version reads format 1.')
  })

  it('a stored payslip that fails its checks, even by one unknown key', async () => {
    const issued = await issuedAugust()
    const broken = issued.map((payslip, index) => (index === 1 ? { ...payslip, lines: [payslip.lines[0], { ...(payslip.lines[1] as object), extra: 1 }, ...payslip.lines.slice(2)] } : payslip))
    const row = rowOf(await review(september(), broken), 'PALMYRE JEAN MARC')
    expect(row.status).toBe('cannot-compare')
    expect(row.problem).toBe('The stored payslip does not match its format. It is not shown, rather than guessed at.')
  })

  it('a stored payslip of another month than the one asked for', async () => {
    const baseline = baselineFromIssued('2026-07', await issuedAugust())
    expect(baseline.payslips.every((payslip) => payslip.side === null)).toBe(true)
    expect(baseline.payslips[0].problem).toBe('The stored payslip is for August 2026, not July 2026. It is not compared.')
  })

  it('a payslip of this month with a figure in error', async () => {
    const now = september()
    const rows = now.data.rows.map((row, index) => (index === 0 ? Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'Employee CSG')) : row))
    const broken = { ...now, data: { ...now.data, rows } }
    const { template, mapping } = templateOf(V1.body, { id: V1.id, name: V1.name, version: 'v1' })
    broken.prepared = preparePayslips(broken.data, { template, mapping, rateVersions: DEFAULT_STATUTORY_RATES, period: PERIOD }, '2026-09-28')
    const row = rowOf(await review(broken), 'DOE JANE')
    expect(row.status).toBe('cannot-compare')
    expect(row.problem).toBe("This month's payslip has a figure to fix first, so there is nothing to compare yet.")
  })

  it('someone who left is still listed when their stored payslip cannot be read', async () => {
    const issued = await issuedAugust()
    const broken = issued.map((payslip) => (payslip.nationalId === 'X0000000000008' ? { ...payslip, lines: [{ kind: 'note' }, {}, {}] } : payslip))
    const comparison = await review(september(), broken)
    const row = comparison.rows.find((found) => found.key === 'left-X0000000000008')!
    expect(row).toMatchObject({ status: 'left', employeeName: 'An employee whose payslip cannot be read', lines: [] })
    expect(row.problem).toMatch(/not issued by this app/)
  })
})

describe('the review only reads', () => {
  it('leaves this month\'s payslips and last month\'s stored ones exactly as they were', async () => {
    const now = september()
    const issued = await issuedAugust()
    const before = JSON.stringify([now.prepared, issued])
    compareMonth(PERIOD, current(now), baselineFromIssued(LAST_PERIOD, issued), templateName)
    expect(JSON.stringify([now.prepared, issued])).toBe(before)
  })
})
