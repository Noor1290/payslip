// Rates and templates through the dashboard: the exact messages sent, every refusal code, the
// reload rule, and the company check. The dashboard is the in-memory stand-in from
// scripts/lib/fake-hub.mjs, which follows docs/INTEGRATION.md. Fake data only.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { DEFAULT_STATUTORY_RATES } from '../src/data/defaultStatutoryRates'
import { ask, canonicalJson, failure, REFUSAL_CODES, sendSave, STATUTORY_RATES, type HubPort } from '../src/lib/hubWire'
import {
  checkRatesSave,
  judgeRatesSave,
  loadRates,
  pendingRatesSave,
  ratesForCrossCheck,
  saveRates,
  type PendingRatesSave,
} from '../src/lib/ratesStore'
import { ratesFor } from '../src/lib/statutoryRates'
import { BUILT_IN_BODY, type TemplateBody } from '../src/lib/templateBody'
import {
  checkDraftSave,
  checkPublish,
  listTemplates,
  loadDraft,
  loadVersion,
  publishDraft,
  saveDraft,
  type PendingDraftSave,
  type PendingPublish,
} from '../src/lib/templateStore'
import { BRN, fakeHub, RATES_JULY } from './fakeHubPort'
import { expectRecorded, root } from './helpers'

const pendingRates = (expectedRevision = 0): PendingRatesSave => ({ brn: BRN, input: RATES_JULY, expectedRevision })
const newDraft = (name = 'Monthly payslip'): PendingDraftSave => ({ brn: BRN, templateId: null, name, body: BUILT_IN_BODY, expectedRevision: 0 })
const relabelled = (title: string): TemplateBody => ({ ...BUILT_IN_BODY, labels: { ...BUILT_IN_BODY.labels, title } })

/** A dashboard that already holds one template with a saved draft. */
async function withTemplate() {
  const made = fakeHub()
  const created = await saveDraft(made.port, newDraft())
  if (created.end !== 'saved') throw new Error('The fake dashboard did not create the template.')
  const templateId = created.saved!.templateId
  const edit = (title: string, expectedRevision = 1): PendingDraftSave => ({
    brn: BRN,
    templateId,
    name: 'Monthly payslip',
    body: relabelled(title),
    expectedRevision,
  })
  const publication = (expectedRevision = 1, publishedBefore: number | null = null, body = BUILT_IN_BODY): PendingPublish => ({
    brn: BRN,
    templateId,
    expectedRevision,
    publishedBefore,
    name: 'Monthly payslip',
    body,
  })
  made.hub.state.log.length = 0
  return { ...made, templateId, edit, publication }
}

describe('the messages sent to the dashboard', () => {
  it('are exactly the recorded ones: requests, a rates save, a draft save and a publish', async () => {
    const { hub, port } = fakeHub()
    await loadRates(port, BRN)
    await saveRates(port, pendingRates())
    await listTemplates(port, BRN)
    const created = await saveDraft(port, newDraft())
    const templateId = created.saved!.templateId
    await loadDraft(port, BRN, templateId)
    await saveDraft(port, { brn: BRN, templateId, name: 'Monthly payslip', body: relabelled('Pay advice'), expectedRevision: 1 })
    await publishDraft(port, { brn: BRN, templateId, expectedRevision: 2, publishedBefore: null, name: 'Monthly payslip', body: relabelled('Pay advice') })
    await loadVersion(port, BRN, templateId, 1)
    expectRecorded('hub-messages', hub.state.log)
  })

  it('carry the BRN of the open payroll data in every save, and one row per save', async () => {
    const { hub, port } = fakeHub()
    await saveRates(port, pendingRates())
    await saveDraft(port, newDraft())
    const saves = hub.state.log.filter((message) => message.type === 'send-data')
    expect(saves).toHaveLength(2)
    for (const save of saves) {
      expect(save.payload.rows).toHaveLength(1)
      expect(save.payload.rows![0].brn).toBe(BRN)
    }
  })

  it('a new template has no template_id and expected_revision 0', async () => {
    const { hub, port } = fakeHub()
    await saveDraft(port, { ...newDraft(), expectedRevision: 7 })
    const row = hub.state.log[0].payload.rows![0]
    expect('template_id' in row).toBe(false)
    expect(row.expected_revision).toBe(0)
  })

  it('a rates save expects the highest revision seen for that month, 0 when it has none', async () => {
    const { port } = fakeHub()
    expect(pendingRatesSave(BRN, RATES_JULY, []).expectedRevision).toBe(0)
    await saveRates(port, pendingRates())
    const loaded = await loadRates(port, BRN)
    if (!loaded.ok) throw new Error('not loaded')
    expect(pendingRatesSave(BRN, RATES_JULY, loaded.versions).expectedRevision).toBe(1)
    expect(pendingRatesSave(BRN, { ...RATES_JULY, effectiveFrom: '2026-08' }, loaded.versions).expectedRevision).toBe(0)
  })

  it('send params.brn when the app knows the company, and leave it out when it does not', async () => {
    const { hub, port } = fakeHub()
    await loadRates(port, BRN)
    await loadRates(port, null)
    expect(hub.state.log[0].payload.params).toEqual({ brn: BRN })
    expect(hub.state.log[1].payload.params).toEqual({})
  })
})

