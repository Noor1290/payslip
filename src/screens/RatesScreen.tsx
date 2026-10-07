import { Info, Lock, Percent, Plus, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Dialog } from '../components/Dialog'
import { FailurePanel, SavedPanel } from '../components/FailurePanel'
import { DEFAULT_STATUTORY_RATES } from '../data/defaultStatutoryRates'
import { formatPeriod, formatShortDate, isIsoDate, todayIso } from '../lib/dates'
import type { HubPort } from '../lib/hubWire'
import { formatCents } from '../lib/money'
import { checkRatesSave, pendingRatesSave, saveRates, type PendingRatesSave, type RatesOutcome, type RatesState } from '../lib/ratesStore'
import {
  crossCheckCsg,
  crossCheckNsf,
  isMonth,
  maxNsf,
  parseDecimalText,
  ratesFor,
  ratesFormOf,
  readRatesForm,
  SOURCE_NOTE_MAX,
  type RatesFormErrors,
  type RatesFormText,
  type RatesInput,
  type RatesVersion,
} from '../lib/statutoryRates'

interface Props {
  state: RatesState
  /** The way to the dashboard. Never used when the app is opened on its own. */
  port: HubPort
  /** The pay month on the Payslips page, when one is chosen. */
  period: string
  /** The BRN of the payroll data that is open: every save carries it. Null without payroll data. */
  brn: string | null
  /** True once the dashboard has said this user is not an admin of the company. */
  readOnly: boolean
  onReload: () => void
  /** A fresh list from the dashboard, after a save or a check. */
  onVersions: (versions: RatesVersion[]) => void
  onForbidden: () => void
}

const money = (value: number) => {
  const text = formatCents(Math.round(value * 100))
  return text === '-' ? '0' : text
}
const percent = (value: number) => `${value} %`

const FIELDS: { key: keyof RatesInput; label: string; show: (v: RatesInput) => string }[] = [
  { key: 'effectiveFrom', label: 'Effective from', show: (v) => (isMonth(v.effectiveFrom) ? formatPeriod(v.effectiveFrom) : '') },
  { key: 'nsfEmployeeRate', label: 'Employee NSF rate', show: (v) => percent(v.nsfEmployeeRate) },
  { key: 'nsfCeiling', label: 'NSF salary ceiling', show: (v) => `Rs ${money(v.nsfCeiling)}` },
  { key: 'nsfCeiling', label: 'Highest NSF this allows', show: (v) => `Rs ${money(maxNsf(v))}` },
  { key: 'nsfExemptAt60', label: 'NSF exemption at 60+', show: (v) => (v.nsfExemptAt60 ? 'On' : 'Off') },
  { key: 'csgEmployeeRateLow', label: 'Employee CSG, lower rate', show: (v) => percent(v.csgEmployeeRateLow) },
  { key: 'csgEmployeeRateHigh', label: 'Employee CSG, higher rate', show: (v) => percent(v.csgEmployeeRateHigh) },
  { key: 'csgThreshold', label: 'CSG salary threshold', show: (v) => `Rs ${money(v.csgThreshold)}` },
  { key: 'sourceNote', label: 'Source note', show: (v) => v.sourceNote?.trim() || 'None' },
]

function addedBy(version: RatesVersion, standalone: boolean): string {
  if (standalone) return 'Built-in default'
  const day = version.createdAt?.slice(0, 10) ?? ''
  const who = version.createdByYou ? 'You' : 'Another admin'
  return isIsoDate(day) ? `${who}, ${formatShortDate(day)}` : who
}

