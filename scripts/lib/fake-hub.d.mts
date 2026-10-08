// Types for fake-hub.mjs, so the tests can use the same stand-in dashboard as the bridge check.
export interface FakeHubState {
  signedIn: boolean
  role: 'admin' | 'viewer'
  company: { name: string; brn: string | null } | null
  rates: Record<string, unknown>[]
  templates: { id: string; name: string; body: Record<string, unknown>; revision: number; updatedAt: string; by: 'you' | 'other' }[]
  versions: { templateId: string; version: number; name: string; body: Record<string, unknown>; publishedAt: string; by: 'you' | 'other' }[]
  log: { type: 'send-data' | 'request-data'; payload: { dataType: string; params?: Record<string, unknown>; rows?: Record<string, unknown>[] } }[]
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
