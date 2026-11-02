import { Columns3, History, Info, Minus, Plus, Rows3, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { formatShortDate, isIsoDate } from '../lib/dates'
import type { ImportedPayroll } from '../lib/payrollFile'
import { cellAt, cellName, MAX_SHEET_COLUMNS, MAX_SHEET_ROWS, mergeAt, type SheetBody } from '../lib/sheetBody'
import { companyOf } from '../lib/sheetDocument'
import { insertColumn, insertRow, removeColumn, removeRow, setCell } from '../lib/sheetEdit'
import { evaluateSheet, problemText } from '../lib/sheetEvaluate'
import { COMPANY_KEYS } from '../lib/payrollFile'
import { DEFAULT_TABLE_MAPPING, mappableKeys } from '../lib/template'
import type { Templates } from '../lib/useTemplates'
import { FailurePanel } from './FailurePanel'
import { SheetCellEditor, type SheetKeys } from './SheetCellEditor'
import { SheetGrid, type SheetPlace } from './SheetGrid'

const when = (stamp: string) => {
  const day = stamp.slice(0, 10)
  return isIsoDate(day) ? formatShortDate(day) : ''
}

/** The keys a cell can name: from the payroll data open, or the standard ones without it. */
function keysFrom(data: ImportedPayroll | null): SheetKeys {
  if (!data) {
    return {
      identity: ['ID', 'Surname', 'Other names', 'Date of Employment'],
      figures: ['Basic Salary', 'Govt Increment', 'Allowances', 'Travelling', 'Gross Pay', 'Employee CSG', 'Employee NSF', 'PAYE', 'Total deductions', 'Net Pay'],
    }
  }
  const company = new Set<string>([...COMPANY_KEYS, 'VAT'])
  const figures = mappableKeys(data.keys, data.rows, DEFAULT_TABLE_MAPPING)
  const identity = data.keys.filter((key) => !company.has(key) && data.rows.some((row) => typeof row[key] === 'string'))
  return { identity, figures }
}

/** The editor of a layout from a file: the grid, rows and columns, and the chosen cell. */
export function SheetEditor({ body, data, templates: t, issueDate }: { body: SheetBody; data: ImportedPayroll | null; templates: Templates; issueDate: string }) {
  const [selected, setSelected] = useState<SheetPlace | null>(null)
  const working = t.busy !== null
  const locked = working || t.cannotSave?.startsWith('Only an admin') === true
  const keys = useMemo(() => keysFrom(data), [data])
  const own = t.editor?.own ?? {}
  const upload = t.editor?.upload

  const firstRow = data?.rows[0] ?? null
  const values = useMemo(() => {
    if (!firstRow) return null
    return evaluateSheet(body, { company: companyOf(firstRow), period: data?.period ?? `${issueDate.slice(0, 7)}`, today: issueDate, own }, firstRow)
  }, [body, firstRow, data, issueDate, own])
  const printed = useMemo(() => (values ? new Map([...values].map(([id, value]) => [id, { text: value.problem ? '' : value.text, figure: value.kind !== 'text' }])) : null), [values])

  const place = selected && selected.row < body.rows.length && selected.col < body.columns.length ? selected : null
  const cell = place ? cellAt(body, place.row, place.col) : null
  const merge = place ? mergeAt(body, place.row, place.col) : null
  const atEdge = (next: SheetBody) => {
    t.editSheet(() => next)
    setSelected(null)
  }

  return (
    <div className="flex flex-col gap-4">
      {upload && upload.notes.length > 0 && (
        <div className="panel tone-sky" role="status" data-testid="upload-notes">
          <Info aria-hidden="true" />
          <div className="min-w-0">
            <p className="m-0 font-medium">From your file</p>
            <ul className="m-0 mt-1 list-disc pl-5 text-sm text-muted">
              {upload.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Rows and columns">
        <span className="flex items-center gap-1 text-sm text-muted">
          <Rows3 aria-hidden="true" className="size-4" />
          Rows
        </span>
        <button type="button" className="btn btn-sm" disabled={!place || locked || body.rows.length >= MAX_SHEET_ROWS} onClick={() => place && atEdge(insertRow(body, place.row))}>
          <Plus aria-hidden="true" />
          Add above
        </button>
        <button type="button" className="btn btn-sm" disabled={!place || locked || body.rows.length >= MAX_SHEET_ROWS} onClick={() => place && atEdge(insertRow(body, place.row + 1))}>
          <Plus aria-hidden="true" />
          Add below
        </button>
        <button type="button" className="btn btn-sm" disabled={!place || locked || body.rows.length <= 1} onClick={() => place && atEdge(removeRow(body, place.row))}>
          <Minus aria-hidden="true" />
          Remove row
        </button>
        <span className="ml-3 flex items-center gap-1 text-sm text-muted">
          <Columns3 aria-hidden="true" className="size-4" />
          Columns
        </span>
        <button type="button" className="btn btn-sm" disabled={!place || locked || body.columns.length >= MAX_SHEET_COLUMNS} onClick={() => place && atEdge(insertColumn(body, place.col))}>
          <Plus aria-hidden="true" />
          Add left
        </button>
        <button type="button" className="btn btn-sm" disabled={!place || locked || body.columns.length >= MAX_SHEET_COLUMNS} onClick={() => place && atEdge(insertColumn(body, place.col + 1))}>
          <Plus aria-hidden="true" />
          Add right
        </button>
        <button type="button" className="btn btn-sm" disabled={!place || locked || body.columns.length <= 1} onClick={() => place && atEdge(removeColumn(body, place.col))}>
          <Minus aria-hidden="true" />
          Remove column
        </button>
        <span className="ml-auto" />
        {t.editor?.templateId && (
          <button type="button" className="btn btn-sm" disabled={working} onClick={() => void t.openHistory()}>
            <History aria-hidden="true" />
            History
          </button>
        )}
      </div>

      {t.history && (
        <section className="card" aria-label="History" data-testid="sheet-history">
          <div className="card-header">
            <h4 className="card-title">History</h4>
            <button type="button" className="btn btn-sm btn-ghost" onClick={t.closeHistory}>
              Close
            </button>
          </div>
          {t.history.status === 'loading' && <p className="m-0 p-4 text-sm text-muted">Loading the versions from the dashboard.</p>}
          {t.history.status === 'failed' && (
            <div className="p-4">
              <FailurePanel failure={t.history.failure} testId="history-failure" />
            </div>
          )}
          {t.history.status === 'loaded' && t.history.versions.length === 0 && <p className="m-0 p-4 text-sm text-muted">No version has been published yet.</p>}
          {t.history.status === 'loaded' && t.history.versions.length > 0 && (
            <ul className="m-0 list-none p-0">
              {t.history.versions.map((version) => (
                <li key={version.version} className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-2 text-sm">
                  <span className="font-medium">Version {version.version}</span>
                  <span className="text-muted">
                    {when(version.publishedAt)}, by {version.publishedByYou ? 'you' : 'another admin'}
                  </span>
                  <button type="button" className="btn btn-sm ml-auto" disabled={locked} onClick={() => t.restoreVersion(version)}>
                    <RotateCcw aria-hidden="true" />
                    Restore<span className="sr-only"> version {version.version}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <SheetGrid body={body} selected={place} onSelect={setSelected} printed={printed} />
        {place && cell ? (
          <SheetCellEditor
            key={cell.id}
            body={body}
            row={place.row}
            cell={cell}
            title={`${merge && (merge.rows > 1 || merge.cols > 1) ? 'Merged block' : 'Cell'} ${cellName(body, place.row, place.col)}`}
            locked={locked}
            companyName={data?.company.name ?? 'This company'}
            ownValue={own[cell.id]}
            keys={keys}
            hint={upload?.hints[cell.id]}
            preview={
              values && firstRow
                ? {
                    text: values.get(cell.id)?.text ?? '',
                    who: `For ${String(firstRow.Surname ?? '')} ${String(firstRow['Other names'] ?? '')}`.trim(),
                    problem: values.get(cell.id)?.problem ? problemText(body, place.row, cell, values.get(cell.id)!) : null,
                  }
                : null
            }
            onChange={(next) => t.editSheet((current) => setCell(current, place.row, place.col, () => next))}
            onOwnChange={(value) => t.editOwn(cell.id, value)}
          />
        ) : place ? (
          <section className="card flex flex-col gap-3 p-4" data-testid="sheet-cell-new">
            <p className="m-0 text-sm text-muted">Nothing is in this cell yet.</p>
            <div>
              <button type="button" className="btn btn-sm" disabled={locked} onClick={() => t.editSheet((current) => setCell(current, place.row, place.col, (made) => made))}>
                <Plus aria-hidden="true" />
                Use this cell
              </button>
            </div>
          </section>
        ) : (
          <section className="card flex items-start gap-2 p-4 text-sm text-muted" data-testid="sheet-cell-none">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            Click a cell, or a merged block, to choose what goes in it.
          </section>
        )}
      </div>
    </div>
  )
}
