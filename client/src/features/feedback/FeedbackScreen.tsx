import { Button } from '../../components/Button'
import type { Attempt, RunItem } from '../../types/study'

export function FeedbackScreen({ item, attempt, last, busy, onRetry, onNext }: { item: RunItem; attempt?: Attempt; last: boolean; busy: boolean; onRetry: () => void; onNext: () => void }) {
  const result = item.latest_result
  const verdict = attempt?.verdict ?? result?.verdict
  const feedback = attempt?.feedback ?? result?.feedback
  const transcript = attempt?.transcript ?? result?.transcript
  const details = attempt?.details ?? result?.details
  const ideaText = (ideaId: string) => item.reference.essential_idea_details?.find((idea) => idea.idea_id === ideaId)?.text ?? 'Core idea'
  return <main id="main" tabIndex={-1} className="mx-auto w-full max-w-task flex-1 py-10">
    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-action">Concept feedback</p>
    <h1 className="mt-3 font-display text-4xl [overflow-wrap:anywhere]">{item.concept_name}</h1>
    <section className="mt-8 rounded-2xl border border-divider bg-paper p-6 shadow-upload sm:p-8" aria-label="Latest result">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">Latest result</p>
      <p className={`mt-3 font-display text-4xl ${verdict === 'Fail' ? 'text-danger' : 'text-action'}`}>{verdict}</p>
      {result?.reason === 'skipped' && <p className="mt-2 text-sm text-muted">Skipped</p>}
      {feedback && <p className="mt-5 leading-relaxed">{feedback}</p>}
      {!!details?.matched_idea_ids.length && <div className="mt-6"><h2 className="text-sm font-semibold">Ideas you explained</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{details.matched_idea_ids.map((ideaId) => <li key={ideaId}>{ideaText(ideaId)}</li>)}</ul></div>}
      {!!details?.missing_idea_ids.length && <div className="mt-6"><h2 className="text-sm font-semibold">Ideas to add</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{details.missing_idea_ids.map((ideaId) => <li key={ideaId}>{ideaText(ideaId)}</li>)}</ul></div>}
      {!!details?.contradictions.length && <div className="mt-6 rounded-xl border border-danger/30 bg-danger/5 p-4"><h2 className="text-sm font-semibold text-danger">Contradictions to correct</h2><ul className="mt-3 space-y-3 text-sm">{details.contradictions.map((contradiction, index) => <li key={`${contradiction.idea_id}-${index}`}><p><span className="font-semibold">Core idea:</span> {ideaText(contradiction.idea_id)}</p><p className="mt-1"><span className="font-semibold">What conflicted:</span> {contradiction.student_claim}</p><p className="mt-1 text-muted">{contradiction.explanation}</p></li>)}</ul></div>}
      {transcript && <div className="mt-6 border-t border-divider pt-5"><h2 className="text-sm font-semibold">Your transcript</h2><p className="mt-2 whitespace-pre-wrap leading-relaxed">{transcript}</p></div>}
      {!!item.reference.source_locations?.length && <p className="mt-5 text-sm text-muted">Source: {item.reference.source_locations.map(({ page, heading }) => `page ${page}${heading ? `, ${heading}` : ''}`).join('; ')}</p>}
      {!!item.reference.source_passages?.length && <details className="mt-5 border-t border-divider pt-5"><summary className="cursor-pointer text-sm font-semibold">Read supporting source passages</summary><ul className="mt-4 space-y-4">{item.reference.source_passages.map((passage) => <li key={passage.block_id} className="rounded-lg bg-canvas p-4 text-sm"><p className="font-semibold">Page {passage.page}{passage.heading ? ` · ${passage.heading}` : ''}</p><p className="mt-2 whitespace-pre-wrap leading-relaxed">{passage.text}</p></li>)}</ul></details>}
    </section>
    <div className="mt-7 flex flex-wrap gap-3"><Button variant="secondary" disabled={busy} onClick={onRetry}>Try this concept again</Button><Button disabled={busy} onClick={onNext}>{busy ? 'Saving progress…' : last ? 'See final review' : 'Choose another concept'}</Button></div>
  </main>
}
