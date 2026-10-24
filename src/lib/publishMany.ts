// Publishing a template to several companies, and saving which template the payslips use.
// The dashboard decides which companies may be chosen (only those where the user is an admin)
// and checks it again on every save; this file only presents its check, decides what is ticked
// at first, and publishes one company at a time so that one failure never stops the others.
// Wire format: docs/INTEGRATION.md, payslip-template ("The template used for the payslips, and
// publishing to several companies"). Nothing here holds payroll figures: only column names.

import { z } from 'zod'
import { formatPeriod } from './dates'
import { normaliseKey } from './payrollFile'
import { ask, failure, normaliseBrn, PAYSLIP_TEMPLATE, sendSave, type Failure, type HubPort, type SaveEnd } from './hubWire'
import { FIXED_LINES } from './template'
import type { TemplateBody } from './templateBody'

const id = z.uuid()
const revision = z.number().int().min(1)
const name = z.string().min(1).max(200)

// ---------- the template used for the payslips ----------

const useResultSchema = z.object({ action: z.literal('use'), template_id: id.nullable(), version: revision.nullable() })

/**
 * Saves which version the selected company's payslips use (both null: the built-in), so it is
 * chosen again the next time. Admins only. The same choice saved twice changes nothing, so a
 * save nobody confirmed may simply be made again.
 */
export async function saveTemplateInUse(
  port: HubPort,
  brn: string,
  templateId: string | null,
  version: number | null,
): Promise<{ ok: true } | { ok: false; failure: Failure }> {
  const sent = await sendSave(port, PAYSLIP_TEMPLATE, { action: 'use', brn, template_id: templateId, version }, useResultSchema)
  if (!sent.ok) return { ok: false, failure: sent.failure }
  return sent.result.template_id === templateId && sent.result.version === version ? { ok: true } : { ok: false, failure: failure('bad-answer') }
}

// ---------- the check ----------

const checkSchema = z
  .object({
    brn: z.string().min(1).max(50),
    company: z.string().max(120),
    selected: z.boolean(),
    templates: z.number().int().min(0).max(1_000),
    template: z
      .object({
        template_id: id,
        name,
        draft_revision: revision,
        published_version: revision.nullable(),
        unpublished_changes: z.boolean(),
        /** Its latest version already is exactly the draft being published. */
        latest_is_same: z.boolean().optional(),
      })
      .nullable(),
    payroll: z
      .object({
        period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
        employees: z.number().int().min(0),
        columns: z.array(z.string().max(200)).max(2_000),
      })
      .nullable(),
  })
  .transform((row) => ({
    brn: row.brn,
    company: row.company,
    selected: row.selected,
    templates: row.templates,
    template: row.template && {
      templateId: row.template.template_id,
      name: row.template.name,
      draftRevision: row.template.draft_revision,
      publishedVersion: row.template.published_version,
      unpublishedChanges: row.template.unpublished_changes,
      latestIsSame: row.template.latest_is_same ?? false,
    },
    payroll: row.payroll,
  }))
/** One company the user is an admin of, as the dashboard checked it. */
export type CompanyCheck = z.infer<typeof checkSchema>

export type Checked = { ok: true; companies: CompanyCheck[] } | { ok: false; failure: Failure }

/** The dashboard answers a check this many companies at a time; a shorter page is the last. */
export const CHECK_PAGE = 50
/** The dashboard's last page (999): 50,000 companies. */
const CHECK_PAGES = 1_000

/**
 * The companies the user is an admin of, checked for a template with that name, asked for one
 * page at a time until a page is not full. The selected one comes first; each company once.
 */
export async function checkCompanies(port: HubPort, brn: string, templateName: string): Promise<Checked> {
  const companies: CompanyCheck[] = []
  const seen = new Set<string>()
  for (let page = 0; ; page++) {
    if (page >= CHECK_PAGES) return { ok: false, failure: failure('bad-answer') }
    const answer = await ask(port, PAYSLIP_TEMPLATE, { action: 'check', name: templateName.trim(), page }, brn, checkSchema, { maxRows: CHECK_PAGE })
    if (!answer.ok) return answer
    for (const row of answer.rows) {
      // A company that moved from one page to the next while the pages were read is kept once.
      if (seen.has(normaliseBrn(row.brn))) continue
      seen.add(normaliseBrn(row.brn))
      companies.push(row)
    }
    if (answer.rows.length < CHECK_PAGE) break
  }
  const selected = companies.filter((row) => row.selected)
  if (selected.length !== 1 || normaliseBrn(selected[0].brn) !== normaliseBrn(brn)) return { ok: false, failure: failure('bad-answer') }
  return { ok: true, companies }
}

