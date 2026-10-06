import { CircleCheck, Info, Percent, Plus } from 'lucide-react'
import { useState } from 'react'
import { Dialog } from '../components/Dialog'
import { formatPeriod, todayIso } from '../lib/dates'
import { formatCents } from '../lib/money'
import {
  crossCheckCsg,
  crossCheckNsf,
  isMonth,
  maxNsf,
  nextRevision,
  ratesFor,
  validateRates,
  type RatesInput,
  type RatesVersion,
} from '../lib/statutoryRates'

interface Props {
  versions: RatesVersion[]
  onVersions: (versions: RatesVersion[]) => void
  /** The pay month on the Payslips page, when one is chosen. */
  period: string
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
  { key: 'nsfExemptAt60', label: 'NSF exemption at 60+', show: (v) => (v.nsfExemptAt60 ? 'On' : 'Off') },
  { key: 'csgEmployeeRateLow', label: 'Employee CSG, lower rate', show: (v) => percent(v.csgEmployeeRateLow) },
  { key: 'csgEmployeeRateHigh', label: 'Employee CSG, higher rate', show: (v) => percent(v.csgEmployeeRateHigh) },
  { key: 'csgThreshold', label: 'CSG salary threshold', show: (v) => `Rs ${money(v.csgThreshold)}` },
]

