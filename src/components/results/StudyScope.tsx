'use client'
import { useEffect, useState } from 'react'
import { cn } from 'cn'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { NUTRIENT_KEYS, type NutrientKey } from '@/lib/scoring/types'
import type { Vantage } from '@/lib/ui/format'
import { agreementLight, errorPctLight, inventedLight, shareLight, type Light } from '@/lib/ui/bands'
import { ANCHORS, CONDITION_LABEL, CONDITION_SHORT, NUTRIENT_LABEL, NUTRIENT_UNIT, fmt0, fmt2, fmtCI, fmtCount, fmtDelta2, fmtPct } from '@/lib/ui/results-format'
import type { Condition, Level1Row, Level3Row, StudyPayload } from '@/lib/ui/results-types'
import EmptyState from './EmptyState'
import KcalBiasDumbbell from './KcalBiasDumbbell'
import Level1Figure, { ConditionLegend } from './Level1Figure'
import Seg from './Seg'
import { Lit, StoplightLegend } from './Stoplight'

/* Study scope (REBUILD-SPEC §3.4, mockup Main.dc.html): headline figure,
   Level 1 table (+ paired context gain), model table (image / +ctx / change),
   Level 2 table per nutrient with anchors, signed-kcal-bias dumbbell, Level 3
   decision table. All numbers come from GET /api/results/study. */

