import { ChevronDown, ChevronRight, CircleHelp, Diff, Equal, Info, ListChecks, RefreshCw, TriangleAlert, UserMinus, UserPlus } from 'lucide-react'
import { Fragment, useState } from 'react'
import { formatPeriod } from '../lib/dates'
import { shownCents, signedCents, STATUS_TEXT, type LineComparison, type MonthComparison, type ReviewRow, type RowStatus } from '../lib/monthCompare'
import type { MonthReview as Review } from '../lib/useMonthReview'
import { FailurePanel } from './FailurePanel'

interface Props {
  /** The pay month being reviewed. */
  period: string
  review: Review
  /** The dashboard said this user is a member: only an admin can load issued payslips. */
  readOnly: boolean
  /** The employee whose payslip is on screen (a row of this month's payroll data). */
  current: number | null
  /** Shows that employee's payslip. The payslip itself is never marked: the review stays in this card. */
  onShow: (rowIndex: number) => void
}

const STATUS_LOOK: Record<RowStatus, { tone: string; icon: typeof Equal }> = {
  unchanged: { tone: 'tone-accent', icon: Equal },
  changed: { tone: 'tone-warn', icon: Diff },
  new: { tone: 'tone-sky', icon: UserPlus },
  left: { tone: 'tone-glow', icon: UserMinus },
  'cannot-compare': { tone: 'tone-danger', icon: CircleHelp },
}

/** The status in words and with an icon: never by colour alone. */
function StatusBadge({ status }: { status: RowStatus }) {
  const { tone, icon: Icon } = STATUS_LOOK[status]
  return (
    <span className={`badge ${tone}`} data-testid="review-status" data-status={status}>
      <Icon aria-hidden="true" />
      {STATUS_TEXT[status]}
    </span>
  )
}