describe('statutory rates', () => {
  it('loads every version, newest month first, and saves one new version', async () => {
    const { hub, port } = fakeHub()
    const first = await saveRates(port, pendingRates())
    expect(first.end).toBe('saved')
    expect(first.latest).toMatchObject({ effectiveFrom: '2026-07', revision: 1, createdByYou: true, sourceNote: RATES_JULY.sourceNote })
    hub.otherAdminSavesRates('2026-09', { nsf_employee_rate: 1, nsf_ceiling: 30000, nsf_exempt_at_60: true, csg_employee_rate_low: 1.5, csg_employee_rate_high: 3, csg_threshold: 50000 })
    const loaded = await loadRates(port, BRN)
    if (!loaded.ok) throw new Error('not loaded')
    expect(loaded.company).toEqual({ name: 'ABC Co Ltd', brn: BRN })
    expect(loaded.versions.map((v) => [v.effectiveFrom, v.revision, v.createdByYou])).toEqual([
      ['2026-09', 1, false],
      ['2026-07', 1, true],
    ])
    // The rates in force for a month: the latest effective-from at or before it.
    expect(ratesFor(loaded.versions, '2026-08')?.nsfCeiling).toBe(29710)
    expect(ratesFor(loaded.versions, '2026-09')?.nsfCeiling).toBe(30000)
    expect(ratesFor(loaded.versions, '2026-06')).toBeNull()
  })

  it('a correction for the same month is the next revision, and the highest revision is in force', async () => {
    const { port } = fakeHub()
    await saveRates(port, pendingRates())
    const corrected = await saveRates(port, { brn: BRN, input: { ...RATES_JULY, nsfCeiling: 29750 }, expectedRevision: 1 })
    expect(corrected.end).toBe('saved')
    expect(corrected.latest?.revision).toBe(2)
    expect(ratesFor(corrected.versions!, '2026-10')).toMatchObject({ revision: 2, nsfCeiling: 29750 })
  })

  it('sends the values exactly as typed: nothing is rounded on the way', async () => {
    const { hub, port } = fakeHub()
    await saveRates(port, { brn: BRN, input: { ...RATES_JULY, csgEmployeeRateLow: 1.2345, nsfCeiling: 29710.55 }, expectedRevision: 0 })
    expect(hub.state.rates[0]).toMatchObject({ csg_employee_rate_low: 1.2345, nsf_ceiling: 29710.55 })
  })

  it('an identical save is "no-change": nothing needed saving, and it is not an error', async () => {
    const { hub, port } = fakeHub()
    await saveRates(port, pendingRates())
    const again = await saveRates(port, pendingRates(1))
    expect(again.end).toBe('no-change')
    expect(again.failure?.title).toBe('Nothing needed saving')
    expect(hub.state.rates).toHaveLength(1)
  })

  it('a stale save never overwrites: the newer version is loaded and shown instead', async () => {
    const { hub, port } = fakeHub()
    await saveRates(port, pendingRates())
    hub.otherAdminSavesRates('2026-07', { nsf_employee_rate: 1, nsf_ceiling: 31000, nsf_exempt_at_60: true, csg_employee_rate_low: 1.5, csg_employee_rate_high: 3, csg_threshold: 50000 })
    const mine = await saveRates(port, { brn: BRN, input: { ...RATES_JULY, nsfCeiling: 29800 }, expectedRevision: 1 })
    expect(mine.end).toBe('stale')
    expect(mine.latest).toMatchObject({ revision: 2, nsfCeiling: 31000, createdByYou: false })
    expect(hub.state.rates.map((row) => row.nsf_ceiling)).toEqual([29710, 31000])
  })
})