export default function StudyScope({
  runId,
  model,
  split,
  nutrient,
  onNutrient,
  onLoaded,
}: {
  runId: string
  model: string
  split: string
  nutrient: NutrientKey
  onNutrient: (n: NutrientKey) => void
  onLoaded?: (p: StudyPayload) => void
}) {
  const key = `${runId}|${model}|${split}`
  const [loaded, setLoaded] = useState<{ key: string; data: StudyPayload } | null>(null)
  const [failed, setFailed] = useState<{ key: string; error: string } | null>(null)

  useEffect(() => {
    let live = true
    fetch(`/api/results/study?run=${encodeURIComponent(runId)}&model=${encodeURIComponent(model)}&split=${encodeURIComponent(split)}`)
      .then(async (r) => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error ?? `study ${r.status}`)
        return j as StudyPayload
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
  }, [runId, model, split])

  const error = failed?.key === key ? failed.error : null
  const data = loaded?.key === key ? loaded.data : null
  if (error) return <EmptyState title="Could not load the study view" body={error} />
  if (!data) return <div className="text-ink-muted">Computing study numbers…</div>
  if (data.run.scoredCount === 0) {
    return (
      <EmptyState
        title="This run has no scored cells yet"
        body={`${data.run.label} covers ${data.run.sceneCount} scenes and ${data.run.cellCount} cells; none has reached the score step. Drive the run, then come back.`}
        action={{ href: '/run', label: 'Open Run' }}
      />
    )
  }

  const conditions = data.run.conditions
  const vantages = data.run.vantages
  const barConditions = conditions.filter((c) => c !== 'context_only')
  const multiples = data.model === 'all'

  return (
    <div className="flex flex-col gap-4">
      {/* Level 1 figure */}
      <section className="flex flex-col gap-2 rounded-[10px] border border-line bg-white px-5 py-3.5">
        <div className="flex items-center gap-3.5">
          <b>Level 1 · Understanding</b>
          <span className="text-ink-muted">two numbers, never averaged · bars = mean over meals · whiskers = 95% interval · hatched = invented deduction</span>
          <ConditionLegend conditions={conditions} />
        </div>
        {multiples ? (
          <div className="flex flex-wrap gap-6">
            {data.level1.smallMultiples.map((f) => (
              <div key={f.modelId} className="flex flex-col gap-1">
                <span className="chip chip-solid w-fit font-mono">{f.modelId}</span>
                {f.bars.length === 0 && !f.contextOnly ? (
                  <span className="text-ink-faint">no scored cells for this model</span>
                ) : (
                  <Level1Figure figure={f} compact vantages={vantages} />
                )}
              </div>
            ))}
          </div>
        ) : data.level1.figure.bars.length === 0 && !data.level1.figure.contextOnly ? (
          <EmptyState compact title="No scored cells for this model" body="Pick another model in the header, or drive the run further." action={{ href: '/run', label: 'Open Run' }} />
        ) : (
          <Level1Figure figure={data.level1.figure} vantages={vantages} />
        )}
        <div className="text-[12px] text-ink-muted">
          {data.meals} meals · {data.scenes} photo scenes · model <span className="font-mono">{multiples ? data.run.headlineModel : data.model}</span> for the tables
          {conditions.includes('context_only') ? ' · dashed line = context only (no photo)' : ''}
        </div>
      </section>

      <div className="grid grid-cols-[1.2fr_1fr] gap-3.5">
        <div className="flex min-w-0 flex-col gap-3.5">
          {/* Level 1 table */}
          <section className="overflow-hidden rounded-[10px] border border-line bg-white px-4 py-3">
            <div className="flex items-baseline gap-2">
              <b>Level 1 table</b>
              <span className="text-ink-muted">context gain = paired within-meal difference · mean [95% CI] · hover a number for its CI</span>
              <span className="ml-auto font-mono text-[11px] text-ink-faint">n = {Math.max(0, ...data.level1.table.map((r) => r.n))} meals</span>
            </div>
            <Level1Table rows={data.level1.table} gain={data.level1.gain} vantages={vantages} />
            <StoplightLegend kinds={['share', 'invented']} className="mt-1.5" />
          </section>

          {/* Model table */}
          <section className="overflow-hidden rounded-[10px] border border-line bg-white px-4 py-3">
            <div className="flex items-baseline gap-2">
              <b>Models</b>
              <span className="text-ink-muted">net recognition per camera · quantity beneath · change = paired context gain</span>
            </div>
            <Table className="mt-1">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="th-label h-8">model</TableHead>
                  {vantages.map((v) => (
                    <TableHead key={v} colSpan={3} className="th-label h-8 border-l border-line-soft text-center">
                      {v}
                    </TableHead>
                  ))}
                </TableRow>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-7" />
                  {vantages.flatMap((v) => [
                    <TableHead key={`${v}i`} className="h-7 border-l border-line-soft px-1.5 text-right text-[10px] text-ink-faint">
                      image only
                    </TableHead>,
                    <TableHead key={`${v}c`} className="h-7 px-1.5 text-right text-[10px] text-ink-faint">
                      with context
                    </TableHead>,
                    <TableHead key={`${v}d`} className="h-7 px-1.5 text-right text-[10px] text-ink-faint">
                      change
                    </TableHead>,
                  ])}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.models.map((m) => (
                  <TableRow key={m.modelId} className={cn(m.headline && 'bg-brand-soft/60 hover:bg-brand-soft/60')}>
                    <TableCell className="align-top">
                      <div className="font-mono text-[12px]">{m.modelId}</div>
                      <div className="text-[11px] text-ink-muted">
                        {m.family} · {m.tier}
                        {m.headline ? ' · headline' : ''}
                      </div>
                    </TableCell>
                    {vantages.flatMap((v) => {
                      const b = m.byVantage[v]
                      return [
                        <TableCell key={`${v}i`} className="border-l border-line-soft px-1.5 text-right font-mono">
                          <div>
                            <Lit light={shareLight(b.net.imageOnly)}>{fmt2(b.net.imageOnly)}</Lit>
                          </div>
                          <div className="mt-0.5 text-[11px]">
                            <Lit light={shareLight(b.quantity.imageOnly)}>{fmt2(b.quantity.imageOnly)}</Lit>
                          </div>
                        </TableCell>,
                        <TableCell key={`${v}c`} className="px-1.5 text-right font-mono">
                          <div>
                            <Lit light={shareLight(b.net.withContext)}>{fmt2(b.net.withContext)}</Lit>
                          </div>
                          <div className="mt-0.5 text-[11px]">
                            <Lit light={shareLight(b.quantity.withContext)}>{fmt2(b.quantity.withContext)}</Lit>
                          </div>
                        </TableCell>,
                        <TableCell key={`${v}d`} className="px-1.5 text-right font-mono">
                          <div className={cn(b.net.change !== null && b.net.change > 0 && 'text-weighed-ink', b.net.change !== null && b.net.change < 0 && 'text-over-ink')}>{fmtDelta2(b.net.change)}</div>
                          <div className="text-[11px] text-ink-faint">{fmtDelta2(b.quantity.change)}</div>
                        </TableCell>,
                      ]
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <StoplightLegend kinds={['share']} className="mt-1.5" />
          </section>

          {/* kcal bias dumbbell */}
          <section className="overflow-hidden rounded-[10px] border border-line bg-white px-4 py-3">
            <div className="flex items-baseline gap-2">
              <b>Signed kcal bias</b>
              <span className="text-ink-muted">mean (est − truth) / truth per camera · image only → with context · thin line = 95% CI</span>
            </div>
            <KcalBiasDumbbell rows={data.kcalBias} />
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-3.5">
          {/* Level 2 */}
          <section className="flex flex-col gap-1.5 overflow-hidden rounded-[10px] border border-line bg-white px-4 py-3">
            <div className="flex items-baseline gap-2">
              <b>Level 2 · {NUTRIENT_LABEL[nutrient]}</b>
              <span className="text-ink-muted">one table per nutrient · anchors beneath</span>
              <Seg
                className="ml-auto"
                ariaLabel="Nutrient"
                value={nutrient}
                onChange={onNutrient}
                options={NUTRIENT_KEYS.map((k) => ({ id: k, label: k }))}
              />
            </div>
            <Level2Table data={data} nutrient={nutrient} />
            <StoplightLegend kinds={['errorPct']} />
            <div className="text-[12px] text-ink-muted">{ANCHORS}</div>
          </section>

        </div>
      </div>

      {/* Level 3 — full width: decision × (camera × condition) is 7 count columns */}
      <section className="flex flex-col gap-1.5 overflow-hidden rounded-[10px] border border-line bg-white px-4 py-3">
        <div className="flex items-baseline gap-2">
          <b>Level 3 · decisions</b>
          <span className="text-ink-muted">agreement with truth per camera × condition · IBS and GLP-1 · counted over photo scenes · hover a count for false alarms / misses</span>
        </div>
        <Level3Table rows={data.level3} conditions={conditions} vantages={vantages} />
        <StoplightLegend kinds={['agreement']} />
      </section>
      {barConditions.length === 0 && <span className="text-ink-faint">This run has only the context-only condition; the bar panels stay empty by design.</span>}
    </div>
  )
}

/* ---- tables ------------------------------------------------------------------- */

function Level1Table({ rows, gain, vantages }: { rows: Level1Row[]; gain: StudyPayload['level1']['gain']; vantages: Vantage[] }) {
  const cellCI = (a: Level1Row['net'], bold = false, light: (v: number | null) => Light | null = shareLight) => (
    <TableCell className={cn('text-right font-mono', bold && 'font-semibold')} title={fmtCI(a)}>
      <Lit light={light(a.mean)}>{fmt2(a.mean)}</Lit>
    </TableCell>
  )
  return (
    <Table className="mt-1 [&_td]:px-1.5 [&_th]:px-1.5">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="th-label h-8">camera</TableHead>
          <TableHead className="th-label h-8">condition</TableHead>
          <TableHead className="th-label h-8 text-right">recognized</TableHead>
          <TableHead className="th-label h-8 text-right">invented</TableHead>
          <TableHead className="th-label h-8 text-right">net</TableHead>
          <TableHead className="th-label h-8 text-right">quantity</TableHead>
          <TableHead className="th-label h-8 text-right">F1</TableHead>
          <TableHead className="th-label h-8 text-right">mass err</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={8} className="text-ink-faint">
              no scored cells for this model
            </TableCell>
          </TableRow>
        )}
        {vantages.flatMap((v) => {
          const mine = rows.filter((r) => r.vantage === v)
          const g = gain.find((x) => x.vantage === v)
          const out = mine.map((r) => (
            <TableRow key={`${v}-${r.condition}`} title={`n = ${r.n} meals`}>
              <TableCell>{v}</TableCell>
              <TableCell className="text-ink-muted">{CONDITION_LABEL[r.condition]}</TableCell>
              {cellCI(r.recognized)}
              {cellCI(r.invented, false, inventedLight)}
              {cellCI(r.net, true)}
              {cellCI(r.quantity, true)}
              <TableCell className="text-right font-mono text-ink-muted" title={fmtCI(r.f1)}>
                {fmt2(r.f1.mean)}
              </TableCell>
              <TableCell className="text-right font-mono text-ink-muted" title={`MAE ${fmtCI(r.massMae, 0)} g · MAPE ${fmtCI(r.massMape, 0)}%`}>
                {r.massMae.mean === null ? '—' : `${fmt0(r.massMae.mean)} g`} · {fmtPct(r.massMape.mean)}
              </TableCell>
            </TableRow>
          ))
          if (g) {
            out.push(
              <TableRow key={`${v}-gain`} className="bg-rail hover:bg-rail" title={`paired over ${g.net.n} meals`}>
                <TableCell className="text-ink-faint" />
                <TableCell className="text-[11px] text-ink-muted">context gain</TableCell>
                <TableCell className="text-right font-mono text-[11px] text-ink-muted">{fmtDelta2(g.recognized.mean)}</TableCell>
                <TableCell className="text-right font-mono text-[11px] text-ink-muted">{fmtDelta2(g.invented.mean)}</TableCell>
                <TableCell className="text-right font-mono text-[11px]">
                  {fmtDelta2(g.net.mean)} <span className="text-[10px] text-ink-faint">{g.net.ci ? `[${fmtDelta2(g.net.ci[0])}, ${fmtDelta2(g.net.ci[1])}]` : ''}</span>
                </TableCell>
                <TableCell className="text-right font-mono text-[11px]">
                  {fmtDelta2(g.quantity.mean)} <span className="text-[10px] text-ink-faint">{g.quantity.ci ? `[${fmtDelta2(g.quantity.ci[0])}, ${fmtDelta2(g.quantity.ci[1])}]` : ''}</span>
                </TableCell>
                <TableCell colSpan={2} />
              </TableRow>,
            )
          }
          return out
        })}
        {rows
          .filter((r) => r.vantage === null)
          .map((r) => (
            <TableRow key="ctx" title={`n = ${r.n} meals`}>
              <TableCell>none</TableCell>
              <TableCell className="text-ink-muted">{CONDITION_LABEL[r.condition]}</TableCell>
              {cellCI(r.recognized)}
              {cellCI(r.invented, false, inventedLight)}
              {cellCI(r.net, true)}
              {cellCI(r.quantity, true)}
              <TableCell className="text-right font-mono text-ink-muted">{fmt2(r.f1.mean)}</TableCell>
              <TableCell className="text-right font-mono text-ink-muted">
                {r.massMae.mean === null ? '—' : `${fmt0(r.massMae.mean)} g`} · {fmtPct(r.massMape.mean)}
              </TableCell>
            </TableRow>
          ))}
      </TableBody>
    </Table>
  )
}

function Level2Table({ data, nutrient }: { data: StudyPayload; nutrient: NutrientKey }) {
  const block = data.level2[nutrient]
  const unit = NUTRIENT_UNIT[nutrient]
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="th-label h-8">camera · condition</TableHead>
            <TableHead className="th-label h-8 text-right">MAE</TableHead>
            <TableHead className="th-label h-8 text-right">% of mean</TableHead>
            <TableHead className="th-label h-8 text-right">MAPE / med</TableHead>
            <TableHead className="th-label h-8 text-right">bias</TableHead>
            <TableHead className="th-label h-8 text-right">within ±20%</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {block.rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-ink-faint">
                no scored cells for this model
              </TableCell>
            </TableRow>
          )}
          {block.rows.map((r) => (
            <TableRow key={`${r.vantage ?? 'none'}-${r.condition}`}>
              <TableCell>
                {r.vantage ?? 'none'} · <span className="text-ink-muted">{CONDITION_SHORT[r.condition]}</span>
              </TableCell>
              <TableCell className="text-right font-mono" title={`${fmtCI(r.mae, nutrient === 'kcal' ? 0 : 1)} ${unit}`}>
                {nutrient === 'kcal' ? fmt0(r.mae.mean) : r.mae.mean === null ? '—' : r.mae.mean.toFixed(1)}
              </TableCell>
              <TableCell className="text-right font-mono">
                <Lit light={errorPctLight(r.pctOfMean)}>{fmtPct(r.pctOfMean)}</Lit>
              </TableCell>
              <TableCell className="text-right font-mono">
                <Lit light={errorPctLight(r.mape)}>{fmtPct(r.mape)}</Lit> / <Lit light={errorPctLight(r.medianApe)}>{fmtPct(r.medianApe)}</Lit>
              </TableCell>
              <TableCell className="text-right font-mono" title={`${fmtCI(r.signedBias, 0)}%`}>
                {fmtPct(r.signedBias.mean, true)}
              </TableCell>
              <TableCell className="text-right font-mono" title={`within ±10%: ${fmtCount(r.within10, r.n)}`}>
                {fmtCount(r.within20, r.n)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {block.gain.length > 0 && (
        <div className="text-[11px] text-ink-muted">
          context gain on absolute % error (paired, negative = context helps):{' '}
          {block.gain.map((g) => (
            <span key={g.vantage} className="mr-2 font-mono">
              {g.vantage} {g.ape.mean === null ? '—' : `${g.ape.mean > 0 ? '+' : ''}${g.ape.mean.toFixed(0)} pts`}
              {g.ape.ci ? ` [${g.ape.ci[0].toFixed(0)}, ${g.ape.ci[1].toFixed(0)}]` : ''}
            </span>
          ))}
        </div>
      )}
    </>
  )
}

function Level3Table({ rows, conditions, vantages }: { rows: Level3Row[]; conditions: Condition[]; vantages: Vantage[] }) {
  const barConditions = conditions.filter((c) => c !== 'context_only')
  const hasCtx = conditions.includes('context_only')
  const cellFor = (r: Level3Row, vantage: string | null, condition: Condition) => {
    const c = r.cells.find((x) => (x.vantage ?? null) === vantage && x.condition === condition)
    if (!c) return <span className="text-ink-faint">—</span>
    const detail = [c.falseAlarm ? `${c.falseAlarm} false alarm` : '', c.miss ? `${c.miss} missed` : '', c.withinOne ? `${c.withinOne} one light off` : '']
      .filter(Boolean)
      .join(' · ')
    return (
      <span title={`${detail || 'all agree'}${c.marginMedian !== null ? ` · median |margin| ${Math.round(c.marginMedian * 100)}%` : ''}`}>
        <Lit light={agreementLight(c.agree, c.N)}>
          {fmtCount(c.agree, c.N)} · {Math.round((c.agree / c.N) * 100)}%
        </Lit>
        {detail && <div className="text-[10px] leading-tight text-ink-faint">{detail}</div>}
      </span>
    )
  }
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="th-label h-8">decision</TableHead>
          <TableHead className="th-label h-8 text-right">base rate</TableHead>
          {vantages.map((v) => (
            <TableHead key={v} colSpan={barConditions.length || 1} className="th-label h-8 border-l border-line-soft text-center">
              {v}
            </TableHead>
          ))}
          {hasCtx && <TableHead className="th-label h-8 border-l border-line-soft text-right">ctx only</TableHead>}
        </TableRow>
        {barConditions.length > 1 && (
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-6" />
            <TableHead className="h-6" />
            {vantages.flatMap((v) =>
              barConditions.map((c, i) => (
                <TableHead key={`${v}${c}`} className={cn('h-6 text-right text-[10px] text-ink-faint', i === 0 && 'border-l border-line-soft')}>
                  {CONDITION_SHORT[c]}
                </TableHead>
              )),
            )}
            {hasCtx && <TableHead className="h-6" />}
          </TableRow>
        )}
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.key}>
            <TableCell>
              {r.label} <span className="text-ink-muted">({r.persona})</span>
              <div className="text-[11px] text-ink-faint">{r.rule}</div>
            </TableCell>
            <TableCell className="text-right font-mono text-ink-muted" title={r.key === 'fodmapLight' ? 'truth moderate or high' : 'truth yes'}>
              {r.baseRate.N ? fmtCount(r.baseRate.positives, r.baseRate.N) : '—'}
            </TableCell>
            {vantages.flatMap((v) =>
              (barConditions.length ? barConditions : []).map((c, i) => (
                <TableCell key={`${v}${c}`} className={cn('text-right font-mono', i === 0 && 'border-l border-line-soft')}>
                  {cellFor(r, v, c)}
                </TableCell>
              )),
            )}
            {barConditions.length === 0 &&
              vantages.map((v) => (
                <TableCell key={v} className="border-l border-line-soft text-right text-ink-faint">
                  —
                </TableCell>
              ))}
            {hasCtx && <TableCell className="border-l border-line-soft text-right font-mono">{cellFor(r, null, 'context_only')}</TableCell>}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
