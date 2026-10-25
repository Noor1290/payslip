import { Building2, Download, RefreshCw, Search } from 'lucide-react'
import { useEffect, useId, useMemo, useState } from 'react'
import { FailurePanel } from '../components/FailurePanel'
import { formatPeriod, todayIso } from '../lib/dates'
import { buildCompaniesZip, download } from '../lib/exports'
import type { Failure, HubPort } from '../lib/hubWire'
import {
  buildCompany,
  companyPaths,
  folderNames,
  fromIssuedText,
  notLoaded,
  reportFileName,
  reportText,
  roundingText,
  summaryLine,
  zipFileName,
  type CompanyOutcome,
} from '../lib/manyPayslips'
import { askForCompanies, listCompanies, loadCompany, type BatchCompany } from '../lib/manyStore'
import { isMonth } from '../lib/statutoryRates'

interface Props {
  port: HubPort
  /** Told while a run is going on, so the dashboard asks before it reloads this app. */
  onRunning: (running: boolean) => void
}

/** From this many companies on, the list can be searched. */
const SEARCH_FROM = 10

type List = { status: 'loading' } | { status: 'failed'; failure: Failure } | { status: 'loaded'; companies: BatchCompany[]; selectedBrn: string }

type Run =
  | { step: 'idle' }
  | { step: 'asking' }
  | { step: 'refused'; failure: Failure }
  | { step: 'companies'; done: number; total: number; company: string }
  | { step: 'files'; done: number; total: number }
  | { step: 'done'; outcomes: Summary[]; summary: string; downloaded: boolean; period: string }
  | { step: 'failed'; message: string }

/** What is kept on screen after the run: no payslip, only who and why. */
type Summary = Pick<CompanyOutcome, 'brn' | 'company' | 'kind'> & { text: string; leftOut: { name: string; reasons: string[] }[]; notes: string[] }

const companies = (count: number) => `${count} ${count === 1 ? 'company' : 'companies'}`
const payslips = (count: number) => `${count} ${count === 1 ? 'payslip' : 'payslips'}`

function summarise(outcome: CompanyOutcome): Summary {
  const base = { brn: outcome.brn, company: outcome.company, kind: outcome.kind, leftOut: outcome.leftOut }
  if (outcome.kind === 'skipped') return { ...base, text: outcome.reason, notes: [] }
  const made = `${payslips(outcome.documents.length)}, with ${outcome.template}.`
  const notes = [...outcome.rounding.map(roundingText), ...outcome.fromIssued.map(fromIssuedText)]
  return { ...base, text: outcome.kind === 'done' ? made : `${made} ${outcome.leftOut.length} left out.`, notes }
}

/**
 * Payslips for several companies at once, for one month, downloaded as one zip. Nothing is
 * issued: issuing stays on each company's own Payslips page, with its month review.
 */