/** A changed line or total: said in words and with an icon, beside its label. */
function ChangedMark({ notMatched = false }: { notMatched?: boolean }) {
  return (
    <span className="badge tone-warn ml-2">
      {notMatched ? <CircleHelp aria-hidden="true" /> : <Diff aria-hidden="true" />}
      {notMatched ? 'Not matched' : 'Changed'}
    </span>
  )
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

function LineRow({ line }: { line: LineComparison }) {
  const notMatched = line.unmatched !== null
  return (
    <tr data-changed={line.changed ? 'true' : undefined}>
      <td className={line.changed ? 'font-medium' : undefined}>
        {line.label}
        {line.changed && <ChangedMark notMatched={notMatched} />}
        {line.lastLabel !== null && <span className="block text-xs font-normal text-muted">Last month: {line.lastLabel}</span>}
        {notMatched && line.unmatched && <span className="block text-xs font-normal text-muted">{line.unmatched}</span>}
      </td>
      <td className="right num">{shownCents(line.last)}</td>
      <td className="right num">{shownCents(line.current)}</td>
      <td className="right num">{line.difference === null ? '' : signedCents(line.difference)}</td>
    </tr>
  )
}

function Details({ row, comparison }: { row: ReviewRow; comparison: MonthComparison }) {
  const [last, now] = [formatPeriod(comparison.lastPeriod), formatPeriod(comparison.period)]
  const sides = [
    { title: 'Earnings', lines: row.lines.filter((line) => line.side === 'earnings') },
    { title: 'Deductions', lines: row.lines.filter((line) => line.side === 'deductions') },
  ]
  const head = '!static !bg-transparent'
  const fromPayroll = comparison.source === 'payroll'
  return (
    <div className="flex flex-col gap-2 py-1">
      {row.problem && (
        <p className="m-0 flex items-start gap-2 text-sm" data-testid="review-problem">
          <CircleHelp aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
          {row.problem}
        </p>
      )}
      {row.status === 'new' && (
        <p className="m-0 text-sm text-muted">
          {fromPayroll ? `This employee is not in the payroll figures of ${last}.` : `No payslip was issued to this employee for ${last}.`} Every figure below is
          this month's.
        </p>
      )}
      {row.status === 'left' && (
        <p className="m-0 text-sm text-muted">
          {fromPayroll ? `This employee is in the payroll figures of ${last}` : `A payslip was issued for ${last}`}, and is not in the payroll data for {now}. No
          payslip is made for them.
        </p>
      )}
      {row.matchedBy === 'label' && <p className="m-0 text-sm text-muted">Another template was used for {last}, so the lines are matched by their labels.</p>}
      {row.notes.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm" data-testid="review-notes">
          {row.notes.map((note) => (
            <li key={note} className="flex items-start gap-2">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-sky" />
              <span>{note}</span>
            </li>
          ))}
        </ul>
      )}
      {row.lines.length > 0 && (
        <div className="table-scroll rounded-lg border border-line">
          <table className="table" data-testid="review-lines">
            <caption className="sr-only">
              {row.employeeName}: each line of the payslip for {last} and for {now}
            </caption>
            <thead>
              <tr>
                <th scope="col" className={head}>
                  Line
                </th>
                <th scope="col" className={`${head} right`}>
                  Last month<span className="sr-only"> ({last})</span>
                </th>
                <th scope="col" className={`${head} right`}>
                  This month<span className="sr-only"> ({now})</span>
                </th>
                <th scope="col" className={`${head} right`}>
                  Difference
                </th>
              </tr>
            </thead>
            <tbody>
              {sides.map(({ title, lines }) => (
                <Fragment key={title}>
                  <tr>
                    <th scope="colgroup" colSpan={4} className={`${head} !text-fg`}>
                      {title}
                    </th>
                  </tr>
                  {lines.map((line, index) => (
                    <LineRow key={`${title}-${index}`} line={line} />
                  ))}
                </Fragment>
              ))}
              <tr>
                <th scope="colgroup" colSpan={4} className={`${head} !text-fg`}>
                  Totals
                </th>
              </tr>
              {row.totals.map((total) => (
                <tr key={total.id} data-changed={total.changed ? 'true' : undefined}>
                  <td className="font-medium">
                    {total.label}
                    {total.changed && <ChangedMark />}
                  </td>
                  <td className="right num">{shownCents(total.last)}</td>
                  <td className="right num">{shownCents(total.current)}</td>
                  <td className="right num">{total.difference === null ? '' : signedCents(total.difference)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/**
 * The month review: each employee's payslip of this month beside the one issued last month. All
 * of it stays in this card. The payslip preview is a picture of paper and is never marked.
 */
export function MonthReview({ period, review, readOnly, current, onShow }: Props) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const { state, comparison, lastPeriod } = review
  if (lastPeriod === null) return null
  const last = formatPeriod(lastPeriod)
  const toggle = (key: string) =>
    setOpen((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const net = (row: ReviewRow) => row.totals.find((total) => total.id === 'net')
  const reviewed = comparison ? comparison.rows.filter((row) => review.isReviewed(row)).length : 0

  return (
    <section className="card" aria-label="Month review" data-testid="month-review" data-state={state.status}>
      <div className="card-header">
        <h2 className="card-title">Month review: compared with {last}</h2>
        {comparison && (
          <p className="m-0 flex flex-wrap justify-end gap-1.5" data-testid="review-counts">
            {(Object.keys(STATUS_TEXT) as RowStatus[])
              .filter((status) => comparison.counts[status] > 0)
              .map((status) => (
                <span key={status} className={`badge ${STATUS_LOOK[status].tone}`}>
                  {comparison.counts[status]} {STATUS_TEXT[status]}
                </span>
              ))}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-3 p-4">
        {state.status === 'not-asked' && (
          <>
            <p className="m-0 text-sm text-muted">
              Compares each payslip of {formatPeriod(period)} with the one issued for {last}, line by line. The payslips of {formatPeriod(period)} are
              always made from this month's payroll figures: nothing is copied from last month.
            </p>
            {readOnly && (
              <p className="m-0 text-sm text-muted" id="cannot-compare" data-testid="review-cannot-compare">
                Only an admin of this company can load issued payslips. You are signed in to the dashboard as a member.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn" onClick={review.load} disabled={readOnly} aria-describedby={readOnly ? 'cannot-compare' : undefined}>
                <ListChecks aria-hidden="true" />
                Compare with {last}
              </button>
              <span className="text-xs text-subtle">The dashboard asks you before it sends issued payslips to this app.</span>
            </div>
          </>
        )}

        {state.status === 'loading' && (
          <div aria-busy="true" role="status" aria-label={`Waiting for the dashboard to send the ${state.what === 'payroll' ? 'payroll figures' : 'payslips'} of ${last}`}>
            <div className="skeleton mb-2 h-8 w-full" />
            <div className="skeleton mb-2 h-8 w-full" />
            <div className="skeleton h-8 w-2/3" />
            <p className="m-0 mt-2 text-sm text-muted">Waiting for the dashboard. It asks you to allow this.</p>
          </div>
        )}

        {state.status === 'failed' && (
          <>
            <FailurePanel failure={state.failure} testId="review-load-failure">
              <button type="button" className="btn btn-sm" onClick={state.what === 'payroll' ? review.loadPayroll : review.load}>
                <RefreshCw aria-hidden="true" />
                Ask again
              </button>
            </FailurePanel>
            <p className="m-0 text-sm text-muted">Nothing is known about {last} yet, so the month cannot be issued. Downloads do not wait for the review.</p>
          </>
        )}

        {state.status === 'none-issued' && (
          <div className="panel tone-sky" role="status" data-testid="review-none-issued">
            <Info aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="m-0 font-medium">No payslip was issued for {last}</p>
              <p className="m-0 text-sm text-muted">
                The review can compare with the payroll figures of {last} instead, if the dashboard has that month's payroll. Issuing waits for the answer.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" className="btn btn-sm" onClick={review.loadPayroll}>
                  <ListChecks aria-hidden="true" />
                  Compare with the payroll figures of {last}
                </button>
                <span className="text-xs text-subtle">The dashboard asks you first.</span>
              </div>
            </div>
          </div>
        )}

        {state.status === 'nothing' && (
          <div className="panel tone-sky" role="status" data-testid="review-nothing">
            <Info aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="m-0 font-medium">Nothing to compare with for {last}</p>
              <p className="m-0 text-sm text-muted">
                No payslip was issued for {last}, and the dashboard has no payroll saved for it. No review is needed: the month can be issued as it is.
              </p>
              <div className="mt-3">
                <button type="button" className="btn btn-sm" onClick={review.checkAgain}>
                  <RefreshCw aria-hidden="true" />
                  Check {last} again
                </button>
              </div>
            </div>
          </div>
        )}

        {comparison && (
          <>
            {comparison.source === 'payroll' && (
              <div className="panel tone-warn" role="status" data-testid="review-source-payroll">
                <TriangleAlert aria-hidden="true" />
                <div className="min-w-0">
                  <p className="m-0 text-sm font-medium">Compared with payroll figures, not issued payslips</p>
                  <p className="m-0 text-sm text-muted">
                    No payslip was issued for {last}. Its payroll figures are shown as they would appear on the template in use now. They are not what
                    anyone was given.
                  </p>
                </div>
              </div>
            )}
            {comparison.banner.map((line) => (
              <div key={line.kind} className="panel tone-warn" role="status" data-testid={`review-banner-${line.kind}`}>
                <TriangleAlert aria-hidden="true" />
                <div className="min-w-0">
                  <p className="m-0 text-sm font-medium">{line.text}</p>
                  <ul className="m-0 mt-1 list-disc pl-5 text-sm text-muted">
                    {line.details.map((detail) => (
                      <li key={detail}>{detail}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}

            <div className="table-scroll max-h-[560px] rounded-lg border border-line">
              <table className="table">
                <caption className="sr-only">
                  Each employee's payslip for {formatPeriod(comparison.period)} compared with {last}
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="w-8">
                      <span className="sr-only">Reviewed</span>
                    </th>
                    <th scope="col">Employee</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="right">
                      Net pay change
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.rows.map((row) => {
                    const isOpen = open.has(row.key)
                    const total = net(row)
                    const detailsId = `review-details-${row.key}`
                    return (
                      <Fragment key={row.key}>
                        <tr data-testid="review-row" data-key={row.key} className={row.rowIndex !== null && row.rowIndex === current ? 'row-current' : undefined}>
                          <td>
                            <input
                              type="checkbox"
                              aria-label={row.status === 'left' ? `Acknowledge that ${row.employeeName} left` : `Mark ${row.employeeName} as reviewed`}
                              checked={review.isReviewed(row)}
                              onChange={(event) => review.setReviewed(row, event.target.checked)}
                            />
                          </td>
                          <td>
                            <span className="flex items-start gap-1.5">
                              <button
                                type="button"
                                className="btn btn-sm btn-ghost !h-6 !w-6 shrink-0 !p-0"
                                aria-expanded={isOpen}
                                aria-controls={detailsId}
                                aria-label={`${isOpen ? 'Hide' : 'Show'} the lines of ${row.employeeName}`}
                                onClick={() => toggle(row.key)}
                              >
                                {isOpen ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
                              </button>
                              <span className="min-w-0">
                                {row.rowIndex === null ? (
                                  <span className="font-medium">{row.employeeName}</span>
                                ) : (
                                  <button
                                    type="button"
                                    className="row-button font-medium"
                                    aria-label={`Show the payslip of ${row.employeeName}`}
                                    onClick={() => onShow(row.rowIndex!)}
                                  >
                                    {row.employeeName}
                                  </button>
                                )}
                                {row.notes.length > 0 && <span className="block text-xs text-muted">{plural(row.notes.length, 'note', 'notes')}</span>}
                              </span>
                            </span>
                          </td>
                          <td>
                            <StatusBadge status={row.status} />
                          </td>
                          <td className="right num">{total && total.difference !== null ? signedCents(total.difference) : ''}</td>
                        </tr>
                        {isOpen && (
                          <tr id={detailsId} data-testid="review-details">
                            <td colSpan={4}>
                              <Details row={row} comparison={comparison} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn" onClick={review.approveUnchanged} disabled={review.unchangedToApprove === 0} data-testid="review-approve-unchanged">
                <ListChecks aria-hidden="true" />
                Approve {review.unchangedToApprove > 0 ? plural(review.unchangedToApprove, 'unchanged payslip', 'unchanged payslips') : 'unchanged payslips'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={review.load}>
                <RefreshCw aria-hidden="true" />
                Load {last} again
              </button>
              <p className="m-0 text-sm text-muted" role="status" data-testid="review-progress">
                {reviewed} of {comparison.rows.length} reviewed.
              </p>
            </div>
            <p className="m-0 text-xs text-subtle">
              Only money decides a status. "Approve unchanged" never marks a changed, new or left employee: those are looked at one by one. Marks are kept in
              this tab only.
            </p>
          </>
        )}
      </div>
    </section>
  )
}
