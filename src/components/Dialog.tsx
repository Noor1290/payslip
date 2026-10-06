import { useEffect, useId, useRef, type ReactNode } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * The one keyboard helper for dialogs and menus: focus moves inside when it opens, Tab stays
 * inside, Escape closes, and focus returns to whatever opened it.
 */
export function useFocusTrap(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const container = ref.current
    if (!container) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusable = () => [...container.querySelectorAll<HTMLElement>(FOCUSABLE)]
    ;(container.querySelector<HTMLElement>('[data-autofocus]') ?? focusable()[0] ?? container).focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) {
        event.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !container.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      opener?.focus()
    }
  }, [])

  return ref
}

interface DialogProps {
  title: string
  description: string
  icon: ReactNode
  tone?: 'accent' | 'warn' | 'danger' | 'sky'
  width?: number
  onClose: () => void
  children?: ReactNode
  /** Buttons, bottom right: Cancel first, then the main action. */
  actions: ReactNode
}

export function Dialog({ title, description, icon, tone = 'accent', width, onClose, children, actions }: DialogProps) {
  const ref = useFocusTrap(onClose)
  const titleId = useId()
  const descriptionId = useId()
  return (
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="dialog rise-in"
        style={width ? ({ '--dialog-width': `${width}px` } as React.CSSProperties) : undefined}
      >
        <div className="flex items-start gap-3 px-5 pt-5">
          <span className={`icon-tile round tone-${tone}`} aria-hidden="true">
            {icon}
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="m-0 text-[17px] font-semibold tracking-tight">
              {title}
            </h2>
            <p id={descriptionId} className="m-0 mt-0.5 text-sm text-muted">
              {description}
            </p>
          </div>
        </div>
        {children && <div className="min-h-0 overflow-auto px-5 pt-4">{children}</div>}
        <div className="flex justify-end gap-2 px-5 py-4">{actions}</div>
      </div>
    </div>
  )
}
