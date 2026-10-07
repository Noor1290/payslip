import { createFakeHub, type FakeHub } from '../scripts/lib/fake-hub.mjs'
import type { HubPort } from '../src/lib/hubWire'
import type { RatesInput } from '../src/lib/statutoryRates'

export const BRN = 'C1234567'

/** What the real bridge resolves with when the dashboard has not answered a save in 10 seconds. */
export const BRIDGE_GAVE_UP = { ok: false, error: 'The dashboard did not answer in time.' }

/**
 * The fake dashboard behind the same port the app uses. A lost answer to a save comes back the
 * way the bridge reports it; a lost answer to a request never comes back at all (the bridge
 * would wait two minutes), so the app's own time-out has to end the wait.
 */
export function fakeHub(): { hub: FakeHub; port: HubPort; sent: () => string[] } {
  const hub = createFakeHub()
  const port: HubPort = {
    requestTimeoutMs: 40,
    send: (type, payload) => {
      const answer = hub.handle(type, payload)
      if (answer !== undefined) return Promise.resolve(answer)
      return type === 'send-data' ? Promise.resolve(BRIDGE_GAVE_UP) : new Promise(() => {})
    },
  }
  /** "send-data statutory-rates", "request-data payslip-template list"... in order. */
  const sent = () =>
    hub.state.log.map(({ type, payload }) =>
      [type, payload.dataType, payload.params?.action ?? payload.rows?.[0]?.action].filter(Boolean).join(' '),
    )
  return { hub, port, sent }
}

/** Fake rates: the bundled defaults' values, from July 2026. */
export const RATES_JULY: RatesInput = {
  effectiveFrom: '2026-07',
  nsfEmployeeRate: 1,
  nsfCeiling: 29710,
  nsfExemptAt60: true,
  csgEmployeeRateLow: 1.5,
  csgEmployeeRateHigh: 3,
  csgThreshold: 50000,
  sourceNote: 'Sample figures, not the real ones',
}
