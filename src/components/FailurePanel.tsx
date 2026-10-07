import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Failure } from '../lib/hubWire'

interface Props {
  failure: Failure
  /** Buttons that fit this failure ("Check again", "Reload"). */
  children?: ReactNode
  testId?: string
}

/** What the dashboard refused or did not answer, in plain words, with what to do next. */
export function FailurePanel({ failure, children, testId }: Props) {
  // "Nothing needed saving" is not an error; a stale save is a warning, since nothing was lost.
  const tone = failure.kind === 'no-change' ? 'sky' : failure.kind === 'stale' ? 'warn' : 'danger'
  const Icon = failure.kind === 'no-change' ? Info : failure.kind === 'stale' ? TriangleAlert : CircleAlert
  return (
    <div className={`panel tone-${tone}`} role={tone === 'danger' ? 'alert' : 'status'} data-testid={testId} data-kind={failure.kind}>
      <Icon aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="m-0 font-medium">{failure.title}</p>
        <p className="m-0 text-sm text-muted">{failure.detail}</p>
        {failure.hubError && <p className="m-0 mt-1 text-sm text-muted">The dashboard said: {failure.hubError}</p>}
        {children && <div className="mt-3 flex flex-wrap gap-2">{children}</div>}
      </div>
    </div>
  )
}

export function SavedPanel({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="panel tone-accent" role="status" data-testid={testId}>
      <CircleCheck aria-hidden="true" />
      <p className="m-0 text-sm">{children}</p>
    </div>
  )
}
