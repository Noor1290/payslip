import { describe, expect, it } from 'vitest'
import { hueOf, initialsOf } from '../src/lib/companyLook'
import { isListed, loadCompanyList, openCompany, openPicker } from '../src/lib/companyList'
import { BRN, fakeHub } from './fakeHubPort'

/** company-list with the fake dashboard (scripts/lib/fake-hub.mjs). FAKE companies only. */
function start() {
  const made = fakeHub()
  made.hub.state.openOnStart = false
  made.hub.state.lists = ['C1234567']
  made.hub.state.others = [{ name: 'DEF Ltd', brn: 'C3333333', role: 'admin', templates: [], versions: [], inUse: null, payroll: null }]
  return made
}
const ABC_ID = '10000000-0000-4000-8000-000001234567'
const DEF_ID = '10000000-0000-4000-8000-000003333333'

describe('the companies of the Payslip app', () => {
  it('lists every company of the user, whether it is on the Payslip list, the selected one marked', async () => {
    const { port } = start()
    const answer = await loadCompanyList(port)
    if (!answer.ok) throw new Error('refused')
    expect(answer.companies.map((one) => [one.name, one.lists, one.selected])).toEqual([
      ['ABC Co Ltd', ['payslips'], true],
      ['DEF Ltd', [], false],
    ])
    expect(answer.companies.filter(isListed).map((one) => one.brn)).toEqual([BRN])
    expect(answer.open).toBeNull()
  })

  it('works as before with a dashboard from before the lists', async () => {
    const { hub, port } = start()
    hub.state.listLegacy = true
    expect(await loadCompanyList(port)).toEqual({ ok: false, legacy: true })
  })

  it('says why when the dashboard is not available', async () => {
    const { hub, port } = start()
    hub.state.signedIn = false
    expect(await loadCompanyList(port)).toMatchObject({ ok: false, legacy: false, failure: { kind: 'unavailable' } })
  })
})

describe('opening a company from its card', () => {
  it('the selected one opens here at once', async () => {
    const { hub, port } = start()
    expect(await openCompany(port, BRN, ABC_ID, '2026-08')).toEqual({ ok: true, switched: false })
    expect(hub.state.reload).toBe(false)
  })

  it('another one is selected in the dashboard, which reloads the app; the month comes back with it', async () => {
    const { hub, port } = start()
    expect(await openCompany(port, BRN, DEF_ID, '2026-07')).toEqual({ ok: true, switched: true })
    expect(hub.state.reload).toBe(true)
    // As if the dashboard had selected DEF Ltd and reloaded the app.
    hub.state.others = [{ name: 'ABC Co Ltd', brn: BRN, role: 'admin', templates: [], versions: [], inUse: null, payroll: null }]
    hub.state.company = { name: 'DEF Ltd', brn: 'C3333333' }
    const after = await loadCompanyList(port)
    if (!after.ok) throw new Error('refused')
    expect(after.selected.name).toBe('DEF Ltd')
    expect(after.open).toEqual({ period: '2026-07' })
  })

  it('opens the picker in the dashboard', async () => {
    const { hub, port } = start()
    expect(await openPicker(port, BRN)).toBeNull()
    expect(hub.state.pickerOpened).toBe(1)
  })
})

describe('the company circle', () => {
  it('is the same as in the dashboard', () => {
    expect(initialsOf('ABC Co Ltd')).toBe('AB')
    expect(initialsOf('The Coral (Mauritius) Ltd')).toBe('CM')
    expect([hueOf('C1234567'), hueOf('C0000101'), hueOf('C3333333')]).toEqual([200, 75, 162])
  })
})
