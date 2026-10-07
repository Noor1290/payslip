// The body of a stored template: what is in it (recorded), what can never be in it, and that
// the built-in Table template gives exactly the same payslips when it goes through a body.
import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUTORY_RATES } from '../src/data/defaultStatutoryRates'
import { computeAll, documentFor } from '../src/lib/build'
import { DEFAULT_TABLE_MAPPING, FIXED_LINES, NEVER_MAP, TABLE_TEMPLATE } from '../src/lib/template'
import {
  bodyChanges,
  bodyOf,
  bodyProblems,
  bodyRows,
  BUILT_IN_BODY,
  MAX_BODY_ROWS,
  nameProblem,
  readBody,
  sameBody,
  templateOf,
  type TemplateBody,
} from '../src/lib/templateBody'
import { fixtureDocuments, ISSUE_DATE, PERIOD } from './fixtureDocuments'
import { expectRecorded, loadFixture, readRecorded } from './helpers'

const clone = (): TemplateBody => JSON.parse(JSON.stringify(BUILT_IN_BODY)) as TemplateBody
const problemsOf = (change: (body: TemplateBody) => void): string[] => {
  const body = clone()
  change(body)
  const read = readBody(body)
  return read.ok ? [] : read.problems
}
/** As the database returns a body: jsonb keeps its own key order. */
const reordered = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(reordered)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().reverse().map((key) => [key, reordered((value as Record<string, unknown>)[key])]))
      : value

describe('the stored template body', () => {
  it('is exactly the recorded one for the built-in Table template', () => {
    expectRecorded('template-body', BUILT_IN_BODY)
  })

  it('holds labels, lines and columns only: no figure, no rate, no image', () => {
    const numbers: unknown[] = []
    const walk = (value: unknown): void => {
      if (typeof value === 'number') numbers.push(value)
      else if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === 'object') Object.values(value).forEach(walk)
    }
    walk(BUILT_IN_BODY)
    // The only number is the format number.
    expect(numbers).toEqual([1])
    expect(JSON.stringify(BUILT_IN_BODY)).not.toMatch(/data:/)
    expect(Object.keys(BUILT_IN_BODY).sort()).toEqual(['deductionGroups', 'earnings', 'kind', 'labels', 'mapping', 'schema'])
    // The rules that are fixed in code are not in it.
    const text = JSON.stringify(BUILT_IN_BODY)
    for (const absent of ['neverMap', 'required', 'aliases', 'checks', 'Total deductions', 'Net Pay"', 'Age 60+', 'formula']) {
      expect(text.includes(absent), absent).toBe(false)
    }
  })

  it('reads back to exactly the built-in template and mapping, whatever order the keys are stored in', () => {
    for (const stored of [BUILT_IN_BODY, reordered(BUILT_IN_BODY), JSON.parse(JSON.stringify(BUILT_IN_BODY))]) {
      const read = readBody(stored)
      if (!read.ok) throw new Error(read.problems.join(' '))
      const { template, mapping } = templateOf(read.body, { id: 'table', name: 'Table', version: 'built-in-1' })
      expect(template).toEqual(TABLE_TEMPLATE)
      expect(mapping).toEqual(DEFAULT_TABLE_MAPPING)
      expect(sameBody(stored, BUILT_IN_BODY)).toBe(true)
    }
    expect(bodyOf(TABLE_TEMPLATE, DEFAULT_TABLE_MAPPING)).toEqual(BUILT_IN_BODY)
  })

  it('gives the recorded layout model, unchanged, when the built-in template goes through a body', () => {
    const read = readBody(reordered(BUILT_IN_BODY))
    if (!read.ok) throw new Error(read.problems.join(' '))
    const { template, mapping } = templateOf(read.body, { id: 'table', name: 'Table', version: 'built-in-1' })
    const data = loadFixture()
    const documents = computeAll(data, { template, mapping, rateVersions: DEFAULT_STATUTORY_RATES, period: PERIOD }).map((c) =>
      documentFor(data, c, template, PERIOD, ISSUE_DATE),
    )
    expect(documents).toEqual(fixtureDocuments())
    expect(JSON.parse(JSON.stringify(documents))).toEqual(readRecorded('layout-model'))
  })

  it('keeps the old column names as aliases, with the "old name" warning, for any stored template', () => {
    const { mapping } = templateOf(clone(), { id: 'x', name: 'Monthly payslip', version: 'v1' })
    expect(mapping.lines.csg).toEqual({ key: 'Employee CSG', aliases: ['CSG - 1.5 %/ 3%'], required: true })
    expect(mapping.lines.nsf).toEqual({ key: 'Employee NSF', aliases: ['NSF - 1%'], required: true })
    expect(mapping.neverMap).toEqual(NEVER_MAP)
    expect(mapping.checks).toEqual({ gross: 'Gross Pay', deductions: 'Total deductions', net: 'Net Pay' })
    expect(Object.keys(FIXED_LINES)).toEqual(['csg', 'nsf', 'paye'])
  })
})

