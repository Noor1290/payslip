import { Building2, Search, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import type { CompanyResult } from '../lib/publishMany'
import type { ManyPublish } from '../lib/useTemplates'
import { Dialog } from './Dialog'
import { FailurePanel } from './FailurePanel'

interface Props {
  many: ManyPublish
  /** The template being published, as saved. */
  name: string
  onTick: (brn: string, on: boolean) => void
  onPublish: () => void
  onClose: () => void
}

const companies = (count: number) => `${count} ${count === 1 ? 'company' : 'companies'}`

/** From this many companies on, the list can be searched. */
export const SEARCH_FROM = 10

function outcomeBadge(result: CompanyResult) {
  switch (result.outcome) {
    case 'updated':
      return <span className="badge tone-accent">Updated</span>
    case 'skipped':
      return <span className="badge">Skipped</span>
    case 'unconfirmed':
      return <span className="badge tone-warn">Not confirmed</span>
    case 'failed':
      return <span className="badge tone-danger">Not published</span>
  }
}

/**
 * Publishing a template to several companies: the dashboard's check of each company where the
 * user is an admin, the ticks, the progress company by company, and what happened to each.
 */
export function PublishManyDialog({ many, name, onTick, onPublish, onClose }: Props) {
  const title = `Publish "${name}" to several companies`
  const [query, setQuery] = useState('')

  if (many.step === 'checking' || many.step === 'failed') {
    return (
      <Dialog
        title={title}
        description={many.step === 'checking' ? 'Checking your companies in the dashboard.' : 'The companies could not be checked, so nothing was published.'}
        icon={<Building2 />}
        width={760}
        onClose={onClose}
        actions={
          <button type="button" className="btn" data-autofocus disabled={many.step === 'checking'} onClick={onClose}>
            Close
          </button>
        }
      >
        {many.step === 'checking' ? (
          <div aria-busy="true" aria-label="Checking your companies in the dashboard">
            <div className="skeleton mb-2 h-10 w-full" />
            <div className="skeleton h-10 w-2/3" />
          </div>
        ) : (
          <FailurePanel failure={many.failure} testId="many-check-failure" />
        )}
      </Dialog>
    )
  }

  if (many.step === 'done') {
    const count = (outcome: CompanyResult['outcome'] | CompanyResult['outcome'][]) =>
      many.results.filter((result) => ([] as string[]).concat(outcome).includes(result.outcome)).length
    return (
      <Dialog
        title={title}
        description={`${count('updated')} updated, ${count('skipped')} skipped, ${count(['failed', 'unconfirmed'])} not published.`}
        icon={<Building2 />}
        width={760}
        onClose={onClose}
        actions={
          <button type="button" className="btn btn-primary" data-autofocus onClick={onClose}>
            Close
          </button>
        }
      >
        <div className="table-scroll" data-testid="many-results">
          <table className="table" aria-label="What happened in each company">
            <thead>
              <tr>
                <th scope="col">Company</th>
                <th scope="col">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {many.results.map((result) => (
                <tr key={result.brn} data-outcome={result.outcome}>
                  <th scope="row" className="!static !bg-transparent !text-fg !text-[13.5px]">
                    {result.company}
                    {result.thisCompany && <span className="badge ml-2">This company</span>}
                    <span className="block text-xs font-normal text-subtle">
                      BRN <span className="num">{result.brn}</span>
                    </span>
                  </th>
                  <td>
                    <span className="flex flex-wrap items-center gap-2">
                      {outcomeBadge(result)}
                      <span className="text-sm">{result.text}</span>
                    </span>
                    {result.outcome === 'skipped' && result.reasons.length > 0 && (
                      <ul className="m-0 mt-1 list-disc pl-5 text-sm text-muted">
                        {result.reasons.map((reason) => (
                          <li key={reason}>{reason}</li>
                        ))}
                      </ul>
                    )}
                    {(result.outcome === 'failed' || result.outcome === 'unconfirmed') && (
                      <p className="m-0 mt-1 text-sm text-muted">
                        {result.detail}
                        {result.failure.hubError && ` The dashboard said: ${result.failure.hubError}`}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Dialog>
    )
  }

  const { plans, ticked } = many
  const publishing = many.step === 'publishing'
  const chosen = plans.filter((plan) => plan.thisCompany || (ticked.has(plan.brn) && plan.blocked === null)).length
  const searchable = plans.length >= SEARCH_FROM
  const wanted = searchable ? query.trim().toLowerCase() : ''
  // A search only hides rows: what is ticked stays ticked, and is counted on the button.
  const shown = wanted ? plans.filter((plan) => plan.company.toLowerCase().includes(wanted) || plan.brn.toLowerCase().includes(wanted)) : plans
  return (
    <Dialog
      title={title}
      description={`Each ticked company gets "${name}" as a published version and uses it for its payslips. Issued payslips are not changed. Only companies where you are an admin are listed.`}
      icon={<Building2 />}
      width={760}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn" disabled={publishing} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" data-autofocus disabled={publishing} onClick={onPublish}>
            {publishing ? 'Publishing' : `Publish to ${companies(chosen)}`}
          </button>
        </>
      }
    >
      {publishing && (
        <p className="m-0 mb-3 text-sm font-medium" role="status" aria-live="polite" data-testid="many-progress">
          {many.company ? `Company ${many.done + 1} of ${many.total}: ${many.company}...` : `${many.done} of ${many.total} done.`}
        </p>
      )}
      {searchable && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
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
            <span className="text-sm text-muted" role="status" data-testid="many-shown">
              Showing {shown.length} of {companies(plans.length)}.
            </span>
          )}
        </div>
      )}
      <div className="table-scroll">
        <table className="table" aria-label="Companies to publish to">
          <thead>
            <tr>
              <th scope="col">Publish</th>
              <th scope="col">Company</th>
              <th scope="col">What happens</th>
              <th scope="col">Check</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={4} className="text-sm text-muted">
                  No company matches "{query.trim()}".
                </td>
              </tr>
            )}
            {shown.map((plan) => {
              const on = plan.thisCompany || (ticked.has(plan.brn) && plan.blocked === null)
              return (
                <tr key={plan.brn} data-brn={plan.brn}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Publish to ${plan.company}`}
                      checked={on}
                      disabled={publishing || plan.thisCompany || plan.blocked !== null}
                      onChange={(event) => onTick(plan.brn, event.target.checked)}
                    />
                  </td>
                  <th scope="row" className="!static !bg-transparent !text-fg !text-[13.5px]">
                    {plan.company}
                    {plan.thisCompany && <span className="badge ml-2">This company</span>}
                    <span className="block text-xs font-normal text-subtle">
                      BRN <span className="num">{plan.brn}</span>
                    </span>
                  </th>
                  <td className="text-sm">{plan.what}</td>
                  <td>
                    {plan.blocked !== null ? (
                      <span className="text-sm text-muted">{plan.blocked}</span>
                    ) : plan.reasons.length === 0 ? (
                      <span className="badge tone-accent">Ready</span>
                    ) : (
                      <div className="flex items-start gap-1.5 text-sm" data-testid="many-reasons">
                        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warn" />
                        <div className="min-w-0">
                          <ul className="m-0 list-none p-0">
                            {plan.reasons.map((reason) => (
                              <li key={reason}>{reason}</li>
                            ))}
                          </ul>
                          {!plan.thisCompany && <p className="m-0 mt-1 text-xs text-muted">Not ticked at first. Tick it to publish anyway.</p>}
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Dialog>
  )
}