describe('every refusal code has its own clear message', () => {
  it('the eight codes give eight different titles and say what to do', () => {
    const titles = REFUSAL_CODES.map((code) => failure(code).title)
    expect(new Set(titles).size).toBe(REFUSAL_CODES.length)
    for (const code of REFUSAL_CODES) expect(failure(code).detail.length).toBeGreaterThan(20)
    expect(failure('wrong-company').detail).toContain('Select the company of this payroll data in the dashboard')
    expect(failure('forbidden').detail).toContain('read-only')
    expect(failure('too-large').detail).toContain('Trying again cannot help')
  })

  const ends = {
    stale: 'stale',
    'no-change': 'no-change',
    forbidden: 'refused',
    'wrong-company': 'refused',
    invalid: 'refused',
    'not-found': 'refused',
    'too-large': 'refused',
  } as const

  for (const [code, end] of Object.entries(ends)) {
    it(`"${code}" on a rates save, a draft save and a publish`, async () => {
      const { hub, port, templateId, edit, publication } = await withTemplate()
      hub.state.nextSave = { mode: 'refuse', code }
      const rates = await saveRates(port, pendingRates())
      expect([rates.end, rates.failure?.kind]).toEqual([end, code])
      expect(hub.state.rates).toHaveLength(0)

      hub.state.nextSave = { mode: 'refuse', code }
      const draft = await saveDraft(port, edit('Pay advice'))
      expect([draft.end, draft.failure?.kind]).toEqual([end, code])
      expect(hub.state.templates[0].revision).toBe(1)

      hub.state.nextSave = { mode: 'refuse', code }
      const published = await publishDraft(port, publication())
      expect([published.end, published.failure?.kind]).toEqual([end, code])
      expect(hub.state.versions).toHaveLength(0)
      // A refusal is final: the save is not sent a second time.
      expect(hub.state.log.filter((m) => m.type === 'send-data')).toHaveLength(3)
      expect(templateId).toBeTruthy()
    })
  }

  it('"unavailable" on a request is shown as it is, with the dashboard\'s own sentence', async () => {
    const { hub, port } = fakeHub()
    hub.state.signedIn = false
    const loaded = await loadRates(port, BRN)
    expect(loaded).toMatchObject({ ok: false, failure: { kind: 'unavailable', hubError: 'Nobody is signed in to the dashboard, or no company is selected.' } })
  })

  it('the real reasons reach the user too: a viewer, another company, a taken name, an image, a missing template', async () => {
    const { hub, port, templateId, edit } = await withTemplate()
    hub.state.role = 'viewer'
    expect((await saveRates(port, pendingRates())).failure?.kind).toBe('forbidden')
    hub.state.role = 'admin'

    expect((await saveRates(port, { ...pendingRates(), brn: 'C7654321' })).failure?.kind).toBe('wrong-company')
    expect((await saveDraft(port, newDraft('monthly PAYSLIP'))).failure).toMatchObject({ kind: 'invalid', hubError: 'This company already has one with that name.' })

    const withImage = { ...relabelled('Payslip'), labels: { ...BUILT_IN_BODY.labels, title: 'data:image/png;base64,AAAA' } }
    expect((await saveDraft(port, { ...edit('x'), body: withImage })).failure?.kind).toBe('invalid')

    const gone = '20000000-0000-4000-8000-000000000099'
    expect((await loadDraft(port, BRN, gone)).ok).toBe(false)
    expect((await saveDraft(port, { ...edit('x'), templateId: gone })).failure?.kind).toBe('not-found')
    expect((await loadVersion(port, BRN, templateId, 4))).toMatchObject({ ok: false, failure: { kind: 'not-found' } })
  })
})

