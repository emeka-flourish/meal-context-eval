import { Suspense } from 'react'
import IntakeScreen from '@/components/intake/IntakeScreen'

export const metadata = { title: 'Intake · Vantage' }

export default function IntakePage() {
  return (
    <Suspense fallback={<div className="p-6 text-ink-muted">Loading intake…</div>}>
      <IntakeScreen />
    </Suspense>
  )
}
