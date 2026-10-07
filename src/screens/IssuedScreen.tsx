import { CircleAlert, FileArchive, FileCheck2, FileSpreadsheet, FolderOpen, Lock } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { FailurePanel } from '../components/FailurePanel'
import { PayslipPreview } from '../components/PayslipPreview'
import { formatPeriod, formatShortDate, isIsoDate } from '../lib/dates'
import { buildPdfZip, buildWorkbook, download, exportBaseName } from '../lib/exports'
import type { HubPort } from '../lib/hubWire'
import { decodeLines } from '../lib/issuedLines'
import { formatCents } from '../lib/money'
import { isMonth } from '../lib/statutoryRates'
import { loadVersion } from '../lib/templateStore'
import type { Issuing } from '../lib/useIssuing'
import { layoutPage } from '../writers/pageGeometry'

interface Props {
  issuing: Issuing
  port: HubPort
  /** The company whose issued payslips are opened: the open payroll data's, or the dashboard's. */
  company: { name: string; brn: string } | null
  readOnly: boolean
  /** The pay month on the Payslips page, offered first. */
  period: string
}

const day = (stamp: string) => (isIsoDate(stamp.slice(0, 10)) ? formatShortDate(stamp.slice(0, 10)) : '')
const amount = (value: number) => formatCents(Math.round(value * 100)).replace(/^-$/, '0')

/**
 * A month as it was issued. Every payslip is drawn from its stored lines alone: nothing here
 * reads the payroll data, a template body or the rates, so nothing can be recalculated.
 */
