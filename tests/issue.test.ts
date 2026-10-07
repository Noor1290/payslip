// Issuing a month and opening it again, against the stand-in dashboard: the exact message, each
// refusal (with the position of the payslip at fault), "locked", the reload rule, the limits, and
// that a reopened payslip is identical to the one issued. Fake data only (ABC Co Ltd).
import { describe, expect, it } from 'vitest'
import { DEFAULT_STATUTORY_RATES } from '../src/data/defaultStatutoryRates'
import { preparePayslips, type PreparedPayslip } from '../src/lib/build'
import { failure, jsonBytes, type HubPort } from '../src/lib/hubWire'
import { buildIssue, monthProblems, type IssueInput } from '../src/lib/issueBuild'
import { decodeLines } from '../src/lib/issuedLines'
import {
  checkIssue,
  issueBatch,
  issueRow,
  judgeIssue,
  loadMonth,
  MESSAGE_MAX_BYTES,
  PAYSLIP_MAX_BYTES,
  planIssue,
  wirePayslip,
  type PayslipToIssue,
  type PendingIssue,
} from '../src/lib/issueStore'
import type { AcceptedChecks } from '../src/lib/payslip'
import { checkKey, ROUNDING_REASON, withReason, zeroKey, type Reasons } from '../src/lib/reasons'
import { ratesFor } from '../src/lib/statutoryRates'
import { BUILT_IN_BODY, templateOf } from '../src/lib/templateBody'
import type { TemplateChoice } from '../src/lib/templateUse'
import { layoutPage } from '../src/writers/pageGeometry'
import { writePayslipPdf } from '../src/writers/pdfWriter'
import { BRN, fakeHub } from './fakeHubPort'
import { ISSUE_DATE, PERIOD } from './fixtureDocuments'
import { expectRecorded, loadFixture, readFont } from './helpers'
import { readPdf } from './readPdf'

const TEMPLATE_ID = '20000000-0000-4000-8000-000000000001'
const choice: TemplateChoice = { kind: 'published', templateId: TEMPLATE_ID, name: 'Monthly payslip', version: 1, body: BUILT_IN_BODY }
const { template, mapping } = templateOf(BUILT_IN_BODY, { id: TEMPLATE_ID, name: 'Monthly payslip', version: 'v1' })
const rates = ratesFor(DEFAULT_STATUTORY_RATES, PERIOD)
const data = loadFixture()
const prepared: PreparedPayslip[] = preparePayslips(data, { template, mapping, rateVersions: DEFAULT_STATUTORY_RATES, period: PERIOD }, ISSUE_DATE)
const everyone = data.rows.map((_, index) => index)

