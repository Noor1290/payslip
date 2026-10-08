// Payslip templates through the dashboard: list, load a draft or a published version, save a
// draft, publish, and the reload rule after a save nobody could confirm.
// Wire format: docs/INTEGRATION.md. A body is checked by templateBody.ts before it is used.

import { z } from 'zod'
import {
  ask,
  failure,
  PAYSLIP_TEMPLATE,
  sendSave,
  type Failure,
  type HubCompany,
  type HubPort,
  type HubRole,
  type SaveEnd,
} from './hubWire'
import { sameBody, type TemplateBody } from './templateBody'

const id = z.uuid()
const name = z.string().min(1).max(200)
const stamp = z.string().max(40)
const revision = z.number().int().min(1)
/** Whatever the dashboard stored. templateBody.readBody decides whether it can be used. */
const rawBody = z.record(z.string(), z.unknown())

const summarySchema = z
  .object({
    template_id: id,
    name,
    draft_revision: revision,
    updated_at: stamp,
    updated_by_you: z.boolean(),
    published_version: revision.nullable(),
    published_at: stamp.nullable(),
  })
  .transform((row) => ({
    templateId: row.template_id,
    name: row.name,
    draftRevision: row.draft_revision,
    updatedAt: row.updated_at,
    updatedByYou: row.updated_by_you,
    publishedVersion: row.published_version,
    publishedAt: row.published_at,
  }))
export type TemplateSummary = z.infer<typeof summarySchema>

const draftSchema = z
  .object({ template_id: id, name, draft_revision: revision, body: rawBody, updated_at: stamp, updated_by_you: z.boolean() })
  .transform((row) => ({
    templateId: row.template_id,
    name: row.name,
    draftRevision: row.draft_revision,
    body: row.body as unknown,
    updatedAt: row.updated_at,
    updatedByYou: row.updated_by_you,
  }))
export type TemplateDraft = z.infer<typeof draftSchema>

const versionSchema = z
  .object({ template_id: id, name, version: revision, body: rawBody, published_at: stamp, published_by_you: z.boolean() })
  .transform((row) => ({
    templateId: row.template_id,
    name: row.name,
    version: row.version,
    body: row.body as unknown,
    publishedAt: row.published_at,
    publishedByYou: row.published_by_you,
  }))
export type TemplateVersion = z.infer<typeof versionSchema>

const savedDraftSchema = z.object({ template_id: id, name, draft_revision: revision, updated_at: stamp })
const publishedSchema = z.object({ template_id: id, version: revision, draft_revision: revision, published_at: stamp })

type Loaded<T> = { ok: true; value: T; company: HubCompany; role: HubRole | null } | { ok: false; failure: Failure }

export async function listTemplates(port: HubPort, expectedBrn: string | null): Promise<Loaded<TemplateSummary[]>> {
  const answer = await ask(port, PAYSLIP_TEMPLATE, { action: 'list' }, expectedBrn, summarySchema)
  return answer.ok ? { ok: true, value: answer.rows, company: answer.company, role: answer.role } : answer
}

async function loadOne<T extends { templateId: string }>(
  port: HubPort,
  expectedBrn: string | null,
  params: Record<string, unknown>,
  schema: z.ZodType<T>,
): Promise<Loaded<T>> {
  const answer = await ask(port, PAYSLIP_TEMPLATE, { action: 'load', ...params }, expectedBrn, schema)
  if (!answer.ok) return answer
  // One row, and the template that was asked for: anything else is not the agreed answer.
  if (answer.rows.length !== 1 || answer.rows[0].templateId !== params.template_id) {
    return { ok: false, failure: failure('bad-answer') }
  }
  return { ok: true, value: answer.rows[0], company: answer.company, role: answer.role }
}

export function loadDraft(port: HubPort, expectedBrn: string | null, templateId: string): Promise<Loaded<TemplateDraft>> {
  return loadOne(port, expectedBrn, { template_id: templateId }, draftSchema)
}

