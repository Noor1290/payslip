import { Scale } from 'lucide-react'
import { useId, useState } from 'react'
import { REASON_MAX, reasonProblem } from '../lib/reasons'
import { Dialog } from './Dialog'

interface Props {
  title: string
  /** What is being accepted, with its figures. */
  description: string
  confirmLabel: string
  onConfirm: (reason: string) => void
  onClose: () => void
}

/** Asks why a difference is accepted. The reason is stored with the issued payslip. */
export function ReasonDialog({ title, description, confirmLabel, onConfirm, onClose }: Props) {
  const [reason, setReason] = useState('')
  const [shown, setShown] = useState(false)
  const id = useId()
  const problem = reasonProblem(reason)
  const confirm = () => {
    setShown(true)
    if (!problem) onConfirm(reason.trim())
  }
  return (
    <Dialog
      title={title}
      description={description}
      icon={<Scale />}
      tone="warn"
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={confirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <form
        className="field"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          confirm()
        }}
      >
        <label className="field-label" htmlFor={id}>
          Reason
        </label>
        <input
          id={id}
          type="text"
          className="input"
          data-autofocus
          autoComplete="off"
          maxLength={REASON_MAX + 50}
          value={reason}
          aria-invalid={shown && problem ? true : undefined}
          aria-describedby={`${id}-hint`}
          onChange={(event) => setReason(event.target.value)}
        />
        <span className={shown && problem ? 'field-error' : 'field-hint'} id={`${id}-hint`}>
          {shown && problem ? problem : 'Kept with the payslip when it is issued. It does not change any figure.'}
        </span>
      </form>
    </Dialog>
  )
}