/** Every rounding difference of the fixture accepted, each with the fixed reason. */
function roundingAccepted(): { accepted: Record<number, AcceptedChecks>; reasons: Reasons } {
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
const input = (change: Partial<IssueInput> = {}): IssueInput => ({
  data,
  period: PERIOD,
  prepared,
  selected: everyone,
  ...roundingAccepted(),
  choice,
  previewingDraft: false,
  rates,
  month: [],
  ...change,
})
const built = (change: Partial<IssueInput> = {}): PayslipToIssue[] => {
  const result = buildIssue(input(change))
  if (!result.ok) throw new Error(result.problems.join(' '))
  return result.payslips
}
const pendingFor = (payslips: PayslipToIssue[]): PendingIssue => ({ brn: BRN, period: PERIOD, payslips })

/** A dashboard whose company has the template published, and every fake employee on its books. */
function dashboard() {
  const made = fakeHub()
  made.hub.state.templates.push({ id: TEMPLATE_ID, name: 'Monthly payslip', body: { ...BUILT_IN_BODY }, revision: 1, updatedAt: '2026-10-07T09:00:00+04:00', by: 'you' })
  made.hub.state.versions.push({ templateId: TEMPLATE_ID, version: 1, name: 'Monthly payslip', body: { ...BUILT_IN_BODY }, publishedAt: '2026-10-07T09:05:00+04:00', by: 'you' })
  made.hub.state.employees = data.rows.map((row) => String(row.ID))
  const sends = () => made.sent().filter((entry) => entry.startsWith('send-data')).length
  const loads = () => made.sent().filter((entry) => entry.startsWith('request-data payslip-issue')).length
  return { ...made, sends, loads }
}

describe('the issue message', () => {
  it('is exactly the recorded one for two fake employees', async () => {
    const { hub, port } = dashboard()
    await issueBatch(port, pendingFor(built({ selected: [0, 1] })))
    expectRecorded('issue-message', hub.state.log[0])
  })

  it('is one row for the month; each payslip has exactly the seven agreed keys and no name', () => {
    const row = issueRow(pendingFor(built()))
    expect(Object.keys(row)).toEqual(['action', 'brn', 'period', 'payslips'])
    expect(row).toMatchObject({ action: 'issue', brn: BRN, period: PERIOD })
    const payslips = row.payslips as Record<string, unknown>[]
    expect(payslips).toHaveLength(7)
    for (const payslip of payslips) {
      expect(Object.keys(payslip)).toEqual(['national_id', 'expected_revision', 'template_id', 'template_version', 'rates', 'lines', 'accepted_differences'])
      expect(payslip).toMatchObject({ expected_revision: 0, template_id: TEMPLATE_ID, template_version: 1 })
    }
    expect(payslips[0].national_id).toBe(String(data.rows[0].ID))
  })

  it('carries the rates the cross-check used, as the eight agreed keys, or null when it did not run', () => {
    expect(wirePayslip(built()[0]).rates).toEqual({
      effective_from: '2026-01',
      revision: 1,
      nsf_employee_rate: 1,
      nsf_ceiling: 29710,
      nsf_exempt_at_60: true,
      csg_employee_rate_low: 1.5,
      csg_employee_rate_high: 3,
      csg_threshold: 50000,
    })
    expect(wirePayslip(built({ rates: null })[0]).rates).toBeNull()
  })

  it('carries each accepted difference with its two amounts and its reason', () => {
    const jane = built()[0]
    expect(jane.name).toBe('DOE JANE')
    expect(jane.acceptedDifferences).toEqual([{ what: 'Total Deductions', payroll: 490.38, payslip: 490.37, reason: 'Rounding' }])
    expect(built().filter((payslip) => payslip.acceptedDifferences.length > 0)).toHaveLength(3)
  })

  it('takes each expected_revision from the month as last loaded', async () => {
    const { port } = dashboard()
    await issueBatch(port, pendingFor(built({ selected: [0, 1] })))
    const month = await loadMonth(port, BRN, PERIOD)
    if (!month.ok) throw new Error('not loaded')
    expect(built({ month: month.payslips }).map((payslip) => payslip.expectedRevision)).toEqual([1, 1, 0, 0, 0, 0, 0])
  })
})

describe('a month can be issued only when everything is in order', () => {
  const problems = (change: Partial<IssueInput>) => {
    const result = buildIssue(input(change))
    return result.ok ? [] : result.problems
  }

  it('needs a published template: not the built-in, and not a draft being previewed', () => {
    expect(problems({ choice: { kind: 'built-in' } }).join(' ')).toContain('published template version')
    expect(problems({ previewingDraft: true }).join(' ')).toContain('previewing a draft')
    expect(monthProblems(input())).toEqual([])
  })

  it('needs the pay month to be the month of the payroll data', () => {
    expect(problems({ period: '2026-10' }).join(' ')).toContain('not the month of the payroll data')
    expect(problems({ data: { ...data, period: null } }).join(' ')).toContain('does not say which month')
  })

  it('needs every difference accepted, and accepted with a reason', () => {
    expect(problems({ accepted: {}, reasons: {} })).toEqual([
      'DOE JANE: a difference from the payroll totals is not accepted yet.',
      expect.stringContaining('not accepted yet'),
      expect.stringContaining('not accepted yet'),
    ])
    expect(problems({ reasons: {} })[0]).toBe('DOE JANE: Total Deductions was accepted without a reason.')
    expect(problems({ selected: [] })).toEqual(['Select at least one employee.'])
  })

  it('needs a reason for a missing figure treated as zero, and stores it on the line', () => {
    const row = { ...data.rows[3] }
    delete row.Travelling
    const changed = { ...data, rows: data.rows.map((found, index) => (index === 3 ? row : found)) }
    const treatAsZero = new Map([[3, new Set(['transport'])]])
    const again = preparePayslips(changed, { template, mapping, rateVersions: DEFAULT_STATUTORY_RATES, period: PERIOD, treatAsZero }, ISSUE_DATE)
    const check = again[3].computation.checks.filter((found) => found.kind !== 'match')
    const accepted = Object.fromEntries(check.map((found) => [found.id, found.diffCents!]))
    const base = { data: changed, prepared: again, selected: [3], accepted: { 3: accepted } }
    let reasons: Reasons = {}
    for (const found of check) reasons = withReason(reasons, 3, checkKey(found.id), 'Travelling is missing this month')
    expect(problems({ ...base, reasons })[0]).toContain('Transport Allowance was treated as zero without a reason')
    const [payslip] = built({ ...base, reasons: withReason(reasons, 3, zeroKey('transport'), 'No travel this month') })
    const figures = payslip.lines[1] as { lines: { id: string; status?: string; reason?: string }[] }
    expect(figures.lines.find((line) => line.id === 'transport')).toMatchObject({ status: 'treated-as-zero', reason: 'No travel this month' })
  })
})

describe('issuing and loading', () => {
  it('issues a month all at once, then re-issues as the next revision; a load gives the latest only', async () => {
    const { hub, port } = dashboard()
    const first = await issueBatch(port, pendingFor(built()))
    expect(first.end).toBe('saved')
    expect([...first.revisions!.values()]).toEqual([1, 1, 1, 1, 1, 1, 1])
    const month = await loadMonth(port, BRN, PERIOD)
    if (!month.ok) throw new Error('not loaded')
    expect(month.payslips.map((p) => [p.revision, p.issuedByYou, p.templateVersion])).toEqual(Array(7).fill([1, true, 1]))
    expect(month.role).toBe('admin')

    const again = await issueBatch(port, pendingFor(built({ selected: [2], month: month.payslips })))
    expect(again.end).toBe('saved')
    expect(hub.state.issued).toHaveLength(8)
    const reloaded = await loadMonth(port, BRN, PERIOD)
    if (!reloaded.ok) throw new Error('not loaded')
    expect(reloaded.payslips).toHaveLength(7)
    expect(reloaded.payslips.filter((p) => p.revision === 2)).toHaveLength(1)
    // Revision 1 stays: nothing is changed or removed.
    expect(hub.state.issued.filter((row) => row.national_id === String(data.rows[2].ID)).map((row) => row.revision)).toEqual([1, 2])
    expect((await loadMonth(port, BRN, '2026-08'))).toMatchObject({ ok: true, payslips: [] })
  })

  it('a load waits for the dashboard user: declined, unanswered, locked or forbidden, each said plainly', async () => {
    const { hub, port } = dashboard()
    hub.state.prompt = 'deny'
    expect(await loadMonth(port, BRN, PERIOD)).toMatchObject({ ok: false, failure: { kind: 'denied', title: 'The request was declined in the dashboard' } })
    hub.state.prompt = 'timeout'
    expect(await loadMonth(port, BRN, PERIOD)).toMatchObject({ ok: false, failure: { kind: 'timeout' } })
    hub.state.prompt = 'allow'
    hub.state.gateOpen = false
    expect(await loadMonth(port, BRN, PERIOD)).toMatchObject({ ok: false, failure: { kind: 'locked' } })
    hub.state.gateOpen = true
    hub.state.role = 'viewer'
    expect(await loadMonth(port, BRN, PERIOD)).toMatchObject({ ok: false, failure: { kind: 'forbidden' } })
    hub.state.role = 'admin'
    expect(await loadMonth(port, 'C7654321', PERIOD)).toMatchObject({ ok: false, failure: { kind: 'wrong-company' } })
  })

  it('an answer about another month than the one asked for is not used', async () => {
    const { port } = dashboard()
    const other: HubPort = { ...port, send: async (type, payload) => ({ ...((await port.send(type, payload)) as object), meta: { label: 'ABC Co Ltd', brn: BRN, period: '2026-08' } }) }
    expect(await loadMonth(other, BRN, PERIOD)).toMatchObject({ ok: false, failure: { kind: 'bad-answer' } })
  })
})

describe('refusals name the employee from the position the dashboard gives', () => {
  it('stale: someone issued one employee first. Nothing is stored, and who moved is shown', async () => {
    const { hub, port } = dashboard()
    hub.otherAdminIssues(PERIOD, String(data.rows[2].ID))
    const outcome = await issueBatch(port, pendingFor(built()))
    expect(outcome.end).toBe('stale')
    expect(outcome.failure).toMatchObject({ kind: 'stale', index: 2 })
    expect(outcome.culprit).toBe(prepared[2].computation.employeeName)
    expect(outcome.moved).toEqual([{ name: prepared[2].computation.employeeName, revision: 1, issuedByYou: false, issuedAt: expect.any(String) }])
    // All or none: the other six were not issued either.
    expect(hub.state.issued).toHaveLength(1)
  })

  it('not-found: an employee the dashboard does not have, or a template version it does not have', async () => {
    const { hub, port } = dashboard()
    hub.state.employees = hub.state.employees!.filter((id) => id !== String(data.rows[4].ID))
    const unknown = await issueBatch(port, pendingFor(built()))
    expect([unknown.end, unknown.failure?.kind, unknown.failure?.index, unknown.culprit]).toEqual(['refused', 'not-found', 4, prepared[4].computation.employeeName])
    expect(unknown.failure?.hubError).toContain('not a current employee')
    // The dashboard's sentence counts from 1 and never names anyone.
    expect(unknown.failure?.hubError).toContain('Payslip 5')
    expect(unknown.failure?.hubError).not.toContain(prepared[4].computation.employeeName)

    const version = await issueBatch(port, pendingFor(built({ selected: [0, 1], choice: { ...choice, version: 9 } })))
    expect([version.failure?.kind, version.failure?.index, version.culprit]).toEqual(['not-found', 0, 'DOE JANE'])
    expect(hub.state.issued).toHaveLength(0)
  })

  it('invalid and too-large inside one payslip carry its position; about the whole message they carry none', async () => {
    const { hub, port } = dashboard()
    const payslips = built()
    const withImage = payslips.map((payslip, index) => (index === 1 ? { ...payslip, lines: [...payslip.lines, { id: 'logo', cells: [{ col: 0, text: 'data:image/png;base64,AAAA' }] }] } : payslip))
    const image = await issueBatch(port, pendingFor(withImage))
    expect([image.failure?.kind, image.failure?.index, image.culprit]).toEqual(['invalid', 1, payslips[1].name])

    const padded = payslips.map((payslip, index) => (index === 5 ? { ...payslip, lines: [...payslip.lines, { id: 'pad', cells: [{ col: 0, text: 'x'.repeat(PAYSLIP_MAX_BYTES) }] }] } : payslip))
    const large = await issueBatch(port, pendingFor(padded))
    expect([large.failure?.kind, large.failure?.index, large.culprit]).toEqual(['too-large', 5, payslips[5].name])

    const twice = await issueBatch(port, pendingFor([payslips[0], payslips[1], payslips[0]]))
    expect([twice.failure?.kind, twice.failure?.index]).toEqual(['invalid', 2])

    hub.state.role = 'viewer'
    const member = await issueBatch(port, pendingFor(payslips))
    expect([member.end, member.failure?.kind, member.failure?.index, member.culprit]).toEqual(['refused', 'forbidden', null, null])
    hub.state.role = 'admin'
    const company = await issueBatch(port, { ...pendingFor(payslips), brn: 'C7654321' })
    expect([company.failure?.kind, company.culprit]).toEqual(['wrong-company', null])
    expect(hub.state.issued).toHaveLength(0)
  })

  it('locked: nothing was stored, nothing is reloaded, and the very same message goes again once unlocked', async () => {
    const { hub, port, sends, loads } = dashboard()
    hub.state.gateOpen = false
    const pending = pendingFor(built())
    const locked = await issueBatch(port, pending)
    expect(locked.end).toBe('locked')
    expect(locked.failure?.detail).toContain('Nothing was stored')
    expect([sends(), loads(), hub.state.issued.length]).toEqual([1, 0, 0])

    hub.state.gateOpen = true
    expect((await issueBatch(port, pending)).end).toBe('saved')
    expect(hub.state.log[1].payload).toEqual(hub.state.log[0].payload)
    expect(hub.state.issued).toHaveLength(7)
  })
})

describe('the reload rule for an issue: load the month again and compare, before issuing again', () => {
  for (const mode of ['lost', 'unavailable'] as const) {
    it(`${mode}, but stored: everyone is at expected + 1, so it went through and is NOT sent again`, async () => {
      const { hub, port, sends, loads } = dashboard()
      hub.state.nextSave = { mode }
      const outcome = await issueBatch(port, pendingFor(built()))
      expect(outcome.end).toBe('saved')
      expect([...outcome.revisions!.values()]).toEqual(Array(7).fill(1))
      expect([sends(), loads(), hub.state.issued.length]).toEqual([1, 1, 7])
    })

    it(`${mode}, and not stored: nobody moved, so the same message may be sent again`, async () => {
      const { hub, port, sends } = dashboard()
      hub.state.nextSave = { mode: `${mode}-unsaved` }
      const pending = pendingFor(built())
      const outcome = await issueBatch(port, pending)
      expect(outcome.end).toBe('not-saved')
      expect(outcome.failure?.detail).toContain('nothing was issued')
      expect(sends()).toBe(1)
      expect((await issueBatch(port, pending)).end).toBe('saved')
      expect(hub.state.issued).toHaveLength(7)
    })
  }

  it('when the month cannot be loaded either, nothing is known: check again, never a blind resend', async () => {
    const { hub, port, sends } = dashboard()
    hub.state.nextSave = { mode: 'lost' }
    hub.state.prompt = 'deny'
    const pending = pendingFor(built())
    const outcome = await issueBatch(port, pending)
    expect(outcome.end).toBe('unconfirmed')
    expect(outcome.failure?.kind).toBe('denied')
    expect(outcome.failure?.detail).toContain('will not send them twice')
    hub.state.prompt = 'allow'
    expect((await checkIssue(port, pending, outcome.failure!)).end).toBe('saved')
    expect([sends(), hub.state.issued.length]).toEqual([1, 7])
  })

  it('someone else issued in between: stale, with who moved', async () => {
    const { hub, port } = dashboard()
    const pending = pendingFor(built())
    hub.otherAdminIssues(PERIOD, String(data.rows[1].ID))
    const checked = await checkIssue(port, pending, failure('no-answer'))
    expect(checked.end).toBe('stale')
    expect(checked.moved.map((moved) => [moved.name, moved.revision, moved.issuedByYou])).toEqual([[prepared[1].computation.employeeName, 1, false]])
  })

  it('the judgement itself: all moved by one and mine, none moved, or anything else', async () => {
    const { port } = dashboard()
    const pending = pendingFor(built({ selected: [0, 1] }))
    expect(judgeIssue([], pending).verdict).toBe('not-saved')
    await issueBatch(port, pending)
    const month = await loadMonth(port, BRN, PERIOD)
    if (!month.ok) throw new Error('not loaded')
    expect(judgeIssue(month.payslips, pending).verdict).toBe('saved')
    // Only one of the two moved: impossible for an all-or-none issue, so it is not mine.
    expect(judgeIssue(month.payslips.slice(0, 1), pending).verdict).toBe('stale')
    expect(judgeIssue(month.payslips.map((p) => ({ ...p, issuedByYou: false })), pending).verdict).toBe('stale')
    expect(judgeIssue(month.payslips.map((p) => ({ ...p, revision: 2 })), pending).verdict).toBe('stale')
    expect(judgeIssue(month.payslips.map((p) => ({ ...p, lines: [...p.lines, { id: 'extra' }] })), pending).verdict).toBe('stale')
  })
})

describe('the limits, checked before sending', () => {
  it('a payslip over 16 KB is refused naming the employee, and never trimmed', () => {
    const payslips = built()
    const padded = payslips.map((payslip, index) => (index === 3 ? { ...payslip, lines: [...payslip.lines, { id: 'pad', cells: [{ col: 0, text: 'x'.repeat(PAYSLIP_MAX_BYTES) }] }] } : payslip))
    const plan = planIssue(BRN, PERIOD, padded)
    expect(plan).toEqual({ ok: false, tooLarge: [{ name: payslips[3].name, bytes: expect.any(Number) }] })
    if (plan.ok) throw new Error('planned')
    expect(plan.tooLarge[0].bytes).toBeGreaterThan(PAYSLIP_MAX_BYTES)
  })

  it('a normal month is one message; the measured size says how many payslips fit in 4 MB', () => {
    const payslips = built()
    const sizes = payslips.map((payslip) => jsonBytes(wirePayslip(payslip)))
    const plan = planIssue(BRN, PERIOD, payslips)
    expect(plan).toMatchObject({ ok: true, batches: [payslips] })
    const largest = Math.max(...sizes)
    const fit = Math.floor((MESSAGE_MAX_BYTES - 1_200) / (largest + 1))
    console.log(`  whole payslips as sent, bytes: ${sizes.join(', ')}; about ${fit} of the largest fit in one 4 MB message`)
    for (const size of sizes) expect(size).toBeLessThan(PAYSLIP_MAX_BYTES / 2)
    expect(fit).toBeGreaterThan(600)
  })

  it('more than fits is split into batches, each within 1,000 payslips and 4 MB, in order and with nobody lost', () => {
    const [sample] = built()
    const many = Array.from({ length: 1_500 }, (_, index) => ({ ...sample, name: `EMPLOYEE ${index}`, nationalId: `X${String(index).padStart(13, '0')}` }))
    const plan = planIssue(BRN, PERIOD, many)
    if (!plan.ok) throw new Error('refused')
    expect(plan.batches.length).toBeGreaterThan(1)
    expect(plan.batches.flat().map((payslip) => payslip.name)).toEqual(many.map((payslip) => payslip.name))
    for (const batch of plan.batches) {
      expect(batch.length).toBeLessThanOrEqual(1_000)
      expect(jsonBytes([issueRow({ brn: BRN, period: PERIOD, payslips: batch })])).toBeLessThanOrEqual(MESSAGE_MAX_BYTES)
    }
  })
})

describe('reopening a month shows each payslip exactly as issued', () => {
  it('issue, then load: the identical layout model and the identical PDF text', async () => {
    const { port } = dashboard()
    await issueBatch(port, pendingFor(built()))
    const month = await loadMonth(port, BRN, PERIOD)
    if (!month.ok) throw new Error('not loaded')
    const fonts = { regular: readFont('regular'), bold: readFont('bold') }
    for (const [index, item] of prepared.entries()) {
      const stored = month.payslips.find((p) => p.nationalId === String(data.rows[index].ID))!
      const read = decodeLines(stored.lines)
      if (!read.ok) throw new Error(read.problem)
      expect(read.document).toEqual(item.document)
      expect(layoutPage(read.document)).toEqual(item.page)
      if (index === 0 || index === 6) {
        expect(await readPdf(await writePayslipPdf(read.document, fonts))).toEqual(await readPdf(await writePayslipPdf(item.document!, fonts)))
      }
    }
  })

  it('never recalculates: what changed in the payroll, the template or the rates since does not reach it', async () => {
    const { hub, port } = dashboard()
    await issueBatch(port, pendingFor(built({ selected: [0] })))
    // The template is republished differently and the rates change after the issue.
    hub.state.versions[0].body = { ...BUILT_IN_BODY, labels: { ...BUILT_IN_BODY.labels, title: 'Changed later' } }
    hub.otherAdminSavesRates('2026-01', { nsf_employee_rate: 9, nsf_ceiling: 1, nsf_exempt_at_60: false, csg_employee_rate_low: 9, csg_employee_rate_high: 9, csg_threshold: 1 })
    const month = await loadMonth(port, BRN, PERIOD)
    if (!month.ok) throw new Error('not loaded')
    const read = decodeLines(month.payslips[0].lines)
    if (!read.ok) throw new Error(read.problem)
    // Decoding takes the stored lines and nothing else.
    expect(decodeLines.length).toBe(1)
    expect(read.document).toEqual(prepared[0].document)
    expect(month.payslips[0].rates).toMatchObject({ nsf_ceiling: 29710, revision: 1 })
  })
})
