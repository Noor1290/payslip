// The editor's moves: every one gives a body that is still valid, and none can remove a required
// line, touch the totals or put more lines on the page than fit.
import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUTORY_RATES } from '../src/data/defaultStatutoryRates'
import { computeAll, documentFor } from '../src/lib/build'
import { BUILT_IN_BODY, bodyProblems, bodyRows, MAX_BODY_ROWS, templateOf, type TemplateBody } from '../src/lib/templateBody'
import {
  addLine,
  canAddLine,
  canRemoveLine,
  moveLine,
  removeLine,
  setCrossCheckBase,
  setGroupLabel,
  setLabel,
  setLineKey,
  setLineLabel,
} from '../src/lib/templateEdit'
import { ISSUE_DATE, PERIOD } from './fixtureDocuments'
import { loadFixture } from './helpers'

const ids = (body: TemplateBody) => [body.earnings.map((l) => l.id), ...body.deductionGroups.map((g) => g.lines.map((l) => l.id))]

describe('editing a template', () => {
  it('changes a label, a line label, a group label and a mapping, and nothing else', () => {
    let body = setLabel(BUILT_IN_BODY, 'title', 'Pay advice')
    body = setLineLabel(body, 'transport', 'Travel allowance')
    body = setGroupLabel(body, 1, 'Other deductions')
    body = setLineKey(body, 'advance', 'Allowances')
    expect(body.labels.title).toBe('Pay advice')
    expect(body.earnings.find((l) => l.id === 'transport')?.label).toBe('Travel allowance')
    expect(body.deductionGroups[1].label).toBe('Other deductions')
    expect(body.mapping.lines.advance).toEqual({ key: 'Allowances' })
    expect(ids(body)).toEqual(ids(BUILT_IN_BODY))
    expect(bodyProblems(body)).toEqual([])
    // The body that was edited is not changed in place.
    expect(BUILT_IN_BODY.labels.title).toBe('Payslip')
  })

  it('a new choice of column is no longer "to confirm"; the same choice keeps the note', () => {
    expect(BUILT_IN_BODY.mapping.lines.transport).toEqual({ key: 'Travelling', toConfirm: true })
    expect(setLineKey(BUILT_IN_BODY, 'transport', 'Travelling').mapping.lines.transport).toEqual({ key: 'Travelling', toConfirm: true })
    expect(setLineKey(BUILT_IN_BODY, 'transport', 'Allowances').mapping.lines.transport).toEqual({ key: 'Allowances' })
    expect(setCrossCheckBase(BUILT_IN_BODY, 'nsfBase', 'New Basic Salary').mapping.crossCheck).toEqual({
      csgBase: 'New Basic Salary',
      nsfBase: 'New Basic Salary',
      nsfBaseToConfirm: false,
    })
  })

  it('moves a line inside its own list only', () => {
    expect(moveLine(BUILT_IN_BODY, 'increment', -1).earnings.map((l) => l.id).slice(0, 2)).toEqual(['increment', 'basic'])
    expect(moveLine(BUILT_IN_BODY, 'basic', -1)).toEqual(BUILT_IN_BODY)
    expect(moveLine(BUILT_IN_BODY, 'paye', 1)).toEqual(BUILT_IN_BODY)
    expect(moveLine(BUILT_IN_BODY, 'csg', 1).deductionGroups[0].lines.map((l) => l.id)).toEqual(['nsf', 'csg', 'paye'])
  })

  it('adds an unmapped line, and removes a line together with its mapping', () => {
    const added = addLine(BUILT_IN_BODY, { side: 'earnings' }, 'line-bonus')
    expect(added.earnings.at(-1)).toEqual({ id: 'line-bonus', label: 'New line' })
    expect(added.mapping.lines['line-bonus']).toEqual({ key: null })
    expect(bodyProblems(added)).toEqual([])
    expect(addLine(added, { side: 'earnings' }, 'line-bonus')).toBe(added)

    const inGroup = addLine(BUILT_IN_BODY, { side: 'deductions', group: 1 }, 'line-loan')
    expect(inGroup.deductionGroups[1].lines.map((l) => l.id)).toEqual(['absences', 'lateness', 'line-loan'])

    const removed = removeLine(added, 'presenceBonus')
    expect(removed.earnings.some((l) => l.id === 'presenceBonus')).toBe(false)
    expect('presenceBonus' in removed.mapping.lines).toBe(false)
    expect(bodyProblems(removed)).toEqual([])
  })

  it('never removes Employee CSG, Employee NSF or PAYE', () => {
    for (const id of ['csg', 'nsf', 'paye']) {
      expect(canRemoveLine(id)).toBe(false)
      expect(removeLine(BUILT_IN_BODY, id)).toBe(BUILT_IN_BODY)
    }
    expect(canRemoveLine('advance')).toBe(true)
  })

  it('stops adding lines when the page is full', () => {
    let body = BUILT_IN_BODY
    for (let n = 0; n < 40; n++) body = addLine(body, { side: 'earnings' }, `line-${n}`)
    expect(body.earnings).toHaveLength(MAX_BODY_ROWS)
    expect(bodyRows(body)).toBe(MAX_BODY_ROWS)
    expect(canAddLine(body, { side: 'earnings' })).toBe(false)
    expect(canAddLine(body, { side: 'deductions', group: 1 })).toBe(true)
    expect(bodyProblems(body)).toEqual([])
  })

  it('the totals follow the lines shown: an added, mapped line is added in; a removed line is left out', () => {
    const data = loadFixture()
    const totalsOf = (body: TemplateBody) => {
      const { template, mapping } = templateOf(body, { id: 'x', name: 'Test', version: 'draft-1' })
      const [first] = computeAll(data, { template, mapping, rateVersions: DEFAULT_STATUTORY_RATES, period: PERIOD })
      const doc = documentFor(data, first, template, PERIOD, ISSUE_DATE)
      const totals = doc.rows.find((row) => row.id === 'totals')!.cells
      return { totals: first.totals!, earningsFormula: totals[1].formula!.lineIds, deductionsFormula: totals[3].formula!.lineIds }
    }
    const base = totalsOf(BUILT_IN_BODY)
    const basic = Math.round(Number(data.rows[0]['Basic Salary']) * 100)

    const twice = totalsOf(setLineKey(addLine(BUILT_IN_BODY, { side: 'earnings' }, 'line-again'), 'line-again', 'Basic Salary'))
    expect(twice.totals.earnings).toBe(base.totals.earnings + basic)
    expect(twice.totals.net).toBe(base.totals.net + basic)
    expect(twice.earningsFormula).toEqual([...base.earningsFormula, 'line-again'])

    const without = totalsOf(removeLine(BUILT_IN_BODY, 'basic'))
    expect(without.totals.earnings).toBe(base.totals.earnings - basic)
    expect(without.earningsFormula).toEqual(base.earningsFormula.filter((id) => id !== 'basic'))
    expect(without.deductionsFormula).toEqual(base.deductionsFormula)
  })
})