describe('the reload rule: after "no answer" or "unavailable" on a save, reload and compare first', () => {
  for (const mode of ['lost', 'unavailable'] as const) {
    it(`rates, ${mode}, but stored: the reload finds it, and it is NOT sent again`, async () => {
      const { hub, port, sent } = fakeHub()
      hub.state.nextSave = { mode }
      const outcome = await saveRates(port, pendingRates())
      expect(outcome.end).toBe('saved')
      expect(outcome.latest?.revision).toBe(1)
      expect(sent()).toEqual(['send-data statutory-rates', 'request-data statutory-rates'])
      expect(hub.state.rates).toHaveLength(1)
    })

    it(`rates, ${mode}, and not stored: the reload shows it, and only then may it be saved again`, async () => {
      const { hub, port, sent } = fakeHub()
      hub.state.nextSave = { mode: `${mode}-unsaved` }
      const pending = pendingRates()
      const outcome = await saveRates(port, pending)
      expect(outcome.end).toBe('not-saved')
      expect(outcome.failure?.detail).toContain('the save was not stored')
      expect(sent()).toEqual(['send-data statutory-rates', 'request-data statutory-rates'])
      // The retry carries the same expected_revision.
      const retry = await saveRates(port, pending)
      expect(retry.end).toBe('saved')
      expect(hub.state.log[2].payload.rows![0].expected_revision).toBe(0)
      expect(hub.state.rates).toHaveLength(1)
    })
  }

  it('rates: someone else saved in between, so it is stale, never "saved"', async () => {
    const { hub, port } = fakeHub()
    const pending = pendingRates()
    hub.otherAdminSavesRates('2026-07', { nsf_employee_rate: 1, nsf_ceiling: 29710, nsf_exempt_at_60: true, csg_employee_rate_low: 1.5, csg_employee_rate_high: 3, csg_threshold: 50000, source_note: RATES_JULY.sourceNote })
    // My save gets no answer, as a time-out would give.
    const lost: HubPort = { ...port, send: (type, payload) => (type === 'send-data' ? Promise.resolve({ ok: false, error: 'The dashboard did not answer in time.' }) : port.send(type, payload)) }
    const outcome = await saveRates(lost, pending)
    // Same values, revision moved by one, but not marked as mine.
    expect(outcome.end).toBe('stale')
  })

  it('rates: the judgement itself', () => {
    const pending = pendingRates(1)
    const version = (revision: number, change: object = {}) => ({ ...RATES_JULY, revision, createdByYou: true, ...change })
    expect(judgeRatesSave([version(1)], pending)).toBe('not-saved')
    expect(judgeRatesSave([version(1), version(2)], pending)).toBe('saved')
    expect(judgeRatesSave([version(1), version(2, { createdByYou: false })], pending)).toBe('stale')
    expect(judgeRatesSave([version(1), version(2, { nsfCeiling: 1 })], pending)).toBe('stale')
    expect(judgeRatesSave([version(1), version(2, { sourceNote: null })], pending)).toBe('stale')
    expect(judgeRatesSave([version(1), version(2), version(3)], pending)).toBe('stale')
  })

  it('when the reload fails too, the outcome is "unconfirmed": check again, never a blind resend', async () => {
    const { hub, port, sent } = fakeHub()
    hub.state.nextSave = { mode: 'lost' }
    hub.state.nextRequest = { mode: 'lost' }
    const pending = pendingRates()
    const outcome = await saveRates(port, pending)
    expect(outcome.end).toBe('unconfirmed')
    expect(outcome.failure?.kind).toBe('no-answer')
    expect(outcome.failure?.detail).toContain('will not send it twice')
    expect(sent()).toEqual(['send-data statutory-rates', 'request-data statutory-rates'])
    // "Check again" only asks; it finds the save that was stored.
    const checked = await checkRatesSave(port, pending, outcome.failure!)
    expect(checked.end).toBe('saved')
    expect(sent().filter((entry) => entry.startsWith('send-data'))).toHaveLength(1)
    expect(hub.state.rates).toHaveLength(1)
  })

  it('a draft: stored but unanswered is found by the reload (revision +1, same body, mine)', async () => {
    const { hub, port, sent, edit } = await withTemplate()
    hub.state.nextSave = { mode: 'unavailable' }
    const outcome = await saveDraft(port, edit('Pay advice'))
    expect(outcome.end).toBe('saved')
    expect(outcome.saved?.draftRevision).toBe(2)
    expect(sent()).toEqual(['send-data payslip-template save-draft', 'request-data payslip-template load'])
  })

  it('a draft: not stored is found by the reload, and the retry uses the same expected_revision', async () => {
    const { hub, port, edit } = await withTemplate()
    hub.state.nextSave = { mode: 'lost-unsaved' }
    const pending = edit('Pay advice')
    expect((await saveDraft(port, pending)).end).toBe('not-saved')
    expect((await saveDraft(port, pending)).end).toBe('saved')
    expect(hub.state.templates[0].revision).toBe(2)
  })

  it('a draft: someone else saved in between is stale, and their draft is handed back', async () => {
    const { hub, port, templateId, edit } = await withTemplate()
    hub.otherAdminSavesDraft(templateId, { body: relabelled('Their title') as unknown as Record<string, unknown> })
    const outcome = await saveDraft(port, edit('My title'))
    expect(outcome.end).toBe('stale')
    expect(outcome.newer).toMatchObject({ draftRevision: 2, updatedByYou: false })
    expect((outcome.newer!.body as TemplateBody).labels.title).toBe('Their title')
    expect((hub.state.templates[0].body as unknown as TemplateBody).labels.title).toBe('Their title')

    // The same through the reload rule: revision moved by one, but it is not mine.
    const checked = await checkDraftSave(port, edit('My title'), failure('no-answer'))
    expect(checked.end).toBe('stale')
  })

  it('a draft whose stored body differs from what was sent is stale, even at revision +1 and mine', async () => {
    const { hub, port, edit } = await withTemplate()
    await saveDraft(port, edit('Something else'))
    expect(hub.state.templates[0].revision).toBe(2)
    const checked = await checkDraftSave(port, edit('Pay advice'), failure('no-answer'))
    expect(checked.end).toBe('stale')
  })

  it('a draft with exactly my body at revision +1, but saved by someone else, is not reported as my save', async () => {
    const { hub, port, templateId, edit } = await withTemplate()
    hub.otherAdminSavesDraft(templateId, { body: relabelled('Pay advice') as unknown as Record<string, unknown> })
    expect((await checkDraftSave(port, edit('Pay advice'), failure('no-answer'))).end).toBe('stale')
  })

  it('a version published by someone else is not reported as my publication', async () => {
    const { hub, port, templateId, publication } = await withTemplate()
    hub.state.versions.push({ templateId, version: 1, name: 'Monthly payslip', body: { ...BUILT_IN_BODY }, publishedAt: '2026-10-07T10:00:00+04:00', by: 'other' })
    expect((await checkPublish(port, publication(), failure('no-answer'))).end).toBe('stale')
    hub.state.versions[0].by = 'you'
    expect((await checkPublish(port, publication(), failure('no-answer'))).end).toBe('saved')
  })

  it('a new template: found by its name after a lost answer, not created twice', async () => {
    const { hub, port, sent } = fakeHub()
    hub.state.nextSave = { mode: 'lost' }
    const outcome = await saveDraft(port, newDraft())
    expect(outcome.end).toBe('saved')
    expect(outcome.saved).toMatchObject({ name: 'Monthly payslip', draftRevision: 1 })
    expect(sent()).toEqual(['send-data payslip-template save-draft', 'request-data payslip-template list', 'request-data payslip-template load'])
    expect(hub.state.templates).toHaveLength(1)

    const other = fakeHub()
    other.hub.state.nextSave = { mode: 'lost-unsaved' }
    expect((await saveDraft(other.port, newDraft())).end).toBe('not-saved')
  })

  it('a publish: stored but unanswered is found (version +1, the body that was published, mine)', async () => {
    const { hub, port, sent, publication } = await withTemplate()
    hub.state.nextSave = { mode: 'lost' }
    const outcome = await publishDraft(port, publication())
    expect(outcome).toMatchObject({ end: 'saved', version: 1 })
    expect(sent()).toEqual(['send-data payslip-template publish', 'request-data payslip-template list', 'request-data payslip-template load'])
    expect(hub.state.versions).toHaveLength(1)
  })

  it('a publish: not stored is found, and nothing is published twice', async () => {
    const { hub, port, publication } = await withTemplate()
    hub.state.nextSave = { mode: 'unavailable-unsaved' }
    const pending = publication()
    const outcome = await publishDraft(port, pending)
    expect(outcome.end).toBe('not-saved')
    expect(outcome.failure?.detail).toContain('nothing was published')
    expect((await publishDraft(port, pending)).end).toBe('saved')
    expect(hub.state.versions).toHaveLength(1)
    // Publishing the same draft again is "no-change".
    expect((await publishDraft(port, { ...pending, publishedBefore: 1 })).end).toBe('no-change')
  })

  it('a publish that someone else made of another draft is stale', async () => {
    const { hub, port, templateId, publication } = await withTemplate()
    hub.otherAdminSavesDraft(templateId, { body: relabelled('Their title') as unknown as Record<string, unknown> })
    expect((await publishDraft(port, publication())).end).toBe('stale')
    expect((await checkPublish(port, publication(), failure('no-answer'))).end).toBe('stale')
    expect(hub.state.versions).toHaveLength(0)
  })
})

