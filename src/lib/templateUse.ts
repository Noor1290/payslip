// Which template the payslips are built with, and whether they may be exported.
// A payslip is exported from a PUBLISHED version or from the built-in template only. A draft can
// be previewed, under a banner, and never exported.

import { DEFAULT_TABLE_MAPPING, TABLE_TEMPLATE, type PayslipTemplate, type TemplateMapping } from './template'
import { BUILT_IN_BODY, sameBody, templateOf, type TemplateBody } from './templateBody'
import type { TemplateSummary } from './templateStore'

/** What the user (or the one-published-template rule) chose for the payslips. */
export type TemplateChoice =
  | { kind: 'built-in' }
  | { kind: 'published'; templateId: string; name: string; version: number; body: TemplateBody }

export interface DraftInUse {
  templateId: string | null
  name: string
  body: TemplateBody
  /** 0 while the draft has never been saved. */
  draftRevision: number
}

export interface ActiveTemplate {
  template: PayslipTemplate
  mapping: TemplateMapping
  kind: 'built-in' | 'built-in-edited' | 'published' | 'draft'
  /** For the chip on the Payslips page: always says which template and which version. */
  chip: string
  /** Why the payslips cannot be exported with this template. Null when they can. */
  exportBlock: string | null
}

export const DRAFT_EXPORT_BLOCK =
  'This is a draft, not published. Payslips can only be exported from a published version or the built-in template. Publish the draft, or stop previewing it.'
export const CHOOSE_EXPORT_BLOCK = 'This company has more than one published template. Choose the one to use on the Template page.'

const BUILT_IN: Pick<ActiveTemplate, 'template' | 'mapping'> = { template: TABLE_TEMPLATE, mapping: DEFAULT_TABLE_MAPPING }

export function activeTemplate(input: {
  /** Inside the dashboard. Opened on its own, the app works with in-memory edits of the built-in. */
  embedded: boolean
  choice: TemplateChoice
  /** More than one published template and the user has not picked yet. */
  choiceNeeded: boolean
  /** Standalone: the in-memory edits. Embedded: the draft being previewed, or null. */
  draft: DraftInUse | null
}): ActiveTemplate {
  const { embedded, choice, draft } = input
  if (!embedded) {
    if (!draft || sameBody(draft.body, BUILT_IN_BODY)) return { ...BUILT_IN, kind: 'built-in', chip: 'Table (built-in)', exportBlock: null }
    return {
      ...templateOf(draft.body, { id: 'table', name: 'Table', version: 'built-in-1-edited' }),
      kind: 'built-in-edited',
      chip: 'Table (built-in, with your changes, not saved)',
      exportBlock: null,
    }
  }
  if (draft) {
    const name = draft.name.trim() || 'New template'
    const revision = draft.draftRevision > 0 ? `draft revision ${draft.draftRevision}` : 'unsaved draft'
    return {
      ...templateOf(draft.body, { id: draft.templateId ?? 'new', name, version: `draft-${draft.draftRevision}` }),
      kind: 'draft',
      chip: `${name}, ${revision} (not published)`,
      exportBlock: DRAFT_EXPORT_BLOCK,
    }
  }
  if (choice.kind === 'published') {
    return {
      ...templateOf(choice.body, { id: choice.templateId, name: choice.name, version: `v${choice.version}` }),
      kind: 'published',
      chip: `${choice.name}, version ${choice.version} (published)`,
      exportBlock: null,
    }
  }
  return { ...BUILT_IN, kind: 'built-in', chip: 'Table (built-in)', exportBlock: input.choiceNeeded ? CHOOSE_EXPORT_BLOCK : null }
}

/**
 * What to do when a company's templates arrive and nothing was chosen yet: with exactly ONE
 * published template it is preselected; with more, the user must pick; with none, the built-in.
 */
export function preselection(items: readonly TemplateSummary[]): { kind: 'none' } | { kind: 'one'; item: TemplateSummary } | { kind: 'choose'; count: number } {
  const published = items.filter((item) => item.publishedVersion !== null)
  if (published.length === 0) return { kind: 'none' }
  if (published.length === 1) return { kind: 'one', item: published[0] }
  return { kind: 'choose', count: published.length }
}
