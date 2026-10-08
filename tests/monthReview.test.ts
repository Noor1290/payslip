// Where the month review stands, against the stand-in dashboard: last month loaded, declined,
// locked, empty or unreadable. Fake data only (ABC Co Ltd).
import { describe, expect, it } from 'vitest'
import { loadMonth } from '../src/lib/issueStore'
import { baselineState, comparisonOf, type BaselineState } from '../src/lib/monthReview'
import type { MonthState } from '../src/lib/useIssuing'
import type { HubPort } from '../src/lib/hubWire'
import { BRN } from './fakeHubPort'
import { august, current, dashboard, issue, LAST_PERIOD, PERIOD, september } from './monthFixtures'

/** What the app keeps for a month after asking the dashboard for it. */
async function monthState(port: HubPort, brn = BRN): Promise<MonthState> {
  const result = await loadMonth(port, brn, LAST_PERIOD)
  return result.ok ? { status: 'loaded', payslips: result.payslips } : { status: 'failed', failure: result.failure }
}
const stateAfter = async (port: HubPort, brn?: string): Promise<BaselineState> => baselineState(LAST_PERIOD, await monthState(port, brn))

describe('last month as the baseline', () => {
  it('is not asked for until the user asks: the dashboard asks its own user first', () => {
    const { sent } = dashboard()
    expect(baselineState(LAST_PERIOD, undefined)).toEqual({ status: 'not-asked' })
    expect(sent()).toEqual([])
  })

  it('is loading while the dashboard is asking its user', () => {
    expect(baselineState(LAST_PERIOD, { status: 'loading' })).toEqual({ status: 'loading', what: 'issued' })
  })

  it('is the issued payslips of last month, the latest revision of each, through one load of that month', async () => {
    const { port, sent } = dashboard()
    await issue(port, august())
    const before = sent().length
    const state = await stateAfter(port)
    expect(sent().slice(before)).toEqual(['request-data payslip-issue load'])
    expect(state.status).toBe('ready')
    if (state.status !== 'ready') return
    expect(state.baseline).toMatchObject({ period: LAST_PERIOD, source: 'issued' })
    expect(state.baseline.payslips.map((payslip) => [payslip.employeeName, payslip.revision])).toEqual([
      ['DOE JANE', 1],
      ['PALMYRE JEAN MARC', 1],
      ['SAMPLE ALEX', 1],
      ['TESTER SAMUEL', 1],
      ['FICTIF MARIE', 1],
      ['TEMPO LEA', 1],
      ['ANCIEN PAUL', 1],
    ])
  })

  it('compares with the LATEST revision when last month was issued again', async () => {
    const { port } = dashboard()
    const month = august()
    await issue(port, month)
    await issue(port, month, [0])
    const state = await stateAfter(port)
    if (state.status !== 'ready') throw new Error(state.status)
    expect(state.baseline.payslips.map((payslip) => payslip.revision)).toEqual([2, 1, 1, 1, 1, 1, 1])
    const comparison = comparisonOf(state, PERIOD, current(september()))!
    expect(comparison.rows[0]).toMatchObject({ employeeName: 'DOE JANE', status: 'unchanged', baselineRevision: 2 })
  })

  it('says so when last month has no issued payslip: an answer, not a failure (the payroll fallback comes next)', async () => {
    const { port } = dashboard()
    const state = await stateAfter(port)
    expect(state).toEqual({ status: 'none-issued' })
    expect(comparisonOf(state, PERIOD, current(september()))).toBeNull()
  })

  it.each([
    ['deny', 'denied', 'The request was declined in the dashboard'],
    ['timeout', 'timeout', 'Nobody answered the question in the dashboard'],
  ] as const)('a load that was answered "%s" is a failure, never an empty month', async (prompt, kind, title) => {
    const { hub, port } = dashboard()
    await issue(port, august())
    hub.state.prompt = prompt
    const state = await stateAfter(port)
    expect(state).toMatchObject({ status: 'failed', what: 'issued', failure: { kind, title } })
    expect(comparisonOf(state, PERIOD, current(september()))).toBeNull()
  })

  it('a locked dashboard is a failure that says to unlock it', async () => {
    const { hub, port } = dashboard()
    await issue(port, august())
    hub.state.gateOpen = false
    expect(await stateAfter(port)).toMatchObject({ status: 'failed', failure: { kind: 'locked', title: 'The dashboard is locked' } })
  })

  it('a member, who may not load issued payslips, gets a failure', async () => {
    const { hub, port } = dashboard()
    await issue(port, august())
    hub.state.role = 'viewer'
    expect(await stateAfter(port)).toMatchObject({ status: 'failed', failure: { kind: 'forbidden' } })
  })

  it('an answer for another company is not used', async () => {
    const { port } = dashboard()
    await issue(port, august())
    expect(await stateAfter(port, 'C7654321')).toMatchObject({ status: 'failed', failure: { kind: 'wrong-company' } })
  })

  it('an answer that is not in the agreed format is not used', async () => {
    const port: HubPort = { send: () => Promise.resolve({ ok: true, dataType: 'payslip-issue', rows: [{ national_id: 'X0000000000001', revision: 'one' }], meta: { brn: BRN, period: LAST_PERIOD } }) }
    expect(await stateAfter(port)).toMatchObject({ status: 'failed', failure: { kind: 'bad-answer' } })
  })

  it('an answer about another month than last month is not used', async () => {
    const port: HubPort = { send: () => Promise.resolve({ ok: true, dataType: 'payslip-issue', rows: [], meta: { brn: BRN, period: '2026-07' } }) }
    expect(await stateAfter(port)).toMatchObject({ status: 'failed', failure: { kind: 'bad-answer' } })
  })
})