describe('the company check on every answer', () => {
  it('refuses an answer about another company than the one whose payroll data is open', async () => {
    const { hub, port } = fakeHub()
    await saveRates(port, pendingRates())
    // A dashboard that answers for another company without checking the BRN it was sent.
    const careless: HubPort = { ...port, send: async (type, payload) => ({ ...(await port.send(type, payload) as object), meta: { label: 'XYZ Ltd', brn: 'C7654321' } }) }
    const loaded = await loadRates(careless, BRN)
    expect(loaded).toMatchObject({ ok: false, failure: { kind: 'other-company' } })
    expect((await listTemplates(careless, BRN)).ok).toBe(false)
    expect(hub.state.rates).toHaveLength(1)
  })

  it('refuses an answer with no meta.brn', async () => {
    const { hub, port } = fakeHub()
    hub.state.company = { name: 'ABC Co Ltd', brn: null }
    expect(await loadRates(port, null)).toMatchObject({ ok: false, failure: { kind: 'no-company-brn' } })
    expect(await listTemplates(port, null)).toMatchObject({ ok: false, failure: { kind: 'no-company-brn' } })
  })

  it('compares BRNs as the dashboard does (case and spaces), and reports the company when none is expected', async () => {
    const { port } = fakeHub()
    expect((await loadRates(port, ' c1234567 ')).ok).toBe(true)
    expect(await loadRates(port, null)).toMatchObject({ ok: true, company: { name: 'ABC Co Ltd', brn: BRN } })
  })

  it('the dashboard refuses a request and a save for a company it has not selected', async () => {
    const { hub, port } = fakeHub()
    expect(await loadRates(port, 'C7654321')).toMatchObject({ ok: false, failure: { kind: 'wrong-company' } })
    expect((await saveDraft(port, { ...newDraft(), brn: 'C7654321' })).failure?.kind).toBe('wrong-company')
    expect(hub.state.templates).toHaveLength(0)
  })
})