export function RatesScreen({ versions, onVersions, period }: Props) {
  const month = isMonth(period) ? period : todayIso().slice(0, 7)
  const current = ratesFor(versions, month)

  const [salary, setSalary] = useState('31635')
  const [gross, setGross] = useState('34335')
  const [aged60, setAged60] = useState(false)

  const [draft, setDraft] = useState<RatesInput | null>(null)
  const [errors, setErrors] = useState<Partial<Record<keyof RatesInput, string>>>({})
  const [confirming, setConfirming] = useState(false)
  const [saved, setSaved] = useState(false)

  const startDraft = () => {
    setSaved(false)
    setErrors({})
    const base = current ?? versions[versions.length - 1]
    setDraft({
      effectiveFrom: month,
      nsfEmployeeRate: base.nsfEmployeeRate,
      nsfCeiling: base.nsfCeiling,
      nsfExemptAt60: base.nsfExemptAt60,
      csgEmployeeRateLow: base.csgEmployeeRateLow,
      csgEmployeeRateHigh: base.csgEmployeeRateHigh,
      csgThreshold: base.csgThreshold,
    })
  }

  const review = () => {
    if (!draft) return
    const found = validateRates(draft)
    setErrors(found)
    if (Object.keys(found).length === 0) setConfirming(true)
  }

  const before = draft && isMonth(draft.effectiveFrom) ? ratesFor(versions, draft.effectiveFrom) : null
  const save = () => {
    if (!draft) return
    onVersions([
      ...versions,
      {
        ...draft,
        revision: nextRevision(versions, draft.effectiveFrom),
        createdAt: new Date().toISOString(),
        createdBy: 'This session (not saved)',
      },
    ])
    setConfirming(false)
    setDraft(null)
    setSaved(true)
  }

  const salaryValue = Number(salary)
  const grossValue = Number(gross)
  const sorted = [...versions].sort(
    (a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.revision - a.revision,
  )

  const numberField = (key: 'nsfEmployeeRate' | 'nsfCeiling' | 'csgEmployeeRateLow' | 'csgEmployeeRateHigh' | 'csgThreshold', label: string, hint?: string) => (
    <div className="field">
      <label className="field-label" htmlFor={`rate-${key}`}>
        {label}
      </label>
      <input
        id={`rate-${key}`}
        type="number"
        step="any"
        min={0}
        className="input num"
        value={Number.isNaN(draft![key]) ? '' : draft![key]}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={errors[key] ? `rate-${key}-error` : undefined}
        onChange={(event) => setDraft({ ...draft!, [key]: event.target.value === '' ? Number.NaN : Number(event.target.value) })}
      />
      {hint && !errors[key] && <span className="field-hint">{hint}</span>}
      {errors[key] && (
        <span className="field-error" id={`rate-${key}-error`}>
          {errors[key]}
        </span>
      )}
    </div>
  )

  return (
    <div className="rise-in mx-auto flex max-w-5xl flex-col gap-4">
      <div>
        <h2 className="m-0 text-2xl font-semibold tracking-tight">Statutory rates</h2>
        <p className="m-0 text-muted">
          Used only to cross-check the employee CSG and NSF copied from the payroll. A difference is a warning; the
          payroll figure is never replaced.
        </p>
      </div>

      <div className="panel tone-warn" role="note">
        <Info aria-hidden="true" />
        <div>
          <p className="m-0 font-medium">Unsaved defaults</p>
          <p className="m-0 text-sm text-muted">
            These rates are the app's built-in defaults. They are not checked against legislation and are not saved
            anywhere yet: a version you add here lasts until this tab is closed. Saving through the dashboard comes in a
            later phase.
          </p>
        </div>
      </div>

      {saved && (
        <div className="panel tone-accent" role="status">
          <CircleCheck aria-hidden="true" />
          <p className="m-0 text-sm">The new version is in use for this session.</p>
        </div>
      )}

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
              <dd className="m-0 text-lg font-semibold num">Rs {money(maxNsf(current))}</dd>
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
                salary above Rs <span className="num">{money(current.csgThreshold)}</span>, on the whole salary
              </dd>
            </div>
          </dl>
        ) : (
          <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <span className="icon-tile tone-warn" aria-hidden="true">
              <Percent />
            </span>
            <p className="m-0 font-semibold">No rates are in force for {formatPeriod(month)}</p>
            <p className="m-0 max-w-sm text-sm text-muted">
              Every version starts later than this month. Add a version that starts in or before it to cross-check its
              payslips.
            </p>
          </div>
        )}
      </section>

      {current && (
        <section className="card" aria-label="Worked example">
          <div className="card-header">
            <h3 className="card-title">Worked example</h3>
            <span className="text-sm text-muted">Change the figures to see what the rates give</span>
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

      <section className="card" aria-label="Versions">
        <div className="card-header">
          <h3 className="card-title">Versions</h3>
          <button type="button" className="btn btn-sm" onClick={startDraft} disabled={draft !== null}>
            <Plus aria-hidden="true" />
            Add rates from a month
          </button>
        </div>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Effective from</th>
                <th scope="col" className="right">Revision</th>
                <th scope="col" className="right">NSF rate</th>
                <th scope="col" className="right">NSF ceiling</th>
                <th scope="col">60+ exempt</th>
                <th scope="col" className="right">CSG low</th>
                <th scope="col" className="right">CSG high</th>
                <th scope="col" className="right">CSG threshold</th>
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
                  <td>{version.nsfExemptAt60 ? 'Yes' : 'No'}</td>
                  <td className="right num">{percent(version.csgEmployeeRateLow)}</td>
                  <td className="right num">{percent(version.csgEmployeeRateHigh)}</td>
                  <td className="right num">{money(version.csgThreshold)}</td>
                  <td className="text-muted">
                    {version.createdBy ?? ''}
                    {version.createdAt ? `, ${version.createdAt.slice(0, 10)}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="m-0 px-5 py-3 text-xs text-subtle">
          A version is never edited. To correct one, add a new version for the same month: it becomes the next revision.
        </p>
      </section>

      {draft && (
        <section className="card" aria-label="New version">
          <div className="card-header">
            <h3 className="card-title">New version</h3>
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
                value={draft.effectiveFrom}
                aria-invalid={errors.effectiveFrom ? true : undefined}
                aria-describedby={errors.effectiveFrom ? 'rate-effectiveFrom-error' : undefined}
                onChange={(event) => setDraft({ ...draft, effectiveFrom: event.target.value })}
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
              Number.isFinite(draft.nsfCeiling) && Number.isFinite(draft.nsfEmployeeRate) ? `Highest NSF: Rs ${money(maxNsf(draft))}` : undefined,
            )}
            {numberField('csgEmployeeRateLow', 'Employee CSG lower rate, %')}
            {numberField('csgEmployeeRateHigh', 'Employee CSG higher rate, %')}
            {numberField('csgThreshold', 'CSG salary threshold, Rs')}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.nsfExemptAt60}
                onChange={(event) => setDraft({ ...draft, nsfExemptAt60: event.target.checked })}
              />
              NSF exemption at 60+
            </label>
            <div className="flex justify-end gap-2 sm:col-span-2 lg:col-span-3">
              <button type="button" className="btn" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Review the change
              </button>
            </div>
          </form>
        </section>
      )}

      {confirming && draft && (
        <Dialog
          title="Use these rates?"
          description={`From ${formatPeriod(draft.effectiveFrom)}, as revision ${nextRevision(versions, draft.effectiveFrom)}. Earlier months keep their own rates.`}
          icon={<Percent />}
          tone="warn"
          width={600}
          onClose={() => setConfirming(false)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={save}>
                Use for this session
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
                  const afterText = field.show(draft)
                  return (
                    <tr key={field.key}>
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
        </Dialog>
      )}
    </div>
  )
}
