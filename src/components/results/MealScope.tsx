'use client'
import { useCallback, useEffect, useState } from 'react'
import { cn } from 'cn'
import ZoomImage from '@/components/intake/ZoomImage'
import { VANTAGES, fmtGrams } from '@/lib/ui/format'
import { DELTA_CLASS, deltaTone, fmt0, fmt2, fmtPct } from '@/lib/ui/results-format'
import type { MatchOverrideResponse, MatchedCell, MealColumn, MealPayload, TruthItemDto } from '@/lib/ui/results-types'
import EmptyState from './EmptyState'
import MatchReviewDialog, { type ReviewTarget } from './MatchReviewDialog'

/* Meal scope (REBUILD-SPEC §3.4, mockup MealCompare.dc.html): one photo
   scene — capture strip, GT column (plates → dishes → items → grams) then one
   column per vantage for the selected condition; each predicted item sits on
   the row of its matched GT item, invented items in their own row, missed GT
   items marked; per-column Level 1 summary computed on the server from the
   match table on screen. Click a pairing to fix it. */

export default function MealScope({
  runId,
  sceneId,
  date,
  model,
  condition,
  onLoaded,
}: {
  runId: string
  sceneId: string | null
  date: string | null
  model: string
  condition: string | null
  onLoaded?: (p: MealPayload) => void
}) {
  const [reloadKey, setReloadKey] = useState(0)
  const key = `${runId}|${sceneId ?? ''}|${date ?? ''}|${model}|${condition ?? ''}|${reloadKey}`
  const [loaded, setLoaded] = useState<{ key: string; data: MealPayload } | null>(null)
  const [failed, setFailed] = useState<{ key: string; error: string } | null>(null)
  const [review, setReview] = useState<ReviewTarget | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(() => {
    const qs = new URLSearchParams({ run: runId, model })
    if (sceneId) qs.set('scene', sceneId)
    if (date) qs.set('date', date)
    if (condition) qs.set('condition', condition)
    return fetch(`/api/results/meal?${qs}`).then(async (r) => {
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? `meal ${r.status}`)
      return j as MealPayload
    })
  }, [runId, sceneId, date, model, condition])

  useEffect(() => {
    let live = true
    load()
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
  }, [load, reloadKey])

  const error = failed?.key === key ? failed.error : null
  // after an override we keep the previous table on screen while the reload runs
  const data = loaded?.key === key ? loaded.data : loaded && reloadKey > 0 && loaded.key.startsWith(key.slice(0, key.lastIndexOf('|'))) ? loaded.data : null

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  if (error) return <EmptyState title="Could not load this meal" body={error} action={{ href: '/run', label: 'Open Run' }} />
  if (!data) return <div className="text-ink-muted">Loading meal…</div>

  const { scene, columns, truth } = data
  if (!scene.inRun) {
    return (
      <EmptyState
        title={`Photo ${scene.index} is not in ${data.run.label}`}
        body={
          scene.valid
            ? 'The scene is valid but was not part of this run’s scene set when the run was created. Create a new run that includes it.'
            : `The scene is excluded (${scene.exclusionReason ?? 'invalid'}) — fix the captures / notes on Intake, then create a new run.`
        }
        action={scene.valid ? { href: '/run', label: 'Open Run' } : { href: `/intake?date=${data.meal.date}`, label: 'Open Intake' }}
      />
    )
  }
  if (truth.length === 0) {
    return <EmptyState title="This scene has no ground-truth items" body="Confirm the structured GT on Intake first; the match table needs truth items." action={{ href: `/intake?date=${data.meal.date}`, label: 'Open Intake' }} />
  }

  const dishes: Array<{ dish: string; items: TruthItemDto[] }> = []
  for (const t of truth) {
    const g = dishes.find((d) => d.dish === t.dish)
    if (g) g.items.push(t)
    else dishes.push({ dish: t.dish, items: [t] })
  }
  const matchOf = (col: MealColumn, truthId: string): MatchedCell | undefined => col.matches.find((m) => m.truthId === truthId)
  const predName = (col: MealColumn, id: string) => col.preds.find((p) => p.id === id)
  const truthTotal = truth.reduce((s, t) => s + (t.tag !== 'ignore' && t.grams ? t.grams : 0), 0)
  const anyScored = columns.some((c) => c.state === 'scored')
  // cameras of this run, plus any other camera that happens to have a photo (older days have a tripod photo)
  const stripVantages = VANTAGES.filter((v) => data.run.vantages.includes(v) || scene.photos[v])
  const gallery = stripVantages.flatMap((v) => (scene.photos[v] ? [{ src: scene.photos[v]!.url, alt: `${v} photo, photo ${scene.index}`, label: v as string }] : []))

  function onSaved(res: MatchOverrideResponse) {
    setReview(null)
    setToast(res.rescored ? `Pairing saved · cell rescored · ${res.overrideN} fix(es) on this column` : `Pairing saved · rescore failed: ${res.rescoreError ?? 'unknown'} — numbers below are recomputed from the match table`)
    setReloadKey((k) => k + 1)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5">
      {/* capture strip */}
      <div className="grid shrink-0 gap-2.5" style={{ gridTemplateColumns: `repeat(${stripVantages.length}, minmax(0, 1fr))` }}>
        {stripVantages.map((v) => {
          const p = scene.photos[v]
          return p ? (
            <ZoomImage key={v} src={p.url} alt={`${v} photo, photo ${scene.index}`} label={v} className="h-[150px] w-full" gallery={gallery} galleryIndex={gallery.findIndex((g) => g.label === v)} />
          ) : (
            <div key={v} className="flex h-[150px] flex-col items-center justify-center rounded-lg border border-dashed border-line-strong bg-paper text-[11px] text-ink-faint">
              <span>no {v} photo</span>
            </div>
          )
        })}
      </div>

      {!anyScored && (
        <EmptyState
          compact
          title={`No scored column for ${data.condition} · ${data.model}`}
          body={columns.map((c) => `${c.label}: ${c.state === 'not_interpreted' ? 'not interpreted' : 'interpreted, not matched'}${c.error ? ` (${c.error})` : ''}`).join(' · ')}
          action={{ href: '/run', label: 'Open Run' }}
        />
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-auto rounded-[10px] border border-line bg-white">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="th-label w-[26%] border-b border-line px-2.5 py-2 text-left normal-case tracking-normal">
                ground truth · photo {scene.index} ({dishes.length} {dishes.length === 1 ? 'plate' : 'plates'})
              </th>
              {columns.map((c) => (
                <th key={c.key} className="th-label border-b border-line px-2.5 py-2 text-left normal-case tracking-normal">
                  {c.label} · photo {scene.index}
                  {c.state !== 'scored' && (
                    <span className="chip chip-sm ml-2" title={c.error ?? undefined}>
                      {c.state === 'not_interpreted' ? 'not interpreted' : 'not matched'}
                    </span>
                  )}
                  {c.mocked && <span className="chip chip-sm chip-estimated ml-2">mock</span>}
                  {c.overrideN > 0 && <span className="chip chip-sm chip-weighed ml-2">{c.overrideN} fixed</span>}
                  {c.cellStale && c.state === 'scored' && (
                    <span className="chip chip-sm chip-over ml-2" title="the stored score cell predates the match table — numbers here are recomputed from the table">
                      cell stale
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dishes.map((d, di) => (
              <DishRows key={d.dish} dish={d} index={di + 1} columns={columns} matchOf={matchOf} predName={predName} onReview={(col, t) => setReview({ column: col, truth: t })} />
            ))}

            {/* invented */}
            <tr className="bg-rail">
              <td className="border-b border-line-soft px-2.5 py-2 align-top text-ink-muted">invented · not in ground truth · full weight for core/secondary, half for garnish/spice</td>
              {columns.map((c) => (
                <td key={c.key} className="border-b border-line-soft px-2.5 py-2 align-top">
                  {c.state !== 'scored' ? (
                    <span className="text-ink-faint">—</span>
                  ) : c.invented.length === 0 ? (
                    <span className="text-ink-muted">—</span>
                  ) : (
                    c.invented.map((i) => (
                      <div key={i.predId}>
                        {i.name} <span className="chip chip-sm">{i.tag}</span>
                        {i.origin === 'wrong_pairing' && <span className="chip chip-sm chip-over ml-1">wrong pairing</span>}
                        <div className="font-mono text-ink-muted">{i.grams != null ? `${fmtGrams(i.grams)} g · in the quantity denominator` : 'no grams'}</div>
                      </div>
                    ))
                  )}
                </td>
              ))}
            </tr>

            {/* plate total */}
            <tr>
              <td className="border-b border-line-soft px-2.5 py-2 text-ink-muted">
                plate total <span className="font-mono">{fmt0(truthTotal)} g</span>
              </td>
              {columns.map((c) => {
                const s = c.summary
                const d = s && s.truthTotalG > 0 ? ((s.estTotalG - s.truthTotalG) / s.truthTotalG) * 100 : null
                return (
                  <td key={c.key} className="border-b border-line-soft px-2.5 py-2 font-mono">
                    {s ? (
                      <>
                        {fmt0(s.estTotalG)} g <Delta pct={d} />
                      </>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </td>
                )
              })}
            </tr>

            {/* level 1 */}
            <tr>
              <td className="px-2.5 py-2 text-ink-muted">level 1</td>
              {columns.map((c) => {
                const s = c.summary
                return (
                  <td key={c.key} className="px-2.5 py-2 text-[12px]">
                    {s ? (
                      <>
                        net <b>{fmt2(s.net)}</b> · quantity <b>{fmt2(s.quantity)}</b>
                        <div className="text-[11px] text-ink-muted">
                          recognized {fmt2(s.recognized)} · invented {fmt2(s.invented)} · F1 {fmt2(s.f1)} · mass {s.massMae === null ? '—' : `${fmt0(s.massMae)} g / ${fmtPct(s.massMape)}`}
                        </div>
                      </>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
        <div className="flex items-center gap-4 px-3.5 py-2.5 text-[12px] text-ink-muted">
          <span>
            Change = model estimate − your weighed value. Grade = smaller over larger. Identity: exact · substitute (half credit in recognition) · missed. Drinks dropped on both sides. If two items are paired
            wrongly, click the pair to fix it; fixes are remembered.
          </span>
          {columns
            .filter((c) => c.contextUsed)
            .map((c) => (
              <span key={c.key} className="chip ml-auto" title={`${c.label}: retrieval ${c.contextUsed?.hit ? 'hit' : 'no match'}`}>
                {c.label}: {c.contextUsed?.hit ? `retrieved ${(c.contextUsed.cardsRetrieved ?? []).slice(0, 2).join(', ') || 'context'}` : 'no card matched'}
              </span>
            ))}
        </div>
      </div>

      {toast && <div className="fixed right-6 bottom-5 z-40 rounded-md bg-ink px-3.5 py-2 text-[12px] text-white shadow-lg">{toast}</div>}
      <MatchReviewDialog runId={runId} target={review} onClose={() => setReview(null)} onSaved={onSaved} />
    </div>
  )
}

function Delta({ pct }: { pct: number | null }) {
  if (pct === null) return null
  return <span className={cn('ml-1 inline-block rounded px-1.5 py-px text-[11px] font-medium', DELTA_CLASS[deltaTone(pct)])}>{fmtPct(pct, true)}</span>
}

function DishRows({
  dish,
  index,
  columns,
  matchOf,
  predName,
  onReview,
}: {
  dish: { dish: string; items: TruthItemDto[] }
  index: number
  columns: MealColumn[]
  matchOf: (col: MealColumn, truthId: string) => MatchedCell | undefined
  predName: (col: MealColumn, id: string) => MealColumn['preds'][number] | undefined
  onReview: (col: MealColumn, t: TruthItemDto) => void
}) {
  return (
    <>
      <tr>
        <td colSpan={columns.length + 1} className="px-2.5 pt-2 pb-0.5 text-[11px] font-semibold text-ink-muted uppercase tracking-[0.04em]">
          plate {index} · {dish.dish}
        </td>
      </tr>
      {dish.items.map((t) => {
        const inQuantity = t.tag !== 'ignore' && t.grams != null
        return (
          <tr key={t.id}>
            <td className="border-b border-line-soft px-2.5 py-2 align-top">
              <span className={cn(t.tag === 'core' && 'font-semibold')}>{t.name}</span>{' '}
              <span className={cn('chip chip-sm', t.tag === 'core' && 'chip-solid')}>{t.tag}</span>
              {t.components && <div className="text-[12px] text-ink-muted">{t.components.join(' · ')}</div>}
              <div className="font-mono text-ink-muted">
                {t.tag === 'ignore' ? 'ignored · dropped on both sides' : t.grams != null ? `${fmtGrams(t.grams)} g · ${t.basis ?? 'estimated'}${t.state ? ` · ${t.state}` : ''}` : 'no grams · not in quantity'}
              </div>
            </td>
            {columns.map((c) => {
              if (c.state !== 'scored' || t.tag === 'ignore')
                return (
                  <td key={c.key} className="border-b border-line-soft px-2.5 py-2 align-top text-ink-faint">
                    —
                  </td>
                )
              const m = matchOf(c, t.id)
              const clickable = 'cursor-pointer hover:bg-tint'
              if (!m || m.status === 'missed' || m.predIds.length === 0) {
                return (
                  <td key={c.key} className={cn('border-b border-line-soft px-2.5 py-2 align-top', clickable)} onClick={() => onReview(c, t)} title="click to pair with a prediction">
                    <span className="chip chip-over">missed</span>
                  </td>
                )
              }
              const names = m.predIds.map((id) => predName(c, id)).filter(Boolean)
              const label = names.length === 1 ? `${names[0]!.name}${names[0]!.inferred ? ' (inferred)' : ''}` : `${names[0]?.name ?? '…'} (${names.length} items, summed)`
              const shared = m.sharedWith.length > 0
              return (
                <td key={c.key} className={cn('border-b border-line-soft px-2.5 py-2 align-top', clickable)} onClick={() => onReview(c, t)} title={names.map((n) => n!.name).join(' + ') + ' · click to change the pairing'}>
                  <div>
                    {label}{' '}
                    <span className={cn('chip chip-sm', m.status === 'substitute' && 'chip-estimated', m.status === 'wrong' && 'chip-over')}>{m.status === 'wrong' ? 'wrong pairing' : m.status}</span>
                    {shared && <span className="chip chip-sm ml-1">shared</span>}
                  </div>
                  {inQuantity ? (
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono">{m.estimate != null ? `${fmtGrams(m.estimate)} g` : 'no grams'}</span>
                      <Delta pct={m.deltaPct} />
                      {m.grade !== null && <span className="font-mono text-[10px] text-ink-muted">grade {fmt2(m.grade)}</span>}
                    </div>
                  ) : (
                    <div className="font-mono text-[10px] text-ink-muted">{m.estimate != null ? `${fmtGrams(m.estimate)} g · not in quantity` : ''}</div>
                  )}
                </td>
              )
            })}
          </tr>
        )
      })}
    </>
  )
}
