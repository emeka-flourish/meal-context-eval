'use client'
import { cn } from 'cn'
import { CircleCheck, CircleHelp, CircleSlash } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { STATUS_HELP, type SceneStatus } from '@/lib/ui/scene-status'

/* The one status line of a photo scene, and the "What do these mean?" help. */

const TONE: Record<SceneStatus['tone'], { box: string; icon: React.ReactNode }> = {
  ready: { box: 'border-weighed-line bg-weighed-bg text-weighed-ink', icon: <CircleCheck className="size-3.5 shrink-0" aria-hidden /> },
  check: { box: 'border-estimated-line bg-estimated-bg text-estimated-ink', icon: <CircleHelp className="size-3.5 shrink-0" aria-hidden /> },
  blocked: { box: 'border-line-strong bg-tint text-ink', icon: <CircleSlash className="size-3.5 shrink-0" aria-hidden /> },
}

export function SceneStatusBox({ status, children, compact }: { status: SceneStatus; children?: React.ReactNode; compact?: boolean }) {
  const t = TONE[status.tone]
  return (
    <div className={cn('flex flex-col gap-1 rounded-md border px-2 py-1.5', t.box)}>
      <div className="flex items-start gap-1.5 text-xs font-semibold leading-snug">
        <span className="mt-px">{t.icon}</span>
        <span>{status.title}</span>
      </div>
      {!compact && <div className="text-[11px] leading-snug text-ink-muted">{status.explain}</div>}
      {children && <div className="flex flex-wrap gap-1.5 pt-0.5">{children}</div>}
    </div>
  )
}

export function StatusHelp() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-muted underline-offset-2 hover:bg-tint hover:text-ink">
          <CircleHelp className="size-3.5" aria-hidden />
          What do these mean?
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[440px] p-3">
        <div className="mb-2 text-sm font-semibold">What each photo scene status means</div>
        <div className="mb-2 text-[11px] text-ink-muted">A photo scene is one plate of food photographed by both cameras. Each scene shows exactly one status.</div>
        <ul className="flex flex-col gap-2">
          {STATUS_HELP.map((h) => (
            <li key={h.title} className="flex gap-2 text-xs">
              <span className={cn('mt-0.5 inline-flex h-fit rounded border p-0.5', TONE[h.tone].box)}>{TONE[h.tone].icon}</span>
              <span>
                <b className="font-semibold">{h.title}</b>
                <span className="block text-[11px] text-ink-muted">{h.meaning}</span>
              </span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