export function loadVersion(
  port: HubPort,
  expectedBrn: string | null,
  templateId: string,
  version: number,
): Promise<Loaded<TemplateVersion>> {
  return loadOne(port, expectedBrn, { template_id: templateId, version }, versionSchema)
}

/** A draft save the user asked for. Kept as it is until its outcome is known. */
export interface PendingDraftSave {
  brn: string
  /** Null for a new template. */
  templateId: string | null
  name: string
  body: TemplateBody
  /** The draft revision the app last saw; 0 for a new template. */
  expectedRevision: number
}

/** The one row of a draft save: always the whole draft, name and body. */
export function draftSaveRow(pending: PendingDraftSave): Record<string, unknown> {
  return {
    action: 'save-draft',
    brn: pending.brn,
    ...(pending.templateId === null ? {} : { template_id: pending.templateId }),
    name: pending.name.trim(),
    body: pending.body,
    expected_revision: pending.templateId === null ? 0 : pending.expectedRevision,
  }
}

export interface DraftOutcome {
  end: SaveEnd
  failure: Failure | null
  /** When saved: where the draft now stands. */
  saved: { templateId: string; name: string; draftRevision: number } | null
  /** When stale: the newer draft someone else saved, if it could be loaded. */
  newer: TemplateDraft | null
}

const UNCONFIRMED =
  'The save may or may not have been stored, and the dashboard could not be asked. Check again before saving: the app will not send it twice.'
const NOT_SAVED = 'Checked with the dashboard: the save was not stored, and nobody else changed this template. You can save again.'

const unconfirmed = (found: Failure): Failure => ({ ...found, detail: `${UNCONFIRMED} ${found.detail}` })

/**
 * Did the draft save go through? The draft is loaded again and compared:
 *  - still at the expected revision: NOT stored;
 *  - moved on by exactly one, with the name and body that were sent, and marked as mine: stored;
 *  - anything else: someone else saved in between.
 */
export function judgeDraftSave(draft: TemplateDraft, pending: PendingDraftSave): 'saved' | 'not-saved' | 'stale' {
  const expected = pending.templateId === null ? 0 : pending.expectedRevision
  if (draft.draftRevision === expected) return 'not-saved'
  return draft.draftRevision === expected + 1 && draft.updatedByYou && draft.name === pending.name.trim() && sameBody(draft.body, pending.body)
    ? 'saved'
    : 'stale'
}

/** The reload rule for a draft. It never sends the save itself. */
export async function checkDraftSave(port: HubPort, pending: PendingDraftSave, cause: Failure): Promise<DraftOutcome> {
  const none = { saved: null, newer: null }
  let templateId = pending.templateId
  if (templateId === null) {
    // A new template has no id yet: it is looked for by its name, which is unique in the company.
    const list = await listTemplates(port, pending.brn)
    if (!list.ok) return { end: 'unconfirmed', failure: unconfirmed(list.failure), ...none }
    const wanted = pending.name.trim().toLowerCase()
    const found = list.value.find((item) => item.name.trim().toLowerCase() === wanted)
    if (!found) return { end: 'not-saved', failure: { ...cause, detail: NOT_SAVED }, ...none }
    templateId = found.templateId
  }
  const loaded = await loadDraft(port, pending.brn, templateId)
  if (!loaded.ok) {
    if (loaded.failure.kind === 'not-found') return { end: 'refused', failure: loaded.failure, ...none }
    return { end: 'unconfirmed', failure: unconfirmed(loaded.failure), ...none }
  }
  const verdict = judgeDraftSave(loaded.value, pending)
  if (verdict === 'saved') {
    const { name: savedName, draftRevision } = loaded.value
    return { end: 'saved', failure: null, saved: { templateId, name: savedName, draftRevision }, newer: null }
  }
  if (verdict === 'stale') return { end: 'stale', failure: failure('stale'), saved: null, newer: loaded.value }
  return { end: 'not-saved', failure: { ...cause, detail: NOT_SAVED }, ...none }
}