export function ManyScreen({ port, onRunning }: Props) {
  const [list, setList] = useState<List>({ status: 'loading' })
  const [reloads, setReloads] = useState(0)
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  const [query, setQuery] = useState('')
  const [period, setPeriod] = useState(() => todayIso().slice(0, 7))
  const [issueDate, setIssueDate] = useState(todayIso)
  // Owner's decision: on by default; a larger difference always leaves the payslip out.
  const [acceptRounding, setAcceptRounding] = useState(true)
  const [run, setRun] = useState<Run>({ step: 'idle' })
  const periodId = useId()
  const dateId = useId()

  useEffect(() => {
    let current = true
    setList({ status: 'loading' })
    void listCompanies(port).then((answer) => {
      if (!current) return
      setList(answer.ok ? { status: 'loaded', companies: answer.companies, selectedBrn: answer.selectedBrn } : { status: 'failed', failure: answer.failure })
    })
    return () => {
      current = false
    }
  }, [port, reloads])

  const running = run.step === 'asking' || run.step === 'companies' || run.step === 'files'
  useEffect(() => {
    onRunning(running)
  }, [running, onRunning])

  const all = list.status === 'loaded' ? list.companies : []
  const wanted = all.length >= SEARCH_FROM ? query.trim().toLowerCase() : ''
  const shown = useMemo(
    () => (wanted ? all.filter((company) => company.name.toLowerCase().includes(wanted) || company.brn.toLowerCase().includes(wanted)) : all),
    [all, wanted],
  )
  const chosen = all.filter((company) => ticked.has(company.brn))
  const cannot =
    list.status !== 'loaded'
      ? 'Wait for your companies to load.'
      : chosen.length === 0
        ? 'Tick at least one company.'
        : !isMonth(period)
          ? 'Choose the pay month.'
          : null

  const tick = (brn: string, on: boolean) =>
    setTicked((previous) => {
      const next = new Set(previous)
      if (on) next.add(brn)
      else next.delete(brn)
      return next
    })

  const start = async () => {
    if (list.status !== 'loaded' || cannot !== null || running) return
    const { selectedBrn } = list
    const order = chosen
    setRun({ step: 'asking' })
    const allowed = await askForCompanies(
      port,
      selectedBrn,
      period,
      order.map((company) => company.brn),
      order.length === all.length,
    )
    if (!allowed.ok) return setRun({ step: 'refused', failure: allowed.failure })
    const allowedBrns = new Set(allowed.companies.map((company) => company.brn.trim().toUpperCase()))

    // One company at a time: its run, its template, its rates; then its payslips and their checks.
    const outcomes: CompanyOutcome[] = []
    for (const [index, company] of order.entries()) {
      setRun({ step: 'companies', done: index, total: order.length, company: company.name })
      if (!allowedBrns.has(company.brn.trim().toUpperCase())) {
        outcomes.push(notLoaded(company, 'The dashboard did not allow it: you may no longer be an admin of this company.'))
        continue
      }
      const loaded = await loadCompany(port, selectedBrn, period, company.brn)
      outcomes.push(
        loaded.ok ? buildCompany(loaded.bundle, { issueDate, acceptRounding }) : notLoaded(company, `The dashboard did not send it: ${loaded.failure.title}.`),
      )
    }

    const report = reportText(outcomes, period, todayIso())
    const made = outcomes.flatMap((outcome) => (outcome.kind === 'skipped' ? [] : [outcome]))
    const folders = folderNames(made)
    const summaries = outcomes.map(summarise)
    if (made.length === 0) {
      return setRun({ step: 'done', outcomes: summaries, summary: summaryLine(outcomes), downloaded: false, period })
    }
    setRun({ step: 'files', done: 0, total: made.length })
    try {
      const zip = await buildCompaniesZip(
        made.map((outcome, index) => ({ ...companyPaths(folders[index], outcome.company, period, outcome.documents), documents: outcome.documents })),
        { path: reportFileName(period), text: report },
        (done) => setRun({ step: 'files', done, total: made.length }),
      )
      download(zip, zipFileName(period), 'application/zip')
      setRun({ step: 'done', outcomes: summaries, summary: summaryLine(outcomes), downloaded: true, period })
    } catch {
      setRun({ step: 'failed', message: 'The files could not be created. Nothing was downloaded. Try again.' })
    }
  }

  return (
    <div className="rise-in mx-auto flex max-w-5xl flex-col gap-4">
      <div>
        <h2 className="m-0 text-2xl font-semibold tracking-tight">Several companies</h2>
        <p className="m-0 text-muted">
          Payslips for several companies at once, for one month. Download only: nothing is issued. Issuing stays on each company's own Payslips page,
          with its month review.
        </p>
      </div>

      <section className="card" aria-label="Month and date">
        <div className="flex flex-wrap items-end gap-4 p-4">
          <div className="field">
            <label className="field-label" htmlFor={periodId}>
              Pay month
            </label>
            <input id={periodId} type="month" className="input num" value={period} disabled={running} onChange={(event) => setPeriod(event.target.value)} />
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
              disabled={running}
              onChange={(event) => event.target.value && setIssueDate(event.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 pb-2.5 text-sm">
            <input type="checkbox" checked={acceptRounding} disabled={running} onChange={(event) => setAcceptRounding(event.target.checked)} />
            Include payslips whose only difference is a 0.01 rounding
          </label>
          <p className="m-0 min-w-64 flex-1 text-sm text-muted">
            Each company uses its own template (the one used for its payslips), its own statutory rates and its own saved payroll for that month, and the
            same checks as on the Payslips page. The dashboard asks you once before it sends the payroll.
          </p>
        </div>
      </section>

      <section className="card" aria-label="Companies">
        <div className="card-header">
          <h3 className="card-title">Companies</h3>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-sm" disabled={running || all.length === 0} onClick={() => setTicked(new Set(all.map((company) => company.brn)))}>
              Select all
            </button>
            <button type="button" className="btn btn-sm" disabled={running || ticked.size === 0} onClick={() => setTicked(new Set())}>
              Clear
            </button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={running || list.status === 'loading'} onClick={() => setReloads((count) => count + 1)}>
              <RefreshCw aria-hidden="true" />
              Reload
            </button>
          </div>
        </div>
        {list.status === 'loading' && (
          <div className="p-5" aria-busy="true" aria-label="Loading your companies from the dashboard">
            <div className="skeleton mb-2 h-10 w-full" />
            <p className="m-0 mt-3 text-sm text-muted">Loading your companies from the dashboard.</p>
          </div>
        )}
        {list.status === 'failed' && (
          <div className="p-4">
            <FailurePanel failure={list.failure} testId="many-companies-failure" />
          </div>
        )}
        {list.status === 'loaded' && all.length === 0 && (
          <p className="m-0 p-5 text-sm text-muted" data-testid="many-none">
            You are not an admin of any company in the dashboard.
          </p>
        )}
        {list.status === 'loaded' && all.length > 0 && (
          <div className="flex flex-col gap-3 p-4">
            <p className="m-0 text-sm text-muted">
              Only companies where you are an admin are listed. {companies(chosen.length)} of {all.length} ticked.
            </p>
            {all.length >= SEARCH_FROM && (
              <div className="flex flex-wrap items-center gap-3">
                <label className="relative flex-1" style={{ minWidth: 220 }}>
                  <span className="sr-only">Search companies</span>
                  <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
                  <input
                    type="search"
                    className="input input-sm w-full"
                    style={{ paddingLeft: 36 }}
                    placeholder="Name or BRN"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                {wanted && (
                  <span className="text-sm text-muted" role="status">
                    Showing {shown.length} of {companies(all.length)}.
                  </span>
                )}
              </div>
            )}
            <ul className="m-0 grid list-none gap-1 p-0 sm:grid-cols-2" aria-label="Your companies">
              {shown.map((company) => (
                <li key={company.brn}>
                  <label className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm">
                    <input type="checkbox" checked={ticked.has(company.brn)} disabled={running} onChange={(event) => tick(company.brn, event.target.checked)} />
                    <span className="min-w-0">
                      {company.name}
                      {company.selected && <span className="badge ml-2">This company</span>}
                      <span className="block text-xs text-subtle">
                        BRN <span className="num">{company.brn}</span>
                      </span>
                    </span>
                  </label>
                </li>
              ))}
              {shown.length === 0 && <li className="text-sm text-muted">No company matches "{query.trim()}".</li>}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-4 py-3">
          {cannot && !running && (
            <span className="text-sm text-muted" data-testid="many-cannot">
              {cannot}
            </span>
          )}
          <button type="button" className="btn btn-primary" disabled={cannot !== null || running} onClick={() => void start()}>
            <Download aria-hidden="true" />
            Download payslips (zip)
          </button>
        </div>
      </section>

      {running && (
        <div className="panel tone-sky" role="status" aria-live="polite" data-testid="many-run-progress">
          <Building2 aria-hidden="true" />
          <p className="m-0 text-sm font-medium">
            {run.step === 'asking'
              ? 'Waiting for your answer in the dashboard.'
              : run.step === 'companies'
                ? `Company ${run.done + 1} of ${run.total}: ${run.company}...`
                : `Making the files: ${run.done} of ${companies(run.total)} done.`}
          </p>
        </div>
      )}
      {run.step === 'refused' && (
        <FailurePanel failure={{ ...run.failure, detail: `${run.failure.detail} Nothing was downloaded.` }} testId="many-run-refused" />
      )}
      {run.step === 'failed' && (
        <div className="panel tone-danger" role="alert">
          <p className="m-0 text-sm">{run.message}</p>
        </div>
      )}
      {run.step === 'done' && (
        <section className="card" aria-label="What was made" data-testid="many-report">
          <div className="card-header">
            <h3 className="card-title">{run.downloaded ? `Downloaded: ${zipFileName(run.period)}` : 'Nothing to download'}</h3>
          </div>
          <div className="flex flex-col gap-3 p-4">
            <p className="m-0 text-sm">
              {run.summary}{' '}
              {run.downloaded
                ? `The same report is in the zip, as "${reportFileName(run.period)}".`
                : 'No company had a payslip that passed its checks, so nothing was downloaded.'}
            </p>
            <div className="table-scroll">
              <table className="table" aria-label="Each company">
                <thead>
                  <tr>
                    <th scope="col">Company</th>
                    <th scope="col">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {run.outcomes.map((outcome) => (
                    <tr key={outcome.brn} data-outcome={outcome.kind}>
                      <th scope="row" className="!static !bg-transparent !text-fg !text-[13.5px]">
                        {outcome.company}
                        <span className="block text-xs font-normal text-subtle">
                          BRN <span className="num">{outcome.brn}</span>
                        </span>
                      </th>
                      <td>
                        <span className="flex flex-wrap items-center gap-2">
                          <span className={`badge ${outcome.kind === 'done' ? 'tone-accent' : outcome.kind === 'partly' ? 'tone-warn' : ''}`}>
                            {outcome.kind === 'done' ? 'In full' : outcome.kind === 'partly' ? 'Partly' : 'Skipped'}
                          </span>
                          <span className="text-sm">{outcome.text}</span>
                        </span>
                        {outcome.notes.length > 0 && (
                          <ul className="m-0 mt-1 list-disc pl-5 text-sm text-muted" data-testid="many-notes">
                            {outcome.notes.map((note, index) => (
                              <li key={`${note}-${index}`}>{note}</li>
                            ))}
                          </ul>
                        )}
                        {outcome.leftOut.length > 0 && (
                          <ul className="m-0 mt-1 list-disc pl-5 text-sm text-muted">
                            {outcome.leftOut.map((person, index) => (
                              <li key={`${person.name}-${index}`}>
                                {person.name}: {person.reasons.join(' ')}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="m-0 text-xs text-subtle">Month: {formatPeriod(run.period)}. The payslips were not kept in this tab once the zip was made.</p>
          </div>
        </section>
      )}
    </div>
  )
}
