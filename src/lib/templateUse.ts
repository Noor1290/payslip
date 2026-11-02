// Which template the payslips are built with, and whether they may be exported.
// A payslip is exported from a PUBLISHED version or from the built-in template only. A draft can
// be previewed, under a banner, and never exported.

import { isSheetBody, type OwnValues, type SheetBody } from './sheetBody'
import type { SheetInUse } from './sheetDocument'
import { DEFAULT_TABLE_MAPPING, TABLE_TEMPLATE, type PayslipTemplate, type TemplateMapping } from './template'
import { BUILT_IN_BODY, sameBody, templateOf, type TemplateBody } from './templateBody'
import type { TemplateSummary } from './templateStore'

/** What the user (or the one-published-template rule) chose for the payslips. */
export type TemplateChoice =
  | { kind: 'built-in' }
  | { kind: 'published'; templateId: string; name: string; version: number; body: AnyBody; own?: OwnValues }

/** A template of the company: the Table form, or a layout from a file. */
export type AnyBody = TemplateBody | SheetBody

export interface DraftInUse {
  templateId: string | null
  name: string
  body: AnyBody
  own?: OwnValues
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
  /** A layout from a file: the payslips come from it, not from `template`. */
  sheet?: SheetInUse
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
    if (draft && isSheetBody(draft.body)) {
      return {
        ...BUILT_IN,
        kind: 'built-in-edited',
        chip: 'From your file (not saved)',
        exportBlock: null,
        sheet: { body: draft.body, own: draft.own ?? {}, id: 'file', version: 'unsaved' },
      }
    }
    if (!draft || sameBody(draft.body, BUILT_IN_BODY) || isSheetBody(draft.body)) return { ...BUILT_IN, kind: 'built-in', chip: 'Table (built-in)', exportBlock: null }
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
    if (isSheetBody(draft.body)) {
      return {
        ...BUILT_IN,
        kind: 'draft',
        chip: `${name}, ${revision} (not published)`,
        exportBlock: DRAFT_EXPORT_BLOCK,
        sheet: { body: draft.body, own: draft.own ?? {}, id: draft.templateId ?? 'new', version: `draft-${draft.draftRevision}` },
      }
    }
    return {
      ...templateOf(draft.body, { id: draft.templateId ?? 'new', name, version: `draft-${draft.draftRevision}` }),
      kind: 'draft',
      chip: `${name}, ${revision} (not published)`,
      exportBlock: DRAFT_EXPORT_BLOCK,
    }
  }
  if (choice.kind === 'published') {
    if (isSheetBody(choice.body)) {
      return {
        ...BUILT_IN,
        kind: 'published',
        chip: `${choice.name}, version ${choice.version} (published)`,
        exportBlock: null,
        sheet: { body: choice.body, own: choice.own ?? {}, id: choice.templateId, version: `v${choice.version}` },
      }
    }
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
 * What to do when a company's templates arrive and nothing was chosen yet in this tab: the
 * version saved in the dashboard as the one used for the payslips, when there is one; otherwise,
 * with exactly ONE published template it is preselected; with more, the user must pick; with
 * none, the built-in.
 */
export function preselection(
  items: readonly TemplateSummary[],
): { kind: 'none' } | { kind: 'saved'; item: TemplateSummary; version: number } | { kind: 'one'; item: TemplateSummary } | { kind: 'choose'; count: number } {
  const saved = items.find((item) => item.inUseVersion !== null)
  if (saved) return { kind: 'saved', item: saved, version: saved.inUseVersion! }
  const published = items.filter((item) => item.publishedVersion !== null)
  if (published.length === 0) return { kind: 'none' }
  if (published.length === 1) return { kind: 'one', item: published[0] }
  return { kind: 'choose', count: published.length }
}
