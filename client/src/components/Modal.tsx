import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function Modal({ titleId, onClose, children, dismissible = true }: {
  titleId: string; onClose: () => void; children: ReactNode; dismissible?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const pointerOutside = useRef(false)
  useEffect(() => {
    const element = dialog.current!
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    element.showModal()
    return () => {
      element.close()
      document.body.style.overflow = overflow
      if (previous?.isConnected) previous.focus()
    }
  }, [])
  return createPortal(<dialog ref={dialog} aria-labelledby={titleId}
    className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-[29rem] overflow-y-auto rounded-2xl border border-divider bg-paper p-0 text-ink shadow-upload backdrop:bg-ink/35 backdrop:backdrop-blur-sm"
    onCancel={(event) => { event.preventDefault(); if (dismissible) onClose() }}
    onKeyDown={(event) => {
      if (event.key !== 'Tab') return
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
      const first = controls[0]
      const last = controls.at(-1)
      if (!first) { event.preventDefault(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
        event.preventDefault(); last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus()
      }
    }}
    onPointerDown={(event) => { pointerOutside.current = event.target === event.currentTarget && outside(event.clientX, event.clientY, event.currentTarget) }}
    onClick={(event) => {
      if (dismissible && pointerOutside.current && event.target === event.currentTarget && outside(event.clientX, event.clientY, event.currentTarget)) onClose()
      pointerOutside.current = false
    }}>
    <div className="relative px-5 pb-6 pt-12 sm:px-8 sm:pb-8">
      <button type="button" aria-label="Close modal" disabled={!dismissible} onClick={onClose}
        className="absolute right-2 top-2 flex size-10 items-center justify-center rounded-full text-muted enabled:hover:bg-canvas enabled:hover:text-ink disabled:opacity-40">
        <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5" fill="none"><path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </button>
      {children}
    </div>
  </dialog>, document.body)
}

function outside(x: number, y: number, element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom
}
