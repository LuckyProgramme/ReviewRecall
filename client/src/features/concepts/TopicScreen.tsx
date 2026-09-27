import { useEffect, useState } from 'react'
import { Button } from '../../components/Button'
import type { StudyRun, Topic } from '../../types/study'
import { ReferencePanel } from './ReferencePanel'

export function TopicChoice({ topics, busy, onChoose }: { topics: Topic[]; busy: boolean; onChoose: (topicId: string) => void }) {
  const [selected, setSelected] = useState(topics[0]?.topic_id ?? '')
  return <main id="main" tabIndex={-1} className="mx-auto w-full max-w-task flex-1 py-10">
    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-action">Your reviewer is ready</p>
    <h1 className="mt-3 font-display text-4xl">Choose a broad topic</h1>
    <p className="mt-3 text-muted">Each topic holds a short queue of concepts from your PDF.</p>
    <div className="mt-8 rounded-2xl border border-divider bg-paper p-6 shadow-upload">
      <label htmlFor="topic-select" className="block text-sm font-semibold">Broad topic</label>
      <select id="topic-select" value={selected} onChange={(event) => setSelected(event.target.value)} className="mt-3 min-h-12 w-full rounded-lg border border-control bg-paper px-3 text-ink">
        {topics.map((topic) => <option value={topic.topic_id} key={topic.topic_id}>{topic.label} · {topic.concept_count} concepts</option>)}
      </select>
      <p className="mt-3 text-sm text-muted">{topics.find((topic) => topic.topic_id === selected)?.summary}</p>
      <Button className="mt-6 w-full sm:w-auto" disabled={busy || !selected} onClick={() => onChoose(selected)}>{busy ? 'Opening topic…' : 'Start this topic'}</Button>
    </div>
  </main>
}

export function ConceptScreen({ run, guestId, reviewerId, topic, onExplain, onSkip, busy }: { run: StudyRun; guestId: string; reviewerId: string; topic: Topic; onExplain: () => void; onSkip: () => void; busy: boolean }) {
  const item = run.items.find((value) => value.item_id === run.current_item_id)
  const [settled, setSettled] = useState(false)
  const [preview, setPreview] = useState('')
  useEffect(() => {
    if (!item) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return
    const labels = run.items.map((value) => value.concept_name)
    let position = 0
    const timer = window.setInterval(() => { setPreview(labels[position++ % labels.length]) }, 110)
    const finish = window.setTimeout(() => { window.clearInterval(timer); setSettled(true) }, 650)
    return () => { window.clearInterval(timer); window.clearTimeout(finish) }
  }, [item?.item_id, run.items, item])
  if (!item) return null
  const reveal = settled || window.matchMedia('(prefers-reduced-motion: reduce)').matches
  return <main id="main" tabIndex={-1} className="mx-auto w-full max-w-task flex-1 py-10">
    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-action">{topic.label} · Concept {run.current_index + 1} of {run.items.length}</p>
    <h1 className="mt-3 font-display text-4xl">Explain this concept</h1>
    <p className="mt-3 text-muted">Use your own simple words. An example or analogy can help, but explain the core idea too.</p>
    <section aria-label="Current concept" className="mt-8 rounded-3xl border border-divider bg-paper p-8 text-center shadow-upload sm:p-12">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">From your PDF</p>
      <p aria-live={reveal ? 'polite' : 'off'} className="mt-5 min-h-20 font-display text-4xl leading-tight [overflow-wrap:anywhere] sm:text-5xl">{reveal ? item.concept_name : preview || 'Preparing concept…'}</p>
      {!reveal && <p className="mt-2 text-sm text-muted">Shuffling concepts…</p>}
    </section>
    {reveal && <ReferencePanel key={item.item_id} reference={item.reference} guestId={guestId} reviewerId={reviewerId} topicId={topic.topic_id} topicLabel={topic.label} />}
    <div className="mt-7 flex flex-wrap gap-3"><Button disabled={!reveal || busy} onClick={onExplain}>Explain this concept</Button><Button variant="secondary" disabled={!reveal || busy} onClick={onSkip}>Skip and count as Fail</Button></div>
  </main>
}
