import { useEffect, useRef, useState } from 'react'
import { Button } from './components/Button'
import { StudyHeader } from './components/StudyHeader'
import { ConceptScreen, TopicChoice } from './features/concepts/TopicScreen'
import { FeedbackScreen } from './features/feedback/FeedbackScreen'
import { FinalReviewScreen } from './features/feedback/FinalReviewScreen'
import { RecallScreen } from './features/recall/RecallScreen'
import { UploadScreen } from './features/upload/UploadScreen'
import { useGuestSession } from './hooks/useGuestSession'
import type { Clip } from './hooks/useRecallRecorder'
import { ApiError, sessionGone } from './lib/api'
import { uploadAudio } from './lib/storage'
import { currentRunPhase, isCurrentGeneration } from './lib/studyFlow'
import { advanceRun, cancelAttempt, completeAttempt, completeReviewer, getAttempt, getRun, getSummary, listReviewers, listTopics, reviewerStatus, signAttempt, skipItem, startRun } from './lib/studyApi'
import type { Attempt, ReviewerStatus, RunSummary, StudyRun, Topic } from './types/study'

type Context = { reviewerId: string; topics: Topic[] }
type Active = Context & { topic: Topic; run: StudyRun }
type View =
  | { phase: 'loading' | 'upload' }
  | { phase: 'processing'; reviewerId: string; status: ReviewerStatus; errorCode?: string; retryable?: boolean; networkIssue?: boolean }
  | { phase: 'topics'; context: Context }
  | { phase: 'concept' | 'feedback'; active: Active; attempt?: Attempt }
  | { phase: 'record'; active: Active; revision: number; busy: boolean; notice?: string; attemptId?: string }
  | { phase: 'summary'; active: Active; summary: RunSummary }
  | { phase: 'error'; message: string; retry: () => void }

