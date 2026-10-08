import {
  CircleAlert,
  CircleCheck,
  FileArchive,
  FileSpreadsheet,
  FileUp,
  Info,
  Replace,
  Scale,
  TriangleAlert,
  Upload,
} from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import sampleText from '../../samples/ABC Co Ltd-pdf-fill-2026-09.json?raw'
import { Dialog } from '../components/Dialog'
import { IssuePanel } from '../components/IssuePanel'
import { MonthReview } from '../components/MonthReview'
import { PayslipPreview } from '../components/PayslipPreview'
import { ReasonDialog } from '../components/ReasonDialog'
import type { PreparedPayslip } from '../lib/build'
import { formatPeriod } from '../lib/dates'
import { buildPdfZip, buildWorkbook, download, exportBaseName } from '../lib/exports'
import { buildIssue, issueStatuses } from '../lib/issueBuild'
import { decodeLines } from '../lib/issuedLines'
import { formatCents } from '../lib/money'
import { withReview } from '../lib/monthReview'
import { importPayrollText, type ImportError, type ImportedPayroll } from '../lib/payrollFile'
import { isReady, pendingChecks, type AcceptedChecks, type ReconcileCheck } from '../lib/payslip'
import { isMonth, type RatesVersion } from '../lib/statutoryRates'
import type { TemplateChoice } from '../lib/templateUse'
import type { Issuing } from '../lib/useIssuing'
import type { MonthReview as Review } from '../lib/useMonthReview'
import { checkKey, ROUNDING_REASON, withReason, zeroKey, type Reasons } from '../lib/reasons'
import type { TemplateMapping } from '../lib/template'

interface Props {
  data: ImportedPayroll | null
  onData: (data: ImportedPayroll | null) => void
  /** Data is already open: the new data goes to the import dialog (Add to or Replace). */
  onOfferImport: (data: ImportedPayroll) => void
  period: string
  onPeriod: (period: string) => void
  issueDate: string
  onIssueDate: (date: string) => void
  prepared: PreparedPayslip[]
  mapping: TemplateMapping
  /** Which template and version the payslips are built with: always shown. */
  templateChip: string
  templateKind: 'built-in' | 'built-in-edited' | 'published' | 'draft'
  /** Why this template cannot be exported (a draft, or a choice still to make). Null when it can. */
  exportBlock: string | null
  onOpenTemplate: () => void
  /** Issuing through the dashboard. Null when the app is opened on its own. */
  issue: IssueSetup | null
  accepted: Record<number, AcceptedChecks>
  onAccepted: Dispatch<SetStateAction<Record<number, AcceptedChecks>>>
  /** Why each difference was accepted. Stored with the payslip when it is issued. */
  reasons: Reasons
  onReasons: Dispatch<SetStateAction<Reasons>>
  treatAsZero: Map<number, Set<string>>
  onTreatAsZero: Dispatch<SetStateAction<Map<number, Set<string>>>>
}

/** What issuing needs besides what is on this page. */
export interface IssueSetup {
  issuing: Issuing
  readOnly: boolean
  choice: TemplateChoice
  /** The rates the cross-check used for this month, or null when it did not run. */
  rates: RatesVersion | null
  /** The comparison with last month. Issuing waits for it; downloads do not. */
  review: Review
}

type Status = 'ready' | 'review' | 'fix'

const amount = (cents: number | null) => (cents === null ? '' : cents === 0 ? '0' : formatCents(cents))
const signed = (cents: number) => `${cents > 0 ? '+' : '-'}${formatCents(Math.abs(cents))}`

function StatusBadge({ status }: { status: Status }) {
  if (status === 'ready') {
    return (
      <span className="badge tone-accent">
        <CircleCheck aria-hidden="true" />
        Ready
      </span>
    )
  }
  if (status === 'review') {
    return (
      <span className="badge tone-warn">
        <Scale aria-hidden="true" />
        To accept
      </span>
    )
  }
  return (
    <span className="badge tone-danger">
      <CircleAlert aria-hidden="true" />
      Fix needed
    </span>
  )
}

