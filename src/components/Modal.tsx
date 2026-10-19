import { useEffect, useState, type ReactNode } from 'react'

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger = true,
  requireText,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  requireText?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const [typed, setTyped] = useState('')
  const allowed = !requireText || typed.trim().toLowerCase() === requireText.toLowerCase()

  return (
    <Modal title={title} onClose={onCancel}>
      <p>{body}</p>
      {requireText && (
        <label>
          Type “{requireText}” to continue
          <input value={typed} onChange={(event) => setTyped(event.target.value)} autoFocus autoComplete="off" />
        </label>
      )}
      <div className="button-row">
        <button
          className={danger ? 'btn danger solid' : 'btn primary'}
          type="button"
          disabled={!allowed || busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
        <button className="btn" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  )
}