type Saved = { reviewerId: string; topicId?: string }
const storageKey = (guestId: string) => `review_recall_work_${guestId}`
function readSaved(guestId: string): Saved | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey(guestId)) || 'null') as Saved | null
    return value && typeof value.reviewerId === 'string' ? value : null
  } catch { return null }
}
function save(guestId: string, value: Saved) {
  try { localStorage.setItem(storageKey(guestId), JSON.stringify(value)) } catch { /* In-memory flow remains usable. */ }
}
function failureMessage(code?: string) {
  if (code === 'NO_EXTRACTABLE_TEXT') return 'This PDF has no readable text. Images can be included, but this version reads text only. Try a PDF with selectable text.'
  if (code === 'INVALID_PDF') return 'The PDF could not be read. Use different study material and try again.'
  if (code === 'MODEL_QUOTA_EXCEEDED') return 'The AI processing limit for this project has been reached. Try again after the quota resets or after billing is enabled.'
  if (code === 'MODEL_RATE_LIMITED') return 'AI processing is receiving too many requests. Wait briefly, then try again.'
  if (code === 'MODEL_UNAVAILABLE') return 'AI processing is temporarily unavailable. Please try again shortly.'
  return 'We could not prepare this reviewer. Please try different study material.'
}
const retryableReviewerCodes = new Set(['MODEL_QUOTA_EXCEEDED', 'MODEL_RATE_LIMITED', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT', 'MODEL_OUTPUT_INVALID'])
const retryableAttemptCodes = new Set(['MODEL_QUOTA_EXCEEDED', 'MODEL_RATE_LIMITED', 'MODEL_UNAVAILABLE', 'MODEL_TIMEOUT', 'MODEL_OUTPUT_INVALID', 'MODEL_NOT_CONFIGURED', 'PROCESSING_FAILED', 'AUDIO_DOWNLOAD_FAILED'])
function attemptFailureMessage(code?: string) {
  if (code === 'MODEL_QUOTA_EXCEEDED') return 'The AI processing limit has been reached. Keep this recording and retry after the project quota resets.'
  if (code === 'MODEL_RATE_LIMITED' || code === 'MODEL_UNAVAILABLE') return 'AI processing is temporarily busy. Keep this recording and retry submitting it shortly.'
  return 'Audio processing failed. Keep this recording and retry, or record again.'
}

export default function App() {
  const session = useGuestSession()
  const [view, setView] = useState<View>({ phase: 'loading' })
  const [viewOwner, setViewOwner] = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const generation = useRef(0)
  const uploadAttempt = useRef<{ attemptId: string; path: string; token: string; uploaded: boolean; itemId: string } | null>(null)
  const guestId = session.status === 'ready' ? session.session.id : null

  useEffect(() => {
    if (!guestId) { generation.current++; return }
    const token = ++generation.current
    let cancelled = false
    const live = () => !cancelled && isCurrentGeneration(generation.current, token)
    async function restore() {
      try {
        const reviewers = await listReviewers(guestId!)
        if (!live()) return
        setViewOwner(guestId!)
        const saved = readSaved(guestId!)
        const reviewer = reviewers.find((row) => row.reviewer_id === saved?.reviewerId) ?? reviewers[0]
        if (!reviewer) { setView({ phase: 'upload' }); return }
        save(guestId!, { reviewerId: reviewer.reviewer_id, topicId: reviewer.reviewer_id === saved?.reviewerId ? saved?.topicId : undefined })
        if (reviewer.status !== 'ready') { setView({ phase: 'processing', reviewerId: reviewer.reviewer_id, status: reviewer.status, errorCode: reviewer.error_code, retryable: reviewer.retryable }); return }
        const topics = await listTopics(guestId!, reviewer.reviewer_id)
        if (!live()) return
        if (!topics.length) { setView({ phase: 'processing', reviewerId: reviewer.reviewer_id, status: 'failed', errorCode: 'NO_SUPPORTED_CONCEPTS' }); return }
        const context = { reviewerId: reviewer.reviewer_id, topics }
        const topic = topics.find((value) => value.topic_id === saved?.topicId)
        if (!topic) { setView({ phase: 'topics', context }); return }
        let run = await startRun(guestId!, topic.topic_id)
        if (!live()) return
        if (run.status === 'completed') { const active = { ...context, topic, run }; const summary = await getSummary(guestId!, run.run_id); if (live()) setView({ phase: 'summary', active, summary }); return }
        let item = run.items.find((value) => value.item_id === run.current_item_id)
        if (item?.pending_attempt_id && item.pending_attempt_status === 'awaiting_upload') {
          // A completed Storage upload may have lost its API response before reload.
          // Preserve it when verification succeeds; otherwise release the intent.
          try { await completeAttempt(guestId!, item.pending_attempt_id) }
          catch (error) {
            if (!(error instanceof ApiError) || ![400, 409].includes(error.status)) throw error
            await cancelAttempt(guestId!, item.pending_attempt_id)
          }
          run = await getRun(guestId!, run.run_id)
          if (!live()) return
          item = run.items.find((value) => value.item_id === run.current_item_id)
        }
        const active = { ...context, topic, run }
        if (item?.pending_attempt_id) { setView({ phase: 'record', active, revision: 0, busy: true, attemptId: item.pending_attempt_id, notice: 'Your explanation is being processed…' }); return }
        setView({ phase: currentRunPhase(run) === 'feedback' ? 'feedback' : 'concept', active })
      } catch (error) {
        if (!live()) return
        if (sessionGone(error)) { session.expire(); return }
        setViewOwner(guestId!)
        setView({ phase: 'error', message: 'Could not restore your reviewer. Check your connection and retry.', retry: () => void restore() })
      }
    }
    void restore()
    return () => { cancelled = true; if (isCurrentGeneration(generation.current, token)) generation.current = token + 1 }
  // A changed expiration timestamp does not restart reviewer restoration.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestId])

  useEffect(() => {
    if (!guestId || viewOwner !== guestId || view.phase !== 'processing' || view.status === 'ready' || view.status === 'failed' || view.status === 'awaiting_upload') return
    let cancelled = false
    let timeout: number | undefined
    let tries = 0
    const poll = async () => {
      try {
        const status = await reviewerStatus(guestId, view.reviewerId)
        if (cancelled) return
        if (status.status === 'ready') {
          const topics = await listTopics(guestId, view.reviewerId)
          if (cancelled) return
          setView(topics.length ? { phase: 'topics', context: { reviewerId: view.reviewerId, topics } } : { phase: 'processing', reviewerId: view.reviewerId, status: 'failed', errorCode: 'NO_SUPPORTED_CONCEPTS' })
          return
        }
        if (status.status === 'failed') { setView({ phase: 'processing', reviewerId: view.reviewerId, status: 'failed', errorCode: status.error_code, retryable: status.retryable }); return }
        setView((current) => current.phase === 'processing' && current.reviewerId === view.reviewerId ? { ...current, status: status.status, networkIssue: false } : current)
      } catch (error) {
        if (cancelled) return
        if (sessionGone(error)) { session.expire(); return }
        setView((current) => current.phase === 'processing' && current.reviewerId === view.reviewerId ? { ...current, networkIssue: true } : current)
      }
      timeout = window.setTimeout(poll, Math.min(8000, 1200 * 2 ** Math.min(tries++, 3)))
    }
    timeout = window.setTimeout(poll, 800)
    return () => { cancelled = true; window.clearTimeout(timeout) }
  // Poll lifecycle changes only with the reviewer and terminal state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestId, viewOwner, view.phase, view.phase === 'processing' ? view.reviewerId : '', view.phase === 'processing' && (view.status === 'failed' || view.status === 'ready' || view.status === 'awaiting_upload')])

  useEffect(() => {
    if (!guestId || viewOwner !== guestId || view.phase !== 'record' || !view.attemptId) return
    const attemptId = view.attemptId
    let cancelled = false
    let timeout: number | undefined
    let tries = 0
    const poll = async () => {
      try {
        const attempt = await getAttempt(guestId, attemptId)
        if (cancelled) return
        if (attempt.status === 'completed') {
          const run = await getRun(guestId, view.active.run.run_id)
          if (cancelled) return
          uploadAttempt.current = null
          setView({ phase: 'feedback', active: { ...view.active, run }, attempt })
          return
        }
        if (attempt.status === 'unclear') {
          uploadAttempt.current = null
          setView({ phase: 'record', active: view.active, revision: view.revision + 1, busy: false, notice: 'Speech was detected, but the audio was too unclear to evaluate. Please record again.' })
          return
        }
        if (attempt.status === 'cancelled') {
          uploadAttempt.current = null
          setView({ phase: 'record', active: view.active, revision: view.revision + 1, busy: false, notice: 'The unfinished upload was canceled. Record again when ready.' })
          return
        }
        if (attempt.status === 'failed') {
          if (attempt.retryable === false || !retryableAttemptCodes.has(attempt.error_code || '')) uploadAttempt.current = null
          setView((current) => current.phase === 'record' && current.attemptId === attemptId ? { ...current, busy: false, attemptId: undefined, notice: attemptFailureMessage(attempt.error_code) } : current)
          return
        }
        const label = attempt.status === 'evaluating' ? 'Comparing your explanation…' : attempt.status === 'transcribing' ? 'Transcribing your explanation…' : 'Preparing audio feedback…'
        setView((current) => current.phase === 'record' && current.attemptId === attemptId ? { ...current, notice: label } : current)
      } catch (error) {
        if (cancelled) return
        if (sessionGone(error)) { session.expire(); return }
        setView((current) => current.phase === 'record' && current.attemptId === attemptId ? { ...current, notice: 'Could not check feedback. Retrying connection…' } : current)
      }
      timeout = window.setTimeout(poll, Math.min(8000, 1200 * 2 ** Math.min(tries++, 3)))
    }
    timeout = window.setTimeout(poll, 700)
    return () => { cancelled = true; window.clearTimeout(timeout) }
  // Attempt status updates do not replace the poller for the same attempt.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guestId, viewOwner, view.phase, view.phase === 'record' ? view.attemptId : ''])

  function handleError(error: unknown, message: string, retry: () => void) {
    if (sessionGone(error)) { session.expire(); return }
    setView({ phase: 'error', message, retry })
  }
  function refreshActivity(owner: string) {
    // These server actions already saved the student's progress and touched the guest.
    // A failed follow-up refresh must not turn a successful action into a retry.
    void session.recordActivity(owner).catch(() => { /* The next meaningful action retries the refresh. */ })
  }
  async function retryReviewer(reviewerId: string) {
    if (!guestId || actionBusy) return
    const token = generation.current
    setActionBusy(true)
    try {
      const reviewer = await completeReviewer(guestId, reviewerId)
      if (isCurrentGeneration(generation.current, token)) {
        refreshActivity(guestId)
        setView({ phase: 'processing', reviewerId, status: reviewer.status, errorCode: reviewer.error_code, retryable: reviewer.retryable })
      }
    } catch (error) {
      if (isCurrentGeneration(generation.current, token)) handleError(error, 'Could not retry AI processing. Check your connection and try again.', () => void retryReviewer(reviewerId))
    } finally { setActionBusy(false) }
  }
  async function choose(topicId: string, context: Context) {
    if (!guestId || actionBusy) return
    const token = generation.current
    const topic = context.topics.find((value) => value.topic_id === topicId)
    if (!topic) return
    setActionBusy(true)
    try {
      let run = await startRun(guestId, topicId)
      if (!isCurrentGeneration(generation.current, token)) return
      save(guestId, { reviewerId: context.reviewerId, topicId })
      refreshActivity(guestId)
      if (run.status === 'completed') { const active = { ...context, topic, run }; const summary = await getSummary(guestId, run.run_id); if (isCurrentGeneration(generation.current, token)) setView({ phase: 'summary', active, summary }); return }
      let item = run.items.find((value) => value.item_id === run.current_item_id)
      if (item?.pending_attempt_id && item.pending_attempt_status === 'awaiting_upload') {
        try { await completeAttempt(guestId, item.pending_attempt_id) }
        catch (error) {
          if (!(error instanceof ApiError) || ![400, 409].includes(error.status)) throw error
          await cancelAttempt(guestId, item.pending_attempt_id)
        }
        run = await getRun(guestId, run.run_id)
        if (!isCurrentGeneration(generation.current, token)) return
        item = run.items.find((value) => value.item_id === run.current_item_id)
      }
      const active = { ...context, topic, run }
      if (item?.pending_attempt_id) setView({ phase: 'record', active, revision: 0, busy: true, attemptId: item.pending_attempt_id, notice: 'Your explanation is being processed…' })
      else setView({ phase: currentRunPhase(run) === 'feedback' ? 'feedback' : 'concept', active })
    } catch (error) { if (isCurrentGeneration(generation.current, token)) handleError(error, 'Could not open this topic. Try again.', () => void choose(topicId, context)) }
    finally { setActionBusy(false) }
  }
  async function skip(active: Active) {
    if (!guestId || !active.run.current_item_id || actionBusy) return
    const token = generation.current
    setActionBusy(true)
    try {
      const run = await skipItem(guestId, active.run.run_id, active.run.current_item_id)
      if (isCurrentGeneration(generation.current, token)) { refreshActivity(guestId); setView({ phase: 'feedback', active: { ...active, run } }) }
    } catch (error) { if (isCurrentGeneration(generation.current, token)) handleError(error, 'Could not save the skip. Try again.', () => void skip(active)) }
    finally { setActionBusy(false) }
  }
  async function next(active: Active) {
    if (!guestId || !active.run.current_item_id || actionBusy) return
    const token = generation.current
    setActionBusy(true)
    try {
      const run = await advanceRun(guestId, active.run.run_id, active.run.current_item_id)
      if (!isCurrentGeneration(generation.current, token)) return
      refreshActivity(guestId)
      const updated = { ...active, run }
      if (run.status === 'completed') { const summary = await getSummary(guestId, run.run_id); if (isCurrentGeneration(generation.current, token)) setView({ phase: 'summary', active: updated, summary }) }
      else setView({ phase: currentRunPhase(run) === 'feedback' ? 'feedback' : 'concept', active: updated })
    } catch (error) { if (isCurrentGeneration(generation.current, token)) handleError(error, 'Could not advance the concept queue. Try again.', () => void next(active)) }
    finally { setActionBusy(false) }
  }
  async function submit(clip: Clip, current: Extract<View, { phase: 'record' }>) {
    if (!guestId || !current.active.run.current_item_id || current.busy) return
    if (clip.seconds > 60.5) { setView({ ...current, notice: 'This recording exceeded one minute after the tab was paused. Record again.' }); return }
    if (clip.blob.size > 12 * 1024 * 1024) { setView({ ...current, notice: 'This recording is too large. Record again.' }); return }
    const itemId = current.active.run.current_item_id
    const token = generation.current
    setView({ ...current, busy: true, notice: 'Uploading your explanation…' })
    try {
      let pending = uploadAttempt.current?.itemId === itemId ? uploadAttempt.current : null
      if (!pending) {
        const signed = await signAttempt(guestId, current.active.run.run_id, itemId, clip.blob.type, clip.blob.size, clip.seconds)
        if (!isCurrentGeneration(generation.current, token)) return
        pending = { attemptId: signed.attempt_id, path: signed.path, token: signed.token, uploaded: false, itemId }
        uploadAttempt.current = pending
      } else if (!pending.uploaded) {
        try { await completeAttempt(guestId, pending.attemptId); pending.uploaded = true }
        catch {
          const signed = await signAttempt(guestId, current.active.run.run_id, itemId, clip.blob.type, clip.blob.size, clip.seconds, pending.attemptId)
          pending.path = signed.path
          pending.token = signed.token
        }
      }
      if (!pending.uploaded) {
        try { await uploadAudio(pending.path, pending.token, clip.blob) }
        catch (uploadError) {
          // The storage reply may be lost after a successful upload. Verification is authoritative.
          try { await completeAttempt(guestId, pending.attemptId); pending.uploaded = true }
          catch { throw uploadError }
        }
        if (!isCurrentGeneration(generation.current, token)) return
        pending.uploaded = true
      }
      await completeAttempt(guestId, pending.attemptId)
      if (!isCurrentGeneration(generation.current, token)) return
      refreshActivity(guestId)
      setView({ ...current, busy: true, notice: 'Transcribing your explanation…', attemptId: pending.attemptId })
    } catch (error) {
      if (!isCurrentGeneration(generation.current, token)) return
      if (sessionGone(error)) { session.expire(); return }
      setView({ ...current, busy: false, notice: error instanceof Error ? error.message : 'Could not submit the recording. Please retry.' })
    }
  }
  async function abandonRecording(current: Extract<View, { phase: 'record' }>): Promise<boolean> {
    const pending = uploadAttempt.current
    if (!pending) { setView({ ...current, notice: undefined }); return true }
    if (!guestId) return false
    const token = generation.current
    setView({ ...current, busy: true, notice: 'Canceling unfinished audio upload…' })
    try {
      const attempt = await cancelAttempt(guestId, pending.attemptId)
      if (!isCurrentGeneration(generation.current, token)) return false
      if (attempt.status !== 'cancelled') throw new Error('The audio attempt could not be canceled.')
      uploadAttempt.current = null
      setView({ ...current, busy: false, notice: undefined })
      return true
    } catch (error) {
      if (!isCurrentGeneration(generation.current, token)) return false
      if (sessionGone(error)) { session.expire(); return false }
      if (error instanceof ApiError && error.status === 409) {
        try {
          const attempt = await getAttempt(guestId, pending.attemptId)
          if (!isCurrentGeneration(generation.current, token)) return false
          if (attempt.status === 'cancelled' || attempt.status === 'failed' || attempt.status === 'unclear') {
            uploadAttempt.current = null
            setView({ ...current, busy: false, notice: undefined })
            return true
          }
          if (attempt.status !== 'awaiting_upload') {
            setView({ ...current, busy: true, attemptId: pending.attemptId, notice: 'Your explanation was submitted. Waiting for feedback…' })
            return false
          }
        } catch (statusError) {
          if (sessionGone(statusError)) { session.expire(); return false }
        }
      }
      setView({ ...current, busy: false, notice: 'Could not cancel the unfinished upload. Check your connection and try again.' })
      return false
    }
  }

  const active = 'active' in view ? view.active : null
  const item = active?.run.items.find((value) => value.item_id === active.run.current_item_id)
  const focusKey = `${guestId ?? 'none'}:${viewOwner ?? 'none'}:${view.phase}:${item?.item_id ?? ''}`
  const previousFocusKey = useRef(focusKey)
  useEffect(() => {
    if (previousFocusKey.current === focusKey) return
    previousFocusKey.current = focusKey
    const frame = window.requestAnimationFrame(() => document.querySelector<HTMLElement>('main#main')?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [focusKey])
  return <div className="flex min-h-dvh flex-col bg-study-glow px-4 sm:px-6">
    <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:z-10 focus:rounded-lg focus:bg-paper focus:p-3">Skip to content</a>
    <StudyHeader current={view.phase === 'topics' || view.phase === 'concept' ? 1 : view.phase === 'record' || view.phase === 'feedback' || view.phase === 'summary' ? 2 : 0} />
    {session.status !== 'ready' ? <UploadScreen key="session" session={session} onRegistered={() => {}} /> : viewOwner !== session.session.id ? <main id="main" tabIndex={-1} className="mx-auto w-full max-w-task flex-1 py-12" role="status">Restoring your study session…</main> : <>
      {view.phase === 'loading' && <main id="main" tabIndex={-1} className="mx-auto w-full max-w-task flex-1 py-12" role="status">Restoring your study session…</main>}
      {view.phase === 'upload' && <UploadScreen key={session.session.id} session={session} onRegistered={(reviewerId) => { save(session.session.id, { reviewerId }); setView({ phase: 'processing', reviewerId, status: 'queued' }) }} />}
      {view.phase === 'processing' && <main id="main" tabIndex={-1} className="mx-auto w-full max-w-task flex-1 py-10"><h1 className="font-display text-4xl">Preparing your reviewer</h1><div className="mt-8 rounded-2xl border border-divider bg-paper p-6 shadow-upload" role="status"><p>{view.status === 'extracting' ? 'Reading your study material…' : view.status === 'generating' ? 'Preparing source-backed concepts…' : view.status === 'failed' ? failureMessage(view.errorCode) : view.status === 'awaiting_upload' ? 'The PDF upload was not completed.' : 'Waiting to read your study material…'}</p>{view.networkIssue && view.status !== 'failed' && <p className="mt-3 text-sm text-danger">Connection interrupted. Your reviewer is still saved, and we are retrying the status check.</p>}{view.status === 'failed' && view.retryable !== false && retryableReviewerCodes.has(view.errorCode || '') && <Button className="mt-5" disabled={actionBusy} onClick={() => void retryReviewer(view.reviewerId)}>Retry processing</Button>}{(view.status === 'failed' || view.status === 'awaiting_upload') && <Button className="mt-5 ml-3" onClick={() => setView({ phase: 'upload' })}>Use different study material</Button>}</div></main>}
      {view.phase === 'topics' && <TopicChoice topics={view.context.topics} busy={actionBusy} onChoose={(id) => void choose(id, view.context)} />}
      {view.phase === 'concept' && <ConceptScreen key={item?.item_id} guestId={session.session.id} reviewerId={view.active.reviewerId} topic={view.active.topic} run={view.active.run} busy={actionBusy} onExplain={() => { uploadAttempt.current = null; setView({ phase: 'record', active: view.active, revision: 0, busy: false }) }} onSkip={() => void skip(view.active)} />}
      {view.phase === 'record' && <RecallScreen key={`${item?.item_id}-${view.revision}`} conceptName={item?.concept_name ?? 'this concept'} submitting={view.busy} notice={view.notice} onSubmit={(clip) => void submit(clip, view)} onDiscard={() => abandonRecording(view)} onBack={async () => { const abandoned = await abandonRecording(view); if (abandoned) setView({ phase: 'concept', active: view.active }); return abandoned }} />}
      {view.phase === 'feedback' && item && <FeedbackScreen item={item} attempt={view.attempt} last={view.active.run.current_index === view.active.run.items.length - 1} busy={actionBusy} onRetry={() => { uploadAttempt.current = null; setView({ phase: 'record', active: view.active, revision: 0, busy: false }) }} onNext={() => void next(view.active)} />}
      {view.phase === 'summary' && <FinalReviewScreen summary={view.summary} onNewTopic={() => { save(session.session.id, { reviewerId: view.active.reviewerId }); setView({ phase: 'topics', context: view.active }) }} />}
      {view.phase === 'error' && <main id="main" tabIndex={-1} className="mx-auto w-full max-w-task flex-1 py-10"><h1 className="font-display text-4xl">Could not continue</h1><p role="alert" className="mt-5">{view.message}</p><Button className="mt-5" onClick={view.retry}>Retry</Button></main>}
    </>}
  </div>
}