/** The payroll columns the template's lines are filled from, each with the old names it also accepts. */
export function columnsUsed(body: TemplateBody): { label: string; key: string; aliases: string[] }[] {
  const lines = [...body.earnings, ...body.deductionGroups.flatMap((group) => group.lines)]
  return lines.flatMap((line) => {
    const key = body.mapping.lines[line.id]?.key
    return key ? [{ label: line.label, key, aliases: FIXED_LINES[line.id]?.aliases ?? [] }] : []
  })
}

/** The most templates a company can have: publishing a NEW template to one that has them fails. */
export const MAX_TEMPLATES = 50

export interface CompanyPlan {
  brn: string
  company: string
  /** The company selected in the dashboard: always published to, never unticked. */
  thisCompany: boolean
  /** Why it is unticked at first. Empty when it is ready. */
  reasons: string[]
  /** Why it cannot be ticked at all, or null. */
  blocked: string | null
  /** What publishing does there. */
  what: string
  /** Sent with the save: the draft revision seen there (0 for none) and its latest version. */
  expectedRevision: number
  publishedBefore: number | null
}

const quoted = (names: string[]) => names.map((key) => `"${key}"`).join(', ')

/**
 * What publishing would do in each company, and why some are unticked at first: a column the
 * lines use is missing from its newest saved payroll, there is no saved payroll to check
 * against, or its draft of the template holds changes that were never published.
 */
export function planCompanies(
  companies: readonly CompanyCheck[],
  input: { name: string; body: TemplateBody; draftRevision: number; publishedVersion: number | null },
): CompanyPlan[] {
  const used = columnsUsed(input.body)
  const templateName = input.name.trim()
  return companies.map((check) => {
    const reasons: string[] = []
    if (!check.payroll) {
      reasons.push('No saved payroll yet to check the columns against')
    } else {
      // Matched as the payslip itself matches them: capitals and extra spaces ignored.
      const present = new Set(check.payroll.columns.map(normaliseKey))
      const has = (key: string) => present.has(normaliseKey(key))
      const missing = [...new Set(used.filter((line) => !has(line.key) && !line.aliases.some(has)).map((line) => line.key))]
      if (missing.length > 0) {
        reasons.push(`Its payroll of ${formatPeriod(check.payroll.period)} has no ${missing.length === 1 ? 'column' : 'columns'} ${quoted(missing)}`)
      }
    }
    const template = check.template
    if (!check.selected && template?.unpublishedChanges) {
      reasons.push(`Its draft of "${template.name}" has changes that were never published; publishing replaces them`)
    }
    const blocked = !template && check.templates >= MAX_TEMPLATES ? `It has ${MAX_TEMPLATES} templates already, the most a company can have` : null
    const next = check.selected ? (input.publishedVersion ?? 0) + 1 : (template?.publishedVersion ?? 0) + 1
    const what =
      template?.latestIsSame && template.publishedVersion !== null
        ? `Already has this as version ${template.publishedVersion}; it becomes the one used for the payslips`
        : template || check.selected
          ? `New version ${next} of "${template?.name ?? templateName}"`
          : `New template "${templateName}", version 1`
    return {
      brn: check.brn,
      company: check.company,
      thisCompany: check.selected,
      reasons,
      blocked,
      what,
      // This company publishes exactly the draft the editor saved, never one saved after it.
      expectedRevision: check.selected ? input.draftRevision : (template?.draftRevision ?? 0),
      publishedBefore: check.selected ? input.publishedVersion : (template?.publishedVersion ?? null),
    }
  })
}

export type PublishTarget = 'this' | 'selected' | 'all'

