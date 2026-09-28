import { Button } from '../../components/Button'
import type { RunSummary } from '../../types/study'

export function FinalReviewScreen({ summary, onNewTopic }: { summary: RunSummary; onNewTopic: () => void }) {
  return <main id="main" tabIndex={-1} className="mx-auto w-full max-w-task flex-1 py-10">
    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-action">Review complete</p>
    <h1 className="mt-3 font-display text-4xl">Your concept results</h1>
    <p className="mt-3 text-muted">The latest result for each concept counts.</p>
    <section className="mt-8 grid grid-cols-3 gap-3" aria-label="Result counts">
      {(['Pass', 'Partial', 'Fail'] as const).map((verdict) => <div key={verdict} className="rounded-2xl border border-divider bg-paper p-4 text-center"><p className="font-display text-4xl">{summary.counts[verdict]}</p><p className="text-sm text-muted">{verdict}</p></div>)}
    </section>
    <ul className="mt-6 divide-y divide-divider rounded-2xl border border-divider bg-paper px-5">
      {summary.concepts.map((concept) => <li key={concept.item_id} className="py-5"><div className="flex flex-wrap items-start justify-between gap-2"><h2 className="font-display text-xl [overflow-wrap:anywhere]">{concept.concept_name}</h2><span className="rounded-full bg-canvas px-3 py-1 text-sm font-semibold">{concept.verdict}</span></div>{concept.reason === 'skipped' && <p className="mt-1 text-sm text-muted">Skipped</p>}{concept.feedback && <p className="mt-2 text-sm text-muted">{concept.feedback}</p>}</li>)}
    </ul>
    <Button className="mt-7" variant="secondary" onClick={onNewTopic}>Choose another topic</Button>
  </main>
}
