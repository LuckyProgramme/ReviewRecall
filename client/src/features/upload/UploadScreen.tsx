import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { StatusMessage } from '../../components/StatusMessage'
import { useGuestSession } from '../../hooks/useGuestSession'
import { ApiError, request, sessionGone } from '../../lib/api'
import { uploadPdf } from '../../lib/storage'

type UploadState =
  | { phase: 'idle' | 'signing' | 'uploading' | 'uploaded'; error?: never }
  | { phase: 'error'; error: string }
const maxSize = 10 * 1024 * 1024

function fileError(files: File[]) {
  if (files.length !== 1) return 'Choose one PDF at a time.'
  const file = files[0]
  if (file.type !== 'application/pdf' || !/\.pdf$/i.test(file.name))
    return 'Choose a PDF file. Other file types are not supported.'
  if (file.size === 0) return 'This PDF is empty. Choose a file with content.'
  if (file.size > maxSize)
    return 'This PDF exceeds 10 MB. Choose a smaller file.'
  return null
}

function sizeLabel(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function UploadScreen() {
  const session = useGuestSession()
  const [file, setFile] = useState<File | null>(null)
  const [validation, setValidation] = useState<string | null>(null)
  const [upload, setUpload] = useState<UploadState>({ phase: 'idle' })
  const [activityWarning, setActivityWarning] = useState(false)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const operation = useRef(0)
  const locked = useRef(false)
  const dragDepth = useRef(0)
  const liveSession = useRef(session)
  useEffect(() => {
    liveSession.current = session
  })
  useEffect(
    () => () => {
      operation.current++
    },
    [],
  )

  const busy = upload.phase === 'signing' || upload.phase === 'uploading'
  const expired = session.status === 'expired'
  const completed = upload.phase === 'uploaded' && !expired
  const pickerStyle =
    busy && !expired
      ? 'border-divider bg-divider text-muted'
      : file
        ? 'cursor-pointer border-control bg-paper text-ink hover:bg-canvas'
        : 'cursor-pointer border-action bg-action text-paper hover:border-action-hover hover:bg-action-hover'

  function select(files: File[]) {
    if (!files.length || locked.current) return
    const error = fileError(files)
    setValidation(error)
    if (error) return
    operation.current++
    setFile(files[0])
    setUpload({ phase: 'idle' })
    setActivityWarning(false)
  }

  function remove() {
    operation.current++
    locked.current = false
    setFile(null)
    setUpload({ phase: 'idle' })
    setValidation(null)
    setActivityWarning(false)
    input.current?.focus()
  }

  async function submit() {
    if (
      !file ||
      session.status !== 'ready' ||
      locked.current ||
      validation ||
      completed
    )
      return
    if (Date.now() >= session.session.expiresAt) {
      session.expire()
      return
    }
    locked.current = true
    const id = ++operation.current
    const guestId = session.session.id
    const current = () =>
      id === operation.current &&
      liveSession.current.status === 'ready' &&
      liveSession.current.session?.id === guestId &&
      liveSession.current.session.expiresAt > Date.now()
    setUpload({ phase: 'signing' })
    try {
      const signed = await request('/api/uploads/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guest_id: guestId,
          file_name: file.name,
          file_type: file.type,
          file_size: file.size,
        }),
      })
      if (!current()) return
      if (
        typeof signed.path !== 'string' ||
        typeof signed.token !== 'string' ||
        !signed.path.startsWith(`${guestId}/`) ||
        !signed.token
      )
        throw new Error('Invalid upload permission')
      setUpload({ phase: 'uploading' })
      await uploadPdf(signed.path, signed.token, file)
      if (!current()) return
      setUpload({ phase: 'uploaded' })
      try {
        await session.recordActivity(guestId)
      } catch {
        if (current()) setActivityWarning(true)
      }
    } catch (error) {
      if (!current()) return
      if (sessionGone(error)) {
        session.expire()
        setUpload({ phase: 'idle' })
        return
      }
      setUpload({
        phase: 'error',
        error:
          error instanceof ApiError && error.status === 400
            ? 'This file could not be accepted. Choose a valid PDF and try again.'
            : 'Upload did not finish. Your file is still selected. Try again.',
      })
    } finally {
      if (id === operation.current) locked.current = false
    }
  }

  return (
    <main id="main" className="mx-auto w-full max-w-upload flex-1 pb-14 pt-9 sm:pt-10">
      <section aria-labelledby="upload-title">
        <div
          data-testid="drop-zone"
          data-dragging={dragging}
          className="relative rounded-2xl border border-divider bg-paper px-5 py-10 text-center shadow-upload transition-colors focus-within:border-action focus-within:outline-2 focus-within:outline-offset-3 focus-within:outline-action data-[dragging=true]:border-action data-[dragging=true]:bg-canvas data-[dragging=true]:outline-2 data-[dragging=true]:outline-action sm:px-12 sm:py-12 motion-reduce:transition-none"
          onDragEnter={(event) => {
            event.preventDefault()
            if (!locked.current) {
              dragDepth.current++
              setDragging(true)
            }
          }}
          onDragOver={(event) => {
            event.preventDefault()
            event.dataTransfer.dropEffect = busy ? 'none' : 'copy'
          }}
          onDragLeave={(event) => {
            event.preventDefault()
            dragDepth.current = Math.max(0, dragDepth.current - 1)
            if (!dragDepth.current) setDragging(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            dragDepth.current = 0
            setDragging(false)
            if (!busy) select(Array.from(event.dataTransfer.files))
          }}
        >
          <div className="relative mx-auto flex size-16 items-center justify-center rounded-2xl border border-divider bg-canvas text-action">
            <svg aria-hidden="true" viewBox="0 0 32 32" className="size-8" fill="none">
              <path
                d="M8.5 4.5h10l5 5v18h-15v-23Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path
                d="M18.5 4.5v5h5M16 22V12m0 0-3.5 3.5M16 12l3.5 3.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="absolute -bottom-1.5 -right-1.5 flex size-6 items-center justify-center rounded-full border-2 border-paper bg-action text-base leading-none text-paper" aria-hidden="true">
              +
            </span>
          </div>
          <h1 id="upload-title" className="mt-7 font-display text-3xl font-medium leading-tight sm:text-[2rem]">
            {dragging ? 'Drop your PDF here' : 'Upload study reviewer'}
          </h1>
          <p id="file-hint" className="mt-2 text-sm text-muted">
            PDF only · Up to 10 MB
          </p>
          <div className="mt-6 flex justify-center">
            <label
              className={`relative inline-flex min-h-11 items-center justify-center rounded-full border px-8 py-3 text-xs font-semibold tracking-[0.12em] uppercase shadow-sm transition-colors motion-reduce:transition-none ${pickerStyle}`}
            >
              {file ? 'Select another' : 'Select PDF'}
              <input
                ref={input}
                type="file"
                accept=".pdf,application/pdf"
                aria-label="Choose PDF"
                aria-describedby={`file-hint${validation ? ' file-error' : ''}`}
                aria-invalid={!!validation}
                disabled={busy && !expired}
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                onChange={(event) => {
                  select(Array.from(event.target.files || []))
                  event.target.value = ''
                }}
              />
            </label>
          </div>
          <p className="mt-6 flex items-center justify-center gap-2 text-xs leading-relaxed text-muted/70">
            <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="none">
              <path d="M8 1v14M1 8h14M8 1 6 3m2-2 2 2M8 15l-2-2m2 2 2-2M1 8l2-2M1 8l2 2m12-2-2-2m2 2-2 2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            or drag and drop your reviewer here
          </p>

          {file && (
            <div className="mt-8 border-t border-divider pt-5 text-left">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium [overflow-wrap:anywhere]">
                    {file.name}
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {sizeLabel(file.size)} · {completed ? 'Uploaded' : 'PDF document'}
                  </p>
                </div>
                <Button
                  variant="utility"
                  className="min-h-8 shrink-0 px-0 py-1 text-sm"
                  disabled={busy && !expired}
                  onClick={remove}
                >
                  {completed ? 'Change reviewer' : 'Remove'}
                </Button>
              </div>
            </div>
          )}

          <div className={`mt-5 min-h-6 text-left ${!file && session.status === 'ready' && !validation ? 'sr-only' : ''}`}>
            {validation && <StatusMessage id="file-error" error>{validation}</StatusMessage>}
            {session.status === 'loading' && <StatusMessage>Preparing your study session…</StatusMessage>}
            {session.status === 'error' && (
              <div className="flex flex-wrap items-center gap-x-3">
                <StatusMessage error>Could not connect to your study session.</StatusMessage>
                <Button variant="utility" className="min-h-8 px-0 py-1 text-sm" onClick={session.retry}>
                  Retry connection
                </Button>
              </div>
            )}
            {expired && (
              <div>
                <StatusMessage error>Your study session has expired. Start a new session to upload a reviewer.</StatusMessage>
                <Button
                  variant="secondary"
                  className="mt-3"
                  onClick={() => {
                    remove()
                    void session.restart()
                  }}
                >
                  Start a new session
                </Button>
              </div>
            )}
            {!expired && upload.phase === 'signing' && <StatusMessage>Preparing your upload…</StatusMessage>}
            {!expired && upload.phase === 'uploading' && <StatusMessage>Uploading reviewer…</StatusMessage>}
            {!expired && upload.phase === 'error' && <StatusMessage error>{upload.error}</StatusMessage>}
            {completed && (
              <div>
                <p role="status" className="font-medium text-ink">Reviewer uploaded</p>
                <p className="mt-2 text-sm leading-relaxed text-muted">Your PDF is uploaded. Concept selection is not available yet.</p>
              </div>
            )}
            {activityWarning && !expired && (
              <StatusMessage error>Your PDF uploaded, but we could not extend the session. Retry the connection before continuing.</StatusMessage>
            )}
            {activityWarning && !expired && (
              <Button
                variant="utility"
                className="min-h-8 px-0 py-1 text-sm"
                onClick={async () => {
                  if (session.status === 'ready') {
                    try {
                      await session.recordActivity(session.session.id)
                      setActivityWarning(false)
                    } catch {
                      /* Keep the retry available. */
                    }
                  }
                }}
              >
                Retry connection
              </Button>
            )}
            {session.status === 'ready' && upload.phase === 'idle' && !validation && (
              <p className="text-sm text-muted">{file ? 'Ready when you are.' : 'Choose a file to begin.'}</p>
            )}
          </div>

          {!completed && !expired && (
            <Button
              className={file ? 'mt-4 w-full rounded-full sm:w-auto' : 'sr-only'}
              disabled={!file || !!validation || session.status !== 'ready' || busy}
              onClick={() => void submit()}
            >
              {busy && (
                <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" />
              )}
              {busy ? 'Uploading reviewer…' : upload.phase === 'error' ? 'Try upload again' : 'Use this reviewer'}
            </Button>
          )}
        </div>
      </section>

      <figure className="mx-auto mt-12 max-w-md text-center text-muted sm:mt-14">
        <div aria-hidden="true" className="mx-auto mb-5 h-px w-10 bg-divider" />
        <blockquote className="font-display text-lg italic leading-relaxed">
          “The first principle is that you must not fool yourself—and you are the easiest person to fool.”
        </blockquote>
        <figcaption className="mt-3 text-[0.65rem] font-medium tracking-[0.24em] uppercase">
          Richard Feynman
        </figcaption>
      </figure>
    </main>
  )
}