/**
 * Which companies are ticked at first. This company always; with "All my companies" every other
 * one that is ready; with "Selected companies" only this one, the user ticks the rest. A company
 * with a reason is never ticked at first, and a blocked one never at all.
 */
export function initialTicks(plans: readonly CompanyPlan[], target: PublishTarget): Set<string> {
  return new Set(plans.filter((plan) => plan.thisCompany || (target === 'all' && plan.reasons.length === 0 && plan.blocked === null)).map((plan) => plan.brn))
}

// ---------- publishing, one company at a time ----------

const copyResultSchema = z.object({
  action: z.literal('publish-copy'),
  brn: z.string().min(1).max(50),
  company: z.string().max(120),
  template_id: id,
  name,
  version: revision,
  draft_revision: revision,
  created: z.boolean(),
  published: z.boolean(),
  published_at: z.string().max(40),
})

export interface PendingCopy {
  brn: string
  companyBrn: string
  name: string
  body: TemplateBody
  expectedRevision: number
  publishedBefore: number | null
}

export type CopyOutcome =
  | { end: 'saved'; templateId: string | null; name: string; version: number; created: boolean; published: boolean }
  | { end: Exclude<SaveEnd, 'saved'>; failure: Failure }

export function copyRow(pending: PendingCopy): Record<string, unknown> {
  return {
    action: 'publish-copy',
    brn: pending.brn,
    company_brn: pending.companyBrn,
    name: pending.name.trim(),
    body: pending.body,
    expected_revision: pending.expectedRevision,
  }
}

const NOT_PUBLISHED = 'Checked with the dashboard: nothing was published there. You can publish to it again.'
const NOT_CONFIRMED = 'It may or may not have been published there, and the dashboard could not be asked. Check the companies again before publishing to it again.'

/**
 * The reload rule for one company: check it again and compare with what was seen before. The
 * draft and the latest version moved on by at most one, with nothing left unpublished, means it
 * went through; both unchanged means it did not (and sending it again is harmless); anything else
 * means someone else changed it meanwhile.
 */
export async function checkCopy(port: HubPort, pending: PendingCopy, cause: Failure): Promise<CopyOutcome> {
  const checked = await checkCompanies(port, pending.brn, pending.name)
  if (!checked.ok) return { end: 'unconfirmed', failure: { ...checked.failure, detail: `${NOT_CONFIRMED} ${checked.failure.detail}` } }
  const row = checked.companies.find((company) => normaliseBrn(company.brn) === normaliseBrn(pending.companyBrn))
  if (!row) return { end: 'refused', failure: failure('forbidden') }
  const now = row.template
  const before = pending.publishedBefore ?? 0
  if (pending.expectedRevision === 0 ? now === null : now !== null && now.draftRevision === pending.expectedRevision && (now.publishedVersion ?? 0) === before) {
    return { end: 'not-saved', failure: { ...cause, detail: NOT_PUBLISHED } }
  }
  const moved =
    now !== null &&
    !now.unpublishedChanges &&
    now.publishedVersion !== null &&
    now.draftRevision - pending.expectedRevision <= 1 &&
    now.publishedVersion - before <= 1
  return moved
    ? { end: 'saved', templateId: now.templateId, name: now.name, version: now.publishedVersion!, created: pending.expectedRevision === 0, published: now.publishedVersion !== before }
    : { end: 'stale', failure: failure('stale') }
}

/** Publishes to ONE company, once. On doubt it checks that company again before anything else. */
export async function publishCopy(port: HubPort, pending: PendingCopy): Promise<CopyOutcome> {
  const sent = await sendSave(port, PAYSLIP_TEMPLATE, copyRow(pending), copyResultSchema)
  if (sent.ok) {
    if (normaliseBrn(sent.result.brn) !== normaliseBrn(pending.companyBrn)) return { end: 'refused', failure: failure('other-company') }
    const { template_id: templateId, name: savedName, version, created, published } = sent.result
    return { end: 'saved', templateId, name: savedName, version, created, published }
  }
  if (sent.uncertain) return checkCopy(port, pending, sent.failure)
  return { end: sent.failure.kind === 'stale' ? 'stale' : 'refused', failure: sent.failure }
}

const summaryResultSchema = z.object({ action: z.literal('publish-summary') })

