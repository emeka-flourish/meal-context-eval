'use client'
import { useEffect, useMemo, useState } from 'react'
import { cn } from 'cn'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { DaySummary, DaysPayload } from '@/lib/ui/intake-types'
import {
  REQUIRED_VANTAGES,
  VANTAGES,
  addMonths,
  capitalize,
  dayShort,
  monthGrid,
  monthTitle,
  plural,
} from '@/lib/ui/format'

/* Left rail (REBUILD-SPEC §3 navigation model): month grid with one dot per
   study camera per day (phone · glasses; a third dot only on days that have a
   tripod photo — the tripod is no longer part of the study and is never shown
   as missing), GT status
   colouring, the selected day's meal list, and an optional footer slot
   (Intake puts the unsorted-tray summary there). Data: GET /api/intake/days. */

export type CalendarRailProps = {
  month: string
  onMonthChange: (m: string) => void
  selected: string | null
  onSelect: (day: string) => void
  /** bump to refetch (after an edit that changes completeness) */
  refreshKey?: number
  footer?: React.ReactNode
  onDays?: (days: DaySummary[]) => void
}

export default function CalendarRail({
  month,
  onMonthChange,
  selected,
  onSelect,
  refreshKey = 0,
  footer,
  onDays,
}: CalendarRailProps) {
  const [days, setDays] = useState<DaySummary[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetch(`/api/intake/days?month=${month}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`days ${r.status}`)
        return (await r.json()) as DaysPayload
      })
      .then((p) => {
        if (!live) return
        setDays(p.days)
        setError(null)
        onDays?.(p.days)
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      live = false
    }
    // onDays is a callback prop — parents pass a stable reference
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, refreshKey])

  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days])
  const cells = useMemo(() => monthGrid(month), [month])
  const current = selected ? byDate.get(selected) : undefined

  return (
    <aside className="flex w-[232px] shrink-0 flex-col gap-2.5 overflow-hidden border-r border-line bg-rail px-3 py-4">
      <div className="flex items-center justify-between px-1">
        <button
          type="button"
          onClick={() => onMonthChange(addMonths(month, -1))}
          className="rounded p-0.5 text-ink-muted hover:bg-tint"
          aria-label="Previous month"
        >
          <ChevronLeft className="size-4" />
        </button>
        <b>{monthTitle(month)}</b>
        <button
          type="button"
          onClick={() => onMonthChange(addMonths(month, 1))}
          className="rounded p-0.5 text-ink-muted hover:bg-tint"
          aria-label="Next month"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-center text-[11px] text-ink-faint">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5" role="grid" aria-label={monthTitle(month)}>
        {cells.map((day, i) =>
          day === null ? (
            <span key={`b${i}`} />
          ) : (
            <DayCell
              key={day}
              day={day}
              summary={byDate.get(day)}
              selected={selected === day}
              onSelect={() => onSelect(day)}
            />
          ),
        )}
      </div>
      <div className="px-1 text-[11px] leading-snug text-ink-muted">Dots under a day: phone photo, glasses photo. A third dot means that day also has a tripod photo (older days only).</div>
      {error && <div className="px-1 text-[11px] text-over-ink">calendar: {error}</div>}

      {selected && (
        <div className="flex flex-col gap-1.5 border-t border-line pt-2.5">
          <b className="text-xs">{dayShort(selected)}</b>
          {current ? (
            current.meals.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onSelect(selected)}
                className="flex items-center gap-2 text-left text-xs"
              >
                <span>{capitalize(m.slot ?? 'meal')}</span>
                <span className="text-ink-muted">{plural(m.scenes, 'photo')}</span>
                <span
                  className={cn(
                    'chip chip-sm ml-auto',
                    m.gt === 'confirmed' && 'chip-weighed',
                    m.gt === 'partial' && 'chip-estimated',
                  )}
                >
                  {m.gt === 'confirmed' ? 'food list saved' : m.gt === 'partial' ? 'partly saved' : 'no food list'}
                </span>
              </button>
            ))
          ) : (
            <span className="text-xs text-ink-faint">no photos this day</span>
          )}
        </div>
      )}

      {footer && <div className="mt-auto border-t border-line pt-2.5">{footer}</div>}
    </aside>
  )
}

function DayCell({
  day,
  summary,
  selected,
  onSelect,
}: {
  day: string
  summary: DaySummary | undefined
  selected: boolean
  onSelect: () => void
}) {
  const n = Number(day.slice(-2))
  const has = Boolean(summary)
  const gtTone =
    summary?.gt === 'confirmed' ? 'ring-1 ring-brand/40' : summary?.gt === 'partial' ? 'ring-1 ring-estimated-line' : ''
  return (
    <button
      type="button"
      role="gridcell"
      aria-selected={selected}
      onClick={onSelect}
      title={
        summary
          ? `${plural(summary.mealCount, 'meal')} · ${plural(summary.sceneCount, 'photo scene')} · ${summary.validScenes} ready for the study · food list ${summary.gt === 'confirmed' ? 'saved for every meal' : summary.gt === 'partial' ? 'saved for some meals' : 'not saved yet'}`
          : 'no photos'
      }
      className={cn(
        'flex flex-col items-center gap-0.5 rounded-[5px] py-[3px] font-mono text-[11px] hover:bg-tint',
        !selected && has && gtTone,
        selected && 'bg-brand text-white hover:bg-brand',
        !has && !selected && 'text-ink-faint',
      )}
    >
      <span>{n}</span>
      <span className="flex h-1 gap-px">
        {has &&
          VANTAGES.filter((v) => REQUIRED_VANTAGES.includes(v) || summary!.vantages[v]).map((v) => (
            <span
              key={v}
              className={cn(
                'inline-block size-1 rounded-px',
                summary!.vantages[v]
                  ? selected
                    ? 'bg-[#bfe0dc]'
                    : 'bg-brand'
                  : selected
                    ? 'bg-white/30'
                    : 'bg-line-strong',
              )}
            />
          ))}
      </span>
    </button>
  )
}
