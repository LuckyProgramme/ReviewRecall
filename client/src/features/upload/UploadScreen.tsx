import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { StatusMessage } from '../../components/StatusMessage'
import type { GuestSessionController } from '../../hooks/useGuestSession'
import { ApiError, NetworkError, request, sessionGone } from '../../lib/api'
import { loadReviewerUploads } from '../../lib/reviewer'
import type { UploadedReviewer } from '../../lib/reviewer'
import { uploadPdf } from '../../lib/storage'
import { completeReviewer } from '../../lib/studyApi'

type UploadState =
  | { phase: 'idle' | 'signing' | 'uploading' | 'registering' | 'uploaded'; error?: never }
  | { phase: 'error'; error: string }
type UploadListState =
  | { phase: 'idle' | 'error'; sessionId: string | null }
  | { phase: 'ready'; sessionId: string; items: UploadedReviewer[] }
const maxSize = 10 * 1024 * 1024
const draftKey = 'reviewer_raw_text'
const maxWords = 1000
const maxCharacters = 50000
const countWords = (text: string) => text.trim().split(/\s+/u).filter(Boolean).length

function readDraft() {
  try {
    const draft = (localStorage.getItem(draftKey) || '').slice(0, maxCharacters)
    const words = [...draft.matchAll(/\S+/gu)]
    return words.length > maxWords ? draft.slice(0, words[maxWords].index).trimEnd() : draft
  } catch { return '' }
}