describe('a body is refused on load, with a message naming the problem', () => {
  it('when a line is mapped to a never-map column', () => {
    for (const column of NEVER_MAP) {
      const problems = problemsOf((body) => (body.mapping.lines.transport.key = column))
      expect(problems.join(' '), column).toContain(`The line "Transport Allowance" is mapped to "${column}", a column that must never be on a payslip`)
    }
    // Whatever the capitals or spaces.
    expect(problemsOf((body) => (body.mapping.lines.csg.key = ' csg ')).join(' ')).toContain('must never be on a payslip')
  })

  it.each([
    ['csg', 'Employee CSG'],
    ['nsf', 'Employee NSF'],
    ['paye', 'PAYE'],
  ])('when the required line %s is removed', (id, name) => {
    const problems = problemsOf((body) => {
      body.deductionGroups[0].lines = body.deductionGroups[0].lines.filter((line) => line.id !== id)
      delete body.mapping.lines[id]
    })
    expect(problems).toContain(`The ${name} line is missing from the deductions. Employee CSG, Employee NSF and PAYE cannot be removed.`)
  })

  it('when a required line is moved to the earnings, or left unmapped', () => {
    expect(
      problemsOf((body) => {
        const [csg] = body.deductionGroups[0].lines.splice(0, 1)
        body.earnings.push(csg)
      }).join(' '),
    ).toContain('The Employee CSG line is missing from the deductions')
    expect(problemsOf((body) => (body.mapping.lines.nsf.key = null))).toContain('The Employee NSF line is not mapped to a payroll column.')
  })

  it('when it fails the schema: an unknown field, a wrong type, a total made editable', () => {
    expect(problemsOf((body) => Object.assign(body, { totals: { netPay: 'Gross Pay' } }))).toEqual(['Unexpected field in the template.'])
    expect(problemsOf((body) => Object.assign(body.mapping, { checks: { net: 'Basic Salary' } }))).toEqual(['Unexpected field in mapping.'])
    expect(problemsOf((body) => Object.assign(body.mapping.lines.csg, { required: false }))).toEqual(['Unexpected field in mapping.lines.csg.'])
    expect(problemsOf((body) => Object.assign(body.earnings[0], { formula: 'A1+A2' }))).toEqual(['Unexpected field in earnings.0.'])
    expect(problemsOf((body) => Object.assign(body.labels, { title: 12 }))).toEqual(['"labels.title" is missing or not valid.'])
    expect(problemsOf((body) => (body.earnings = []))).toEqual(['"earnings" is missing or not valid.'])
    expect(readBody('a template')).toEqual({ ok: false, problems: ['The template body is not an object.'] })
  })

  it('when it is in another format: never guessed', () => {
    expect(problemsOf((body) => Object.assign(body, { schema: 2 }))).toEqual([
      'This template was saved by a newer version of the app (format 2). This version reads format 1.',
    ])
    expect(readBody({ title: 'Payslip', lines: [] })).toEqual({
      ok: false,
      problems: ['This is not a payslip template this app can read (it has no known format number).'],
    })
  })

  it('when lines and mapping do not agree, an id is used twice, or an id belongs to the totals', () => {
    expect(problemsOf((body) => delete body.mapping.lines.advance)).toContain('The line "Advance" has no mapping entry.')
    expect(problemsOf((body) => (body.mapping.lines.ghost = { key: 'Basic Salary' }))).toContain('There is a mapping for "ghost", which is not a line of this template.')
    expect(problemsOf((body) => body.earnings.push({ id: 'basic', label: 'Basic again' })).join(' ')).toContain('Two lines share the id "basic"')
    expect(
      problemsOf((body) => {
        body.earnings.push({ id: 'netPay', label: 'Net' })
        body.mapping.lines.netPay = { key: null }
      }).join(' '),
    ).toContain('uses the id "netPay", which belongs to the totals')
  })

  it('when it holds an image, or more lines than fit on the page', () => {
    expect(problemsOf((body) => (body.labels.title = 'data:image/png;base64,iVBORw0KGgo='))).toContain(
      'A template cannot contain images or other embedded files.',
    )
    const problems = problemsOf((body) => {
      for (let n = 0; body.earnings.length <= MAX_BODY_ROWS; n++) {
        body.earnings.push({ id: `extra${n}`, label: `Extra ${n}` })
        body.mapping.lines[`extra${n}`] = { key: null }
      }
    })
    expect(problems.join(' ')).toMatch(/earnings|only 20 fit on the page/)
    expect(bodyRows(BUILT_IN_BODY)).toBe(9)
  })

  it('and a good body has no problems', () => {
    expect(bodyProblems(BUILT_IN_BODY)).toEqual([])
    expect(readBody(clone()).ok).toBe(true)
  })
})

describe('names and changes', () => {
  it('a name is 1 to 80 characters once trimmed, and not one the company already uses', () => {
    expect(nameProblem('  ')).toBe('Give the template a name.')
    expect(nameProblem('x'.repeat(81))).toContain('80 characters')
    expect(nameProblem('x'.repeat(80))).toBeNull()
    expect(nameProblem(' monthly PAYSLIP ', ['Monthly payslip'])).toBe('This company already has a template with that name.')
    expect(nameProblem('Weekly payslip', ['Monthly payslip'])).toBeNull()
  })

  it('what changed between two bodies is listed in words', () => {
    const mine = clone()
    mine.labels.title = 'Pay advice'
    mine.mapping.lines.advance.key = 'Advance'
    mine.earnings.push({ id: 'bonus', label: 'Year-end bonus' })
    mine.mapping.lines.bonus = { key: null }
    mine.deductionGroups[1].lines = mine.deductionGroups[1].lines.filter((line) => line.id !== 'lateness')
    delete mine.mapping.lines.lateness
    expect(bodyChanges(BUILT_IN_BODY, mine)).toEqual([
      { what: 'Label "Payslip"', before: 'Payslip', after: 'Pay advice' },
      { what: 'Payroll column of "Advance"', before: 'Not mapped', after: 'Advance' },
      { what: 'Line "Lateness"', before: 'In Deductions, Others Deductions :', after: 'Removed' },
      { what: 'Line "Year-end bonus"', before: 'Not there', after: 'Added to Earnings, column: Not mapped' },
    ])
    expect(bodyChanges(BUILT_IN_BODY, clone())).toEqual([])

    const moved = clone()
    moved.earnings.reverse()
    expect(bodyChanges(BUILT_IN_BODY, moved).map((change) => change.what)).toEqual(['Order of the lines'])
  })
})
