'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import CalendarRail from '@/components/shell/CalendarRail'
import { NUTRIENT_KEYS, type NutrientKey } from '@/lib/scoring/types'
import { capitalize, dayShort, dayTitle, isoMonth } from '@/lib/ui/format'
import { CONDITION_LABEL } from '@/lib/ui/results-format'
import type { Condition, DayPayload, MealPayload, RunInfo, Scope, Split, StudyPayload } from '@/lib/ui/results-types'
import DayScope from './DayScope'
import EmptyState from './EmptyState'
import MealScope from './MealScope'
import RunPicker, { type RunRow } from './RunPicker'
import Seg from './Seg'
import StudyScope from './StudyScope'

/* Results (REBUILD-SPEC §3.4): three scopes — Study (default) / Day / Meal —
   over one run. URL carries everything: /results?run=&scope=&date=&scene=
   &model=&condition=&split=&nutrient=. The calendar rail (Day / Meal) drives
   the day; Day → Meal by clicking a meal; the run picker sits in this header
   (the AppShell pill is a placeholder). */

const SCOPES: Scope[] = ['study', 'day', 'meal']
const isScope = (s: string | null): s is Scope => SCOPES.includes(s as Scope)
const isNutrient = (s: string | null): s is NutrientKey => NUTRIENT_KEYS.includes(s as NutrientKey)

type Params = {
  run: string | null
  scope: Scope
  date: string | null
  scene: string | null
  model: string | null
  condition: string | null
  split: Split
  nutrient: NutrientKey
}