/**
 * Tells the dashboard how the batch went, so it shows ONE toast for it: each company published to
 * has no toast of its own. Counts only. Nothing is stored, so a lost answer needs nothing more.
 */
export async function sendPublishSummary(port: HubPort, brn: string, name: string, results: readonly CompanyResult[]): Promise<void> {
  const count = (outcome: CompanyResult['outcome']) => results.filter((result) => result.outcome === outcome).length
  await sendSave(
    port,
    PAYSLIP_TEMPLATE,
    { action: 'publish-summary', brn, name: name.trim(), published: count('updated'), skipped: count('skipped'), failed: count('failed'), unconfirmed: count('unconfirmed') },
    summaryResultSchema,
  )
}

export type CompanyResult =
  | { brn: string; company: string; thisCompany: boolean; outcome: 'updated'; text: string; templateId: string | null; version: number }
  | { brn: string; company: string; thisCompany: boolean; outcome: 'skipped'; text: string; reasons: string[] }
  | { brn: string; company: string; thisCompany: boolean; outcome: 'failed' | 'unconfirmed'; text: string; detail: string; failure: Failure }

/**
 * Why one company was not published to, said about THAT company: the app's own sentences for a
 * refusal speak of the company selected in the dashboard, which is not the one at fault here.
 */
export function copyFailureDetail(found: Failure, end: Exclude<SaveEnd, 'saved'>): string {
  if (end === 'not-saved' || end === 'unconfirmed') return found.detail
  switch (found.kind) {
    case 'forbidden':
      return 'You are not an admin of this company in the dashboard. Nothing was published there.'
    case 'stale':
      return 'Its template was changed since the check. Nothing was published there. Check the companies again.'
    case 'too-large':
      return 'It has reached a limit: 50 templates, or a template larger than the dashboard accepts. Nothing was published there.'
    default:
      return `${found.title}. Nothing was published there.`
  }
}

function updatedText(outcome: Extract<CopyOutcome, { end: 'saved' }>): string {
  if (outcome.created) return `New template "${outcome.name}", version 1, used for the payslips`
  if (!outcome.published) return `Already had this as version ${outcome.version}; now used for the payslips`
  return `Published as version ${outcome.version} of "${outcome.name}", used for the payslips`
}

/**
 * Publishes to each ticked company in turn, this company first. Each company gets all of it or
 * nothing (the dashboard does it in one step); a company that fails does not stop the others.
 */
export async function publishToCompanies(
  port: HubPort,
  input: { brn: string; name: string; body: TemplateBody },
  plans: readonly CompanyPlan[],
  ticked: ReadonlySet<string>,
  onProgress: (done: number, total: number, company: string) => void = () => {},
): Promise<CompanyResult[]> {
  const chosen = plans.filter((plan) => plan.thisCompany || (ticked.has(plan.brn) && plan.blocked === null))
  const results: CompanyResult[] = []
  let done = 0
  for (const plan of plans) {
    const base = { brn: plan.brn, company: plan.company, thisCompany: plan.thisCompany }
    if (!chosen.includes(plan)) {
      results.push({ ...base, outcome: 'skipped', text: plan.blocked ?? 'Not ticked', reasons: plan.blocked ? [] : plan.reasons })
      continue
    }
    onProgress(done, chosen.length, plan.company)
    const outcome = await publishCopy(port, {
      brn: input.brn,
      companyBrn: plan.brn,
      name: input.name,
      body: input.body,
      expectedRevision: plan.expectedRevision,
      publishedBefore: plan.publishedBefore,
    })
    done += 1
    if (outcome.end === 'saved') {
      results.push({ ...base, outcome: 'updated', text: updatedText(outcome), templateId: outcome.templateId, version: outcome.version })
    } else {
      const unconfirmed = outcome.end === 'unconfirmed'
      results.push({
        ...base,
        outcome: unconfirmed ? 'unconfirmed' : 'failed',
        text: unconfirmed ? 'Not confirmed' : 'Not published',
        detail: copyFailureDetail(outcome.failure, outcome.end),
        failure: outcome.failure,
      })
    }
  }
  onProgress(done, chosen.length, '')
  return results
}