export function RatesScreen({ state, port, period, brn, readOnly, onReload, onVersions, onForbidden }: Props) {
  const standalone = state.status === 'standalone'
  const versions: readonly RatesVersion[] = standalone ? DEFAULT_STATUTORY_RATES : state.status === 'loaded' ? state.versions : []
  const month = isMonth(period) ? period : todayIso().slice(0, 7)
  const current = ratesFor(versions, month)

  const [salary, setSalary] = useState('31635')
  const [gross, setGross] = useState('34335')
  const [aged60, setAged60] = useState(false)

  const [form, setForm] = useState<RatesFormText | null>(null)
  const [errors, setErrors] = useState<RatesFormErrors>({})
  /** The checked values waiting for the user's confirmation. */
  const [confirming, setConfirming] = useState<PendingRatesSave | null>(null)
  /** A save that was sent: kept until its outcome is known, so it is never sent twice blindly. */
  const [pending, setPending] = useState<PendingRatesSave | null>(null)
  const [busy, setBusy] = useState<'saving' | 'checking' | null>(null)
  const [outcome, setOutcome] = useState<RatesOutcome | null>(null)

  // Why a save is not possible right now, in words. Null when it is.
  const cannotSave = standalone
    ? 'Opened on its own, the app cannot save rates. Open it from the Payroll Hub dashboard to save them for a company.'
    : state.status !== 'loaded'
      ? 'The rates have not been loaded from the dashboard.'
      : brn === null
        ? 'Import or get payroll data first. A save must carry the BRN of the company in the payroll data, so the rates cannot go to the wrong company.'
        : readOnly
          ? 'Only an admin of this company can add rates. You are signed in to the dashboard as a member.'
          : outcome?.end === 'unconfirmed'
            ? 'The last save has not been confirmed yet. Check again first.'
            : null

  const startForm = () => {
    setOutcome(null)
    setErrors({})
    // A company's first version starts from the bundled defaults; after that, from what is in force.
    const base = current ?? versions[0] ?? DEFAULT_STATUTORY_RATES[0]
    setForm(ratesFormOf(base, month))
  }

  const review = () => {
    if (!form || brn === null) return
    const read = readRatesForm(form)
    if (!read.ok) return setErrors(read.errors)
    setErrors({})
    setConfirming(pendingRatesSave(brn, read.input, versions))
  }

  const finish = (result: RatesOutcome, sent: PendingRatesSave) => {
    setBusy(null)
    setOutcome(result)
    if (result.versions) onVersions(result.versions)
    if (result.failure?.kind === 'forbidden') onForbidden()
    if (result.end === 'saved' || result.end === 'no-change') {
      setPending(null)
      setForm(null)
    } else {
      setPending(sent)
    }
  }

  const send = async (sent: PendingRatesSave) => {
    setConfirming(null)
    setOutcome(null)
    setPending(sent)
    setBusy('saving')
    finish(await saveRates(port, sent), sent)
  }

  const checkAgain = async () => {
    if (!pending || !outcome?.failure) return
    setBusy('checking')
    finish(await checkRatesSave(port, pending, outcome.failure), pending)
  }

  const salaryValue = Number(salary)
  const grossValue = Number(gross)
  const sorted = [...versions].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.revision - a.revision)
  const before = confirming ? ratesFor(versions, confirming.input.effectiveFrom) : null

  const numberField = (
    key: 'nsfEmployeeRate' | 'nsfCeiling' | 'csgEmployeeRateLow' | 'csgEmployeeRateHigh' | 'csgThreshold',
    label: string,
    hint?: string,
  ) => (
    <div className="field">
      <label className="field-label" htmlFor={`rate-${key}`}>
        {label}
      </label>
      <input
        id={`rate-${key}`}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className="input num"
        value={form![key]}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={errors[key] ? `rate-${key}-error` : hint ? `rate-${key}-hint` : undefined}
        onChange={(event) => setForm({ ...form!, [key]: event.target.value })}
      />
      {hint && !errors[key] && (
        <span className="field-hint" id={`rate-${key}-hint`}>
          {hint}
        </span>
      )}
      {errors[key] && (
        <span className="field-error" id={`rate-${key}-error`}>
          {errors[key]}
        </span>
      )}
    </div>
  )

  const formCeiling = form ? parseDecimalText(form.nsfCeiling) : null
  const formRate = form ? parseDecimalText(form.nsfEmployeeRate) : null

  return (
    <div className="rise-in mx-auto flex max-w-5xl flex-col gap-4">
      <div>
        <h2 className="m-0 text-2xl font-semibold tracking-tight">Statutory rates</h2>
        <p className="m-0 text-muted">
          Used only to cross-check the employee CSG and NSF copied from the payroll. A difference is a warning; the
          payroll figure is never replaced.
        </p>
      </div>

      {standalone && (
        <div className="panel tone-warn" role="note" data-testid="unsaved-defaults">
          <Info aria-hidden="true" />
          <div>
            <p className="m-0 font-medium">Unsaved defaults</p>
            <p className="m-0 text-sm text-muted">
              These are the app's built-in defaults. They are not checked against legislation and are not saved
              anywhere. Opened from the Payroll Hub dashboard, the app uses the rates saved there for the company, and
              an admin can add versions.
            </p>
          </div>
        </div>
      )}

      {state.status === 'loaded' && (
        <p className="m-0 text-sm text-muted" data-testid="rates-company">
          Saved in the dashboard for <span className="font-medium text-fg">{state.company.name || 'the selected company'}</span>, BRN{' '}
          <span className="num">{state.company.brn}</span>.
        </p>
      )}

      {(state.status === 'waiting' || state.status === 'loading') && (
        <div className="card p-5" aria-busy="true" aria-label="Loading the rates from the dashboard">
          <div className="skeleton mb-3 h-6 w-1/3" />
          <div className="skeleton mb-2 h-10 w-full" />
          <div className="skeleton h-10 w-2/3" />
          <p className="m-0 mt-3 text-sm text-muted">
            {state.status === 'waiting' ? 'Waiting for the dashboard.' : 'Loading the rates from the dashboard.'}
          </p>
        </div>
      )}

      {state.status === 'failed' && (
        <FailurePanel failure={state.failure} testId="rates-load-failure">
          <button type="button" className="btn btn-sm" onClick={onReload}>
            <RefreshCw aria-hidden="true" />
            Check again
          </button>
        </FailurePanel>
      )}

      {outcome?.end === 'saved' && (
        <SavedPanel testId="rates-saved">
          Saved in the dashboard: {outcome.latest ? `${formatPeriod(outcome.latest.effectiveFrom)}, revision ${outcome.latest.revision}` : 'the new version'}.
          {outcome.versions === null && ' The list could not be refreshed; press Reload to see it.'}
        </SavedPanel>
      )}

      {outcome?.failure && outcome.end !== 'saved' && (
        <FailurePanel failure={outcome.failure} testId="rates-outcome">
          {outcome.end === 'unconfirmed' && (
            <button type="button" className="btn btn-sm" onClick={() => void checkAgain()} disabled={busy !== null}>
              <RefreshCw aria-hidden="true" />
              {busy === 'checking' ? 'Checking' : 'Check again'}
            </button>
          )}
          {outcome.end === 'not-saved' && pending && (
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void send(pending)} disabled={busy !== null}>
              Save again
            </button>
          )}
        </FailurePanel>
      )}

      {outcome?.end === 'stale' && pending && (
        <section className="card" aria-label="What changed in the dashboard" data-testid="rates-stale">
          <div className="card-header">
            <h3 className="card-title">What changed for {formatPeriod(pending.input.effectiveFrom)}</h3>
            <span className="text-sm text-muted">Your values are still in the form below. Review them against the newer version to save.</span>
          </div>
          {outcome.latest ? (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Setting</th>
                    <th scope="col" className="right">
                      Now in the dashboard (revision {outcome.latest.revision}, {addedBy(outcome.latest, false)})
                    </th>
                    <th scope="col" className="right">Your change (not saved)</th>
                    <th scope="col">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {FIELDS.filter((field) => field.key !== 'effectiveFrom').map((field) => {
                    const theirs = field.show(outcome.latest!)
                    const mine = field.show(pending.input)
                    return (
                      <tr key={field.label}>
                        <th scope="row" className="!static !bg-transparent !text-fg !text-[13.5px]">
                          {field.label}
                        </th>
                        <td className="right num">{theirs}</td>
                        <td className="right num">{mine}</td>
                        <td>{theirs === mine ? <span className="text-subtle">Same</span> : <span className="badge tone-warn">Different</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="m-0 p-5 text-sm text-muted">The newer version could not be loaded. Press Reload to see it.</p>
          )}
        </section>
      )}

      {!standalone && state.status === 'loaded' && versions.length === 0 && (
        <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center" data-testid="rates-empty">
          <span className="icon-tile tone-warn" aria-hidden="true">
            <Percent />
          </span>
          <p className="m-0 font-semibold">No rates are saved for this company</p>
          <p className="m-0 max-w-md text-sm text-muted">
            Until an admin adds a version, CSG and NSF are not cross-checked. The app does not guess: its built-in
            defaults only prefill the form for the first version.
          </p>
        </div>
      )}

      {(standalone || (state.status === 'loaded' && versions.length > 0)) && (
        <section className="card" aria-label="Rates in force">
          <div className="card-header">
            <h3 className="card-title">In force for {formatPeriod(month)}</h3>
            {current && (
              <span className="text-sm text-muted">
                Version of {formatPeriod(current.effectiveFrom)}, revision <span className="num">{current.revision}</span>
              </span>
            )}
          </div>
          {current ? (
            <dl className="m-0 grid gap-x-6 gap-y-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-xs uppercase tracking-wider text-subtle">Employee NSF</dt>
                <dd className="m-0 text-lg font-semibold num">{percent(current.nsfEmployeeRate)}</dd>
                <dd className="m-0 text-sm text-muted">
                  of the salary up to Rs <span className="num">{money(current.nsfCeiling)}</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-subtle">Highest NSF this allows</dt>
                <dd className="m-0 text-lg font-semibold num" data-testid="max-nsf">
                  Rs {money(maxNsf(current))}
                </dd>
                <dd className="m-0 text-sm text-muted">
                  {percent(current.nsfEmployeeRate)} of the Rs <span className="num">{money(current.nsfCeiling)}</span> ceiling
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-subtle">NSF exemption at 60+</dt>
                <dd className="m-0 text-lg font-semibold">{current.nsfExemptAt60 ? 'On' : 'Off'}</dd>
                <dd className="m-0 text-sm text-muted">
                  {current.nsfExemptAt60 ? 'NSF is 0 when Age 60+ is ticked' : 'Age makes no difference'}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-subtle">Employee CSG, lower rate</dt>
                <dd className="m-0 text-lg font-semibold num">{percent(current.csgEmployeeRateLow)}</dd>
                <dd className="m-0 text-sm text-muted">
                  salary at or below Rs <span className="num">{money(current.csgThreshold)}</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-subtle">Employee CSG, higher rate</dt>
                <dd className="m-0 text-lg font-semibold num">{percent(current.csgEmployeeRateHigh)}</dd>
                <dd className="m-0 text-sm text-muted">
                  salary strictly above Rs <span className="num">{money(current.csgThreshold)}</span>, on the whole salary
                </dd>
              </div>
              {current.sourceNote && (
                <div>
                  <dt className="text-xs uppercase tracking-wider text-subtle">Source note</dt>
                  <dd className="m-0 text-sm">{current.sourceNote}</dd>
                </div>
              )}
            </dl>
          ) : (
            <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
              <span className="icon-tile tone-warn" aria-hidden="true">
                <Percent />
              </span>
              <p className="m-0 font-semibold">No rates are in force for {formatPeriod(month)}</p>
              <p className="m-0 max-w-sm text-sm text-muted">
                Every version starts later than this month, so its payslips are not cross-checked.
                {standalone ? '' : ' Add a version that starts in or before it.'}
              </p>
            </div>
          )}
        </section>
      )}

      {current && (
        <section className="card" aria-label="Worked example">
          <div className="card-header">
            <h3 className="card-title">Worked example</h3>
            <span className="text-sm text-muted">Change the figures to see what the rates in force give</span>
          </div>
          <div className="grid gap-4 p-5 md:grid-cols-[1fr_1fr]">
            <div className="flex flex-col gap-3">
              <div className="field">
                <label className="field-label" htmlFor="example-salary">
                  New Basic Salary (CSG base), Rs
                </label>
                <input id="example-salary" type="number" step="any" className="input num" value={salary} onChange={(event) => setSalary(event.target.value)} />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="example-gross">
                  Gross Pay (NSF base), Rs
                </label>
                <input id="example-gross" type="number" step="any" className="input num" value={gross} onChange={(event) => setGross(event.target.value)} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={aged60} onChange={(event) => setAged60(event.target.checked)} />
                Age 60+
              </label>
            </div>
            <dl className="m-0 flex flex-col gap-4" aria-live="polite">
              <div>
                <dt className="text-xs uppercase tracking-wider text-subtle">Employee CSG</dt>
                <dd className="m-0 text-2xl font-semibold num" data-testid="example-csg">
                  Rs {Number.isFinite(salaryValue) ? money(crossCheckCsg(salaryValue, current)) : ''}
                </dd>
                <dd className="m-0 text-sm text-muted">
                  {salaryValue > current.csgThreshold
                    ? `${percent(current.csgEmployeeRateHigh)} of the whole salary, because it is above Rs ${money(current.csgThreshold)}`
                    : `${percent(current.csgEmployeeRateLow)} of the salary, because it is at or below Rs ${money(current.csgThreshold)}`}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-subtle">Employee NSF</dt>
                <dd className="m-0 text-2xl font-semibold num" data-testid="example-nsf">
                  Rs {Number.isFinite(grossValue) ? money(crossCheckNsf(grossValue, aged60, current)) : ''}
                </dd>
                <dd className="m-0 text-sm text-muted">
                  {aged60 && current.nsfExemptAt60
                    ? 'NSF is 0 at 60+'
                    : grossValue > current.nsfCeiling
                      ? `${percent(current.nsfEmployeeRate)} of the Rs ${money(current.nsfCeiling)} ceiling`
                      : `${percent(current.nsfEmployeeRate)} of the gross pay, which is under the ceiling`}
                </dd>
              </div>
            </dl>
          </div>
        </section>
      )}

      {(standalone || state.status === 'loaded') && (
        <section className="card" aria-label="Version history">
          <div className="card-header">
            <h3 className="card-title">Version history</h3>
            <div className="flex flex-wrap gap-2">
              {!standalone && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={onReload} disabled={busy !== null}>
                  <RefreshCw aria-hidden="true" />
                  Reload
                </button>
              )}
              {!standalone && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={startForm}
                  disabled={cannotSave !== null || form !== null || busy !== null}
                  aria-describedby={cannotSave ? 'rates-cannot-save' : undefined}
                >
                  <Plus aria-hidden="true" />
                  Add rates from month...
                </button>
              )}
            </div>
          </div>
          {cannotSave && (
            <p className="m-0 flex items-start gap-2 border-b border-line px-5 py-3 text-sm text-muted" id="rates-cannot-save" data-testid="rates-cannot-save">
              <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {cannotSave}
            </p>
          )}
          {sorted.length > 0 && (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Effective from</th>
                    <th scope="col" className="right">Revision</th>
                    <th scope="col" className="right">NSF rate</th>
                    <th scope="col" className="right">NSF ceiling</th>
                    <th scope="col" className="right">Highest NSF</th>
                    <th scope="col">60+ exempt</th>
                    <th scope="col" className="right">CSG low</th>
                    <th scope="col" className="right">CSG high</th>
                    <th scope="col" className="right">CSG threshold</th>
                    <th scope="col">Source note</th>
                    <th scope="col">Added by</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((version) => (
                    <tr key={`${version.effectiveFrom}-${version.revision}`}>
                      <td>
                        {formatPeriod(version.effectiveFrom)}{' '}
                        {version === current && <span className="badge tone-accent ml-1">In force</span>}
                      </td>
                      <td className="right num">{version.revision}</td>
                      <td className="right num">{percent(version.nsfEmployeeRate)}</td>
                      <td className="right num">{money(version.nsfCeiling)}</td>
                      <td className="right num">{money(maxNsf(version))}</td>
                      <td>{version.nsfExemptAt60 ? 'Yes' : 'No'}</td>
                      <td className="right num">{percent(version.csgEmployeeRateLow)}</td>
                      <td className="right num">{percent(version.csgEmployeeRateHigh)}</td>
                      <td className="right num">{money(version.csgThreshold)}</td>
                      <td className="text-muted">{version.sourceNote ?? ''}</td>
                      <td className="text-muted">{addedBy(version, standalone)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="m-0 px-5 py-3 text-xs text-subtle">
            A version is never edited. To correct one, add rates for the same month: they become the next revision, and
            the highest revision is the one in force.
          </p>
        </section>
      )}

      {form && (
        <section className="card" aria-label="New version">
          <div className="card-header">
            <h3 className="card-title">New version</h3>
            <span className="text-sm text-muted">Rates are percentages; amounts are rupees a month</span>
          </div>
          <form
            className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3"
            noValidate
            onSubmit={(event) => {
              event.preventDefault()
              review()
            }}
          >
            <div className="field">
              <label className="field-label" htmlFor="rate-effectiveFrom">
                Effective from
              </label>
              <input
                id="rate-effectiveFrom"
                type="month"
                className="input num"
                value={form.effectiveFrom}
                aria-invalid={errors.effectiveFrom ? true : undefined}
                aria-describedby={errors.effectiveFrom ? 'rate-effectiveFrom-error' : undefined}
                onChange={(event) => setForm({ ...form, effectiveFrom: event.target.value })}
              />
              {errors.effectiveFrom && (
                <span className="field-error" id="rate-effectiveFrom-error">
                  {errors.effectiveFrom}
                </span>
              )}
            </div>
            {numberField('nsfEmployeeRate', 'Employee NSF rate, %')}
            {numberField(
              'nsfCeiling',
              'NSF salary ceiling, Rs',
              formCeiling !== null && formRate !== null
                ? `Highest NSF: Rs ${money(maxNsf({ ...DEFAULT_STATUTORY_RATES[0], nsfCeiling: formCeiling, nsfEmployeeRate: formRate }))}`
                : undefined,
            )}
            {numberField('csgEmployeeRateLow', 'Employee CSG lower rate, %', 'At or below the threshold')}
            {numberField('csgEmployeeRateHigh', 'Employee CSG higher rate, %', 'Strictly above the threshold')}
            {numberField('csgThreshold', 'CSG salary threshold, Rs')}
            <div className="field sm:col-span-2">
              <label className="field-label" htmlFor="rate-sourceNote">
                Source note <span className="text-subtle">(optional)</span>
              </label>
              <input
                id="rate-sourceNote"
                type="text"
                className="input"
                maxLength={SOURCE_NOTE_MAX + 50}
                value={form.sourceNote}
                placeholder="Where these values come from"
                aria-invalid={errors.sourceNote ? true : undefined}
                aria-describedby={errors.sourceNote ? 'rate-sourceNote-error' : undefined}
                onChange={(event) => setForm({ ...form, sourceNote: event.target.value })}
              />
              {errors.sourceNote && (
                <span className="field-error" id="rate-sourceNote-error">
                  {errors.sourceNote}
                </span>
              )}
            </div>
            <label className="flex items-center gap-2 self-end pb-3 text-sm">
              <input type="checkbox" checked={form.nsfExemptAt60} onChange={(event) => setForm({ ...form, nsfExemptAt60: event.target.checked })} />
              NSF exemption at 60+
            </label>
            <div className="flex justify-end gap-2 sm:col-span-2 lg:col-span-3">
              <button
                type="button"
                className="btn"
                disabled={busy !== null}
                onClick={() => {
                  setForm(null)
                  setPending(null)
                  setOutcome(null)
                }}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={cannotSave !== null || busy !== null}>
                {busy === 'saving' ? 'Saving' : 'Review the change'}
              </button>
            </div>
          </form>
        </section>
      )}

      {confirming && (
        <Dialog
          title="Save these rates?"
          description={`From ${formatPeriod(confirming.input.effectiveFrom)}, as revision ${confirming.expectedRevision + 1}, for BRN ${confirming.brn}. Earlier months keep their own rates.`}
          icon={<Percent />}
          tone="warn"
          width={640}
          onClose={() => setConfirming(null)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setConfirming(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={() => void send(confirming)}>
                Save to the dashboard
              </button>
            </>
          }
        >
          <div className="table-scroll rounded-lg border border-line">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Setting</th>
                  <th scope="col" className="right">Before</th>
                  <th scope="col" className="right">After</th>
                  <th scope="col">Change</th>
                </tr>
              </thead>
              <tbody>
                {FIELDS.map((field) => {
                  const beforeText = before ? field.show(before) : 'None'
                  const afterText = field.show(confirming.input)
                  return (
                    <tr key={field.label}>
                      <th scope="row" className="!static !bg-transparent !text-fg !text-[13.5px]">
                        {field.label}
                      </th>
                      <td className="right num">{beforeText}</td>
                      <td className="right num">{afterText}</td>
                      <td>{beforeText === afterText ? <span className="text-subtle">Same</span> : <span className="badge tone-warn">Changed</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="m-0 mt-3 text-sm text-muted">
            {before
              ? `"Before" is what is in force for ${formatPeriod(confirming.input.effectiveFrom)} now.`
              : `Nothing is in force for ${formatPeriod(confirming.input.effectiveFrom)} yet.`}{' '}
            The rates only feed the cross-check: no payroll figure changes.
          </p>
        </Dialog>
      )}
    </div>
  )
}
