import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { drawConcept, shuffled } from '../../lib/conceptDeck'
import { runDecelerationLoop, ShuffleSoundEffects } from '../../lib/shuffleLogic'
import { listConcepts } from '../../lib/studyApi'
import { sessionGone } from '../../lib/api'
import type { Concept, Topic } from '../../types/study'

export function MicIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none"><rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.6" /><path d="M6 10v2a6 6 0 0 0 12 0v-2M12 18v3m-3 0h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
}

export function TopicSelection({ topics, guestId, initialTopicId, initialConceptId, busy, recording, hidden = false, onExplain, onReupload, onExpired }: {
  topics: Topic[]; guestId: string; initialTopicId?: string; initialConceptId?: string
  busy: boolean; recording: boolean; hidden?: boolean; onExplain: (topicId: string, conceptId: string) => void
  onReupload: () => void; onExpired: () => void
}) {
  const [selectedTopicId, setSelectedTopicId] = useState(initialTopicId || topics[0]?.topic_id || '')
  const [loaded, setLoaded] = useState<{ topicId: string; concepts: Concept[]; active?: Concept; remaining: Concept[] } | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [isSpinning, setIsSpinning] = useState(false)
  const [preview, setPreview] = useState('')
  const [referenceOpen, setReferenceOpen] = useState(false)
  const spinLock = useRef(false)
  const sound = useRef<ShuffleSoundEffects | null>(null)
  const sequence = useRef<AbortController | null>(null)
  const mounted = useRef(false)
  const expired = useRef(onExpired)
  const initial = useRef({ topic: initialTopicId, concept: initialConceptId })
  useEffect(() => { expired.current = onExpired }, [onExpired])
  useEffect(() => {
    let cancelled = false
    listConcepts(guestId, selectedTopicId).then(concepts => {
      if (cancelled) return
      const preferred = selectedTopicId === initial.current.topic ? concepts.find(c => c.concept_id === initial.current.concept) : undefined
      initial.current = { topic: undefined, concept: undefined }
      const drawn = drawConcept(concepts, [])
      setLoaded({ topicId: selectedTopicId, concepts, active: preferred || drawn.active,
        remaining: preferred ? shuffled(concepts.filter(c => c.concept_id !== preferred.concept_id)) : drawn.remaining })
    }).catch(cause => {
      if (cancelled) return
      if (sessionGone(cause)) expired.current()
      else setError('Could not load these concepts. Please try again.')
    })
    return () => { cancelled = true }
  }, [guestId, selectedTopicId, retry])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      sequence.current?.abort()
      sound.current?.dispose()
      sound.current = null
    }
  }, [])
  useEffect(() => {
    if (hidden || recording) sequence.current?.abort()
  }, [hidden, recording])
  const topic = topics.find(t => t.topic_id === selectedTopicId)
  const ready = loaded?.topicId === selectedTopicId
  const active = ready ? loaded.active : undefined
  const disabled = busy || recording || isSpinning
  async function spin() {
    if (spinLock.current || disabled || !ready || !active) return
    spinLock.current = true
    const next = drawConcept(loaded.concepts, loaded.remaining, active.concept_id)
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    setIsSpinning(true)
    setPreview(active.name)
    sound.current ??= new ShuffleSoundEffects()
    const controller = new AbortController()
    sequence.current = controller
    try {
      await runDecelerationLoop(
        loaded.concepts,
        concept => { if (!reducedMotion && mounted.current) setPreview(concept.name) },
        () => { if (mounted.current) setLoaded({ ...loaded, active: next.active, remaining: next.remaining }) },
        { finalConcept: next.active, signal: controller.signal, soundEffects: sound.current },
      )
    } finally {
      if (sequence.current === controller) {
        sequence.current = null
        if (mounted.current) setIsSpinning(false)
        spinLock.current = false
      }
    }
  }
  return <main id={hidden ? undefined : 'main'} hidden={hidden} tabIndex={-1} className="mx-auto w-full max-w-[32rem] flex-1 pb-12 pt-7 sm:pt-9">
    <h1 className="sr-only">Choose a topic and concept</h1>
    <div className="rounded-2xl border border-divider bg-paper p-5 shadow-upload sm:p-7">
      <label htmlFor="topic-select" className="block text-center font-display text-2xl">Choose your topic</label>
      <select id="topic-select" value={selectedTopicId} disabled={disabled} onChange={event => {
        setSelectedTopicId(event.target.value); setLoaded(null); setError(''); setReferenceOpen(false)
      }} className="mt-3 min-h-11 w-full rounded-lg border border-control bg-paper px-3 text-sm text-ink disabled:opacity-60">
        {topics.map(t => <option key={t.topic_id} value={t.topic_id}>{t.label}</option>)}
      </select>
      <div className="relative mt-5">
        <button type="button" onClick={spin} disabled={disabled || !active} aria-label="Shuffle concept" aria-busy={isSpinning}
          className="group relative z-10 flex min-h-32 w-full min-w-0 flex-col items-center justify-center rounded-xl border border-control bg-canvas/50 px-3 py-4 text-center enabled:cursor-pointer enabled:hover:border-action enabled:hover:bg-canvas disabled:cursor-default">
          <span data-testid="active-concept" className={`my-3 font-display text-2xl leading-tight [overflow-wrap:anywhere] sm:text-3xl ${isSpinning ? 'opacity-50 blur-[0.5px] motion-reduce:opacity-100 motion-reduce:blur-none' : ''}`}>{isSpinning ? preview : active?.name || (error ? 'Concepts unavailable' : ready ? 'No concepts available' : 'Loading concepts…')}</span>
        </button>
        <button type="button" disabled={disabled || !active} onClick={() => setReferenceOpen(true)} aria-haspopup="dialog" aria-label="Concept Reference"
          className="mx-auto mt-3 flex min-h-11 items-center justify-center gap-2 rounded-lg border border-control bg-paper px-3 py-2 text-action transition-colors enabled:cursor-pointer enabled:hover:bg-canvas disabled:opacity-40 motion-reduce:transition-none md:absolute md:left-[calc(100%+1.75rem)] md:top-2 md:m-0 md:min-h-14 md:w-16 md:flex-col md:gap-1 md:rounded-l-none md:border-l-0 md:px-1.5">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-3.5" fill="none"><path d="M12 5.5C9 3.5 6 3.5 3 4.5v14c3-1 6-1 9 1 3-2 6-2 9-1v-14c-3-1-6-1-9 1Zm0 0v14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span className="text-xs font-medium leading-tight md:text-[0.5625rem]">Concept<span className="md:hidden"> </span><br className="hidden md:block" />Reference</span>
        </button>
      </div>
      <p role="status" className="sr-only">{!isSpinning && active ? `Selected concept: ${active.name}` : ''}</p>
      {error && <div role="alert" className="mt-3 text-sm text-danger">{error} <button className="underline" onClick={() => { setError(''); setRetry(n => n + 1) }}>Retry</button></div>}
      <div className="mt-5 grid grid-cols-2 gap-3">
        <Button variant="secondary" disabled={disabled} onClick={onReupload} className="text-sm">ReUpload</Button>
        <Button disabled={disabled || !active} onClick={() => active && onExplain(selectedTopicId, active.concept_id)} className="text-sm"><MicIcon />{busy ? 'Opening…' : 'Explain'}</Button>
      </div>
    </div>
    <p className="mx-auto mt-5 max-w-xs text-center text-xs leading-relaxed text-muted">Explain it using your own words.<br />One minute to explain.</p>
    {referenceOpen && !recording && !hidden && active && <Modal titleId="reference-title" onClose={() => setReferenceOpen(false)}>
      <p className="text-xs text-action">{topic?.label}</p>
      <h2 id="reference-title" className="mt-2 font-display text-3xl">{active.name}</h2>
      <p className="mt-1 text-xs text-muted">Concept Reference</p>
      <div className="mt-5 space-y-5 text-sm leading-relaxed">
        <p>{active.reference.definition}</p>
        {!!active.reference.essential_ideas.length && <div><h3 className="font-semibold">Core ideas</h3><ul className="mt-2 list-disc space-y-2 pl-5">{active.reference.essential_ideas.map((idea, i) => <li key={i}>{idea}</li>)}</ul></div>}
        {!!active.reference.analogies.length && <div><h3 className="font-semibold">Analogies</h3>{active.reference.analogies.map((text, i) => <p className="mt-2" key={i}>{text}</p>)}</div>}
        {!!active.reference.examples.length && <div><h3 className="font-semibold">Examples</h3>{active.reference.examples.map((text, i) => <p className="mt-2" key={i}>{text}</p>)}</div>}
        {!!active.reference.source_locations.length && <p className="border-t border-divider pt-4 text-xs text-muted">Source: {active.reference.source_locations.map(s => s.heading ? `${s.heading} · page ${s.page}` : `page ${s.page}`).join('; ')}</p>}
      </div>
    </Modal>}
  </main>
}
