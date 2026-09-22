import { Suspense } from 'react'
import CorpusScreen from '@/components/corpus/CorpusScreen'

export const metadata = { title: 'Corpus · Vantage' }

// Corpus (REBUILD-SPEC §3.2): review queue + context tab. The client screen
// reads the tab from the URL (?tab=context), hence the Suspense boundary.
export default function CorpusPage() {
  return (
    <Suspense fallback={<div className="p-6 text-ink-muted">Loading corpus…</div>}>
      <CorpusScreen />
    </Suspense>
  )
}
