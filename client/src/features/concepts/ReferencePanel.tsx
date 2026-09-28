import { useState } from 'react'
import { Button } from '../../components/Button'
import type { Reference } from '../../types/study'
import { downloadReference } from '../../lib/studyApi'

export function ReferencePanel({ reference, guestId, reviewerId, topicId, topicLabel }: { reference: Reference; guestId: string; reviewerId: string; topicId: string; topicLabel: string }) {
  const [open, setOpen] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')
  async function download() {
    setDownloading(true)
    setError('')
    try {
      const markdown = await downloadReference(guestId, reviewerId, topicId)
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${topicLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'reviewer'}-reference.md`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not download the reference.')
    } finally { setDownloading(false) }
  }
  return (
    <section className="mt-6 rounded-2xl border border-divider bg-paper p-5 sm:p-6" aria-label="Optional concept reference">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="font-display text-xl">Compact reference</h3><p className="text-sm text-muted">Open it if you need a reminder before explaining.</p></div>
        <Button variant="secondary" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide reference' : 'Show reference'}</Button>
      </div>
      {open && <div className="mt-5 space-y-4 border-t border-divider pt-5 text-sm leading-relaxed">
        <p>{reference.definition}</p>
        {!!reference.essential_ideas?.length && <div><h4 className="font-semibold">Core ideas</h4><ul className="mt-2 list-disc space-y-1 pl-5">{reference.essential_ideas.map((idea, index) => <li key={index}>{idea}</li>)}</ul></div>}
        {!!reference.analogies?.length && <div><h4 className="font-semibold">Source analogies</h4><ul className="mt-2 list-disc space-y-1 pl-5">{reference.analogies.map((analogy, index) => <li key={index}>{analogy}</li>)}</ul></div>}
        {!!reference.examples?.length && <div><h4 className="font-semibold">Examples</h4><ul className="mt-2 list-disc space-y-1 pl-5">{reference.examples.map((example, index) => <li key={index}>{example}</li>)}</ul></div>}
        {!!reference.source_locations?.length && <p className="text-muted">Source: {reference.source_locations.map(({ page, heading }) => `page ${page}${heading ? `, ${heading}` : ''}`).join('; ')}</p>}
        <Button variant="utility" disabled={downloading} onClick={() => void download()}>{downloading ? 'Preparing download…' : 'Download topic reference (.md)'}</Button>
        {error && <p role="alert" className="text-danger">{error}</p>}
      </div>}
    </section>
  )
}