describe('answers are validated before anything is used', () => {
  const answering = (reply: unknown): HubPort => ({ send: () => Promise.resolve(reply), requestTimeoutMs: 40 })
  const row = { effective_from: '2026-07', revision: 1, nsf_employee_rate: 1, nsf_ceiling: 29710, nsf_exempt_at_60: true, csg_employee_rate_low: 1.5, csg_employee_rate_high: 3, csg_threshold: 50000, source_note: null, created_at: '2026-07-02T09:00:00+04:00', created_by_you: true }
  const ok = (rows: unknown[], dataType = STATUTORY_RATES) => ({ ok: true, dataType, rows, meta: { label: 'ABC Co Ltd', brn: BRN } })

  it('accepts a well-formed answer', async () => {
    expect((await loadRates(answering(ok([row])), BRN)).ok).toBe(true)
  })

  it.each([
    ['a rate sent as text', ok([{ ...row, nsf_employee_rate: '1' }])],
    ['a missing field', ok([{ ...row, csg_threshold: undefined }])],
    ['a month that is not a month', ok([{ ...row, effective_from: '2026-13' }])],
    ['a rate above 100', ok([{ ...row, csg_employee_rate_high: 300 }])],
    ['another data type', ok([row], 'payroll-result')],
    ['rows that are not a list', { ok: true, dataType: STATUTORY_RATES, rows: 'none', meta: { brn: BRN } }],
    ['something that is not an answer', 'hello'],
  ])('refuses %s', async (_name, reply) => {
    expect(await loadRates(answering(reply), BRN)).toMatchObject({ ok: false, failure: { kind: 'bad-answer' } })
  })

  it('a template answer for another template than the one asked for is refused', async () => {
    const { port, templateId } = await withTemplate()
    const other = '20000000-0000-4000-8000-000000000077'
    const swapped: HubPort = { ...port, send: async (type, payload) => {
      const answer = (await port.send(type, payload)) as { rows: Record<string, unknown>[] }
      return { ...answer, rows: answer.rows.map((r) => ({ ...r, template_id: other })) }
    } }
    expect((await loadDraft(port, BRN, templateId)).ok).toBe(true)
    expect(await loadDraft(swapped, BRN, templateId)).toMatchObject({ ok: false, failure: { kind: 'bad-answer' } })
  })

  it('an ok save whose result is not the agreed one is not trusted: reload and compare', async () => {
    const saved = await sendSave(answering({ ok: true, result: { revision: 'two' } }), STATUTORY_RATES, {}, z.object({ revision: z.number() }))
    expect(saved).toMatchObject({ ok: false, uncertain: true, failure: { kind: 'bad-answer' } })
  })

  it('no answer to a request ends after the app\'s own time-out, as "the dashboard did not answer"', async () => {
    const silent: HubPort = { send: () => new Promise(() => {}), requestTimeoutMs: 30 }
    const started = Date.now()
    const answer = await ask(silent, STATUTORY_RATES, {}, BRN, z.unknown())
    expect(answer).toMatchObject({ ok: false, failure: { kind: 'no-answer', title: 'The dashboard did not answer' } })
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('a refusal with no code (the bridge giving up, "not registered") counts as no answer', async () => {
    const answer = await loadRates(answering({ ok: false, error: 'This app is not registered for that kind of data.' }), BRN)
    expect(answer).toMatchObject({ ok: false, failure: { kind: 'no-answer', hubError: 'This app is not registered for that kind of data.' } })
  })

  it('canonical JSON ignores key order, so a body stored as jsonb still compares equal', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }))
    expect(canonicalJson({ a: [1, 2] })).not.toBe(canonicalJson({ a: [2, 1] }))
  })
})

