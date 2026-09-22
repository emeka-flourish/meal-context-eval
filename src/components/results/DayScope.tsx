'use client'
import { useEffect, useState } from 'react'
import { cn } from 'cn'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { dayShort } from '@/lib/ui/format'
import { shareLight } from '@/lib/ui/bands'
import { Lit, StoplightLegend } from './Stoplight'
import { DELTA_CLASS, NUTRIENT_LABEL, deltaTone, fmt0, fmt2, fmtPct } from '@/lib/ui/results-format'
import type { DayPayload } from '@/lib/ui/results-types'
import EmptyState from './EmptyState'

/* Day scope (REBUILD-SPEC §3.4, mockup ResultsDay.dc.html): decisions by
   meal (truth vs each vantage, rule explanation, margin, "differs" chip),
   day nutrition (five nutrients, partial when any scene is excluded),
   understanding by meal (click → Meal scope). Data: GET /api/results/day. */

export default function DayScope({
  runId,
  date,
  model,
  condition,
  onLoaded,
  onOpenScene,
}: {
  runId: string
  date: string | null
  model: string
  condition: string | null
  onLoaded?: (p: DayPayload) => void
  onOpenScene: (sceneId: string) => void
}) {
  const key = `${runId}|${date ?? ''}|${model}|${condition ?? ''}`
  const [loaded, setLoaded] = useState<{ key: string; data: DayPayload } | null>(null)
  const [failed, setFailed] = useState<{ key: string; error: string } | null>(null)

  useEffect(() => {
    let live = true
    const qs = new URLSearchParams({ run: runId, model })
    if (date) qs.set('date', date)
    if (condition) qs.set('condition', condition)
    fetch(`/api/results/day?${qs}`)
      .then(async (r) => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error ?? `day ${r.status}`)
        return j as DayPayload
      })
      .then((p) => {
        if (!live) return
        setLoaded({ key, data: p })
        onLoaded?.(p)
      })
      .catch((e) => live && setFailed({ key, error: e instanceof Error ? e.message : String(e) }))
    return () => {
      live = false
    }
    // onLoaded is a callback prop — the parent passes a stable reference
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, date, model, condition])

  const error = failed?.key === key ? failed.error : null
  const data = loaded?.key === key ? loaded.data : null
  if (error) return <EmptyState title="Could not load this day" body={error} action={{ href: '/run', label: 'Open Run' }} />
  if (!data) return <div className="text-ink-muted">Loading day…</div>

  const inRun = data.scenes.filter((s) => s.inRun)
  const scored = data.scenes.filter((s) => s.scoredColumns.length > 0)
  if (data.scenes.length === 0) {
    return (
      <EmptyState
        title={`No photo scenes on ${dayShort(data.date)}`}
        body={
          data.run.dates.length
            ? `This run covers ${data.run.dates.map(dayShort).join(', ')} — pick one of those days in the calendar.`
            : 'This run has no scenes at all.'
        }
        action={{ href: '/intake', label: 'Open Intake' }}
      />
    )
  }
  if (inRun.length === 0) {
    return (
      <EmptyState
        title={`No scene from ${dayShort(data.date)} is in ${data.run.label}`}
        body={`The day has ${data.scenes.length} scene(s); ${data.scenes.filter((s) => !s.valid).length} are excluded (${[...new Set(data.scenes.filter((s) => !s.valid).map((s) => s.exclusionReason ?? 'invalid'))].join(', ') || '—'}). Run days: ${data.run.dates.map(dayShort).join(', ') || 'none'}.`}
        action={{ href: '/intake', label: 'Fix the scene on Intake' }}
      />
    )
  }
  if (scored.length === 0) {
    return (
      <EmptyState
        title="No scored cells for this day yet"
        body={`${inRun.length} scene(s) of ${dayShort(data.date)} are in the run but none has a score for model ${data.model} · ${data.condition}. Drive the run, or switch the condition.`}
        action={{ href: '/run', label: 'Open Run' }}
      />
    )
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[1.6fr_1fr] gap-3.5">
      {/* decisions */}
      <section className="flex min-h-0 flex-col gap-2 overflow-auto rounded-[10px] border border-line bg-white px-4 py-3.5">
        <div className="flex items-baseline gap-2">
          <b>Decisions by meal</b>
          <span className="text-ink-muted">rule explanation under each value · margin shown for numeric rules</span>
        </div>
        <Table className="[&_td]:whitespace-normal [&_td]:align-top">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="th-label h-8 w-[24%]">meal · decision</TableHead>
              <TableHead className="th-label h-8">truth</TableHead>
              {data.columns.map((c) => (
                <TableHead key={c.key} className="th-label h-8" style={{ width: `${Math.floor(76 / (data.columns.length + 1))}%` }}>
                  {c.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.decisions.map((d) => (
              <TableRow key={`${d.sceneId}-${d.key}`}>
                <TableCell className="align-top">
                  <button type="button" className="text-left font-semibold hover:text-brand" onClick={() => onOpenScene(d.sceneId)}>
                    {d.mealLabel} · {d.label}
                  </button>
                  <div className="text-[11px] text-ink-muted">
                    {d.persona} · {d.rule}
                  </div>
                </TableCell>
                <TableCell className="align-top">
                  <span className="font-mono">{d.truth.value}</span>
                  {d.truth.explain && <div className="text-[11px] text-ink-muted">{d.truth.explain}</div>}
                </TableCell>
                {data.columns.map((c) => {
                  const v = d.byColumn[c.key]
                  if (!v)
                    return (
                      <TableCell key={c.key} className="align-top text-ink-faint">
                        not scored
                      </TableCell>
                    )
                  return (
                    <TableCell key={c.key} className="align-top">
                      <span className="font-mono">{v.value}</span>{' '}
                      {v.differs && (
                        <span className="chip chip-over" title={v.direction.replace('_', ' ')}>
                          {v.direction === 'within_one' ? 'one light off' : 'differs'}
                        </span>
                      )}
                      {v.explain && <div className="text-[11px] text-ink-muted">{v.explain}</div>}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <div className="flex min-h-0 flex-col gap-3.5">
        {/* nutrition */}
        <section className="flex flex-col gap-2 rounded-[10px] border border-line bg-white px-4 py-3.5">
          <div className="flex items-baseline gap-2">
            <b>Day nutrition</b>
            <span className="text-ink-muted">five nutrients · truth vs estimate · partial if any scene excluded</span>
            {data.nutrition.partial && <span className="chip chip-estimated ml-auto">partial</span>}
          </div>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="h-8" />
                <TableHead className="th-label h-8 text-right">truth</TableHead>
                {data.columns.map((c) => (
                  <TableHead key={c.key} className="th-label h-8 text-right">
                    {c.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.nutrition.rows.map((r) => (
                <TableRow key={r.nutrient}>
                  <TableCell>{NUTRIENT_LABEL[r.nutrient]}</TableCell>
                  <TableCell className="text-right font-mono">{r.nutrient === 'kcal' ? fmt0(r.truth) : r.truth === null ? '—' : r.truth.toFixed(1)}</TableCell>
                  {data.columns.map((c) => {
                    const v = r.byColumn[c.key]
                    return (
                      <TableCell key={c.key} className="text-right font-mono">
                        {r.nutrient === 'kcal' ? fmt0(v?.est) : v?.est == null ? '—' : v.est.toFixed(1)}{' '}
                        {v?.deltaPct != null && (
                          <span className={cn('inline-block rounded px-1.5 py-px text-[10px] font-medium', DELTA_CLASS[deltaTone(v.deltaPct)])}>{fmtPct(v.deltaPct, true)}</span>
                        )}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {data.nutrition.note && <div className="text-[12px] text-ink-muted">{data.nutrition.note}</div>}
        </section>

        {/* understanding */}
        <section className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto rounded-[10px] border border-line bg-white px-4 py-3.5">
          <div className="flex items-baseline gap-2">
            <b>Understanding by meal</b>
            <span className="text-ink-muted">click a meal to open photo by photo</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="th-label h-8">meal</TableHead>
                {data.columns.map((c) => (
                  <TableHead key={c.key} className="th-label h-8 text-right">
                    {c.label} · net · quantity
                  </TableHead>
                ))}
                <TableHead className="th-label h-8">invented</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.understanding.map((u) => {
                const invented = [...new Set(data.columns.flatMap((c) => u.byColumn[c.key]?.invented ?? []))]
                return (
                  <TableRow key={u.sceneId} className="cursor-pointer" onClick={() => onOpenScene(u.sceneId)}>
                    <TableCell>
                      <span className="text-brand">{u.mealLabel}</span>
                    </TableCell>
                    {data.columns.map((c) => {
                      const v = u.byColumn[c.key]
                      return (
                        <TableCell key={c.key} className="text-right font-mono">
                          {v ? (
                            <>
                              <Lit light={shareLight(v.net)}>{fmt2(v.net)}</Lit> · <Lit light={shareLight(v.quantity)}>{fmt2(v.quantity)}</Lit>
                            </>
                          ) : (
                            <span className="text-ink-faint">—</span>
                          )}
                        </TableCell>
                      )
                    })}
                    <TableCell className="text-ink-muted">{invented.length ? invented.join(', ') : '—'}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <StoplightLegend kinds={['share']} />
        </section>
      </div>
    </div>
  )
}