export function IssuedScreen({ issuing, port, company, readOnly, period: payMonth }: Props) {
  const [period, setPeriod] = useState(isMonth(payMonth) ? payMonth : '')
  const [current, setCurrent] = useState(0)
  const [busy, setBusy] = useState<'pdf' | 'excel' | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  /** Template names, by "id version". Loaded only to name the template; never needed to draw. */
  const [templateNames, setTemplateNames] = useState<Record<string, string | null>>({})

  const month = isMonth(period) ? issuing.months[period] : undefined
  const payslips = useMemo(
    () => (month?.status === 'loaded' ? month.payslips.map((issued) => ({ issued, read: decodeLines(issued.lines) })) : []),
    [month],
  )
  const readable = payslips.flatMap(({ read }) => (read.ok ? [read.document] : []))
  const shown = payslips[current] as (typeof payslips)[number] | undefined
  const page = useMemo(() => (shown?.read.ok ? layoutPage(shown.read.document) : null), [shown])

  useEffect(() => setCurrent(0), [month])

  const wanted = [...new Set(payslips.map(({ issued }) => `${issued.templateId} ${issued.templateVersion}`))].join('|')
  useEffect(() => {
    if (!company || wanted === '') return
    let active = true
    for (const key of wanted.split('|')) {
      const [templateId, version] = key.split(' ')
      // A template that cannot be loaded never blocks the payslips: only its name is missing.
      void loadVersion(port, company.brn, templateId, Number(version)).then((loaded) => {
        if (active) setTemplateNames((previous) => ({ ...previous, [key]: loaded.ok ? loaded.value.name : null }))
      })
    }
    return () => {
      active = false
    }
  }, [wanted, company, port])

  const templateOf = (templateId: string, version: number) => {
    const name = templateNames[`${templateId} ${version}`]
    return name ? `${name}, version ${version}` : name === null ? `Version ${version} (name not available)` : `Version ${version}`
  }

  const runExport = async (kind: 'pdf' | 'excel') => {
    if (!company) return
    setBusy(kind)
    setExportError(null)
    try {
      const base = `${exportBaseName(company.name || 'Company', period)} - issued`
      if (kind === 'pdf') download(await buildPdfZip(readable, period), `${base}.zip`, 'application/zip')
      else download(await buildWorkbook(readable), `${base}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    } catch {
      setExportError('The file could not be created. Nothing was downloaded. Try again.')
    } finally {
      setBusy(null)
    }
  }

  const cannotOpen = readOnly
    ? 'Only an admin of this company can open issued payslips. You are signed in to the dashboard as a member.'
    : !company
      ? 'The dashboard has not said which company is selected yet.'
      : null

  return (
    <div className="rise-in mx-auto flex max-w-[1500px] flex-col gap-4">
      <div>
        <h2 className="m-0 text-2xl font-semibold tracking-tight">Issued payslips</h2>
        <p className="m-0 text-muted">A month exactly as it was issued. Nothing here is recalculated from the payroll data.</p>
      </div>

      <section className="card" aria-label="Open a month">
        <div className="flex flex-wrap items-end gap-4 px-5 py-4">
          <div className="mr-auto min-w-0">
            <p className="m-0 text-xs uppercase tracking-wider text-subtle">Company</p>
            <p className="m-0 text-lg font-semibold tracking-tight" data-testid="issued-company">
              {company ? `${company.name || 'The selected company'}, BRN ${company.brn}` : 'Not known yet'}
            </p>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="issued-month">
              Month
            </label>
            <input id="issued-month" type="month" className="input num" value={period} onChange={(event) => setPeriod(event.target.value)} />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={cannotOpen !== null || !isMonth(period) || month?.status === 'loading' || issuing.busy}
            aria-describedby={cannotOpen ? 'cannot-open' : undefined}
            onClick={() => void issuing.load(period)}
          >
            <FolderOpen aria-hidden="true" />
            {month?.status === 'loading' ? 'Waiting for the dashboard' : month?.status === 'loaded' ? 'Open the month again' : 'Open the month'}
          </button>
        </div>
        <p className="m-0 border-t border-line px-5 py-3 text-xs text-subtle">
          The dashboard asks you first, and must be unlocked: this sends national IDs and pay to this app. They stay in this tab's memory and
          are gone when the tab is closed.
        </p>
        {cannotOpen && (
          <p className="m-0 flex items-start gap-2 border-t border-line px-5 py-3 text-sm text-muted" id="cannot-open" data-testid="cannot-open">
            <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {cannotOpen}
          </p>
        )}
      </section>

      {month?.status === 'failed' && (
        <FailurePanel failure={month.failure} testId="issued-load-failure">
          <button type="button" className="btn btn-sm" onClick={() => void issuing.load(period)}>
            Ask again
          </button>
        </FailurePanel>
      )}

      {month?.status === 'loaded' && payslips.length === 0 && (
        <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center" data-testid="issued-empty">
          <span className="icon-tile" aria-hidden="true">
            <FileCheck2 />
          </span>
          <p className="m-0 font-semibold">Nothing is issued for {formatPeriod(period)}</p>
          <p className="m-0 max-w-md text-sm text-muted">Issue the month from the Payslips page. It then shows here exactly as issued.</p>
        </div>
      )}

      {month?.status === 'loaded' && payslips.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-[minmax(420px,5fr)_7fr]">
          <div className="flex min-w-0 flex-col gap-4">
            <section className="card flex min-h-0 flex-col" aria-label="Issued payslips of the month">
              <div className="card-header">
                <h3 className="card-title">{formatPeriod(period)}</h3>
                <span className="badge tone-accent" data-testid="issued-shown">
                  {payslips.length} issued, latest revision of each
                </span>
              </div>
              <div className="table-scroll max-h-[420px]">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Employee</th>
                      <th scope="col" className="right">Revision</th>
                      <th scope="col">Template</th>
                      <th scope="col">Issued</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payslips.map(({ issued, read }, index) => (
                      <tr key={index} className={index === current ? 'row-current' : undefined}>
                        <td>
                          <button type="button" className="row-button" aria-current={index === current ? 'true' : undefined} onClick={() => setCurrent(index)}>
                            {read.ok ? read.document.employeeName : `Payslip ${index + 1} (cannot be shown)`}
                          </button>
                        </td>
                        <td className="right num">{issued.revision}</td>
                        <td className="text-muted">{templateOf(issued.templateId, issued.templateVersion)}</td>
                        <td className="text-muted">
                          {issued.issuedByYou ? 'You' : 'Another admin'} {day(issued.issuedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
                <button type="button" className="btn btn-primary" disabled={readable.length === 0 || busy !== null} onClick={() => void runExport('pdf')}>
                  <FileArchive aria-hidden="true" />
                  {busy === 'pdf' ? 'Creating PDFs' : 'Download issued PDFs (zip)'}
                </button>
                <button type="button" className="btn" disabled={readable.length === 0 || busy !== null} onClick={() => void runExport('excel')}>
                  <FileSpreadsheet aria-hidden="true" />
                  {busy === 'excel' ? 'Creating Excel file' : 'Download issued Excel'}
                </button>
                <p className="m-0 w-full text-sm text-muted" role="status">
                  {readable.length} {readable.length === 1 ? 'payslip' : 'payslips'}, made from what was stored when issued.
                  {readable.length < payslips.length ? ` ${payslips.length - readable.length} cannot be shown and are left out.` : ''}
                </p>
                {exportError && (
                  <p className="m-0 w-full text-sm text-danger" role="alert">
                    {exportError}
                  </p>
                )}
              </div>
            </section>

            {shown && (
              <section className="card" aria-label="As issued" data-testid="issued-details">
                <div className="card-header">
                  <h3 className="card-title">As issued</h3>
                  <span className="badge">Revision {shown.issued.revision}</span>
                </div>
                <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 p-4 text-sm">
                  <dt className="text-muted">Template</dt>
                  <dd className="m-0">{templateOf(shown.issued.templateId, shown.issued.templateVersion)}</dd>
                  <dt className="text-muted">Cross-check rates</dt>
                  <dd className="m-0">
                    {shown.issued.rates
                      ? `Version of ${formatPeriod(shown.issued.rates.effective_from)}, revision ${shown.issued.rates.revision}`
                      : 'Not cross-checked'}
                  </dd>
                  <dt className="text-muted">Accepted differences</dt>
                  <dd className="m-0">
                    {shown.issued.acceptedDifferences.length === 0
                      ? 'None'
                      : shown.issued.acceptedDifferences.map((difference) => (
                          <span key={difference.what} className="block">
                            {difference.what}: payslip <span className="num">{amount(difference.payslip)}</span>, payroll{' '}
                            <span className="num">{amount(difference.payroll)}</span>. Reason: {difference.reason}
                          </span>
                        ))}
                  </dd>
                  {shown.read.ok &&
                    shown.read.figures.lines
                      .filter((line) => line.status === 'treated-as-zero')
                      .map((line) => (
                        <div key={line.id} className="contents">
                          <dt className="text-muted">Treated as zero</dt>
                          <dd className="m-0">
                            {line.label}. Reason: {line.reason ?? 'none given'}
                          </dd>
                        </div>
                      ))}
                </dl>
              </section>
            )}
          </div>

          <section className="card min-w-0" aria-label="Issued payslip">
            <div className="card-header">
              <h3 className="card-title">{shown?.read.ok ? shown.read.document.employeeName : 'Payslip'}</h3>
              <span className="text-sm text-muted">Exactly as issued</span>
            </div>
            <div className="p-4">
              {shown?.read.ok && page ? (
                <div className="paper-well">
                  <PayslipPreview page={page} label={`Issued payslip of ${shown.read.document.employeeName} for ${formatPeriod(period)}`} />
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 px-6 py-16 text-center" data-testid="issued-unreadable">
                  <span className="icon-tile tone-danger" aria-hidden="true">
                    <CircleAlert />
                  </span>
                  <p className="m-0 font-semibold">This payslip cannot be shown</p>
                  <p className="m-0 max-w-md text-sm text-muted">{shown && !shown.read.ok ? shown.read.problem : ''}</p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