describe('opened on its own, outside the dashboard', () => {
  it('the bridge sends nothing: a save or a request is answered locally and no message is posted', async () => {
    const posted: unknown[] = []
    const window: Record<string, unknown> = { addEventListener: () => {}, postMessage: (message: unknown) => posted.push(message) }
    window.parent = window // not in a frame
    vm.runInNewContext(readFileSync(resolve(root, 'src/payrollHubBridge.js'), 'utf8'), { window, setTimeout, clearTimeout })
    const bridge = window.PayrollHubBridge as Window['PayrollHubBridge']
    bridge.init({ appId: 'payslip' })
    const port: HubPort = { send: (type, payload) => bridge.sendToDashboard(type, payload) }
    expect(bridge.isEmbedded()).toBe(false)
    expect((await loadRates(port, BRN)).ok).toBe(false)
    expect((await saveRates(port, pendingRates())).end).toBe('unconfirmed')
    expect(posted).toHaveLength(0)
  })

  it('the cross-check uses the bundled defaults, and only then', () => {
    expect(ratesForCrossCheck({ status: 'standalone' }, '2026-09')).toEqual({ versions: DEFAULT_STATUTORY_RATES, whyNone: null })
  })

  it('inside the dashboard the defaults are never used: with nothing loaded or saved it says so', () => {
    const company = { name: 'ABC Co Ltd', brn: BRN }
    const waiting = ratesForCrossCheck({ status: 'loading' }, '2026-09')
    expect(waiting.versions).toEqual([])
    expect(waiting.whyNone).toContain('have not been loaded from the dashboard yet')

    const failed = ratesForCrossCheck({ status: 'failed', failure: failure('wrong-company') }, '2026-09')
    expect(failed.versions).toEqual([])
    expect(failed.whyNone).toContain('could not be loaded from the dashboard (the dashboard has another company selected)')

    const none = ratesForCrossCheck({ status: 'loaded', versions: [], company }, '2026-09')
    expect(none.versions).toEqual([])
    expect(none.whyNone).toContain('The dashboard has no statutory rates saved for this company')

    const later = ratesForCrossCheck({ status: 'loaded', versions: [{ ...RATES_JULY, revision: 1 }], company }, '2026-06')
    expect(later.whyNone).toContain('start in July 2026, after this pay month')
    expect(ratesForCrossCheck({ status: 'loaded', versions: [{ ...RATES_JULY, revision: 1 }], company }, '2026-07').whyNone).toBeNull()
  })
})

