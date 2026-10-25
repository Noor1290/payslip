// Types for fake-hub.mjs, so the tests can use the same stand-in dashboard as the bridge check.
type FakeTemplate = { id: string; name: string; body: object; revision: number; updatedAt: string; by: 'you' | 'other' }
type FakeVersion = { templateId: string; version: number; name: string; body: object; publishedAt: string; by: 'you' | 'other' }
type FakeInUse = { templateId: string; version: number } | null
export interface FakeHubState {
  signedIn: boolean
  role: 'admin' | 'viewer'
  company: { name: string; brn: string | null } | null
  rates: Record<string, unknown>[]
  templates: FakeTemplate[]
  versions: FakeVersion[]
  /** The selected company's template used for the payslips. */
  inUse: FakeInUse
  /** The user's other companies; only those with role "admin" are listed or published to. */
  others: {
    name: string
    brn: string
    role: 'admin' | 'member'
    templates: FakeTemplate[]
    versions: FakeVersion[]
    inUse: FakeInUse
    payroll: { period: string; employees: number; columns: string[] } | null
    /** Its saved runs by month, for payslip-batch: the rows of the payroll export. */
    runs?: Record<string, Record<string, unknown>[]>
    /** Its statutory rates versions, as the dashboard sends them, plus `by`. */
    rates?: Record<string, unknown>[]
    /** Its issued payslips, as for the selected company (`issued`). */
    issued?: (Record<string, unknown> & { national_id: string; period: string; revision: number; by: 'you' | 'other' })[]
  }[]
  /** A publish-copy to these BRNs is refused with that code. */
  refuseCopy: Record<string, string>
  /** The last template id handed out. */
  ids: number
  /** What the user allowed for payslip-batch. */
  batchAllowed: { period: string; brns: string[] } | null
  log: { type: 'send-data' | 'request-data'; payload: { dataType: string; period?: string; params?: Record<string, unknown>; rows?: Record<string, unknown>[] } }[]
  /** Saved payroll runs by month, as the rows of the payroll export. */
  runs: Record<string, Record<string, unknown>[]>
  gateOpen: boolean
  prompt: 'allow' | 'deny' | 'timeout'
  employees: string[] | null
  issued: (Record<string, unknown> & { national_id: string; period: string; revision: number; by: 'you' | 'other' })[]
  nextSave: { mode: 'lost' | 'lost-unsaved' | 'unavailable' | 'unavailable-unsaved' } | { mode: 'refuse'; code: string } | null
  nextRequest: { mode: 'lost' } | { mode: 'refuse'; code: string } | null
  ticks: number
}
export interface FakeHub {
  state: FakeHubState
  /** One message in, one answer out. `undefined` is an answer that never arrives. */
  handle(type: 'send-data' | 'request-data', payload: unknown): Record<string, unknown> | undefined
  otherAdminSavesRates(month: string, values: Record<string, unknown>): void
  otherAdminSavesDraft(templateId: string, change: { name?: string; body?: Record<string, unknown> }): void
  otherAdminIssues(period: string, nationalId: string, change?: Record<string, unknown>): void
}
export function createFakeHub(): FakeHub
