import { ArrowDown, ArrowUp, Clock3, Eye, FilePlus2, Info, Lock, Pencil, Plus, RefreshCw, Table2, TextSearch, Trash2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { Dialog } from '../components/Dialog'
import { FailurePanel, SavedPanel } from '../components/FailurePanel'
import { formatShortDate, isIsoDate } from '../lib/dates'
import type { ImportedPayroll } from '../lib/payrollFile'
import { DEFAULT_TABLE_MAPPING, FIXED_LINES, mappableKeys, NEVER_MAP } from '../lib/template'
import { bodyChanges, bodyRows, LABEL_MAX, MAX_BODY_ROWS, NAME_MAX, type BodyLine, type TemplateBody } from '../lib/templateBody'
import {
  addLine,
  canAddLine,
  canRemoveLine,
  moveLine,
  newLineId,
  removeLine,
  setCrossCheckBase,
  setGroupLabel,
  setLabel,
  setLineKey,
  setLineLabel,
  type LabelKey,
  type ListRef,
} from '../lib/templateEdit'
import type { Templates } from '../lib/useTemplates'

interface Props {
  data: ImportedPayroll | null
  templates: Templates
  /** Inside the dashboard. Opened on its own, the built-in template is edited in memory only. */
  embedded: boolean
}

const HEADER_LABELS: [LabelKey, string][] = [
  ['title', 'Title'],
  ['brnPrefix', 'Before the BRN'],
  ['payPeriodPrefix', 'Before the pay period'],
  ['employeeInfo', 'Employee band'],
  ['name', 'Name'],
  ['dateOfEmployment', 'Date of employment'],
  ['nic', 'NIC'],
  ['earnings', 'Earnings heading'],
  ['deductions', 'Deductions heading'],
  ['currency', 'Currency, above the amounts'],
]
const FOOTER_LABELS: [LabelKey, string][] = [
  ['totalEarnings', 'Total earnings'],
  ['totalDeductions', 'Total deductions'],
  ['netPay', 'Net pay'],
  ['signatureEmployee', 'Employee signature'],
  ['signatureEmployer', 'Employer signature'],
  ['date', 'Date'],
]

const hasValue = (row: Record<string, unknown>, key: string) => key in row && row[key] !== null && row[key] !== ''
const when = (stamp: string | null) => {
  const day = stamp?.slice(0, 10) ?? ''
  return isIsoDate(day) ? formatShortDate(day) : ''
}
const by = (you: boolean) => (you ? 'you' : 'another admin')

/** What the user is about to do while the editor holds something that would be lost. */
type Leaving = { title: string; go: () => void }

export function TemplateScreen({ data, templates: t, embedded }: Props) {
  const [leaving, setLeaving] = useState<Leaving | null>(null)
  const { editor, list } = t
  const working = t.busy !== null
  const keys = data ? mappableKeys(data.keys, data.rows, DEFAULT_TABLE_MAPPING) : []

  /** Runs `go` at once, or asks first when unsaved changes would be lost. */
  const guarded = (title: string, go: () => void) => (t.unsaved ? setLeaving({ title, go }) : go())

  const options = (current: string | null) => {
    const all = current && !keys.includes(current) ? [current, ...keys] : keys
    return all.map((key) => (
      <option key={key} value={key}>
        {key}
      </option>
    ))
  }

  const labelField = (body: TemplateBody, [key, name]: [LabelKey, string]) => (
    <div className="field" key={key}>
      <label className="field-label" htmlFor={`label-${key}`}>
        {name}
      </label>
      <input
        id={`label-${key}`}
        type="text"
        className="input input-sm"
        maxLength={LABEL_MAX}
        value={body.labels[key]}
        disabled={working}
        onChange={(event) => t.edit((current) => setLabel(current, key, event.target.value))}
      />
    </div>
  )

  const lineRows = (body: TemplateBody, lines: BodyLine[]) =>
    lines.map((line, index) => {
      const found = body.mapping.lines[line.id] ?? { key: null }
      const fixed = FIXED_LINES[line.id]
      const aliases = fixed?.aliases ?? []
      const rows = data && found.key ? data.rows : []
      const missing = rows.filter((row) => !hasValue(row, found.key!) && !aliases.some((alias) => hasValue(row, alias))).length
      const oldName = rows.filter((row) => !hasValue(row, found.key!) && aliases.some((alias) => hasValue(row, alias))).length
      const name = line.label.trim() || 'this line'
      return (
        <tr key={line.id}>
          <td>
            <input
              type="text"
              className="input input-sm w-full min-w-40"
              aria-label={`Label of ${name}`}
              maxLength={LABEL_MAX}
              value={line.label}
              disabled={working}
              onChange={(event) => t.edit((current) => setLineLabel(current, line.id, event.target.value))}
            />
          </td>
          <td>
            <select
              className="input input-sm w-full min-w-44 max-w-xs"
              aria-label={`Payroll column for ${name}`}
              value={found.key ?? ''}
              disabled={!data || working}
              onChange={(event) => t.edit((current) => setLineKey(current, line.id, event.target.value === '' ? null : event.target.value))}
            >
              {!fixed?.required && <option value="">Not mapped (shows "-")</option>}
              {options(found.key)}
            </select>
          </td>
          <td>
            <span className="flex flex-wrap gap-1.5">
              {fixed && <span className="badge">{fixed.required ? 'Required' : 'Cannot be removed'}</span>}
              {found.toConfirm && <span className="badge tone-sky">To confirm</span>}
              {missing > 0 && (
                <span className="badge tone-danger">
                  Missing for {missing} {missing === 1 ? 'employee' : 'employees'}
                </span>
              )}
              {oldName > 0 && (
                <span className="badge tone-warn">
                  Old name for {oldName} {oldName === 1 ? 'employee' : 'employees'}
                </span>
              )}
            </span>
          </td>
          <td>
            <span className="flex justify-end gap-1">
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                aria-label={`Move ${name} up`}
                disabled={index === 0 || working}
                onClick={() => t.edit((current) => moveLine(current, line.id, -1))}
              >
                <ArrowUp aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                aria-label={`Move ${name} down`}
                disabled={index === lines.length - 1 || working}
                onClick={() => t.edit((current) => moveLine(current, line.id, 1))}
              >
                <ArrowDown aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                aria-label={`Remove ${name}`}
                disabled={!canRemoveLine(line.id) || working}
                onClick={() => t.edit((current) => removeLine(current, line.id))}
              >
                <Trash2 aria-hidden="true" />
              </button>
            </span>
          </td>
        </tr>
      )
    })

  const linesTable = (body: TemplateBody, lines: BodyLine[], where: ListRef, caption: string) => (
    <div className="table-scroll">
      <table className="table" aria-label={caption}>
        <thead>
          <tr>
            <th scope="col">Label on the payslip</th>
            <th scope="col">Payroll column</th>
            <th scope="col">Notes</th>
            <th scope="col" className="right">
              <button
                type="button"
                className="btn btn-sm"
                disabled={!canAddLine(body, where) || working}
                onClick={() => t.edit((current) => addLine(current, where, newLineId()))}
              >
                <Plus aria-hidden="true" />
                Add a line<span className="sr-only"> to {caption}</span>
              </button>
            </th>
          </tr>
        </thead>
        <tbody>{lineRows(body, lines)}</tbody>
      </table>
    </div>
  )

  const conflictChanges = editor?.conflict && editor.saved ? bodyChanges(editor.saved.body, editor.conflict.body) : []
  const used = t.active

  return (
    <div className="rise-in mx-auto flex max-w-5xl flex-col gap-4">
      <div>
        <h2 className="m-0 text-2xl font-semibold tracking-tight">Template</h2>
        <p className="m-0 text-muted">How the payslip looks, and which payroll column fills each line.</p>
      </div>

      {t.notice?.kind === 'ok' && <SavedPanel testId="template-saved">{t.notice.text}</SavedPanel>}
      {t.notice?.kind === 'failure' && (
        <FailurePanel failure={t.notice.failure} testId="template-outcome">
          {t.notice.end === 'unconfirmed' && (
            <button type="button" className="btn btn-sm" onClick={t.checkAgain} disabled={working}>
              <RefreshCw aria-hidden="true" />
              {t.busy === 'checking' ? 'Checking' : 'Check again'}
            </button>
          )}
          {t.notice.end === 'not-saved' && (
            <button type="button" className="btn btn-sm btn-primary" onClick={t.sendAgain} disabled={working}>
              {t.notice.action === 'publish' ? 'Publish again' : 'Save again'}
            </button>
          )}
          {t.notice.failure.kind === 'not-found' && (
            <button type="button" className="btn btn-sm" onClick={t.reload} disabled={working}>
              <RefreshCw aria-hidden="true" />
              Reload the list
            </button>
          )}
        </FailurePanel>
      )}
      {t.notice?.kind === 'refused-body' && (
        <div className="panel tone-danger" role="alert" data-testid="template-refused">
          <TriangleAlert aria-hidden="true" />
          <div className="min-w-0">
            <p className="m-0 font-medium">"{t.notice.name}" cannot be used</p>
            <p className="m-0 text-sm text-muted">The template stored in the dashboard was refused by this app, and nothing from it is used:</p>
            <ul className="m-0 mt-1 list-disc pl-5 text-sm text-muted">
              {t.notice.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <section className="card" aria-label="Used for the payslips">
        <div className="card-header">
          <h3 className="card-title">Used for the payslips</h3>
          <span className={`badge ${used.kind === 'draft' ? 'tone-warn' : 'tone-accent'}`} data-testid="template-in-use">
            {used.chip}
          </span>
        </div>
        {t.choiceNeeded && (
          <div className="panel tone-warn m-4 mb-0" role="status" data-testid="template-choose">
            <TriangleAlert aria-hidden="true" />
            <p className="m-0 text-sm">
              Choose the template to use. The app does not pick one for you when a company has more than one published
              template, or when its one published template could not be used. Until you choose, payslips cannot be
              exported.
            </p>
          </div>
        )}
        <div className="grid gap-4 p-4 md:grid-cols-2">
          <div className="card flex items-start gap-3 p-4" aria-current={used.kind === 'built-in' || used.kind === 'built-in-edited' ? 'true' : undefined}>
            <span className="icon-tile" aria-hidden="true">
              <Table2 />
            </span>
            <div className="min-w-0 flex-1">
              <p className="m-0 flex flex-wrap items-center gap-2 font-semibold">
                Table <span className="badge">Built-in</span>
                {!embedded && t.dirty && <span className="badge tone-warn">Not saved</span>}
                {(used.kind === 'built-in' || used.kind === 'built-in-edited') && !t.choiceNeeded && <span className="badge tone-accent">In use</span>}
              </p>
              <p className="m-0 text-sm text-muted">One A4 page: earnings on the left, deductions on the right, as in the reference.</p>
              {embedded && (
                <p className="m-0 mt-1 text-sm text-muted">Payslips made with it can be downloaded, but not issued: issuing needs a published template of the company.</p>
              )}
              <span className="mt-2 flex flex-wrap gap-2">
                {embedded && (t.choice.kind !== 'built-in' || t.choiceNeeded) && (
                  <button type="button" className="btn btn-sm" onClick={t.pickBuiltIn} disabled={working}>
                    Use the built-in template
                  </button>
                )}
                {embedded && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={working || t.cannotSave !== null || list.status !== 'loaded'}
                    onClick={() => guarded("Publish the built-in template as this company's template?", () => void t.publishBuiltIn())}
                  >
                    Publish the built-in template as this company's template
                  </button>
                )}
              </span>
            </div>
          </div>
          <div className="card flex items-start gap-3 p-4 opacity-70" aria-disabled="true">
            <span className="icon-tile tone-glow" aria-hidden="true">
              <TextSearch />
            </span>
            <div className="min-w-0">
              <p className="m-0 flex flex-wrap items-center gap-2 font-semibold">
                Lookup{' '}
                <span className="badge">
                  <Clock3 aria-hidden="true" />
                  Coming soon
                </span>
              </p>
              <p className="m-0 text-sm text-muted">A workbook that fills the payslip from an employee ID. Not available yet.</p>
            </div>
          </div>
        </div>
        <p className="m-0 border-t border-line px-5 py-3 text-xs text-subtle">
          {embedded
            ? 'Payslips are exported from a published version or from the built-in template. A draft can be previewed, never exported.'
            : 'Opened on its own, the app uses the built-in template. Changes you make below are used for this session only.'}
        </p>
      </section>

      {embedded && (
        <section className="card" aria-label="Templates saved in the dashboard">
          <div className="card-header">
            <h3 className="card-title">
              Saved in the dashboard
              {list.status === 'loaded' && (
                <span className="ml-2 text-sm font-normal text-muted" data-testid="template-company">
                  for {list.company.name || 'the selected company'}, BRN <span className="num">{list.company.brn}</span>
                </span>
              )}
            </h3>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-sm btn-ghost" onClick={t.reload} disabled={working || list.status === 'loading'}>
                <RefreshCw aria-hidden="true" />
                Reload
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={working || list.status !== 'loaded'}
                onClick={() => guarded('Start a new template?', t.newTemplate)}
              >
                <FilePlus2 aria-hidden="true" />
                New template
              </button>
            </div>
          </div>
          {(list.status === 'waiting' || list.status === 'loading') && (
            <div className="p-5" aria-busy="true" aria-label="Loading the templates from the dashboard">
              <div className="skeleton mb-2 h-10 w-full" />
              <div className="skeleton h-10 w-2/3" />
              <p className="m-0 mt-3 text-sm text-muted">{list.status === 'waiting' ? 'Waiting for the dashboard.' : 'Loading the templates from the dashboard.'}</p>
            </div>
          )}
          {list.status === 'failed' && (
            <div className="p-4">
              <FailurePanel failure={list.failure} testId="template-load-failure">
                <button type="button" className="btn btn-sm" onClick={t.reload}>
                  <RefreshCw aria-hidden="true" />
                  Check again
                </button>
              </FailurePanel>
            </div>
          )}
          {list.status === 'loaded' && list.items.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center" data-testid="template-empty">
              <span className="icon-tile" aria-hidden="true">
                <FilePlus2 />
              </span>
              <p className="m-0 font-semibold">No template is saved for this company</p>
              <p className="m-0 max-w-md text-sm text-muted">Payslips use the built-in Table template. Start a new template to change labels, lines or columns and keep them.</p>
            </div>
          )}
          {list.status === 'loaded' && list.items.length > 0 && (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Draft</th>
                    <th scope="col">Published</th>
                    <th scope="col" className="right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {list.items.map((item) => {
                    const chosen = t.choice.kind === 'published' && t.choice.templateId === item.templateId ? t.choice.version : null
                    const open = editor?.templateId === item.templateId
                    return (
                      <tr key={item.templateId}>
                        <th scope="row" className="!static !bg-transparent !text-fg !text-[13.5px]">
                          {item.name}
                        </th>
                        <td>
                          <span className="badge tone-warn">Draft</span>{' '}
                          <span className="text-sm text-muted">
                            revision <span className="num">{item.draftRevision}</span>, saved by {by(item.updatedByYou)} {when(item.updatedAt)}
                          </span>
                        </td>
                        <td>
                          {item.publishedVersion === null ? (
                            <span className="text-sm text-muted">Never published</span>
                          ) : (
                            <>
                              <span className="badge tone-accent">Published</span>{' '}
                              <span className="text-sm text-muted">
                                version <span className="num">{item.publishedVersion}</span> {when(item.publishedAt)}
                              </span>
                            </>
                          )}
                        </td>
                        <td>
                          <span className="flex flex-wrap justify-end gap-2">
                            {chosen !== null && used.kind === 'published' && (
                              <span className="badge tone-accent">In use: version {chosen}</span>
                            )}
                            {item.publishedVersion !== null && chosen !== item.publishedVersion && (
                              <button
                                type="button"
                                className="btn btn-sm"
                                disabled={working}
                                onClick={() => void t.pickPublished(item.templateId, item.publishedVersion!)}
                              >
                                Use version {item.publishedVersion}
                                <span className="sr-only"> of {item.name}</span>
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-sm"
                              disabled={working || open}
                              onClick={() => guarded(`Open the draft of "${item.name}"?`, () => void t.openDraft(item.templateId))}
                            >
                              <Pencil aria-hidden="true" />
                              {open ? 'Open below' : 'Open the draft'}
                              <span className="sr-only"> of {item.name}</span>
                            </button>
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {editor && (
        <section className="card" aria-label="Template editor" data-testid="template-editor">
          <div className="card-header">
            <h3 className="card-title">{embedded ? (editor.templateId === null ? 'New template' : `Draft of "${editor.saved?.name ?? editor.name}"`) : 'Built-in Table template'}</h3>
            <p className="m-0 flex flex-wrap items-center gap-1.5" data-testid="editor-status">
              {embedded && <span className="badge tone-warn">{editor.saved ? `Draft, revision ${editor.saved.draftRevision}` : 'Draft, never saved'}</span>}
              {embedded && <span className="badge">{editor.publishedVersion === null ? 'Never published' : `Published: version ${editor.publishedVersion}`}</span>}
              {t.dirty && <span className="badge tone-warn">{embedded ? 'Unsaved changes' : 'Not saved'}</span>}
              {embedded && !t.dirty && editor.saved && <span className="badge tone-accent">Saved</span>}
            </p>
          </div>

          {editor.conflict && editor.saved && (
            <div className="panel tone-warn m-4 mb-0" role="status" data-testid="template-conflict">
              <TriangleAlert aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="m-0 font-medium">Your changes were not saved</p>
                <p className="m-0 text-sm text-muted">
                  The editor now shows the newer draft (revision {editor.saved.draftRevision}). Below is what you had changed, kept in this
                  tab's memory. Nothing is reapplied for you: make the changes again by hand, then save.
                </p>
                <ul className="m-0 mt-2 list-disc pl-5 text-sm">
                  {editor.conflict.name !== editor.saved.name && (
                    <li>
                      Name: yours "{editor.conflict.name}", now "{editor.saved.name}"
                    </li>
                  )}
                  {conflictChanges.map((change) => (
                    <li key={change.what}>
                      {change.what}: now "{change.before}", yours "{change.after}"
                    </li>
                  ))}
                  {conflictChanges.length === 0 && editor.conflict.name === editor.saved.name && <li>Your version is the same as the newer draft.</li>}
                </ul>
                <button type="button" className="btn btn-sm mt-3" onClick={t.resolveConflict}>
                  I am done with this list
                </button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-5 p-4">
            {embedded && (
              <div className="field max-w-md">
                <label className="field-label" htmlFor="template-name">
                  Template name
                </label>
                <input
                  id="template-name"
                  type="text"
                  className="input"
                  maxLength={NAME_MAX + 20}
                  value={editor.name}
                  disabled={working}
                  placeholder="For example: Monthly payslip"
                  onChange={(event) => t.rename(event.target.value)}
                />
              </div>
            )}

            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-2 p-0 text-sm font-semibold">Block: title, company and employee</legend>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{HEADER_LABELS.map((entry) => labelField(editor.body, entry))}</div>
            </fieldset>

            <div>
              <h4 className="m-0 mb-1 text-sm font-semibold">Where each line comes from</h4>
              <p className="m-0 mb-3 text-sm text-muted">
                {data ? `${keys.length} columns found in the payroll data.` : 'Import payroll data on the Payslips page to choose from the columns found in it.'}{' '}
                <span data-testid="rows-used">
                  The lines take {bodyRows(editor.body)} of the {MAX_BODY_ROWS} rows that fit on the page.
                </span>
              </p>
              {!data && (
                <div className="panel tone-sky mb-3">
                  <Info aria-hidden="true" />
                  <p className="m-0 text-sm">Without payroll data the columns cannot be changed. Labels, order and lines can.</p>
                </div>
              )}
              <p className="m-0 mb-1 text-xs uppercase tracking-wider text-subtle">Block: earnings</p>
              {linesTable(editor.body, editor.body.earnings, { side: 'earnings' }, 'Earnings')}
              {editor.body.deductionGroups.map((group, index) => (
                <div key={index} className="mt-4">
                  <div className="field mb-2 max-w-sm">
                    <label className="field-label" htmlFor={`group-${index}`}>
                      Block: deductions, group {index + 1} heading
                    </label>
                    <input
                      id={`group-${index}`}
                      type="text"
                      className="input input-sm"
                      maxLength={LABEL_MAX}
                      value={group.label}
                      disabled={working}
                      onChange={(event) => t.edit((current) => setGroupLabel(current, index, event.target.value))}
                    />
                  </div>
                  {linesTable(editor.body, group.lines, { side: 'deductions', group: index }, `Deductions, ${group.label.trim() || `group ${index + 1}`}`)}
                </div>
              ))}
            </div>

            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-2 p-0 text-sm font-semibold">Block: totals, net pay and sign-off</legend>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{FOOTER_LABELS.map((entry) => labelField(editor.body, entry))}</div>
              <p className="m-0 mt-2 flex items-start gap-2 text-sm text-muted">
                <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                Only the labels can be changed here. Total Earnings, Total Deductions and Net Pay are always the plain addition of the lines
                shown, and they cannot be removed.
              </p>
            </fieldset>

            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-2 p-0 text-sm font-semibold">Checks</legend>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="m-0 text-sm font-medium">The three totals are compared with</p>
                  <ul className="m-0 mt-1 list-disc pl-5 text-sm text-muted">
                    <li>Total Earnings against {DEFAULT_TABLE_MAPPING.checks.gross}</li>
                    <li>Total Deductions against {DEFAULT_TABLE_MAPPING.checks.deductions}</li>
                    <li>Net Pay against {DEFAULT_TABLE_MAPPING.checks.net}</li>
                  </ul>
                </div>
                <div className="flex flex-col gap-3">
                  <div className="field">
                    <label className="field-label" htmlFor="csg-base">
                      CSG cross-check base
                    </label>
                    <select
                      id="csg-base"
                      className="input input-sm"
                      value={editor.body.mapping.crossCheck.csgBase}
                      disabled={!data || working}
                      onChange={(event) => t.edit((current) => setCrossCheckBase(current, 'csgBase', event.target.value))}
                    >
                      {options(editor.body.mapping.crossCheck.csgBase)}
                    </select>
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor="nsf-base">
                      NSF cross-check base {editor.body.mapping.crossCheck.nsfBaseToConfirm && <span className="badge tone-sky ml-1">To confirm</span>}
                    </label>
                    <select
                      id="nsf-base"
                      className="input input-sm"
                      value={editor.body.mapping.crossCheck.nsfBase}
                      disabled={!data || working}
                      onChange={(event) => t.edit((current) => setCrossCheckBase(current, 'nsfBase', event.target.value))}
                    >
                      {options(editor.body.mapping.crossCheck.nsfBase)}
                    </select>
                  </div>
                </div>
                <p className="m-0 text-sm text-muted md:col-span-2">
                  Never used on a payslip: {NEVER_MAP.join(', ')}. These are employer-side columns, or a second PAYE column.
                </p>
              </div>
            </fieldset>

            {t.problems.length > 0 && (
              <div className="panel tone-danger" role="alert" data-testid="template-problems">
                <TriangleAlert aria-hidden="true" />
                <div className="min-w-0">
                  <p className="m-0 font-medium">{embedded ? 'This template cannot be saved yet' : 'This template has a problem'}</p>
                  <ul className="m-0 mt-1 list-disc pl-5 text-sm text-muted">
                    {t.problems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {t.cannotSave && (
              <p className="m-0 flex items-start gap-2 text-sm text-muted" id="template-cannot-save" data-testid="template-cannot-save">
                <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {t.cannotSave}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2">
              {embedded ? (
                <>
                  <label className="mr-auto flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={t.previewDraft} disabled={working} onChange={(event) => t.setPreviewDraft(event.target.checked)} />
                    <Eye aria-hidden="true" className="size-4" />
                    Preview this draft on the Payslips page
                  </label>
                  <button type="button" className="btn" disabled={working} onClick={() => guarded('Close the editor?', t.closeEditor)}>
                    Close
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={working || t.cannotSave !== null || t.problems.length > 0 || !t.dirty}
                    aria-describedby={t.cannotSave ? 'template-cannot-save' : undefined}
                    onClick={t.save}
                  >
                    {t.busy === 'saving' ? 'Saving' : 'Save draft'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={working || t.cannotSave !== null || t.dirty || !editor.saved}
                    aria-describedby={t.cannotSave ? 'template-cannot-save' : undefined}
                    title={t.dirty ? 'Save the draft first: publishing publishes exactly the saved draft.' : undefined}
                    onClick={t.publish}
                  >
                    {t.busy === 'publishing' ? 'Publishing' : `Publish as version ${(editor.publishedVersion ?? 0) + 1}`}
                  </button>
                </>
              ) : (
                <button type="button" className="btn" disabled={!t.dirty} onClick={t.closeEditor}>
                  Reset to the built-in template
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {leaving && (
        <Dialog
          title={leaving.title}
          description="The editor holds changes that are not saved in the dashboard. They are kept in this tab's memory only, and will be lost."
          icon={<TriangleAlert />}
          tone="warn"
          onClose={() => setLeaving(null)}
          actions={
            <>
              <button type="button" className="btn" data-autofocus onClick={() => setLeaving(null)}>
                Keep editing
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  const { go } = leaving
                  setLeaving(null)
                  go()
                }}
              >
                Discard my changes
              </button>
            </>
          }
        />
      )}
    </div>
  )
}