describe('what Phase 4 added to every exchange', () => {
  it('each answer says the role: an admin, or a member who sees read-only from the start', async () => {
    const { hub, port } = fakeHub()
    expect(await loadRates(port, BRN)).toMatchObject({ ok: true, role: 'admin' })
    hub.state.role = 'viewer'
    expect(await loadRates(port, BRN)).toMatchObject({ ok: true, role: 'member' })
    expect(await listTemplates(port, BRN)).toMatchObject({ ok: true, role: 'member' })
  })

  it('an answer without a role is still used, with the role unknown', async () => {
    const plain: HubPort = { send: () => Promise.resolve({ ok: true, dataType: STATUTORY_RATES, rows: [], meta: { brn: BRN } }) }
    expect(await loadRates(plain, BRN)).toMatchObject({ ok: true, role: null })
  })

  it('a refusal can carry the position of the payslip at fault, and "locked" is not a maybe', async () => {
    const answering = (reply: unknown): HubPort => ({ send: () => Promise.resolve(reply) })
    const stale = await sendSave(answering({ ok: false, code: 'stale', error: 'Payslip 3 was issued by someone else.', index: 2 }), 'payslip-issue', {}, z.unknown())
    expect(stale).toMatchObject({ ok: false, uncertain: false, failure: { kind: 'stale', index: 2 } })
    const locked = await sendSave(answering({ ok: false, code: 'locked', error: 'The dashboard is locked.' }), 'payslip-issue', {}, z.unknown())
    expect(locked).toMatchObject({ ok: false, uncertain: false, failure: { kind: 'locked', index: null, title: 'The dashboard is locked' } })
    for (const code of ['denied', 'timeout'] as const) {
      expect(failure(code).title).not.toBe(failure('no-answer').title)
    }
  })

  it('a request that waits for the dashboard user is not cut short by the 15-second rule', async () => {
    const slow: HubPort = { requestTimeoutMs: 20, send: () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, dataType: 'payslip-issue', rows: [], meta: { brn: BRN } }), 120)) }
    expect((await ask(slow, 'payslip-issue', {}, BRN, z.unknown())).ok).toBe(false)
    expect((await ask(slow, 'payslip-issue', {}, BRN, z.unknown(), { timeoutMs: null })).ok).toBe(true)
  })
})