/** Sends the draft ONCE. On doubt it reloads and compares; on "stale" it fetches the newer draft. */
export async function saveDraft(port: HubPort, pending: PendingDraftSave): Promise<DraftOutcome> {
  const sent = await sendSave(port, PAYSLIP_TEMPLATE, draftSaveRow(pending), savedDraftSchema)
  if (sent.ok) {
    const { template_id: templateId, name: savedName, draft_revision: draftRevision } = sent.result
    return { end: 'saved', failure: null, saved: { templateId, name: savedName, draftRevision }, newer: null }
  }
  if (sent.uncertain) return checkDraftSave(port, pending, sent.failure)
  if (sent.failure.kind === 'stale' && pending.templateId !== null) {
    const loaded = await loadDraft(port, pending.brn, pending.templateId)
    return { end: 'stale', failure: sent.failure, saved: null, newer: loaded.ok ? loaded.value : null }
  }
  const end: SaveEnd = sent.failure.kind === 'stale' ? 'stale' : sent.failure.kind === 'no-change' ? 'no-change' : 'refused'
  return { end, failure: sent.failure, saved: null, newer: null }
}

/** A publication the user asked for: exactly this draft revision, as the next version. */
export interface PendingPublish {
  brn: string
  templateId: string
  /** The draft revision being published. */
  expectedRevision: number
  /** The latest published version the app had seen, or null when never published. */
  publishedBefore: number | null
  /** The draft being published, to recognise it afterwards. */
  name: string
  body: TemplateBody
}

export function publishRow(pending: PendingPublish): Record<string, unknown> {
  return { action: 'publish', brn: pending.brn, template_id: pending.templateId, expected_revision: pending.expectedRevision }
}

export interface PublishOutcome {
  end: SaveEnd
  failure: Failure | null
  /** When published: the new version number. */
  version: number | null
}

/** The reload rule for a publication. It never sends the publish itself. */
export async function checkPublish(port: HubPort, pending: PendingPublish, cause: Failure): Promise<PublishOutcome> {
  const list = await listTemplates(port, pending.brn)
  if (!list.ok) return { end: 'unconfirmed', failure: unconfirmed(list.failure), version: null }
  const found = list.value.find((item) => item.templateId === pending.templateId)
  if (!found) return { end: 'refused', failure: failure('not-found'), version: null }

  const before = pending.publishedBefore ?? 0
  const now = found.publishedVersion ?? 0
  if (now === before) {
    if (found.draftRevision !== pending.expectedRevision) return { end: 'stale', failure: failure('stale'), version: null }
    return { end: 'not-saved', failure: { ...cause, detail: NOT_SAVED.replace('the save was not stored', 'nothing was published') }, version: null }
  }
  if (now !== before + 1) return { end: 'stale', failure: failure('stale'), version: null }

  const published = await loadVersion(port, pending.brn, pending.templateId, now)
  if (!published.ok) return { end: 'unconfirmed', failure: unconfirmed(published.failure), version: null }
  const mine = published.value.publishedByYou && published.value.name === pending.name.trim() && sameBody(published.value.body, pending.body)
  return mine ? { end: 'saved', failure: null, version: now } : { end: 'stale', failure: failure('stale'), version: null }
}

/** Sends the publish ONCE. On doubt it reloads and compares before anything else is offered. */
export async function publishDraft(port: HubPort, pending: PendingPublish): Promise<PublishOutcome> {
  const sent = await sendSave(port, PAYSLIP_TEMPLATE, publishRow(pending), publishedSchema)
  if (sent.ok) return { end: 'saved', failure: null, version: sent.result.version }
  if (sent.uncertain) return checkPublish(port, pending, sent.failure)
  const end: SaveEnd = sent.failure.kind === 'stale' ? 'stale' : sent.failure.kind === 'no-change' ? 'no-change' : 'refused'
  return { end, failure: sent.failure, version: null }
}
