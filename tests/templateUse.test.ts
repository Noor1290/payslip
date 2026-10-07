// Which template the payslips use, and when they may be exported: a published version or the
// built-in template only. A draft can be previewed, never exported.
import { describe, expect, it } from 'vitest'
import { DEFAULT_TABLE_MAPPING, TABLE_TEMPLATE } from '../src/lib/template'
import { BUILT_IN_BODY, type TemplateBody } from '../src/lib/templateBody'
import type { TemplateSummary } from '../src/lib/templateStore'
import { activeTemplate, CHOOSE_EXPORT_BLOCK, DRAFT_EXPORT_BLOCK, preselection, type TemplateChoice } from '../src/lib/templateUse'

const ID = '20000000-0000-4000-8000-000000000001'
const edited: TemplateBody = { ...BUILT_IN_BODY, labels: { ...BUILT_IN_BODY.labels, title: 'Pay advice' } }
const builtIn: TemplateChoice = { kind: 'built-in' }
const published: TemplateChoice = { kind: 'published', templateId: ID, name: 'Monthly payslip', version: 3, body: edited }
const summary = (name: string, publishedVersion: number | null): TemplateSummary => ({
  templateId: ID.replace(/1$/, String(name.length % 9)),
  name,
  draftRevision: 2,
  updatedAt: '2026-10-07T09:00:00+04:00',
  updatedByYou: true,
  publishedVersion,
  publishedAt: publishedVersion === null ? null : '2026-10-07T09:05:00+04:00',
})

describe('opened on its own', () => {
  it('uses the built-in template itself, unchanged, and can export', () => {
    const active = activeTemplate({ embedded: false, choice: builtIn, choiceNeeded: false, draft: { templateId: null, name: 'Table', body: BUILT_IN_BODY, draftRevision: 0 } })
    expect(active.template).toBe(TABLE_TEMPLATE)
    expect(active.mapping).toBe(DEFAULT_TABLE_MAPPING)
    expect(active).toMatchObject({ kind: 'built-in', chip: 'Table (built-in)', exportBlock: null })
  })

  it('uses in-memory changes, labelled "not saved", and can still export', () => {
    const active = activeTemplate({ embedded: false, choice: builtIn, choiceNeeded: false, draft: { templateId: null, name: 'Table', body: edited, draftRevision: 0 } })
    expect(active).toMatchObject({ kind: 'built-in-edited', chip: 'Table (built-in, with your changes, not saved)', exportBlock: null })
    expect(active.template).toMatchObject({ id: 'table', version: 'built-in-1-edited', labels: { title: 'Pay advice' } })
  })
})

describe('inside the dashboard', () => {
  it('the built-in template can be exported and says which it is', () => {
    const active = activeTemplate({ embedded: true, choice: builtIn, choiceNeeded: false, draft: null })
    expect(active.template).toBe(TABLE_TEMPLATE)
    expect(active).toMatchObject({ kind: 'built-in', chip: 'Table (built-in)', exportBlock: null })
  })

  it('a published version can be exported, and the chip names the template and the version', () => {
    const active = activeTemplate({ embedded: true, choice: published, choiceNeeded: false, draft: null })
    expect(active).toMatchObject({ kind: 'published', chip: 'Monthly payslip, version 3 (published)', exportBlock: null })
    expect(active.template).toMatchObject({ id: ID, name: 'Monthly payslip', version: 'v3', labels: { title: 'Pay advice' } })
  })

  it('a draft can be previewed but never exported, saved or not', () => {
    const saved = activeTemplate({ embedded: true, choice: published, choiceNeeded: false, draft: { templateId: ID, name: 'Monthly payslip', body: edited, draftRevision: 4 } })
    expect(saved).toMatchObject({ kind: 'draft', chip: 'Monthly payslip, draft revision 4 (not published)', exportBlock: DRAFT_EXPORT_BLOCK })
    expect(saved.template.version).toBe('draft-4')

    const fresh = activeTemplate({ embedded: true, choice: builtIn, choiceNeeded: false, draft: { templateId: null, name: ' ', body: BUILT_IN_BODY, draftRevision: 0 } })
    expect(fresh).toMatchObject({ kind: 'draft', chip: 'New template, unsaved draft (not published)', exportBlock: DRAFT_EXPORT_BLOCK })
  })

  it('with a choice still to make, nothing is exported until the user picks', () => {
    expect(activeTemplate({ embedded: true, choice: builtIn, choiceNeeded: true, draft: null }).exportBlock).toBe(CHOOSE_EXPORT_BLOCK)
  })
})

describe('the preselection rule', () => {
  it('preselects only when the company has exactly one published template', () => {
    expect(preselection([])).toEqual({ kind: 'none' })
    expect(preselection([summary('Draft only', null)])).toEqual({ kind: 'none' })
    const one = summary('Monthly payslip', 2)
    expect(preselection([summary('Draft only', null), one])).toEqual({ kind: 'one', item: one })
    expect(preselection([one, summary('Weekly', 1), summary('Draft only', null)])).toEqual({ kind: 'choose', count: 2 })
  })
})
