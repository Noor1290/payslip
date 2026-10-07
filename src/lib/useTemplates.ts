// The app's template state: the company's templates from the dashboard, which one the payslips
// use, and the draft open in the editor. Everything is kept in memory only, so it survives moving
// between the app's pages but never a reload. No payroll figure is involved.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { failure, normaliseBrn, type Failure, type HubCompany, type HubPort, type HubRole, type SaveEnd } from './hubWire'
import { bodyProblems, BUILT_IN_BODY, nameProblem, readBody, sameBody, type TemplateBody } from './templateBody'
import {
  checkDraftSave,
  checkPublish,
  listTemplates,
  loadDraft,
  loadVersion,
  publishDraft,
  saveDraft,
  type DraftOutcome,
  type PendingDraftSave,
  type PendingPublish,
  type PublishOutcome,
  type TemplateSummary,
} from './templateStore'
import { activeTemplate, preselection, type ActiveTemplate, type TemplateChoice } from './templateUse'

export type TemplatesList =
  | { status: 'standalone' | 'waiting' | 'loading' }
  | { status: 'loaded'; items: TemplateSummary[]; company: HubCompany; role: HubRole | null }
  | { status: 'failed'; failure: Failure }

export interface EditorState {
  /** The company the draft belongs to. Null when the app is opened on its own. */
  brn: string | null
  /** Null for a template that has never been saved. */
  templateId: string | null
  name: string
  body: TemplateBody
  /** The draft as the dashboard has it. Null while it has never been saved. */
  saved: { name: string; body: TemplateBody; draftRevision: number } | null
  publishedVersion: number | null
  /** After a stale save: my changes that were NOT saved, kept until I say I am done with them. */
  conflict: { name: string; body: TemplateBody } | null
}

export type TemplateNotice =
  | { kind: 'ok'; text: string }
  | { kind: 'failure'; failure: Failure; end: SaveEnd | 'load'; action: 'save' | 'publish' | 'load' }
  /** A body from the dashboard that this app refuses to use, and why. */
  | { kind: 'refused-body'; name: string; problems: string[] }

type Pending = { action: 'save'; save: PendingDraftSave } | { action: 'publish'; publish: PendingPublish }
export type TemplatesBusy = 'loading' | 'saving' | 'publishing' | 'checking' | null

const STANDALONE_EDITOR: EditorState = {
  brn: null,
  templateId: null,
  name: 'Table',
  body: BUILT_IN_BODY,
  saved: null,
  publishedVersion: null,
  conflict: null,
}

interface Options {
  embedded: boolean
  connected: boolean
  /** The BRN of the payroll data that is open, or null. Every save carries it. */
  brn: string | null
  port: HubPort
  /** True once the dashboard has said this user is not an admin of the company. */
  readOnly: boolean
  onForbidden: () => void
  /** The role the dashboard reported with an answer. */
  onRole: (role: HubRole | null) => void
}

