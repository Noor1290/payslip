import { Download, Inbox } from 'lucide-react'
import { useState } from 'react'
import { formatPeriod } from '../lib/dates'
import type { MergeResult } from '../lib/hubBridge'
import { employeeName, type ImportedPayroll } from '../lib/payrollFile'
import { Dialog } from './Dialog'

/** Payroll data that was read and checked, and is waiting for the user's decision. */
export interface IncomingPayroll {
  /** Tells one delivery from the next, even with identical rows. */
  key: string
  source: 'dashboard' | 'file'
  data: ImportedPayroll
}

interface Props {
  incoming: IncomingPayroll
  /** Data already open, if any: then the user chooses between adding and replacing. */
  existing: { name: string; count: number } | null
  /** Whether the incoming rows can be added to the data already open, and why not. */
  merge: MergeResult | null
  onImport: (mode: 'add' | 'replace') => void
  onClose: () => void
}

const PREVIEW_NAMES = 8

/**
 * The one confirmation step for data that would change what is on screen: what is about to be
 * imported, and the Add to / Replace choice. Names only; no figures are shown here.
 */
export function ImportDialog({ incoming, existing, merge, onImport, onClose }: Props) {
  const canAdd = merge?.ok === true
  // Adding is the choice that loses nothing, so it is the default whenever it is possible.
  const [mode, setMode] = useState<'add' | 'replace'>(canAdd ? 'add' : 'replace')
  const { data, source } = incoming
  const count = data.rows.length
  const people = (n: number) => `${n} ${n === 1 ? 'employee' : 'employees'}`
  const effectiveMode = existing && canAdd ? mode : 'replace'

  return (
    <Dialog
      title="Import payroll data"
      description={source === 'dashboard' ? 'Sent by the dashboard.' : `From the file ${data.fileName ?? 'you chose'}.`}
      icon={source === 'dashboard' ? <Inbox /> : <Download />}
      width={560}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {source === 'dashboard' ? 'Not now' : 'Cancel'}
          </button>
          <button type="button" className="btn btn-primary" data-autofocus onClick={() => onImport(existing ? effectiveMode : 'replace')}>
            {!existing ? `Import ${people(count)}` : effectiveMode === 'add' ? `Add ${people(count)}` : `Replace with ${people(count)}`}
          </button>
        </>
      }
    >
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted">Company</dt>
        <dd className="m-0 font-medium">{data.company.name}</dd>
        <dt className="text-muted">Pay month</dt>
        <dd className="m-0">{data.period ? formatPeriod(data.period) : 'Not given. You choose it after importing.'}</dd>
        <dt className="text-muted">Employees</dt>
        <dd className="m-0 num">{count}</dd>
      </dl>

      <ul className="m-0 mt-3 max-h-40 list-none overflow-auto rounded-lg border border-line p-0 text-sm" aria-label="Employees in this data">
        {data.rows.slice(0, PREVIEW_NAMES).map((row, index) => (
          <li key={index} className="border-b border-line px-3 py-1.5 last:border-b-0">
            {employeeName(row)}
          </li>
        ))}
        {count > PREVIEW_NAMES && <li className="px-3 py-1.5 text-muted">and {count - PREVIEW_NAMES} more</li>}
      </ul>

      {existing && (
        <fieldset className="m-0 mt-4 rounded-lg border border-line p-3">
          <legend className="px-1 text-sm text-muted">
            {existing.name}, {people(existing.count)}, is open now
          </legend>
          <label className="flex items-start gap-2 py-1 text-sm">
            <input type="radio" name="import-mode" className="mt-1" checked={effectiveMode === 'add'} disabled={!canAdd} onChange={() => setMode('add')} />
            <span>
              Add to the {people(existing.count)} already here
              {!canAdd && merge && !merge.ok && <span className="block text-muted">Not possible. {merge.reason}</span>}
            </span>
          </label>
          <label className="flex items-start gap-2 py-1 text-sm">
            <input type="radio" name="import-mode" className="mt-1" checked={effectiveMode === 'replace'} onChange={() => setMode('replace')} />
            <span>
              Replace them
              <span className="block text-muted">The differences you accepted for the current data will be cleared.</span>
            </span>
          </label>
        </fieldset>
      )}
    </Dialog>
  )
}
