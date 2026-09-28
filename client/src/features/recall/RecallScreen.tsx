import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import type { Clip } from '../../hooks/useRecallRecorder'
import { useRecallRecorder } from '../../hooks/useRecallRecorder'
import { useLiveTranscript } from '../../hooks/useLiveTranscript'

export function RecallScreen({ conceptName, submitting, notice, transcript, onSubmit, onBack, onDiscard }: {
  conceptName: string; submitting: boolean; notice?: string; transcript?: string
  onSubmit: (clip: Clip) => void; onBack: () => Promise<boolean>; onDiscard: () => Promise<boolean>
}) {
  const capture = useRecallRecorder()
  const [grace, setGrace] = useState<number | null>(submitting || notice ? null : 3)
  const [round, setRound] = useState(0)
  const [closing, setClosing] = useState(false)
  const submitted = useRef<Clip | null>(null)
  const canceled = useRef(false)
  const started = useRef(false)
  const autoStart = useRef(!submitting && !notice)
  const live = useLiveTranscript(capture.phase === 'recording')
  const start = capture.start
  useEffect(() => {
    if (!autoStart.current) return
    let disposed = false
    const deadline = Date.now() + 3000
    const tick = window.setInterval(() => {
      if (disposed || canceled.current) return
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setGrace(left || null)
      if (left === 0 && !started.current) {
        started.current = true
        window.clearInterval(tick)
        void start()
      }
    }, 100)
    return () => { disposed = true; window.clearInterval(tick) }
  }, [start, round])
  useEffect(() => {
    if (!canceled.current && capture.phase === 'ready' && capture.clip && !submitting && submitted.current !== capture.clip) {
      submitted.current = capture.clip
      onSubmit(capture.clip)
    }
  }, [capture.phase, capture.clip, submitting, onSubmit])
  async function close() {
    if (submitting || closing) return
    canceled.current = true
    capture.clear()
    setGrace(null)
    setClosing(true)
    await onBack()
    setClosing(false)
  }
  async function again() {
    if (submitting || closing) return
    if (!await onDiscard()) return
    capture.clear()
    canceled.current = false
    submitted.current = null
    started.current = false
    autoStart.current = true
    setGrace(3)
    setRound(n => n + 1)
  }
  const recording = capture.phase === 'recording'
  const seconds = capture.secondsLeft
  const label = grace ? String(grace) : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  return <Modal titleId="explain-title" dismissible={!submitting && !closing} onClose={() => void close()}>
    <div className="text-center">
      <button type="button" disabled={!recording} onClick={capture.stop} aria-label={recording ? 'Stop recording and submit' : grace ? `Recording starts in ${grace}` : 'Recording timer'}
        className="relative mx-auto flex size-32 items-center justify-center rounded-full text-action enabled:cursor-pointer enabled:hover:bg-canvas focus-visible:outline-offset-4">
        <svg aria-hidden="true" viewBox="0 0 128 128" className="absolute inset-0 size-full -rotate-90"><circle cx="64" cy="64" r="59" fill="none" stroke="var(--color-divider)" strokeWidth="2" /><circle cx="64" cy="64" r="59" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="371" strokeDashoffset={371 * (1 - (grace ? grace / 3 : seconds / 60))} strokeLinecap="round" className="transition-[stroke-dashoffset] duration-200 motion-reduce:transition-none" /></svg>
        <span className="font-display text-4xl tabular-nums">{submitting ? <span className="text-2xl">Evaluating</span> : label}</span>
      </button>
      <p role="status" className="mt-3 min-h-5 text-xs text-muted">{grace ? 'Get ready to explain…' : recording ? 'Recording · tap the timer to finish' : capture.phase === 'requesting' ? 'Allow microphone access to begin.' : submitting ? 'Your explanation is being reviewed.' : capture.phase === 'ready' ? 'Recording finished' : 'One minute, in your own words.'}</p>
      <p className="mt-6 text-[0.65rem] uppercase tracking-[0.16em] text-muted">Concept to explain</p>
      <h2 id="explain-title" className="mt-2 font-display text-3xl leading-tight [overflow-wrap:anywhere]">{conceptName}</h2>
    </div>
    <section className="mt-6 border-t border-divider pt-4" aria-labelledby="transcription-title">
      <h3 id="transcription-title" className="text-xs font-semibold text-action">Transcription</h3>
      <div role="log" aria-live="polite" aria-label="Live transcription" className="mt-3 max-h-40 min-h-24 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
        {transcript || live.text || <span className="text-muted">{submitting ? 'Preparing your transcript…' : !live.available ? 'Live preview is unavailable in this browser. Your audio will still be transcribed after recording.' : recording ? 'Listening for your words…' : 'Your words will appear here as you speak.'}</span>}
      </div>
      <p className="mt-2 text-[0.65rem] leading-relaxed text-muted">{live.available ? 'Live preview uses your browser’s speech service. Feedback uses the submitted audio.' : 'Speak in English, Filipino, or both.'}</p>
    </section>
    {notice && <p role="status" className="mt-4 rounded-lg bg-canvas p-3 text-xs leading-relaxed">{notice}</p>}
    {capture.phase === 'error' && <p role="alert" className="mt-4 text-sm text-danger">{capture.error}</p>}
    {!submitting && !grace && (capture.phase === 'error' || capture.phase === 'ready' || capture.phase === 'idle') && <div className="mt-4 flex flex-wrap justify-center gap-3">
      {capture.clip && <Button className="text-sm" onClick={() => capture.clip && onSubmit(capture.clip)}>Retry submission</Button>}
      <Button variant="secondary" className="text-sm" onClick={() => void again()}>Record again</Button>
    </div>}
  </Modal>
}