export function useTemplates({ embedded, connected, brn, port, readOnly, onForbidden, onRole }: Options) {
  const [list, setList] = useState<TemplatesList>(() => ({ status: embedded ? 'waiting' : 'standalone' }))
  const [reloads, setReloads] = useState(0)
  const [choice, setChoice] = useState<TemplateChoice>({ kind: 'built-in' })
  const [choiceNeeded, setChoiceNeeded] = useState(false)
  const [editor, setEditor] = useState<EditorState | null>(() => (embedded ? null : STANDALONE_EDITOR))
  const [previewDraft, setPreviewDraft] = useState(false)
  const [busy, setBusy] = useState<TemplatesBusy>(null)
  const [notice, setNotice] = useState<TemplateNotice | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  /** The company the current choice was made for: a choice is never carried to another company. */
  const chosenFor = useRef<string | null>(null)

  /** Loads one published version and, when its body can be used, makes it the payslips' template. */
  const choosePublished = useCallback(
    async (templateId: string, version: number, isCurrent: () => boolean = () => true): Promise<boolean> => {
      const loaded = await loadVersion(port, brn, templateId, version)
      if (!isCurrent()) return false
      if (!loaded.ok) {
        setNotice({ kind: 'failure', failure: loaded.failure, end: 'load', action: 'load' })
        return false
      }
      const read = readBody(loaded.value.body)
      if (!read.ok) {
        setNotice({ kind: 'refused-body', name: `${loaded.value.name}, version ${version}`, problems: read.problems })
        return false
      }
      setChoice({ kind: 'published', templateId, name: loaded.value.name, version, body: read.body })
      setChoiceNeeded(false)
      setPreviewDraft(false)
      return true
    },
    [port, brn],
  )

  useEffect(() => {
    if (!embedded || !connected) return
    let current = true
    setList({ status: 'loading' })
    void listTemplates(port, brn).then(async (result) => {
      if (!current) return
      if (!result.ok) return setList({ status: 'failed', failure: result.failure })
      setList({ status: 'loaded', items: result.value, company: result.company, role: result.role })
      onRole(result.role)

      const company = normaliseBrn(result.company.brn)
      if (chosenFor.current === company) return
      // Another company (or the first answer): start from the built-in, then apply the rule.
      chosenFor.current = company
      setChoice({ kind: 'built-in' })
      setPreviewDraft(false)
      const found = preselection(result.value)
      setChoiceNeeded(found.kind === 'choose')
      if (found.kind === 'one') {
        const chosen = await choosePublished(found.item.templateId, found.item.publishedVersion!, () => current)
        // The company's one published template could not be used: the user decides, not the app.
        if (current && !chosen) setChoiceNeeded(true)
      }
    })
    return () => {
      current = false
    }
  }, [embedded, connected, brn, port, reloads, choosePublished, onRole])

  const reload = useCallback(() => setReloads((count) => count + 1), [])
  const items = list.status === 'loaded' ? list.items : []

  const dirty =
    editor !== null &&
    (embedded
      ? editor.saved === null || editor.name.trim() !== editor.saved.name || !sameBody(editor.body, editor.saved.body)
      : !sameBody(editor.body, BUILT_IN_BODY))
  /** True while leaving the editor would lose something: unsaved edits, or changes set aside after a stale save. */
  const unsaved = embedded && editor !== null && (dirty || editor.conflict !== null)
  const forOtherCompany = editor !== null && editor.brn !== null && brn !== null && normaliseBrn(editor.brn) !== normaliseBrn(brn)

  const problems = useMemo(() => {
    if (!editor) return []
    const taken = items.filter((item) => item.templateId !== editor.templateId).map((item) => item.name)
    const name = embedded ? nameProblem(editor.name, taken) : null
    return [...(name ? [name] : []), ...bodyProblems(editor.body)]
  }, [editor, items, embedded])

  // Why a save is not possible right now, in words. Null when it is.
  const cannotSave = !embedded
    ? 'Opened on its own, the app cannot save templates. Your changes are used for this session only. Open the app from the Payroll Hub dashboard to save them for a company.'
    : brn === null
      ? 'Import or get payroll data first. A save must carry the BRN of the company in the payroll data, so a template cannot go to the wrong company.'
      : forOtherCompany
        ? `This draft belongs to the company with BRN ${editor?.brn}. The payroll data that is open is for another company (BRN ${brn}).`
        : readOnly
          ? 'Only an admin of this company can save or publish a template. You are signed in to the dashboard as a member.'
          : notice?.kind === 'failure' && notice.end === 'unconfirmed'
            ? 'The last save has not been confirmed yet. Check again first.'
            : null

  const fail = (found: Failure, end: SaveEnd | 'load', action: 'save' | 'publish' | 'load') => {
    setNotice({ kind: 'failure', failure: found, end, action })
    if (found.kind === 'forbidden') onForbidden()
  }

  const pickPublished = async (templateId: string, version: number) => {
    setBusy('loading')
    setNotice(null)
    await choosePublished(templateId, version)
    setBusy(null)
  }

  const pickBuiltIn = () => {
    setChoice({ kind: 'built-in' })
    setChoiceNeeded(false)
    setPreviewDraft(false)
  }

  /** Opens a draft from the dashboard in the editor. Whatever was in the editor is replaced. */
  const openDraft = async (templateId: string, kept: EditorState['conflict'] = null): Promise<boolean> => {
    setBusy('loading')
    setNotice(null)
    const loaded = await loadDraft(port, brn, templateId)
    setBusy(null)
    if (!loaded.ok) {
      fail(loaded.failure, 'load', 'load')
      return false
    }
    const read = readBody(loaded.value.body)
    if (!read.ok) {
      setNotice({ kind: 'refused-body', name: `${loaded.value.name} (draft)`, problems: read.problems })
      return false
    }
    const { name, draftRevision } = loaded.value
    setEditor({
      brn: brn ?? loaded.company.brn,
      templateId,
      name,
      body: read.body,
      saved: { name, body: read.body, draftRevision },
      publishedVersion: items.find((item) => item.templateId === templateId)?.publishedVersion ?? null,
      conflict: kept,
    })
    setPending(null)
    return true
  }

  /** Starts a new template from what the payslips use now. Nothing reaches the dashboard until it is saved. */
  const newTemplate = () => {
    setNotice(null)
    setPending(null)
    setEditor({
      brn: brn ?? (list.status === 'loaded' ? list.company.brn : null),
      templateId: null,
      name: '',
      body: choice.kind === 'published' ? choice.body : BUILT_IN_BODY,
      saved: null,
      publishedVersion: null,
      conflict: null,
    })
  }

  const closeEditor = () => {
    setEditor(embedded ? null : STANDALONE_EDITOR)
    setPreviewDraft(false)
    setPending(null)
    setNotice(null)
  }

  const edit = (change: (body: TemplateBody) => TemplateBody) => setEditor((previous) => (previous ? { ...previous, body: change(previous.body) } : previous))
  const rename = (name: string) => setEditor((previous) => (previous ? { ...previous, name } : previous))
  const resolveConflict = () => setEditor((previous) => (previous ? { ...previous, conflict: null } : previous))

  const afterDraft = async (outcome: DraftOutcome, sent: PendingDraftSave) => {
    if (outcome.end === 'saved' && outcome.saved) {
      const { templateId, name, draftRevision } = outcome.saved
      setEditor((previous) => (previous ? { ...previous, templateId, name, saved: { name, body: sent.body, draftRevision } } : previous))
      setPending(null)
      setNotice({ kind: 'ok', text: `Draft saved as revision ${draftRevision}. It is not published: payslips do not use it yet.` })
      reload()
      return
    }
    const found = outcome.failure ?? failure('bad-answer')
    if (outcome.end === 'stale') {
      setPending(null)
      // A new template that "exists already": someone made one with that name. Nothing to merge.
      if (sent.templateId === null) return fail(failure('invalid', 'This company already has one with that name.'), 'refused', 'save')
      const read = outcome.newer ? readBody(outcome.newer.body) : null
      if (outcome.newer && read?.ok) {
        // Never overwrite: the newer draft takes the editor, and my changes are set aside in memory.
        const { name, draftRevision } = outcome.newer
        setEditor((previous) =>
          previous
            ? { ...previous, name, body: read.body, saved: { name, body: read.body, draftRevision }, conflict: { name: sent.name, body: sent.body } }
            : previous,
        )
      }
      return fail(found, 'stale', 'save')
    }
    // Only a save that is "not stored" or "not confirmed" is kept, to be resent or checked.
    setPending(outcome.end === 'not-saved' || outcome.end === 'unconfirmed' ? { action: 'save', save: sent } : null)
    fail(found, outcome.end, 'save')
  }

  const afterPublish = async (outcome: PublishOutcome, sent: PendingPublish) => {
    if (outcome.end === 'saved' && outcome.version !== null) {
      const version = outcome.version
      setEditor((previous) => (previous ? { ...previous, publishedVersion: version } : previous))
      setPending(null)
      setNotice({ kind: 'ok', text: `Published as version ${version}. Choose it under "Used for the payslips" to export with it.` })
      reload()
      return
    }
    const found = outcome.failure ?? failure('bad-answer')
    setPending(outcome.end === 'not-saved' || outcome.end === 'unconfirmed' ? { action: 'publish', publish: sent } : null)
    if (outcome.end === 'stale') {
      // The draft moved on. Nothing of mine is unsaved, so the newer draft is simply loaded.
      await openDraft(sent.templateId)
      reload()
    }
    fail(found, outcome.end, 'publish')
  }

  const run = async (next: Pending, how: 'send' | 'check', cause?: Failure) => {
    setPending(next)
    setNotice(null)
    setBusy(how === 'check' ? 'checking' : next.action === 'save' ? 'saving' : 'publishing')
    if (next.action === 'save') {
      const outcome = how === 'send' ? await saveDraft(port, next.save) : await checkDraftSave(port, next.save, cause!)
      setBusy(null)
      await afterDraft(outcome, next.save)
    } else {
      const outcome = how === 'send' ? await publishDraft(port, next.publish) : await checkPublish(port, next.publish, cause!)
      setBusy(null)
      await afterPublish(outcome, next.publish)
    }
  }

  const save = () => {
    if (!editor || brn === null || cannotSave !== null || problems.length > 0 || busy !== null) return
    void run(
      {
        action: 'save',
        save: { brn, templateId: editor.templateId, name: editor.name.trim(), body: editor.body, expectedRevision: editor.saved?.draftRevision ?? 0 },
      },
      'send',
    )
  }

  const publish = () => {
    if (!editor?.saved || editor.templateId === null || brn === null || cannotSave !== null || dirty || busy !== null) return
    void run(
      {
        action: 'publish',
        publish: {
          brn,
          templateId: editor.templateId,
          expectedRevision: editor.saved.draftRevision,
          publishedBefore: editor.publishedVersion,
          name: editor.saved.name,
          body: editor.saved.body,
        },
      },
      'send',
    )
  }

  /** After "not confirmed": ask the dashboard again and compare. Never sends the save itself. */
  const checkAgain = () => {
    if (pending && notice?.kind === 'failure' && busy === null) void run(pending, 'check', notice.failure)
  }
  /** After the reload showed the save was NOT stored: send the same save again, unchanged. */
  const sendAgain = () => {
    if (pending && notice?.kind === 'failure' && notice.end === 'not-saved' && busy === null) void run(pending, 'send')
  }

  const active: ActiveTemplate = useMemo(() => {
    const draft =
      editor && (!embedded || (previewDraft && !forOtherCompany))
        ? { templateId: editor.templateId, name: editor.name, body: editor.body, draftRevision: editor.saved?.draftRevision ?? 0 }
        : null
    return activeTemplate({ embedded, choice, choiceNeeded, draft })
  }, [embedded, choice, choiceNeeded, editor, previewDraft, forOtherCompany])

  return {
    list,
    reload,
    choice,
    choiceNeeded,
    pickPublished,
    pickBuiltIn,
    editor,
    dirty,
    unsaved,
    problems,
    cannotSave,
    openDraft,
    newTemplate,
    closeEditor,
    edit,
    rename,
    resolveConflict,
    save,
    publish,
    checkAgain,
    sendAgain,
    previewDraft,
    setPreviewDraft,
    busy,
    notice,
    dismissNotice: () => setNotice(null),
    active,
  }
}

export type Templates = ReturnType<typeof useTemplates>