export default function ResultsScreen() {
  const params = useSearchParams()
  const router = useRouter()
  const p: Params = useMemo(
    () => ({
      run: params.get('run'),
      scope: isScope(params.get('scope')) ? (params.get('scope') as Scope) : 'study',
      date: params.get('date'),
      scene: params.get('scene'),
      model: params.get('model'),
      condition: params.get('condition'),
      split: (['all', 'routine', 'novel'] as Split[]).includes(params.get('split') as Split) ? (params.get('split') as Split) : 'all',
      nutrient: isNutrient(params.get('nutrient')) ? (params.get('nutrient') as NutrientKey) : 'kcal',
    }),
    [params],
  )

  const set = useCallback(
    (patch: Partial<Record<keyof Params, string | null | undefined>>) => {
      const next = new URLSearchParams(params.toString())
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === '') next.delete(k)
        else next.set(k, String(v))
      }
      router.replace(`/results?${next.toString()}`)
    },
    [params, router],
  )

  const [runs, setRuns] = useState<RunRow[] | null>(null)
  const [runsErr, setRunsErr] = useState<string | null>(null)
  const [runInfo, setRunInfo] = useState<RunInfo | null>(null)
  // per run: is ScoreCell.routine recorded on any cell? (GET /api/results/study routineAvailable)
  const [routineAvailable, setRoutineAvailable] = useState<{ run: string; value: boolean } | null>(null)
  const [month, setMonth] = useState<string>(p.date?.slice(0, 7) ?? isoMonth(new Date()))
  const [dayTitleText, setDayTitleText] = useState<string | null>(null)
  const [mealHead, setMealHead] = useState<MealPayload | null>(null)

  useEffect(() => {
    let live = true
    fetch('/api/runs')
      .then(async (r) => {
        if (!r.ok) throw new Error(`runs ${r.status}`)
        return (await r.json()) as { runs: RunRow[] }
      })
      .then((j) => live && setRuns(j.runs))
      .catch((e) => live && setRunsErr(e instanceof Error ? e.message : String(e)))
    return () => {
      live = false
    }
  }, [])

  // no run in the URL → the latest run
  useEffect(() => {
    if (!runs || runs.length === 0 || p.run) return
    set({ run: runs[0].id })
  }, [runs, p.run, set])

  const run = runs?.find((r) => r.id === p.run) ?? null
  const splitEnabled = run !== null && routineAvailable?.run === run.id && routineAvailable.value
  const models = run?.summary.models ?? []
  const conditions = (run?.summary.conditions ?? []) as Condition[]
  const headlineModel = models.find((m) => m.tier === 'frontier')?.id ?? models[0]?.id ?? null
  const model = p.model && (p.model === 'all' || models.some((m) => m.id === p.model)) ? p.model : headlineModel
  const tableModel = model === 'all' ? headlineModel : model
  const condition: Condition | null = p.condition && conditions.includes(p.condition as Condition) ? (p.condition as Condition) : conditions.includes('image_context') ? 'image_context' : (conditions[0] ?? null)

  const onStudyLoaded = useCallback((s: StudyPayload) => {
    setRunInfo(s.run)
    setRoutineAvailable({ run: s.run.id, value: s.routineAvailable })
  }, [])
  const onDayLoaded = useCallback(
    (d: DayPayload) => {
      setRunInfo(d.run)
      setDayTitleText(`${d.scenes.filter((s) => s.valid && s.inRun).length} scenes in run, ${d.scenes.filter((s) => !s.valid).length} excluded${d.scenes.some((s) => !s.valid) ? ` (${[...new Set(d.scenes.filter((s) => !s.valid).map((s) => s.exclusionReason ?? 'invalid'))].join(', ')})` : ''}`)
      if (!p.date) set({ date: d.date })
    },
    [p.date, set],
  )
  const onMealLoaded = useCallback(
    (m: MealPayload) => {
      setRunInfo(m.run)
      setMealHead(m)
      if (p.scene !== m.scene.id || p.date !== m.meal.date) set({ scene: m.scene.id, date: m.meal.date })
    },
    [p.scene, p.date, set],
  )
  // the rail follows the URL day (derived from the previous render, not an effect)
  const [prevDate, setPrevDate] = useState(p.date)
  if (p.date !== prevDate) {
    setPrevDate(p.date)
    if (p.date) setMonth(p.date.slice(0, 7))
  }

  /* ---- empty states ---------------------------------------------------- */
  if (runsErr) {
    return (
      <main className="flex flex-1 flex-col gap-3 px-7 py-5">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">Results</h1>
        <EmptyState title="Could not load the run list" body={runsErr} action={{ href: '/run', label: 'Open Run' }} />
      </main>
    )
  }
  if (!runs) return <main className="flex flex-1 px-7 py-5 text-ink-muted">Loading runs…</main>
  if (runs.length === 0) {
    return (
      <main className="flex flex-1 flex-col gap-3 px-7 py-5">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">Results</h1>
        <EmptyState title="No runs yet" body="Results are always shown per run. Create one on the Run screen (pick the scene set, conditions and models), drive it, then come back." action={{ href: '/run', label: 'Create a run' }} />
      </main>
    )
  }
  if (!p.run) return <main className="flex flex-1 px-7 py-5 text-ink-muted">Opening the latest run…</main>
  if (!run) {
    return (
      <main className="flex flex-1 flex-col gap-3 px-7 py-5">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold tracking-[-0.01em]">Results</h1>
          <RunPicker runs={runs} value={null} onChange={(id) => set({ run: id, scene: null })} />
        </div>
        <EmptyState title="Unknown run" body={`No run with id ${p.run}. Pick one above.`} />
      </main>
    )
  }

  /* ---- header ----------------------------------------------------------- */
  const scopeSeg = (
    <Seg
      ariaLabel="Scope"
      value={p.scope}
      onChange={(s) => set({ scope: s, scene: s === 'meal' ? p.scene : null })}
      options={[
        { id: 'study', label: 'Study' },
        { id: 'day', label: 'Day' },
        { id: 'meal', label: 'Meal' },
      ]}
    />
  )
  const modelSeg =
    models.length > 0 ? (
      <Seg
        ariaLabel="Model"
        value={model ?? ''}
        onChange={(m) => set({ model: m })}
        options={[
          ...models.map((m) => ({ id: m.id, label: `${capitalize(m.family)} ${m.tier}` })),
          ...(p.scope === 'study' && models.length > 1 ? [{ id: 'all', label: 'all models' }] : []),
        ]}
      />
    ) : null
  const conditionSeg =
    conditions.length > 0 && p.scope !== 'study' ? (
      <Seg ariaLabel="Condition" value={condition ?? ''} onChange={(c) => set({ condition: c })} options={conditions.map((c) => ({ id: c, label: CONDITION_LABEL[c] }))} />
    ) : null
  const runSub = runInfo
    ? `${runInfo.dates.length ? `${dayShort(runInfo.dates[0])}${runInfo.dates.length > 1 ? `–${dayShort(runInfo.dates[runInfo.dates.length - 1])}` : ''} · ` : ''}${runInfo.sceneCount} scenes · ${runInfo.scoredCount} of ${runInfo.cellCount} cells scored`
    : `${run.summary.scenes} scenes · ${run.summary.cells} cells`

  const rail = p.scope !== 'study' && (
    <CalendarRail month={month} onMonthChange={setMonth} selected={p.date} onSelect={(d) => set({ scope: p.scope === 'meal' ? 'meal' : 'day', date: d, scene: null })} />
  )

  const title =
    p.scope === 'study' ? 'Results' : p.scope === 'day' ? (p.date ? dayTitle(p.date) : 'Day') : mealHead ? `${dayShort(mealHead.meal.date)} · ${capitalize(mealHead.meal.slot ?? 'meal')}` : p.date ? dayShort(p.date) : 'Meal'

  return (
    <>
      {rail}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-auto px-7 py-5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-[-0.01em]">{title}</h1>
          {scopeSeg}
          {p.scope === 'meal' && mealHead && mealHead.scenes.length > 0 && (
            <Seg
              ariaLabel="Photo"
              value={mealHead.scene.id}
              onChange={(id) => set({ scene: id })}
              options={mealHead.scenes.map((s) => ({ id: s.id, label: `Photo ${s.index}`, disabled: !s.inRun, why: s.valid ? 'not in this run' : 'excluded scene' }))}
            />
          )}
          {p.scope === 'meal' && mealHead && mealHead.dayMeals.length > 1 && (
            <Seg
              ariaLabel="Meal"
              value={mealHead.meal.id}
              onChange={(id) => {
                const m = mealHead.dayMeals.find((x) => x.id === id)
                const first = m?.scenes.find((s) => s.inRun) ?? m?.scenes[0]
                if (first) set({ scene: first.id })
              }}
              options={mealHead.dayMeals.map((m) => ({ id: m.id, label: capitalize(m.slot ?? 'meal'), disabled: !m.scenes.some((s) => s.inRun), why: 'no scene of this meal is in the run' }))}
            />
          )}
          <span className="text-ink-muted">
            <span className="font-mono">{run.label}</span> · {p.scope === 'study' ? runSub : p.scope === 'day' ? (dayTitleText ?? runSub) : `${tableModel ?? ''}`}
          </span>
          <RunPicker runs={runs} value={run.id} onChange={(id) => set({ run: id, scene: null, model: null, condition: null })} />
          <span className="ml-auto flex items-center gap-2">
            {p.scope === 'study' && (
              <Seg
                ariaLabel="Meal split"
                value={p.split}
                onChange={(s) => set({ split: s })}
                options={[
                  { id: 'all', label: 'All meals' },
                  { id: 'routine', label: 'Routine', disabled: !splitEnabled, why: 'context version not built — the routine flag is not recorded on this run' },
                  { id: 'novel', label: 'Novel', disabled: !splitEnabled, why: 'context version not built — the routine flag is not recorded on this run' },
                ]}
              />
            )}
            {conditionSeg}
            {modelSeg}
            {p.scope === 'study' && (
              <Button asChild variant="outline" size="sm" className="h-7 bg-white">
                <a href={`/api/export/cells?run=${encodeURIComponent(run.id)}`} download>
                  Export CSV
                </a>
              </Button>
            )}
          </span>
        </div>

        {!tableModel ? (
          <EmptyState title="This run has no models" body="The run config lists no models, so no cell can exist." action={{ href: '/run', label: 'Open Run' }} />
        ) : p.scope === 'study' ? (
          <StudyScope runId={run.id} model={model ?? tableModel} split={p.split} nutrient={p.nutrient} onNutrient={(n) => set({ nutrient: n })} onLoaded={onStudyLoaded} />
        ) : p.scope === 'day' ? (
          <DayScope runId={run.id} date={p.date} model={tableModel} condition={condition} onLoaded={onDayLoaded} onOpenScene={(sceneId) => set({ scope: 'meal', scene: sceneId })} />
        ) : (
          <MealScope runId={run.id} sceneId={p.scene} date={p.date} model={tableModel} condition={condition} onLoaded={onMealLoaded} />
        )}
      </main>
    </>
  )
}