function PdfIcon() {
  return <svg aria-hidden="true" viewBox="0 0 32 32" className="size-8 shrink-0" fill="none">
    <path d="M8 3h11l6 6v20H8zM19 3v7h6M12 16h9M12 21h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

function fileError(files: File[]) {
  if (files.length !== 1) return 'Choose one PDF at a time.'
  const file = files[0]
  if ((file.type && !['application/pdf', 'application/octet-stream'].includes(file.type)) || !/\.pdf$/i.test(file.name))
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

export function UploadScreen({ session, onRegistered }: { session: GuestSessionController; onRegistered: (reviewerId: string) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [rawText, setRawText] = useState(readDraft)
  const wordCount = countWords(rawText)
  const [textNotice, setTextNotice] = useState<string | null>(null)
  const [cacheWarning, setCacheWarning] = useState(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const [validation, setValidation] = useState<string | null>(null)
  const [upload, setUpload] = useState<UploadState>({ phase: 'idle' })
  const [activityWarning, setActivityWarning] = useState(false)
  const [uploadList, setUploadList] = useState<UploadListState>({ phase: 'idle', sessionId: null })
  const [listRefresh, setListRefresh] = useState(0)
  const [isDragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const operation = useRef(0)
  const locked = useRef(false)
  const dragDepth = useRef(0)
  const liveSession = useRef(session)
  const pendingRegistration = useRef<{ reviewerId: string; guestId: string } | null>(null)
  const uploadIntentKey = useRef<string | null>(null)
  useEffect(() => {
    liveSession.current = session
  })
  useEffect(
    () => () => {
      operation.current++
    },
    [],
  )

  const sessionId = session.status === 'ready' ? session.session.id : null
  useEffect(() => {
    if (!sessionId) return
    let current = true
    loadReviewerUploads(sessionId)
      .then((items) => {
        if (!current) return
        setUploadList({ phase: 'ready', sessionId, items })
      })
      .catch((error) => {
        if (!current) return
        if (sessionGone(error)) {
          liveSession.current.expire()
          return
        }
        setUploadList({ phase: 'error', sessionId })
      })
    return () => { current = false }
  }, [sessionId, listRefresh])

  const busy = upload.phase === 'signing' || upload.phase === 'uploading' || upload.phase === 'registering'
  const expired = session.status === 'expired'
  const completed = upload.phase === 'uploaded' && !expired
  const uploadedReviewers = uploadList.phase === 'ready' && uploadList.sessionId === sessionId
    ? uploadList.items
    : []
  function cacheDraft(text: string) {
    try {
      if (text) localStorage.setItem(draftKey, text)
      else localStorage.removeItem(draftKey)
      setCacheWarning(false)
    } catch { setCacheWarning(true) }
  }

  function editText(value: string) {
    if (locked.current || file) return
    if (countWords(value) > maxWords || value.length > maxCharacters) {
      setTextNotice(value.length > maxCharacters ? 'Keep your reviewer within 50,000 characters.' : '1,000-word limit reached. Shorten your text before adding more.')
      return
    }
    setRawText(value)
    cacheDraft(value)
    setTextNotice(null)
    setValidation(null)
    setUpload({ phase: 'idle' })
    uploadIntentKey.current = null
  }

  function select(files: File[]) {
    if (!files.length || locked.current) return
    const error = fileError(files)
    setValidation(error)
    if (error) return
    operation.current++
    setFile(files[0])
    cacheDraft(rawText)
    pendingRegistration.current = null
    uploadIntentKey.current = window.crypto.randomUUID()
    setUpload({ phase: 'idle' })
    setActivityWarning(false)
  }

  function remove() {
    operation.current++
    locked.current = false
    setFile(null)
    pendingRegistration.current = null
    uploadIntentKey.current = null
    setUpload({ phase: 'idle' })
    setValidation(null)
    setActivityWarning(false)
    window.requestAnimationFrame(() => textarea.current?.focus())
  }

  async function submit() {
    if (
      session.status !== 'ready' ||
      locked.current ||
      completed
    )
      return
    if (!file && !rawText.trim()) {
      setValidation('Select a PDF or paste your reviewer text to continue.')
      textarea.current?.focus()
      return
    }
    setValidation(null)
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
    let uploading = false
    uploadIntentKey.current ??= window.crypto.randomUUID()
    setUpload({ phase: pendingRegistration.current?.guestId === guestId ? 'registering' : 'signing' })
    try {
      let pending = pendingRegistration.current?.guestId === guestId ? pendingRegistration.current : null
      if (!pending && !file) {
        setUpload({ phase: 'uploading' })
        const saved = await request('/api/uploads/raw', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Guest-Id': guestId },
          body: JSON.stringify({ mode: 'raw', text: rawText.trim(), idempotency_key: uploadIntentKey.current }),
        })
        if (!current()) return
        if (typeof saved.reviewer_id !== 'string') throw new Error('Invalid reviewer response')
        pending = { reviewerId: saved.reviewer_id, guestId }
      }
      if (!pending && file) {
      const signed = await request('/api/uploads/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Guest-Id': guestId },
        body: JSON.stringify({
          mode: 'pdf',
          guest_id: guestId,
          file_name: file.name,
          file_type: 'application/pdf',
          file_size: file.size,
          idempotency_key: uploadIntentKey.current,
        }),
      })
      if (!current()) return
      if (
        typeof signed.path !== 'string' ||
        typeof signed.token !== 'string' ||
        typeof signed.reviewer_id !== 'string' ||
        !signed.path.startsWith(`${guestId}/`) ||
        !signed.token
      )
        throw new Error('Invalid upload permission')
      uploading = true
      setUpload({ phase: 'uploading' })
      await uploadPdf(signed.path, signed.token, file)
      if (!current()) return
      pending = { reviewerId: signed.reviewer_id, guestId }
      pendingRegistration.current = pending
      }
      if (!pending) throw new Error('No study material selected')
      setUpload({ phase: 'registering' })
      await completeReviewer(guestId, pending.reviewerId)
      if (!current()) return
      setUpload({ phase: 'uploaded' })
      pendingRegistration.current = null
      cacheDraft('')
      setRawText('')
      onRegistered(pending.reviewerId)
      try {
        await session.recordActivity(guestId)
      } catch {
        if (current()) setActivityWarning(true)
      } finally {
        if (id === operation.current) setListRefresh((value) => value + 1)
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
        error: !file
          ? 'Could not submit your text. Your draft is preserved. Check your connection and try again.'
          : pendingRegistration.current
          ? 'The PDF uploaded, but registration did not finish. Retry to continue without uploading it again.'
          : uploading
          ? 'Storage could not finish the upload. Your file is still selected. Try again.'
          : error instanceof ApiError && error.status === 400
            ? 'This file could not be accepted. Choose a valid PDF and try again.'
            : error instanceof ApiError && error.status >= 500
              ? 'The upload service is unavailable. Your file is still selected. Try again.'
              : error instanceof NetworkError
                ? 'Could not reach the upload service. Check your connection and try again.'
                : 'Could not prepare the upload. Your file is still selected. Try again.',
      })
    } finally {
      if (id === operation.current) locked.current = false
    }
  }

  return (
    <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[27rem] flex-1 pb-10 pt-6">
      <section aria-labelledby="upload-title">
        <h1 id="upload-title" className="sr-only">Upload study reviewer</h1>
        <form onSubmit={(event) => { event.preventDefault(); void submit() }} aria-busy={busy}
          onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}
          onDrop={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault() }}
          className="rounded-2xl border border-divider bg-paper p-4 text-center shadow-upload sm:p-6">
          <div
            data-testid="drop-zone"
            data-dragging={isDragging}
            className="relative rounded-xl border border-dashed border-control bg-canvas/40 transition-colors data-[dragging=true]:border-action data-[dragging=true]:bg-action/10 motion-reduce:transition-none"
            onDragEnter={(event) => {
              event.preventDefault()
              if (!locked.current && event.dataTransfer.types.includes('Files')) {
                dragDepth.current++
                setDragging(true)
              }
            }}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = busy ? 'none' : 'copy' }}
            onDragLeave={(event) => {
              event.preventDefault()
              dragDepth.current = Math.max(0, dragDepth.current - 1)
              if (!dragDepth.current) setDragging(false)
            }}
            onDrop={(event) => {
              event.preventDefault()
              dragDepth.current = 0
              setDragging(false)
              if (!locked.current) select(Array.from(event.dataTransfer.files))
            }}
          >
            <input ref={input} id="reviewer-pdf" type="file" accept=".pdf,application/pdf"
              aria-label="Choose PDF" aria-describedby="file-hint" disabled={busy}
              className="sr-only" tabIndex={-1}
              onChange={(event) => { select(Array.from(event.target.files || [])); event.target.value = '' }} />
            {file ? <div className="flex min-h-20 items-center gap-3 px-3 py-2 text-left">
              <span className="text-action"><PdfIcon /></span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold [overflow-wrap:anywhere]">{file.name}</p>
                <p className="mt-1 text-xs text-muted">PDF · {sizeLabel(file.size)}</p>
              </div>
              <button type="button" disabled={busy} onClick={remove} className="min-h-11 shrink-0 rounded-md px-2 text-xs font-semibold text-action enabled:hover:bg-action/10 disabled:opacity-50">
                <span aria-hidden="true">✕ </span>Remove
              </button>
            </div> : <button type="button" disabled={busy} onClick={() => input.current?.click()}
              className="flex min-h-20 w-full flex-col items-center justify-center gap-1 rounded-xl px-3 py-3 text-action enabled:cursor-pointer enabled:hover:bg-action/5 disabled:opacity-50"
              aria-describedby="file-hint">
              <span className="flex items-center gap-3 text-sm font-semibold tracking-[0.1em]"><PdfIcon />{isDragging ? 'DROP PDF HERE' : 'SELECT PDF'}</span>
              <span className="text-xs text-muted">or drag and drop your PDF here</span>
            </button>}
          </div>
          <p id="file-hint" className="mt-2 text-xs text-muted">PDF only · Up to 10 MB</p>
          <div className="my-3 flex items-center gap-3 text-[0.65rem] font-medium tracking-widest text-muted" aria-hidden="true">
            <span className="h-px flex-1 bg-divider" />OR<span className="h-px flex-1 bg-divider" />
          </div>
          <div className="relative overflow-hidden rounded-xl border border-control bg-paper focus-within:border-action focus-within:ring-1 focus-within:ring-action">
            <label htmlFor="reviewer-text" className="sr-only">Reviewer text</label>
            <textarea ref={textarea} id="reviewer-text" value={rawText} disabled={!!file || busy}
              rows={3}
              onChange={(event) => editText(event.target.value)}
              placeholder="PASTE THE TEXT OF YOUR REVIEWER HERE"
              aria-describedby={`word-count${textNotice ? ' text-notice' : ''}${file ? ' pdf-priority' : ''}`}
              className="block min-h-24 w-full resize-y bg-transparent px-3 py-3 text-left text-sm leading-relaxed text-ink outline-none placeholder:text-center placeholder:text-xs placeholder:leading-6 placeholder:tracking-[0.06em] placeholder:text-muted disabled:resize-none disabled:opacity-20 focus-visible:outline-none" />
            <div className="flex items-center justify-end px-3 pb-2">
              <span id="word-count" className={`text-xs tabular-nums ${wordCount >= 900 ? 'font-semibold text-danger' : 'text-muted'}`}>
                {wordCount.toLocaleString()} / 1,000 words{wordCount >= 1000 ? ' · Limit reached' : wordCount >= 900 ? ' · Almost full' : ''}
              </span>
            </div>
            {file && <div id="pdf-priority" role="status" className="absolute inset-0 flex flex-col items-center justify-center bg-canvas/95 px-4 py-2 text-center">
              <p className="font-display text-xl">Uploaded a PDF!</p>
              <p className="mt-1 max-w-64 text-xs leading-relaxed text-muted">Remove the pdf to use text box input.</p>
              {rawText && <p className="mt-1 text-xs font-medium text-action">Your draft is kept.</p>}
            </div>}
          </div>
          {textNotice && !file && <p id="text-notice" role="status" className="mt-2 text-left text-xs text-danger">{textNotice}</p>}
          {cacheWarning && <p role="status" className="mt-2 text-left text-xs text-danger">Browser storage is unavailable. Keep this page open to preserve your draft.</p>}
          <div className="mt-3 text-left text-sm">
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
                <StatusMessage error>
                  {session.cleanup === 'pending'
                    ? 'Preparing a fresh study session…'
                    : session.cleanup === 'failed'
                      ? 'Could not reset your study session. Try again.'
                      : 'Start a new study session to continue.'}
                </StatusMessage>
                {session.cleanup === 'failed' && (
                  <Button variant="secondary" className="mt-3" onClick={session.retryCleanup}>
                    Retry cleanup
                  </Button>
                )}
                {session.cleanup === 'done' && (
                  <Button
                    variant="secondary"
                    className="mt-3"
                    onClick={() => void session.restart()}
                  >
                    Start a new session
                  </Button>
                )}
              </div>
            )}
            {!expired && upload.phase === 'signing' && <StatusMessage>Preparing your upload…</StatusMessage>}
            {!expired && upload.phase === 'uploading' && <StatusMessage>Uploading reviewer…</StatusMessage>}
            {!expired && upload.phase === 'registering' && <StatusMessage>Registering reviewer…</StatusMessage>}
            {!expired && upload.phase === 'error' && <StatusMessage error>{upload.error}</StatusMessage>}
            {completed && !uploadedReviewers.length && (
              <div>
                <p role="status" className="font-medium text-ink">Reviewer uploaded</p>
                <p className="mt-2 text-sm leading-relaxed text-muted">Your reviewer is uploaded. Preparing concepts.</p>
              </div>
            )}
            {activityWarning && !expired && (
              <StatusMessage error>Your reviewer uploaded, but we could not refresh the connection. Retry the connection before continuing.</StatusMessage>
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
          </div>
          <Button type="submit" className="mt-3 min-w-32 rounded-full px-7 text-xs tracking-[0.12em]"
            disabled={session.status !== 'ready' || busy || completed}>
            {busy ? 'UPLOADING…' : 'UPLOAD'}
          </Button>
        </form>
        {sessionId && uploadList.phase === 'error' && uploadList.sessionId === sessionId && (
          <div className="mt-5 text-center">
            <StatusMessage error>Could not load your uploaded reviewers.</StatusMessage>
            <Button
              variant="utility"
              className="mt-2"
              onClick={() => setListRefresh((value) => value + 1)}
            >
              Retry list
            </Button>
          </div>
        )}
        {uploadedReviewers.length > 0 && (
          <div className="mt-8 rounded-2xl border border-divider bg-paper p-4 shadow-upload sm:p-6">
            <h2 className="font-display text-xl text-ink">Uploaded reviewers</h2>
            <p className="mt-1 text-sm text-muted">Saved in this study session.</p>
            <ul className="mt-5 divide-y divide-divider border-t border-divider">
              {uploadedReviewers.map((reviewer) => (
                <li key={reviewer.path} className="flex items-start justify-between gap-4 py-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink [overflow-wrap:anywhere]">{reviewer.name}</p>
                    <p className="mt-1 text-xs text-muted">
                      PDF document
                      {reviewer.size !== null ? ` · ${sizeLabel(reviewer.size)}` : ''}
                      {reviewer.uploadedAt ? ` · ${new Date(reviewer.uploadedAt).toLocaleString()}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-canvas px-3 py-1 text-xs font-medium text-action">Uploaded</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <figure className="mx-auto mt-8 max-w-sm px-3 text-center text-muted sm:mt-10">
        <div aria-hidden="true" className="mx-auto mb-5 h-px w-10 bg-divider" />
        <blockquote className="font-display text-lg italic leading-relaxed">
          “The first principle is that you must not fool yourself—and you are the easiest person to fool.”
        </blockquote>
        <figcaption className="mt-3 text-[0.65rem] font-medium tracking-[0.24em] uppercase">
          — Richard Feynman
        </figcaption>
      </figure>
    </main>
  )
}