export function PayslipsScreen(props: Props) {
  const { data, onData, period, onPeriod, issueDate, onIssueDate, prepared, accepted, onAccepted, onTreatAsZero } = props
  const [importErrors, setImportErrors] = useState<ImportError[] | null>(null)
  const [reading, setReading] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [current, setCurrent] = useState(0)
  const [busy, setBusy] = useState<'pdf' | 'excel' | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [roundingOpen, setRoundingOpen] = useState(false)
  /** A difference waiting for its reason before it is accepted. */
  const [asking, setAsking] = useState<{ title: string; description: string; confirmLabel: string; apply: (reason: string) => void } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const periodId = useId()
  const dateId = useId()

  // A new set of data starts with everyone selected and the first employee on screen.
  useEffect(() => {
    setSelected(new Set(data ? data.rows.map((_, index) => index) : []))
    setCurrent(0)
    setExportError(null)
  }, [data])

  const { issue } = props
  const monthState = issue && isMonth(period) ? issue.issuing.months[period] : undefined
  const issuedMonth = monthState?.status === 'loaded' ? monthState.payslips : null
  /** Where each employee stands for the month, once the month has been loaded from the dashboard. */
  const issueStatus = useMemo(
    () => (data ? issueStatuses(data, prepared, issuedMonth, accepted, props.reasons) : new Map()),
    [data, prepared, issuedMonth, accepted, props.reasons],
  )
  const issueBuild = useMemo(
    () =>
      data && issue
        ? buildIssue({
            data,
            period,
            prepared,
            selected: [...selected].sort((a, b) => a - b),
            accepted,
            reasons: props.reasons,
            choice: issue.choice,
            previewingDraft: props.templateKind === 'draft',
            rates: issue.rates,
            month: issuedMonth ?? [],
          })
        : null,
    [data, issue, period, prepared, selected, accepted, props.reasons, props.templateKind, issuedMonth],
  )
  // The month review adds its reasons to wait. It never changes a payslip that is to be issued.
  const reviewedBuild = issue && issueBuild ? withReview(issueBuild, issue.review.problems([...selected])) : issueBuild

  const accept = (next: ImportedPayroll) => {
    setImportErrors(null)
    if (data) props.onOfferImport(next)
    else onData(next)
  }

  const importText = (text: string, fileName: string) => {
    const result = importPayrollText(text, fileName)
    if (result.ok) accept(result.data)
    else setImportErrors(result.errors)
  }

  const readFile = async (file: File | undefined) => {
    if (!file) return
    setReading(true)
    try {
      importText(await file.text(), file.name)
    } catch {
      setImportErrors([{ message: 'The file could not be read. Choose it again.' }])
    } finally {
      setReading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const importControls = (
    <>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => void readFile(event.target.files?.[0])}
      />
      <button type="button" className={`btn ${data ? '' : 'btn-primary'}`} onClick={() => fileInput.current?.click()}>
        {data ? <Replace aria-hidden="true" /> : <Upload aria-hidden="true" />}
        {data ? 'Import another file' : 'Import payroll JSON'}
      </button>
    </>
  )

  const errorPanel = importErrors && (
    <div className="panel tone-danger mb-4" role="alert">
      <CircleAlert aria-hidden="true" />
      <div className="min-w-0">
        <p className="m-0 font-medium">This file was not imported.</p>
        <ul className="m-0 mt-1 list-disc pl-5 text-sm text-muted">
          {importErrors.slice(0, 12).map((error, index) => (
            <li key={index}>{error.message}</li>
          ))}
          {importErrors.length > 12 && <li>And {importErrors.length - 12} more.</li>}
        </ul>
        <p className="m-0 mt-2 text-sm text-muted">Fix it in the payroll app, export the file again, then import it here.</p>
      </div>
    </div>
  )

  if (reading) {
    return (
      <div className="card mx-auto max-w-3xl p-6" aria-busy="true" aria-label="Reading the file">
        <div className="skeleton mb-3 h-6 w-1/3" />
        <div className="skeleton mb-2 h-10 w-full" />
        <div className="skeleton mb-2 h-10 w-full" />
        <div className="skeleton h-10 w-2/3" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-3xl rise-in">
        {errorPanel}
        <div
          className="card flex flex-col items-center gap-3 px-6 py-14 text-center"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            void readFile(event.dataTransfer.files[0])
          }}
        >
          <span className="icon-tile" aria-hidden="true">
            <FileUp />
          </span>
          <h2 className="m-0 text-2xl font-semibold tracking-tight">No payroll data yet</h2>
          <p className="m-0 max-w-md text-muted">
            Import the file the payroll app calls "Export for PDF fill (JSON)", with Company Details ticked. You can also
            drop the file here.
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {importControls}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => importText(sampleText, 'ABC Co Ltd-pdf-fill-2026-09.json')}
            >
              Try with fake sample data
            </button>
          </div>
          <p className="m-0 mt-2 text-xs text-subtle">The data stays in this tab's memory. Nothing is saved in the browser.</p>
        </div>
      </div>
    )
  }

  const hasPeriod = isMonth(period)
  const statusOf = (item: PreparedPayslip): Status =>
    item.computation.errors.length > 0
      ? 'fix'
      : isReady(item.computation, accepted[item.computation.rowIndex] ?? {})
        ? 'ready'
        : 'review'
  const statuses = prepared.map(statusOf)
  const counts = { ready: 0, review: 0, fix: 0 }
  for (const status of statuses) counts[status]++

  const item = prepared[current] as PreparedPayslip | undefined
  const selectedItems = prepared.filter((p) => selected.has(p.computation.rowIndex))
  const notReady = selectedItems.filter((p) => statusOf(p) !== 'ready').length
  const blockReason = props.exportBlock
    ? props.exportBlock
    : !hasPeriod
    ? 'Choose the pay month first.'
    : selectedItems.length === 0
      ? 'Select at least one employee.'
      : notReady > 0
        ? `${notReady} selected ${notReady === 1 ? 'payslip is' : 'payslips are'} not ready. Fix or accept them, or untick them.`
        : null

  const notIssuedSelected = selectedItems.filter((p) => {
    const status = issueStatus.get(p.computation.rowIndex)
    return !(status?.kind === 'issued' && status.same)
  }).length
  const issuedBadge = (rowIndex: number) => {
    const status = issueStatus.get(rowIndex)
    if (!status) return <span className="text-xs text-subtle">Not checked</span>
    if (status.kind === 'not-issued') return <span className="badge tone-warn">Not issued</span>
    return status.same ? (
      <span className="badge tone-accent">Issued, revision {status.revision}</span>
    ) : (
      <span className="badge tone-warn">Changed since revision {status.revision}</span>
    )
  }

  const roundingItems = prepared.flatMap((p) =>
    p.computation.errors.length > 0
      ? []
      : pendingChecks(p.computation, accepted[p.computation.rowIndex] ?? {})
          .filter((check) => check.kind === 'rounding')
          .map((check) => ({ item: p, check })),
  )

  const acceptCheck = (rowIndex: number, check: ReconcileCheck, name: string) => {
    if (check.diffCents === null) return
    const diff = check.diffCents
    const apply = (reason: string) => {
      onAccepted((previous) => ({ ...previous, [rowIndex]: { ...previous[rowIndex], [check.id]: diff } }))
      props.onReasons((previous) => withReason(previous, rowIndex, checkKey(check.id), reason))
      setAsking(null)
    }
    // A difference of exactly 0.01 is rounding. Anything else needs its own reason.
    if (check.kind === 'rounding') return apply(ROUNDING_REASON)
    setAsking({
      title: `Accept the difference on ${check.label}?`,
      description: `${name}: the payslip shows ${amount(check.payslipCents)}, the payroll says ${amount(check.payrollCents)} (${signed(diff)}). No figure is changed.`,
      confirmLabel: 'Accept the difference',
      apply,
    })
  }
  const acceptAllRounding = () => {
    onAccepted((previous) => {
      const next = { ...previous }
      for (const { item: p, check } of roundingItems) {
        next[p.computation.rowIndex] = { ...next[p.computation.rowIndex], [check.id]: check.diffCents! }
      }
      return next
    })
    props.onReasons((previous) =>
      roundingItems.reduce((next, { item: p, check }) => withReason(next, p.computation.rowIndex, checkKey(check.id), ROUNDING_REASON), previous),
    )
    setRoundingOpen(false)
  }
  const treatLineAsZero = (rowIndex: number, lineId: string, name: string) => {
    const label = prepared[rowIndex]?.computation.lines.find((line) => line.id === lineId)?.label ?? 'this line'
    setAsking({
      title: `Treat ${label} as zero?`,
      description: `${name}: the payroll data has no figure for ${label}. The line will show "-". No other figure is changed.`,
      confirmLabel: 'Treat as zero',
      apply: (reason) => {
        onTreatAsZero((previous) => {
          const next = new Map(previous)
          next.set(rowIndex, new Set([...(previous.get(rowIndex) ?? []), lineId]))
          return next
        })
        props.onReasons((previous) => withReason(previous, rowIndex, zeroKey(lineId), reason))
        setAsking(null)
      },
    })
  }

  const runExport = async (kind: 'pdf' | 'excel') => {
    setBusy(kind)
    setExportError(null)
    try {
      // A payslip that is exactly the one issued is made from what was stored when it was issued.
      const docs = selectedItems.map((p) => {
        const status = issueStatus.get(p.computation.rowIndex)
        const stored = status?.kind === 'issued' && status.same ? decodeLines(status.issued.lines) : null
        return stored?.ok ? stored.document : p.document!
      })
      const base = exportBaseName(data.company.name, period)
      if (kind === 'pdf') download(await buildPdfZip(docs, period), `${base}.zip`, 'application/zip')
      else {
        download(
          await buildWorkbook(docs),
          `${base}.xlsx`,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
      }
    } catch {
      setExportError('The file could not be created. Nothing was downloaded. Try again.')
    } finally {
      setBusy(null)
    }
  }

  const allSelected = prepared.length > 0 && selected.size === prepared.length
  const toggle = (rowIndex: number) => {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(rowIndex)) next.delete(rowIndex)
      else next.add(rowIndex)
      return next
    })
  }

  return (
    <div className="rise-in mx-auto flex max-w-[1500px] flex-col gap-4">
      {errorPanel}

      <section className="card" aria-label="Payroll data">
        <div className="flex flex-wrap items-end gap-4 px-5 py-4">
          <div className="mr-auto min-w-0">
            <p className="m-0 text-xs uppercase tracking-wider text-subtle">Company</p>
            <p className="m-0 text-lg font-semibold tracking-tight">{data.company.name}</p>
            <p className="m-0 text-sm text-muted">
              <span className="num">{data.rows.length}</span> employees
              {data.fileName ? ` from ${data.fileName}` : ''}
            </p>
          </div>
          <div className="min-w-0">
            <p className="m-0 text-xs uppercase tracking-wider text-subtle">Template</p>
            <p className="m-0 flex flex-wrap items-center gap-2">
              <span className={`badge ${props.templateKind === 'published' || props.templateKind === 'built-in' ? 'tone-accent' : 'tone-warn'}`} data-testid="template-chip">
                {props.templateChip}
              </span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={props.onOpenTemplate}>
                Change<span className="sr-only"> the template</span>
              </button>
            </p>
          </div>
          <div className="field">
            <label className="field-label" htmlFor={periodId}>
              Pay month
            </label>
            <input
              id={periodId}
              type="month"
              className="input num"
              value={period}
              aria-invalid={!hasPeriod}
              onChange={(event) => onPeriod(event.target.value)}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor={dateId}>
              Date on the payslip
            </label>
            <input
              id={dateId}
              type="date"
              className="input num"
              value={issueDate}
              onChange={(event) => event.target.value && onIssueDate(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">{importControls}</div>
        </div>
      </section>

      {props.templateKind === 'draft' && (
        <div className="panel tone-warn" role="status" data-testid="draft-banner">
          <TriangleAlert aria-hidden="true" />
          <div>
            <p className="m-0 font-medium">Draft, not published</p>
            <p className="m-0 text-sm text-muted">
              You are previewing a draft template. It shows how the payslips would look. They can be exported only from a
              published version or the built-in template.
            </p>
          </div>
        </div>
      )}

      {!hasPeriod ? (
        <div className="panel tone-warn" role="status">
          <TriangleAlert aria-hidden="true" />
          <div>
            <p className="m-0 font-medium">Choose the pay month.</p>
            <p className="m-0 text-sm text-muted">
              The file name did not say which month this payroll is for. Pick it above to see the payslips.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(420px,5fr)_7fr]">
          <div className="flex min-w-0 flex-col gap-4">
            <section className="card flex min-h-0 flex-col" aria-label="Employees">
              <div className="card-header">
                <h2 className="card-title">Employees</h2>
                <p className="m-0 flex flex-wrap gap-1.5">
                  <span className="badge tone-accent">{counts.ready} ready</span>
                  {counts.review > 0 && <span className="badge tone-warn">{counts.review} to accept</span>}
                  {counts.fix > 0 && <span className="badge tone-danger">{counts.fix} to fix</span>}
                </p>
              </div>
              <div className="table-scroll max-h-[420px]">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col" className="w-8">
                        <input
                          type="checkbox"
                          aria-label="Select all employees"
                          checked={allSelected}
                          onChange={() =>
                            setSelected(allSelected ? new Set() : new Set(prepared.map((p) => p.computation.rowIndex)))
                          }
                        />
                      </th>
                      <th scope="col">Employee</th>
                      <th scope="col" className="right">
                        Net pay
                      </th>
                      <th scope="col">Status</th>
                      {issue && <th scope="col">Issued</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {prepared.map((p, index) => {
                      const c = p.computation
                      const warnings = c.warnings.filter((w) => w.code.startsWith('cross-check') || w.code === 'old-name').length
                      return (
                        <tr key={c.rowIndex} className={index === current ? 'row-current' : undefined}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={`Include ${c.employeeName}`}
                              checked={selected.has(c.rowIndex)}
                              onChange={() => toggle(c.rowIndex)}
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className="row-button"
                              aria-current={index === current ? 'true' : undefined}
                              onClick={() => setCurrent(index)}
                            >
                              <span className="font-medium">{c.employeeName}</span>
                              {warnings > 0 && (
                                <span className="ml-2 inline-flex items-center gap-1 text-xs text-warn">
                                  <TriangleAlert aria-hidden="true" size={12} />
                                  {warnings} {warnings === 1 ? 'warning' : 'warnings'}
                                </span>
                              )}
                            </button>
                          </td>
                          <td className="right num">{c.totals ? amount(c.totals.net) : ''}</td>
                          <td>
                            <StatusBadge status={statuses[index]} />
                          </td>
                          {issue && <td>{issuedBadge(c.rowIndex)}</td>}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={blockReason !== null || busy !== null}
                  onClick={() => void runExport('pdf')}
                >
                  <FileArchive aria-hidden="true" />
                  {busy === 'pdf' ? 'Creating PDFs' : 'Download PDFs (zip)'}
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={blockReason !== null || busy !== null}
                  onClick={() => void runExport('excel')}
                >
                  <FileSpreadsheet aria-hidden="true" />
                  {busy === 'excel' ? 'Creating Excel file' : 'Download Excel'}
                </button>
                {roundingItems.length > 0 && (
                  <button type="button" className="btn" onClick={() => setRoundingOpen(true)}>
                    <Scale aria-hidden="true" />
                    Accept {roundingItems.length} rounding {roundingItems.length === 1 ? 'difference' : 'differences'}
                  </button>
                )}
                {issue && notIssuedSelected > 0 && (
                  <p className="m-0 flex w-full items-center gap-2 text-sm" data-testid="not-issued-note">
                    <span className="badge tone-warn">Not issued</span>
                    {notIssuedSelected} of the selected {notIssuedSelected === 1 ? 'payslip is' : 'payslips are'} not issued, or changed since.
                    A download of them is not an issued payslip. Nothing is printed on the payslip itself.
                  </p>
                )}
                <p className="m-0 w-full text-sm text-muted" role="status">
                  {blockReason ??
                    `${selectedItems.length} ${selectedItems.length === 1 ? 'payslip' : 'payslips'} for ${formatPeriod(period)} ready to download.`}
                </p>
                {exportError && (
                  <p className="m-0 w-full text-sm text-danger" role="alert">
                    {exportError}
                  </p>
                )}
              </div>
            </section>

            {issue ? (
              <MonthReview period={period} review={issue.review} readOnly={issue.readOnly} current={item?.computation.rowIndex ?? null} onShow={setCurrent} />
            ) : (
              <section className="card" aria-label="Month review" data-testid="month-review-standalone">
                <div className="card-header">
                  <h2 className="card-title">Month review</h2>
                </div>
                <p className="m-0 p-4 text-sm text-muted">
                  The month review compares each payslip with the one issued last month. Issued payslips are kept by the Payroll Hub dashboard, so the
                  review is available when this app is opened from there.
                </p>
              </section>
            )}

            {issue && reviewedBuild && (
              <IssuePanel
                period={period}
                brn={data.company.brn}
                month={monthState}
                issuing={issue.issuing}
                readOnly={issue.readOnly}
                build={reviewedBuild}
                templateLabel={props.templateChip}
                ratesLabel={issue.rates ? `Version of ${formatPeriod(issue.rates.effectiveFrom)}, revision ${issue.rates.revision}` : 'Not cross-checked'}
                onLoad={() => void issue.issuing.load(period)}
              />
            )}

            {item && (
              <ChecksCard
                item={item}
                mapping={props.mapping}
                accepted={accepted[item.computation.rowIndex] ?? {}}
                reasons={props.reasons[item.computation.rowIndex] ?? {}}
                onAccept={(check) => acceptCheck(item.computation.rowIndex, check, item.computation.employeeName)}
                onTreatAsZero={(lineId) => treatLineAsZero(item.computation.rowIndex, lineId, item.computation.employeeName)}
              />
            )}
          </div>

          <section className="card min-w-0" aria-label="Payslip preview">
            <div className="card-header">
              <h2 className="card-title">{item ? item.computation.employeeName : 'Preview'}</h2>
              <span className="text-sm text-muted">A4, as it will print</span>
            </div>
            <div className="p-4">
              {item?.page ? (
                <div className="paper-well">
                  <PayslipPreview page={item.page} label={`Payslip of ${item.computation.employeeName} for ${formatPeriod(period)}`} />
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
                  <span className="icon-tile tone-danger" aria-hidden="true">
                    <CircleAlert />
                  </span>
                  <h3 className="m-0 text-lg font-semibold">This payslip cannot be shown yet</h3>
                  <p className="m-0 max-w-sm text-sm text-muted">
                    A figure is missing or wrong, so nothing is printed rather than a blank or a zero. See what to fix in
                    the checks.
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {roundingOpen && (
        <Dialog
          title="Accept the rounding differences?"
          description="Each total below differs from the payroll's by exactly 0.01. The payroll adds unrounded figures; the payslip adds the lines shown."
          icon={<Scale />}
          tone="warn"
          width={720}
          onClose={() => setRoundingOpen(false)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setRoundingOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={acceptAllRounding}>
                Accept {roundingItems.length}
              </button>
            </>
          }
        >
          <div className="table-scroll max-h-[46vh] rounded-lg border border-line">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  <th scope="col">Total</th>
                  <th scope="col" className="right">
                    Payslip
                  </th>
                  <th scope="col" className="right">
                    Payroll
                  </th>
                  <th scope="col" className="right">
                    Difference
                  </th>
                </tr>
              </thead>
              <tbody>
                {roundingItems.map(({ item: p, check }) => (
                  <tr key={`${p.computation.rowIndex}-${check.id}`}>
                    <td>{p.computation.employeeName}</td>
                    <td>{check.label}</td>
                    <td className="right num">{amount(check.payslipCents)}</td>
                    <td className="right num">{amount(check.payrollCents)}</td>
                    <td className="right num">{signed(check.diffCents!)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Dialog>
      )}

      {asking && (
        <ReasonDialog
          title={asking.title}
          description={asking.description}
          confirmLabel={asking.confirmLabel}
          onConfirm={asking.apply}
          onClose={() => setAsking(null)}
        />
      )}
    </div>
  )
}

interface ChecksProps {
  item: PreparedPayslip
  mapping: TemplateMapping
  accepted: AcceptedChecks
  reasons: Record<string, string>
  onAccept: (check: ReconcileCheck) => void
  onTreatAsZero: (lineId: string) => void
}

function ChecksCard({ item, mapping, accepted, reasons, onAccept, onTreatAsZero }: ChecksProps) {
  const c = item.computation
  const canTreatAsZero = (lineId: string | undefined) =>
    lineId !== undefined && lineId in mapping.lines && !mapping.lines[lineId].required

  return (
    <section className="card" aria-label={`Checks for ${c.employeeName}`}>
      <div className="card-header">
        <h2 className="card-title">Checks for {c.employeeName}</h2>
      </div>
      <div className="flex flex-col gap-3 p-4">
        {c.errors.map((error, index) => (
          <div key={`e${index}`} className="panel tone-danger" role="alert">
            <CircleAlert aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="m-0 text-sm">
                <span className="font-medium">{c.employeeName}.</span> {error.message}
              </p>
              {error.code === 'missing-key' && canTreatAsZero(error.lineId) && (
                <button type="button" className="btn btn-sm mt-2" onClick={() => onTreatAsZero(error.lineId!)}>
                  Treat as zero for this employee
                </button>
              )}
            </div>
          </div>
        ))}

        <div className="table-scroll rounded-lg border border-line">
          <table className="table">
            <caption className="sr-only">The payslip totals compared with the payroll totals</caption>
            <thead>
              <tr>
                <th scope="col">Total</th>
                <th scope="col" className="right">
                  Payslip
                </th>
                <th scope="col" className="right">
                  Payroll
                </th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {c.checks.map((check) => {
                const isAccepted = check.diffCents !== null && check.kind !== 'match' && accepted[check.id] === check.diffCents
                return (
                  <tr key={check.id}>
                    <th scope="row" className="!static !bg-transparent !text-fg !text-[13.5px]">
                      {check.label}
                      <span className="block text-xs font-normal text-subtle">against {check.payrollKey}</span>
                    </th>
                    <td className="right num">{amount(check.payslipCents)}</td>
                    <td className="right num">{amount(check.payrollCents)}</td>
                    <td>
                      {check.kind === 'match' && (
                        <span className="badge tone-accent">
                          <CircleCheck aria-hidden="true" />
                          Matches
                        </span>
                      )}
                      {check.kind === 'unavailable' && <span className="badge tone-danger">Not checked</span>}
                      {(check.kind === 'rounding' || check.kind === 'difference') && (
                        <span className="flex flex-wrap items-center gap-2">
                          <span className={`badge ${check.kind === 'rounding' ? 'tone-warn' : 'tone-danger'}`}>
                            {check.kind === 'rounding' ? 'Rounding' : 'Difference'} <span className="num">{signed(check.diffCents!)}</span>
                          </span>
                          {isAccepted ? (
                            <span className="text-xs text-muted">Accepted: {reasons[checkKey(check.id)] ?? 'no reason given'}</span>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-sm"
                              onClick={() => onAccept(check)}
                              aria-label={`Accept the ${check.kind === 'rounding' ? 'rounding difference' : 'difference'} on ${check.label}`}
                            >
                              Accept
                            </button>
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {c.lines
          .filter((line) => line.status === 'treated-as-zero')
          .map((line) => (
            <div key={`z${line.id}`} className="panel tone-sky">
              <Info aria-hidden="true" />
              <p className="m-0 text-sm">
                <span className="font-medium">Treated as zero.</span> {line.label}: {reasons[zeroKey(line.id)] ?? 'no reason given'}
              </p>
            </div>
          ))}
        {c.warnings.map((warning, index) => (
          <div key={`w${index}`} className={`panel ${warning.code === 'to-confirm' ? 'tone-sky' : 'tone-warn'}`}>
            {warning.code === 'to-confirm' ? <Info aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
            <p className="m-0 text-sm">
              <span className="font-medium">{warning.code === 'to-confirm' ? 'To confirm.' : 'Warning.'}</span> {warning.message}
            </p>
          </div>
        ))}
        <p className="m-0 text-xs text-subtle">
          A difference from the payroll totals blocks the download until you accept it. Warnings never block.
        </p>
      </div>
    </section>
  )
}
