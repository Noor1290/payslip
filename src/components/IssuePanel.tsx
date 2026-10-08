import { CircleCheck, FileCheck2, Lock, RefreshCw, Send, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { formatPeriod, formatShortDate, isIsoDate } from '../lib/dates'
import { identicalAsk, type IssueBuild } from '../lib/issueBuild'
import { runSummary, type Issuing, type MonthState } from '../lib/useIssuing'
import { Dialog } from './Dialog'
import { FailurePanel } from './FailurePanel'

interface Props {
  period: string
  /** The BRN of the payroll data that is open: the company the payslips are issued for. */
  brn: string
  month: MonthState | undefined
  issuing: Issuing
  /** The dashboard said this user is a member, not an admin. */
  readOnly: boolean
  /** The selection as payslips to issue, or why it cannot be issued. */
  build: IssueBuild
  /** Which template and version, and which rates, the payslips were made with: shown before issuing. */
  templateLabel: string
  ratesLabel: string
  onLoad: () => void
}

const names = (list: string[]) => (list.length <= 6 ? list.join(', ') : `${list.slice(0, 6).join(', ')} and ${list.length - 6} more`)
const day = (stamp: string) => (isIsoDate(stamp.slice(0, 10)) ? formatShortDate(stamp.slice(0, 10)) : '')

/** Issuing a month: check what is issued, confirm, send, and say exactly how it ended. */
export function IssuePanel({ period, brn, month, issuing, readOnly, build, templateLabel, ratesLabel, onLoad }: Props) {
  /** 'identical' is the second confirmation, asked only when a selected payslip is unchanged since it was last issued. */
  const [step, setStep] = useState<'closed' | 'confirm' | 'identical'>('closed')
  const { run } = issuing
  const mine = run?.period === period ? run : null
  const loaded = month?.status === 'loaded'
  const payslips = build.ok ? build.payslips : []
  const reissues = payslips.filter((payslip) => payslip.expectedRevision > 0)
  const identical = build.ok ? build.identical : []
  const ask = identical.length > 0 ? identicalAsk(identical) : null
  const issueNow = () => {
    setStep('closed')
    issuing.start(brn, period, payslips)
  }
  const summary = mine && (mine.status === 'done' || mine.status === 'stopped') ? runSummary(mine) : null
  const outcome = mine?.status === 'stopped' ? mine.outcome : null

  const cannotIssue = readOnly
    ? 'Only an admin of this company can issue payslips. You are signed in to the dashboard as a member.'
    : !loaded
      ? 'Check what is issued first: each payslip is sent with the revision the dashboard has now.'
      : !build.ok
        ? build.problems[0]
        : outcome?.end === 'unconfirmed'
          ? 'The last issue has not been confirmed yet. Check again first.'
          : null

  // The dialog sits outside the card: a card has a backdrop filter, which would trap an overlay inside it.
  return (
    <>
    <section className="card" aria-label="Issue the month" data-testid="issue-panel">
      <div className="card-header">
        <h2 className="card-title">Issue {formatPeriod(period)}</h2>
        {loaded && (
          <span className="badge" data-testid="issued-count">
            {month.payslips.length} issued in the dashboard
          </span>
        )}
      </div>
      <div className="flex flex-col gap-3 p-4">
        <p className="m-0 text-sm text-muted">
          Issuing stores each payslip in the dashboard exactly as shown here. An issued payslip is never changed: issuing again makes a
          new revision.
        </p>

        {month?.status === 'failed' && (
          <FailurePanel failure={month.failure} testId="month-load-failure">
            <button type="button" className="btn btn-sm" onClick={onLoad}>
              <RefreshCw aria-hidden="true" />
              Ask again
            </button>
          </FailurePanel>
        )}

        {issuing.tooLarge.length > 0 && (
          <div className="panel tone-danger" role="alert" data-testid="issue-too-large">
            <TriangleAlert aria-hidden="true" />
            <div className="min-w-0">
              <p className="m-0 font-medium">Nothing was sent: a payslip is too large for the dashboard</p>
              <p className="m-0 text-sm text-muted">The dashboard accepts 16 KB per payslip. Nothing is trimmed to make one fit. Use a template with fewer lines, or untick:</p>
              <ul className="m-0 mt-1 list-disc pl-5 text-sm text-muted">
                {issuing.tooLarge.map((found) => (
                  <li key={found.name}>
                    {found.name}: {(found.bytes / 1000).toFixed(1)} KB
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {mine && (mine.status === 'sending' || mine.status === 'checking') && (
          <p className="m-0 text-sm" role="status" data-testid="issue-progress">
            {mine.status === 'checking' ? 'Checking with the dashboard' : 'Issuing'}
            {mine.batches.length > 1 ? `: batch ${mine.at + 1} of ${mine.batches.length}` : ''}. The dashboard may ask you to allow it.
          </p>
        )}

        {outcome?.failure && (
          <FailurePanel failure={outcome.failure} testId="issue-outcome">
            {(outcome.end === 'locked' || outcome.end === 'not-saved') && (
              <button type="button" className="btn btn-sm btn-primary" onClick={issuing.resume}>
                <Send aria-hidden="true" />
                Issue again
              </button>
            )}
            {outcome.end === 'unconfirmed' && (
              <button type="button" className="btn btn-sm" onClick={issuing.resume}>
                <RefreshCw aria-hidden="true" />
                Check again
              </button>
            )}
          </FailurePanel>
        )}
        {outcome && (outcome.culprit || outcome.moved.length > 0 || (mine && mine.batches.length > 1)) && (
          <div className="panel tone-warn" role="status" data-testid="issue-detail">
            <TriangleAlert aria-hidden="true" />
            <div className="min-w-0 text-sm">
              {mine && mine.batches.length > 1 && (
                <p className="m-0">
                  Stopped at batch {mine.at + 1} of {mine.batches.length}. Each batch is stored all or none.
                </p>
              )}
              {outcome.culprit && (
                <p className="m-0">
                  <span className="font-medium">The payslip at fault: {outcome.culprit}.</span> Nothing in this batch was issued.
                </p>
              )}
              {outcome.moved.length > 0 && (
                <>
                  <p className="m-0 font-medium">Issued since you last checked:</p>
                  <ul className="m-0 list-disc pl-5">
                    {outcome.moved.map((moved) => (
                      <li key={moved.name}>
                        {moved.name}: revision {moved.revision}, by {moved.issuedByYou ? 'you' : 'another admin'} {day(moved.issuedAt)}
                      </li>
                    ))}
                  </ul>
                  <p className="m-0 text-muted">Open the Issued payslips page to see what was issued. To issue yours as the next revision, issue again; or untick them.</p>
                </>
              )}
            </div>
          </div>
        )}

        {summary && (
          <div className={`panel ${summary.notIssued.length === 0 ? 'tone-accent' : 'tone-warn'}`} role="status" data-testid="issue-summary">
            {summary.notIssued.length === 0 ? <CircleCheck aria-hidden="true" /> : <TriangleAlert aria-hidden="true" />}
            <div className="min-w-0 text-sm">
              <p className="m-0 font-medium">
                Issued: {summary.issued.length}. Not issued: {summary.notIssued.length}.
              </p>
              {summary.issued.length > 0 && <p className="m-0 text-muted">Issued: {names(summary.issued)}.</p>}
              {summary.notIssued.length > 0 && <p className="m-0 text-muted">Not issued: {names(summary.notIssued)}.</p>}
            </div>
          </div>
        )}

        {cannotIssue && (
          <p className="m-0 flex items-start gap-2 text-sm text-muted" id="cannot-issue" data-testid="cannot-issue">
            <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {cannotIssue}
          </p>
        )}
        {!build.ok && build.problems.length > 1 && loaded && !readOnly && (
          <ul className="m-0 list-disc pl-9 text-sm text-muted">
            {build.problems.slice(1, 8).map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn" onClick={onLoad} disabled={readOnly || issuing.busy || month?.status === 'loading'}>
            <RefreshCw aria-hidden="true" />
            {month?.status === 'loading' ? 'Waiting for the dashboard' : loaded ? 'Check again what is issued' : 'Check what is issued'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={cannotIssue !== null || issuing.busy}
            aria-describedby={cannotIssue ? 'cannot-issue' : undefined}
            onClick={() => setStep('confirm')}
          >
            <FileCheck2 aria-hidden="true" />
            Issue {payslips.length > 0 ? payslips.length : ''} {payslips.length === 1 ? 'payslip' : 'payslips'}
          </button>
        </div>
        <p className="m-0 text-xs text-subtle">The dashboard asks you before it sends issued payslips to this app, and it must be unlocked to issue.</p>
      </div>
    </section>

      {step === 'confirm' && build.ok && (
        <Dialog
          title={`Issue ${payslips.length} ${payslips.length === 1 ? 'payslip' : 'payslips'} for ${formatPeriod(period)}?`}
          description={`For BRN ${brn}. They are stored in the dashboard exactly as shown, all or none.`}
          icon={<FileCheck2 />}
          tone="warn"
          width={600}
          onClose={() => setStep('closed')}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setStep('closed')}>
                Cancel
              </button>
              {/* An unchanged payslip is not sent on this confirmation alone: it gets its own question. */}
              <button type="button" className="btn btn-primary" onClick={() => (ask ? setStep('identical') : issueNow())}>
                Issue
              </button>
            </>
          }
        >
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Template</dt>
            <dd className="m-0">{templateLabel}</dd>
            <dt className="text-muted">Cross-check rates</dt>
            <dd className="m-0">{ratesLabel}</dd>
            <dt className="text-muted">First issue</dt>
            <dd className="m-0">
              {payslips.length - reissues.length} {payslips.length - reissues.length === 1 ? 'payslip' : 'payslips'}, as revision 1
            </dd>
          </dl>
          {reissues.length > 0 && (
            <div className="panel tone-warn mt-3" data-testid="reissue-list">
              <TriangleAlert aria-hidden="true" />
              <div className="min-w-0 text-sm">
                <p className="m-0 font-medium">
                  {reissues.length} {reissues.length === 1 ? 'payslip was' : 'payslips were'} issued before
                </p>
                <ul className="m-0 mt-1 max-h-40 list-disc overflow-auto pl-5">
                  {reissues.map((payslip) => (
                    <li key={payslip.nationalId}>
                      {payslip.name}: this creates revision {payslip.expectedRevision + 1}; revision {payslip.expectedRevision} stays.
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </Dialog>
      )}

      {step === 'identical' && build.ok && ask && (
        <Dialog
          title={ask.title}
          description={ask.question}
          icon={<TriangleAlert />}
          tone="warn"
          width={600}
          onClose={() => setStep('closed')}
          actions={
            <>
              <button type="button" className="btn" data-autofocus onClick={() => setStep('closed')}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={issueNow}>
                Issue anyway
              </button>
            </>
          }
        >
          <ul className="m-0 max-h-40 list-disc overflow-auto pl-5 text-sm" data-testid="identical-list">
            {ask.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="m-0 mt-3 text-sm text-muted">
            {payslips.length > identical.length
              ? `The other ${payslips.length - identical.length} of this issue ${payslips.length - identical.length === 1 ? 'is' : 'are'} new or changed. `
              : ''}
            Nothing is sent if you cancel. To issue without the unchanged ones, cancel and untick them.
          </p>
        </Dialog>
      )}
    </>
  )
}
