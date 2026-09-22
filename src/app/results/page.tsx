import { Suspense } from 'react'
import ResultsScreen from '@/components/results/ResultsScreen'

export const metadata = { title: 'Results · Vantage' }

// Results (REBUILD-SPEC §3.4): Study / Day / Meal scopes over one run.
// URL: /results?run=&scope=study|day|meal&date=&scene=&model=&condition=.
export default function ResultsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-ink-muted">Loading results…</div>}>
      <ResultsScreen />
    </Suspense>
  )
}
