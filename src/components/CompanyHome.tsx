import { ChevronRight, LayoutGrid, LoaderCircle } from 'lucide-react'
import { useId, type CSSProperties } from 'react'
import { formatPeriod } from '../lib/dates'
import type { Failure } from '../lib/hubWire'
import { hueOf, initialsOf } from '../lib/companyLook'
import { FailurePanel } from './FailurePanel'

/** One card: a company on this app's list. Names and BRNs only. */
export interface HomeCompany {
  company_id: string
  brn: string
  name: string
}

export interface CompanyHomeProps {
  /** The companies on this app's list, by name. */
  companies: readonly HomeCompany[]
  /** Whether the list is still being read from the dashboard. */
  loading: boolean
  /** Whether the user is an admin of at least one company: only admins choose the list. */
  canChoose: boolean
  months: readonly string[]
  period: string
  onPeriod: (period: string) => void
  /** The card being opened: it shows a spinner and the others wait. */
  opening: string | null
  onOpen: (company: HomeCompany) => void
  onChoose: () => void
  /** Small labels on a card, e.g. "CSG", "PRGF". */
  tags?: (company: HomeCompany) => readonly string[]
  /** Something that went wrong reading the list, or opening a company or the picker. */
  failure: Failure | null
  /** Reads the list again, when that is what failed. */
  onRetry?: () => void
}

/** The circle with the company's initials, in the same colour as in the dashboard. */
export function Avatar({ name, hueKey }: { name: string; hueKey: string }) {
  const hue = hueOf(hueKey)
  const style: CSSProperties = {
    color: `oklch(var(--avatar-fg-l) 0.13 ${hue})`,
    background: `oklch(0.7 0.13 ${hue} / var(--avatar-bg-a))`,
    boxShadow: `inset 0 0 0 1px oklch(0.7 0.13 ${hue} / 0.35)`,
  }
  return (
    <span className="avatar" style={style} aria-hidden="true" data-values>
      {initialsOf(name)}
    </span>
  )
}

/** "Your companies, November 2026": a card for each company on this app's list. */
export function CompanyHome({ companies, loading, canChoose, months, period, onPeriod, opening, onOpen, onChoose, tags, failure, onRetry }: CompanyHomeProps) {
  const monthId = useId()
  const empty = !loading && companies.length === 0
  return (
    <section className="flex flex-col gap-5 rise-in" aria-labelledby="home-title" data-testid="company-home">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <h2 id="home-title" className="home-title">
          Your companies
        </h2>
        <label htmlFor={monthId} className="sr-only">
          Month
        </label>
        <select id={monthId} className="month-pill" data-values value={period} onChange={(event) => onPeriod(event.target.value)}>
          {months.map((month) => (
            <option key={month} value={month}>
              {formatPeriod(month)}
            </option>
          ))}
        </select>
        {!empty && (
          <button type="button" className="btn btn-sm ml-auto" onClick={onChoose} disabled={loading}>
            <LayoutGrid aria-hidden="true" />
            Choose companies
          </button>
        )}
      </div>

      {failure && (
        <FailurePanel failure={failure} testId="home-failure">
          {onRetry && (
            <button type="button" className="btn btn-sm" onClick={onRetry}>
              Try again
            </button>
          )}
        </FailurePanel>
      )}

      {loading && (
        <div role="status" className="company-grid">
          <span className="sr-only">Loading</span>
          {[0, 1, 2].map((n) => (
            <div key={n} className="skeleton" style={{ height: 78, borderRadius: 16 }} />
          ))}
        </div>
      )}

      {empty && (
        <div className="company-empty" data-testid="no-companies">
          <span className="icon-tile tone-accent round" aria-hidden="true">
            <LayoutGrid />
          </span>
          <h3>No companies yet</h3>
          {canChoose ? (
            <button type="button" className="btn btn-primary" onClick={onChoose}>
              <LayoutGrid aria-hidden="true" />
              Choose companies
            </button>
          ) : (
            <p className="m-0 text-sm text-muted">An admin can choose them.</p>
          )}
        </div>
      )}

      {!loading && companies.length > 0 && (
        <ul className="company-grid" aria-label="Your companies">
          {companies.map((company) => {
            const busy = opening === company.company_id
            const labels = tags?.(company) ?? []
            return (
              <li key={company.company_id}>
                <button
                  type="button"
                  className="company-card"
                  aria-busy={busy || undefined}
                  disabled={opening !== null && !busy}
                  onClick={() => onOpen(company)}
                >
                  <Avatar name={company.name} hueKey={company.brn || company.company_id} />
                  <span className="company-text">
                    <span className="company-name" data-values>
                      {company.name}
                    </span>
                    <span className="company-brn" data-values>
                      {company.brn}
                    </span>
                    {labels.length > 0 && (
                      <span className="company-tags">
                        {labels.map((label) => (
                          <span key={label} className="company-tag">
                            {label}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                  {busy ? <LoaderCircle className="go spin" aria-hidden="true" /> : <ChevronRight className="go" aria-hidden="true" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
