import { cn } from 'cn'
import { BAND_LEGEND, LIGHT_LABEL, LIGHT_SHAPE, type BandKind, type Light } from '@/lib/ui/bands'

/* Stoplight reading aid for the Results tables. The number is always printed;
   the light adds a shape (circle / triangle / square) and a tint, so colour is
   never the only signal. Thresholds: src/lib/ui/bands.ts. */

const TONE: Record<Light, string> = {
  good: 'bg-light-good-bg text-light-good-ink',
  watch: 'bg-light-watch-bg text-light-watch-ink',
  poor: 'bg-light-poor-bg text-light-poor-ink',
}

export function Lit({ light, children, className }: { light: Light | null; children: React.ReactNode; className?: string }) {
  if (!light) return <span className={className}>{children}</span>
  return (
    <span className={cn('inline-flex items-center gap-1 rounded px-1 py-px', TONE[light], className)}>
      <span aria-hidden className="text-[8px] leading-none">
        {LIGHT_SHAPE[light]}
      </span>
      <span>{children}</span>
      <span className="sr-only"> ({LIGHT_LABEL[light]})</span>
    </span>
  )
}

/** Shown once per table: what green / amber / red mean for the numbers in it. */
export function StoplightLegend({ kinds, className }: { kinds: BandKind[]; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-0.5 text-[11px] text-ink-muted', className)}>
      {kinds.map((k) => {
        const b = BAND_LEGEND[k]
        return (
          <div key={k} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span>{b.title}:</span>
            <Lit light="good">good · {b.good}</Lit>
            <Lit light="watch">watch · {b.watch}</Lit>
            <Lit light="poor">poor · {b.poor}</Lit>
          </div>
        )
      })}
    </div>
  )
}
