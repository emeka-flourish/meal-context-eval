'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { SceneListRow } from '@/lib/ui/intake-types'
import LockedSettings, { lockedRowsFromConfig, lockedRowsFromDefaults } from './LockedSettings'
import { REQUIRED_VANTAGES, capitalize, dayShort, plural, runVantages, type Vantage } from '@/lib/ui/format'
import {
  DEFAULT_CONCURRENCY,
  driveRun,
  failedKeys,
  formatElapsed,
  onlyKeys,
  postResultFromResponse,
  type DriverHandle,
  type DriverItem,
  type DriverProgress,
  type DriverSummary,
  type ItemState,
  type PostResult,
} from '@/lib/ui/run-driver'

/* Run (REBUILD-SPEC §3.3): new-run form → POST /api/runs; progress grid
   rows = photo scenes, columns = vantage × condition for one model at a
   time (+ context-only, once per scene); run list. Contract (pipeline
   agent, lib/runmatrix.ts):
     POST /api/runs  { label, mealSet:{kind:'all_valid'}|{kind:'dates',dates}, conditions, models:[{id,family,tier}] }
                     → 201 { ok, run:{ id, config, cellCount } }
     GET  /api/runs  → { runs:[{ id, label, createdAt, status, summary:{ scenes, cells, models, conditions } }] }
     GET  /api/runs/:id → { run:{ id, label, status, config }, progress:{ cells:[{sceneId,vantage,condition,modelId,state,error}], counts } }
   A 404 on either route renders the "runs API not ready" state.

   Execution (this file, lib/ui/run-driver.ts): "Start run" creates the run
   and immediately drives its work list from this tab — one POST /api/run-item
   per item, bounded concurrency, dependency order per cell — exactly the
   August RunDay fan-out. Live states come from the driver while it runs and
   from GET /api/runs/:id (the DB witness) once it stops. One driver per run
   per tab (module map); a run already `running` that this tab never drove is
   confirmed before driving (it may be driven from another tab). */

type Condition = 'image_only' | 'image_context' | 'context_only'
const CONDITIONS: { id: Condition; label: string; short: string; sw: string; help: string }[] = [
  { id: 'image_only', label: 'Photo only', short: 'photo', sw: 'bg-cond-1', help: 'The model sees the photo and nothing else.' },
  { id: 'image_context', label: 'Photo plus your context', short: 'photo + context', sw: 'bg-cond-2', help: 'The photo, plus what the Corpus tab knows about the dishes you usually eat.' },
  { id: 'context_only', label: 'Your context only, no photo', short: 'context only', sw: 'bg-cond-3', help: 'A baseline with no photo: how far does knowing your habits get on its own? Asked once per scene, not once per camera.' },
]
type Family = 'openai' | 'anthropic' | 'google'
type Tier = 'frontier' | 'cheap'
const FAMILIES: { id: Family; label: string }[] = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'google', label: 'Google' },
]
const TIER_LABEL: Record<string, string> = { frontier: 'most capable', cheap: 'small and cheap' }
type RunModel = { id: string; family: string; tier: string }
const familyLabel = (f: string) => FAMILIES.find((x) => x.id === f)?.label ?? f

const PERSONAS = [
  { id: 'ibs', label: 'IBS-M · 3 decisions' },
  { id: 'glp1', label: 'GLP-1 patient · 3 decisions' },
]

type PromptRef = { version: string; hash: string | null; text: string | null }
type Defaults = {
  roster: { id: string; family: Family; tier: Tier }[]
  cameras: Vantage[]
  locked: {
    interpret: PromptRef
    matcher: PromptRef & { modelId: string }
    classifier: PromptRef & { modelId: string }
    context: { id: string; label: string; createdAt: string; cardCount: number } | null
    aliasVersion: string
  }
  helpers: { structurer: string; judge: string }
}
/** the part of a saved run's settings this screen reads (lib/runmatrix RunConfig) */
type SavedConfig = {
  sceneIds: string[]
  conditions: Condition[]
  models: RunModel[]
  vantages?: Vantage[]
  promptVersion?: string
  promptBlockHashes?: Record<string, string>
  matcher?: { modelId: string; promptVersion: string }
  classifier?: { modelId: string; promptVersion: string }
  contextVersionId?: string | null
  contextVersionLabel?: string | null
  aliasVersion?: string
  mealSet?: { kind: string; dates?: string[] }
}

type ServerCellState = 'queued' | 'interpreted' | 'matched' | 'classified' | 'done' | 'failed'
type CellTone = 'queued' | 'running' | 'done' | 'failed'
const toneOf = (s: ServerCellState | undefined): CellTone => (s === 'done' ? 'done' : s === 'failed' ? 'failed' : s && s !== 'queued' ? 'running' : 'queued')

type RunRow = {
  id: string
  label: string
  createdAt?: string
  status?: string
  summary?: { scenes?: number; cells?: number; models?: RunModel[]; conditions?: Condition[] }
}
type RunDetail = {
  run: { id: string; label: string; status: string; config: SavedConfig }
  items: DriverItem[]
  progress: {
    cells: { sceneId: string; vantage: Vantage | null; condition: Condition; modelId: string; state: ServerCellState; error: string | null }[]
    counts: Record<ServerCellState, number>
  }
  /** optional: reported by GET /api/runs/:id when it sums the run's LlmCall ledger */
  cost?: { usd: number; calls?: number }
}

/* One driver per run per tab: module-level so a re-mounted screen cannot start a second one. */
const activeDrivers = new Map<string, DriverHandle>()
const drivenKey = (runId: string) => `cg_driven:${runId}`
const markDriven = (runId: string) => {
  try {
    sessionStorage.setItem(drivenKey(runId), '1')
  } catch {}
}
const wasDrivenHere = (runId: string) => {
  try {
    return sessionStorage.getItem(drivenKey(runId)) === '1'
  } catch {
    return false
  }
}
const cellKeyOf = (sceneId: string, vantage: Vantage | null, condition: Condition, modelId: string) => `${sceneId}|${vantage ?? 'none'}|${condition}|${modelId}`

/** Local overlay while the driver runs: per cell, the state of each kind. */
type LocalCell = Partial<Record<DriverItem['kind'], ItemState>> & { error?: string | null }
const localTone = (c: LocalCell): CellTone | null => {
  const states = (['interpret', 'match', 'classify', 'score'] as const).map((k) => c[k]).filter(Boolean) as ItemState[]
  if (states.length === 0) return null
  if (states.some((s) => s === 'running')) return 'running'
  if (states.some((s) => s === 'failed' || s === 'blocked')) return 'failed'
  if (c.score === 'done') return 'done'
  if (states.some((s) => s === 'done')) return 'running'
  return null // only queued/skipped so far → defer to the server state
}

async function postItem(item: DriverItem): Promise<PostResult> {
  const res = await fetch('/api/run-item', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: item.kind, ref: item.ref }) })
  const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
  return postResultFromResponse(res.status, body)
}

async function fetchDetail(runId: string): Promise<RunDetail> {
  const r = await fetch(`/api/runs/${runId}`)
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `GET /api/runs/${runId} ${r.status}`)
  return (await r.json()) as RunDetail
}

// Rough planning figure for ONE photo reading together with its matching call and its decision check.
// The run records the real cost of every call; this only sizes the run before it starts.
const COST_PER_READING_USD = 0.042

export default function RunScreen() {
  const [defaults, setDefaults] = useState<Defaults | null>(null)
  const [label, setLabel] = useState('')
  // period: '' = not chosen yet → the first / last day that has ready scenes
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [conditions, setConditions] = useState<Record<Condition, boolean>>({ image_only: true, image_context: true, context_only: true })
  // ids of the ticked roster models; null = not touched yet → the most capable model of each family
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const [allScenes, setAllScenes] = useState<SceneListRow[]>([])
  const [runs, setRuns] = useState<RunRow[] | null>(null)
  const [apiReady, setApiReady] = useState<boolean | null>(null)
  const [selectedRun, setSelectedRun] = useState<string | null>(null)
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [detailErr, setDetailErr] = useState<string | null>(null)
  const [viewModel, setViewModel] = useState<string | null>(null)
  const [submit, setSubmit] = useState<{ busy: boolean; msg: string | null; tone: 'ok' | 'warn' | 'err' }>({ busy: false, msg: null, tone: 'ok' })
  const [concurrency, setConcurrency] = useState(String(DEFAULT_CONCURRENCY))
  // the live driver of this tab (one run at a time on screen)
  const [drive, setDrive] = useState<{ runId: string; progress: DriverProgress; summary: DriverSummary | null } | null>(null)
  const [localCells, setLocalCells] = useState<{ runId: string; cells: Map<string, LocalCell> } | null>(null)
  const localRef = useRef<{ runId: string; cells: Map<string, LocalCell> } | null>(null)
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [, setTick] = useState(0)

  useEffect(() => {
    fetch('/api/intake/run-defaults')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Defaults | null) => {
        if (d) setDefaults(d)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/intake/scenes?set=all')
      .then((r) => (r.ok ? r.json() : { scenes: [] }))
      .then((p: { scenes: SceneListRow[] }) => setAllScenes(p.scenes))
      .catch(() => setAllScenes([]))
  }, [])

  const loadRuns = useCallback(
    () =>
      fetch('/api/runs')
        .then(async (r) => {
          if (r.status === 404) return { ready: false as const, list: [] as RunRow[] }
          if (!r.ok) throw new Error(String(r.status))
          const j = (await r.json()) as { runs?: RunRow[] }
          return { ready: true as const, list: j.runs ?? [] }
        })
        .catch(() => ({ ready: false as const, list: [] as RunRow[] }))
        .then(({ ready, list }) => {
          setApiReady(ready)
          setRuns(list)
        }),
    [],
  )
  useEffect(() => {
    loadRuns()
  }, [loadRuns])

  // selected run detail (+ light polling while work is in flight)
  useEffect(() => {
    if (!selectedRun) return
    let live = true
    const load = () =>
      fetchDetail(selectedRun)
        .then((d) => {
          if (!live) return
          setDetail(d)
          setDetailErr(null)
        })
        .catch((e) => live && setDetailErr(e instanceof Error ? e.message : String(e)))
    load()
    const t = setInterval(load, 8000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [selectedRun])

  const roster = useMemo(() => defaults?.roster ?? [], [defaults])
  const isPicked = useCallback((m: { id: string; tier: string }) => (picked ? picked.has(m.id) : m.tier === 'frontier'), [picked])
  // exactly this list is sent as `models` in POST /api/runs
  const selectedModels = useMemo<RunModel[]>(() => roster.filter(isPicked).map((m) => ({ id: m.id, family: m.family, tier: m.tier })), [roster, isPicked])
  const toggleModel = (id: string, on: boolean) =>
    setPicked((cur) => {
      const next = new Set(cur ?? roster.filter((m) => m.tier === 'frontier').map((m) => m.id))
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  // period → the list of dates that have at least one ready scene (sent as mealSet {kind:'dates'})
  const readyDates = useMemo(() => [...new Set(allScenes.filter((s) => s.valid).map((s) => s.date))].sort(), [allScenes])
  const from = fromDate || readyDates[0] || ''
  const to = toDate || readyDates[readyDates.length - 1] || ''
  const inPeriod = useCallback((d: string) => Boolean(from && to) && d >= from && d <= to, [from, to])
  const periodDates = useMemo(() => readyDates.filter(inPeriod), [readyDates, inPeriod])
  const formScenes = useMemo(() => allScenes.filter((s) => inPeriod(s.date)), [allScenes, inPeriod])
  const eligible = formScenes.filter((s) => s.valid)
  const formConds = CONDITIONS.filter((c) => conditions[c.id]).map((c) => c.id)
  // cameras a NEW run asks per scene come from the server (STUDY_VANTAGES: phone, glasses) — never a fixed 3
  const formCameras: Vantage[] = defaults?.cameras?.length ? defaults.cameras : REQUIRED_VANTAGES
  const photoConds = formConds.filter((c) => c !== 'context_only').length
  const perScene = formCameras.length * photoConds + (formConds.includes('context_only') ? 1 : 0)
  /** one reading = one model looking at one scene through one camera under one condition (a grid square) */
  const readings = selectedModels.length * eligible.length * perScene
  const est = {
    readings,
    matching: readings, // each reading is paired with your notes by the matching model
    decisions: readings + eligible.length, // each reading gets a decision check, plus one per scene for your own notes
    total: readings * 3 + eligible.length,
    cost: readings * COST_PER_READING_USD,
  }
  const calls = readings
  const cost = est.cost

  // What the grid shows: the selected run (frozen config) or the form preview.
  const showing = detail && detail.run.id === selectedRun ? detail : null
  const gridCameras: Vantage[] = showing ? runVantages(showing.run.config) : formCameras
  const gridModels = showing ? showing.run.config.models : selectedModels
  const gridConds = showing ? showing.run.config.conditions : formConds
  const gridScenes = showing ? allScenes.filter((s) => showing.run.config.sceneIds.includes(s.id)) : formScenes
  const imageConds = CONDITIONS.filter((c) => c.id !== 'context_only' && gridConds.includes(c.id))
  const ctxOnly = gridConds.includes('context_only')
  const activeModel = viewModel && gridModels.some((m) => m.id === viewModel) ? viewModel : (gridModels[0]?.id ?? null)

  const cellIndex = useMemo(() => {
    const m = new Map<string, ServerCellState>()
    for (const c of showing?.progress.cells ?? []) m.set(`${c.sceneId}|${c.vantage ?? 'none'}|${c.condition}|${c.modelId}`, c.state)
    return m
  }, [showing])
  const overlay = localCells && showing && localCells.runId === showing.run.id ? localCells.cells : null
  const cellTone = (sceneId: string, vantage: Vantage | null, condition: Condition, modelId: string): CellTone => {
    const key = cellKeyOf(sceneId, vantage, condition, modelId)
    const local = overlay?.get(key)
    return (local && localTone(local)) ?? toneOf(cellIndex.get(key))
  }
  const cellError = (sceneId: string, vantage: Vantage | null, condition: Condition, modelId: string): string | null => {
    const key = cellKeyOf(sceneId, vantage, condition, modelId)
    return overlay?.get(key)?.error ?? showing?.progress.cells.find((c) => cellKeyOf(c.sceneId, c.vantage, c.condition, c.modelId) === key)?.error ?? null
  }

  /* ---- driving ------------------------------------------------------------ */
  const driving = drive && activeDrivers.has(drive.runId) ? drive : null
  const drivingThis = Boolean(driving && showing && driving.runId === showing.run.id)

  // elapsed ticks once a second while a driver is live
  useEffect(() => {
    if (!driving) return
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [driving])

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current) return
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null
      const cur = localRef.current
      if (cur) setLocalCells({ runId: cur.runId, cells: new Map(cur.cells) })
    }, 120)
  }, [])

  const startDrive = useCallback(
    async (runId: string, scope: 'all' | 'failed' | { keys: string[] }, opts: { fresh?: boolean } = {}) => {
      if (activeDrivers.has(runId)) {
        setSubmit({ busy: false, msg: 'This run is already being driven from this tab.', tone: 'warn' })
        return
      }
      let d: RunDetail
      try {
        d = await fetchDetail(runId)
      } catch (e) {
        setSubmit({ busy: false, msg: e instanceof Error ? e.message : String(e), tone: 'err' })
        return
      }
      setDetail(d)
      if (!opts.fresh && d.run.status === 'running' && !wasDrivenHere(runId)) {
        const go = window.confirm(`Run "${d.run.label}" is marked running and was not started from this tab — it may be driven from another tab right now. Drive it here anyway?`)
        if (!go) return
      }
      const items = d.items ?? []
      const only = scope === 'all' ? undefined : scope === 'failed' ? onlyKeys(failedKeys(items), items) : onlyKeys(new Set(scope.keys), items)
      const pending = items.filter((i) => !i.done && (only ? only(i) : true))
      if (pending.length === 0) {
        setSubmit({ busy: false, msg: scope === 'all' ? 'Nothing left to run — every item is done.' : 'Nothing to re-run in that selection.', tone: 'ok' })
        return
      }
      const cells = new Map<string, LocalCell>()
      localRef.current = { runId, cells }
      setLocalCells({ runId, cells: new Map() })
      const n = Math.max(1, Math.min(16, Number.parseInt(concurrency, 10) || DEFAULT_CONCURRENCY))
      const handle = driveRun(items, {
        post: postItem,
        concurrency: n,
        only,
        onItem: (o) => {
          const cur = localRef.current
          if (!cur || o.item.key.endsWith('|truth')) return
          const prev = cur.cells.get(o.item.key) ?? {}
          cur.cells.set(o.item.key, { ...prev, [o.item.kind]: o.state, error: o.state === 'failed' || o.state === 'blocked' ? o.error : prev.error ?? null })
          scheduleFlush()
        },
        onProgress: (p) => setDrive({ runId, progress: p, summary: null }),
      })
      activeDrivers.set(runId, handle)
      markDriven(runId)
      setDrive({ runId, progress: handle.progress(), summary: null })
      setSubmit({ busy: false, msg: `Running ${pending.length} steps, ${n} at the same time — leave this tab open until it finishes.`, tone: 'ok' })
      const summary = await handle.done
      activeDrivers.delete(runId)
      // the DB is the witness: re-read, then drop the local overlay
      try {
        const fresh = await fetchDetail(runId)
        setDetail(fresh)
      } catch {}
      localRef.current = null
      setLocalCells(null)
      setDrive({ runId, progress: summary, summary })
      await loadRuns()
      const tone = summary.stopped === 'fatal' ? 'err' : summary.failed || summary.blocked ? 'warn' : 'ok'
      const msg =
        summary.stopped === 'fatal'
          ? `Stopped: ${summary.fatal} — ${summary.done} done, ${summary.queued} not attempted. Fix the server/auth and press Continue.`
          : summary.stopped === 'aborted'
            ? `Stopped by you — ${summary.done} done, ${summary.failed} failed, ${summary.queued} left. Press Continue to resume.`
            : `Finished in ${formatElapsed(summary.elapsedMs)} — ${summary.done} done, ${summary.failed} failed, ${summary.blocked} blocked, ${summary.skipped} already done.`
      setSubmit({ busy: false, msg, tone })
    },
    [concurrency, loadRuns, scheduleFlush],
  )

  const pauseResume = () => {
    const h = driving ? activeDrivers.get(driving.runId) : undefined
    if (!h) return
    if (driving!.progress.paused) h.resume()
    else h.pause()
  }
  const stopDrive = () => {
    const h = driving ? activeDrivers.get(driving.runId) : undefined
    h?.abort()
  }
  // a driver started before a page reload is gone — the DB state still shows in the grid
  useEffect(() => {
    return () => {
      if (flushTimer.current) clearTimeout(flushTimer.current)
    }
  }, [])

  async function start() {
    setSubmit({ busy: true, msg: null, tone: 'ok' })
    const body = {
      label: label.trim() || 'run',
      mealSet: { kind: 'dates', dates: periodDates },
      conditions: formConds,
      models: selectedModels,
      // informational; the API stamps prompt hashes / pins itself
      personas: PERSONAS.map((p) => p.id),
      estimate: { calls: est.total, costUsd: Number(cost.toFixed(2)) },
    }
    try {
      const r = await fetch('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (r.status === 404) {
        setApiReady(false)
        setSubmit({ busy: false, msg: 'Runs API not ready — POST /api/runs returned 404. The form is wired; nothing was started.', tone: 'warn' })
        return
      }
      const j = (await r.json().catch(() => ({}))) as { run?: { id: string; cellCount?: number }; error?: string }
      if (!r.ok) throw new Error(j.error ?? `POST /api/runs ${r.status}`)
      setSubmit({ busy: false, msg: `Run "${label}" created${j.run?.cellCount != null ? ` · ${j.run.cellCount} cells` : ''} — starting…`, tone: 'ok' })
      await loadRuns()
      if (j.run?.id) {
        setSelectedRun(j.run.id)
        setViewModel(null)
        await startDrive(j.run.id, 'all', { fresh: true })
      }
    } catch (e) {
      setSubmit({ busy: false, msg: e instanceof Error ? e.message : String(e), tone: 'err' })
    }
  }

  const startBlocker =
    !label.trim()
      ? 'Give the run a name to start.'
      : selectedModels.length === 0
        ? 'Tick at least one model.'
        : formConds.length === 0
          ? 'Tick at least one thing for the model to be given.'
          : eligible.length === 0
            ? 'There is no ready photo scene in this period.'
            : apiReady === false
              ? 'The run service is not answering.'
              : ''
  const canStart = !submit.busy && !driving && apiReady !== false && selectedModels.length > 0 && formConds.length > 0 && eligible.length > 0 && label.trim().length > 0
  // cell counts from the merged view (driver overlay over the server state)
  const counts = useMemo(() => {
    if (!showing) return null
    const out = { done: 0, running: 0, queued: 0, failed: 0 }
    for (const c of showing.progress.cells) {
      const key = cellKeyOf(c.sceneId, c.vantage, c.condition, c.modelId)
      const local = overlay?.get(key)
      out[(local && localTone(local)) ?? toneOf(c.state)] += 1
    }
    return out
  }, [showing, overlay])
  const total = showing ? showing.progress.cells.length : calls
  const inFlight = counts ? counts.running : 0
  const liveElapsed = drive && showing && drive.runId === showing.run.id ? (activeDrivers.get(drive.runId)?.progress().elapsedMs ?? drive.progress.elapsedMs) : null
  const hasFailed = Boolean(counts && counts.failed > 0)
  const hasPending = Boolean(counts && counts.queued + counts.running > 0)

  return (
    <main className="flex min-w-0 flex-1 gap-[18px] overflow-hidden px-7 py-5">
      {/* New run form */}
      <div className="flex w-[430px] shrink-0 flex-col gap-4 overflow-y-auto rounded-[10px] border border-line bg-white px-[18px] pb-6 pt-4">
        <h1 className="text-base font-semibold tracking-[-0.01em]">New run</h1>
        <div>
          <label htmlFor="run-label" className="font-medium">
            Name
          </label>
          <Input id="run-label" value={label} onChange={(e) => setLabel(e.target.value)} className="mt-1 h-8 font-mono" placeholder="for example: september-both-cameras" />
        </div>

        <fieldset>
          <legend className="font-medium">Period to run</legend>
          <div className="mt-1 flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-ink-muted">
              From
              <Input type="date" value={from} min={readyDates[0]} max={to || undefined} onChange={(e) => setFromDate(e.target.value)} className="h-8 w-[150px]" aria-label="First day of the period" />
            </label>
            <label className="flex items-center gap-1.5 text-ink-muted">
              to
              <Input type="date" value={to} min={from || undefined} max={readyDates[readyDates.length - 1]} onChange={(e) => setToDate(e.target.value)} className="h-8 w-[150px]" aria-label="Last day of the period" />
            </label>
            {(fromDate || toDate) && (
              <button type="button" className="text-xs text-ink-muted underline underline-offset-2 hover:text-ink" onClick={() => (setFromDate(''), setToDate(''))}>
                All dates
              </button>
            )}
          </div>
          <div className="mt-1.5 text-xs text-ink-muted">
            {readyDates.length === 0 ? (
              'No photo scene is ready for the study yet — finish them on the Intake tab first.'
            ) : (
              <>
                This period covers <b className="text-ink">{plural(eligible.length, 'ready photo scene')}</b> on {plural(periodDates.length, 'day')}
                {periodDates.length > 0 && ` (${dayShort(periodDates[0])}${periodDates.length > 1 ? ` to ${dayShort(periodDates[periodDates.length - 1])}` : ''})`}.
                {formScenes.length > eligible.length && ` ${plural(formScenes.length - eligible.length, 'more scene')} in this period ${formScenes.length - eligible.length === 1 ? 'is' : 'are'} not ready and will be left out — fix them on the Intake tab.`}
              </>
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend className="font-medium">What the model is given</legend>
          <div className="mt-1 flex flex-col gap-1">
            {CONDITIONS.map((c) => (
              <label key={c.id} className={cn('flex cursor-pointer items-start gap-2 rounded-md border px-2 py-1.5', conditions[c.id] ? 'border-brand-tint bg-brand-soft/50' : 'border-line')}>
                <Checkbox checked={conditions[c.id]} onCheckedChange={(v) => setConditions((cur) => ({ ...cur, [c.id]: Boolean(v) }))} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-[13px]">
                    <span className={cn('size-2 rounded-[2px]', c.sw)} />
                    {c.label}
                  </span>
                  <span className="block text-[11px] leading-snug text-ink-muted">{c.help}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="mt-1 text-xs text-ink-muted">{formConds.length} of 3 selected</div>
        </fieldset>

        <fieldset>
          <legend className="font-medium">Models to test</legend>
          <div className="mt-1 flex flex-col gap-1">
            {roster.length === 0 && <span className="text-xs text-ink-faint">Loading the model list…</span>}
            {roster.map((m) => (
              <label key={m.id} className={cn('flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5', isPicked(m) ? 'border-brand-tint bg-brand-soft/50' : 'border-line')}>
                <Checkbox checked={isPicked(m)} onCheckedChange={(v) => toggleModel(m.id, Boolean(v))} aria-label={`Include ${m.id}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs">{m.id}</span>
                  <span className="block text-[11px] text-ink-muted">
                    {familyLabel(m.family)} · {TIER_LABEL[m.tier] ?? m.tier}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs">
            <b>
              {selectedModels.length} of {roster.length} models selected
            </b>
            <button type="button" className="text-ink-muted underline underline-offset-2 hover:text-ink" onClick={() => setPicked(new Set(roster.map((m) => m.id)))}>
              Select all
            </button>
            <button type="button" className="text-ink-muted underline underline-offset-2 hover:text-ink" onClick={() => setPicked(new Set())}>
              Clear
            </button>
          </div>
        </fieldset>

        <LockedSettings
          title="Settings that will be locked into this run"
          rows={defaults ? lockedRowsFromDefaults(defaults, formCameras, formConds) : null}
        />

        <div className="flex flex-col gap-2 rounded-lg border border-line bg-rail px-3 py-2.5">
          <div className="text-[13px]">
            <b>
              About {est.total.toLocaleString('en-US')} model calls, estimated cost ${cost < 10 ? cost.toFixed(2) : cost.toFixed(0)}
            </b>
          </div>
          <details className="text-xs text-ink-muted">
            <summary className="cursor-pointer select-none underline underline-offset-2">How this is worked out</summary>
            <div className="mt-1.5 flex flex-col gap-1">
              <div>
                <b className="text-ink">{readings.toLocaleString('en-US')} photo readings</b> = {eligible.length} scenes × {selectedModels.length} models × {perScene} per scene
                <span className="block text-[11px]">
                  ({formCameras.length} cameras × {photoConds} photo {photoConds === 1 ? 'setting' : 'settings'}
                  {formConds.includes('context_only') ? ', plus 1 with no photo' : ''})
                </span>
              </div>
              <div>
                + <b className="text-ink">{est.matching.toLocaleString('en-US')} matching calls</b> — each reading is paired with your notes, item by item
              </div>
              <div>
                + <b className="text-ink">{est.decisions.toLocaleString('en-US')} decision checks</b> — one per reading, plus one per scene for your own notes
              </div>
              <div>
                Cost: roughly ${COST_PER_READING_USD.toFixed(2)} for each photo reading together with its matching call and decision check. This is a planning figure; the real cost is recorded as the run goes.
              </div>
            </div>
          </details>
          <label className="flex items-center gap-2 text-xs">
            <span className="flex-1">
              How many calls to run at the same time
              <span className="block text-[11px] text-ink-muted">Between 1 and 16. A higher number finishes sooner; lower it if calls start failing because a provider is limiting you.</span>
            </span>
            <Input
              value={concurrency}
              onChange={(e) => setConcurrency(e.target.value.replace(/[^\d]/g, '').slice(0, 2))}
              aria-label="How many calls to run at the same time"
              inputMode="numeric"
              className="h-8 w-12 bg-white px-1.5 text-center font-mono text-xs"
            />
          </label>
          <Button type="button" disabled={!canStart} onClick={start} className="w-full">
            {submit.busy ? 'Starting…' : driving ? 'A run is in progress…' : `Start run with ${plural(selectedModels.length, 'model')}`}
          </Button>
          {!canStart && !submit.busy && !driving && <div className="text-[11px] text-ink-muted">{startBlocker}</div>}
        </div>
        {submit.msg && (
          <div
            className={cn(
              'rounded-md px-2.5 py-1.5 text-xs',
              submit.tone === 'ok' && 'bg-brand-soft text-ink',
              submit.tone === 'warn' && 'border border-estimated-line bg-estimated-bg text-estimated-ink',
              submit.tone === 'err' && 'bg-over-bg text-over-ink',
            )}
          >
            {submit.msg}
          </div>
        )}
      </div>

      {/* Runs + progress */}
      <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden rounded-[10px] border border-line bg-white px-[18px] py-4">
        <div className="flex flex-wrap items-center gap-2 border-b border-line-soft pb-2.5">
          <span className="text-ink-muted">Runs</span>
          {apiReady === false && <span className="chip chip-estimated">The run service is not answering</span>}
          {apiReady === null && <span className="chip">Loading runs…</span>}
          <button type="button" onClick={() => setSelectedRun(null)} className={cn('chip', selectedRun === null && 'chip-solid')}>
            Preview of the new run
          </button>
          {runs?.map((r) => (
            <button key={r.id} type="button" onClick={() => setSelectedRun(r.id)} className={cn('chip', r.id === selectedRun && 'chip-solid')}>
              {r.label}
              {r.createdAt && ` · ${dayShort(r.createdAt.slice(0, 10))}`}
              {r.summary?.scenes != null && ` · ${plural(r.summary.scenes, 'scene')}`}
              {r.status && ` · ${r.status}`}
            </button>
          ))}
          {apiReady && runs?.length === 0 && <span className="text-ink-faint">no runs yet</span>}
        </div>

        <div className="flex items-baseline gap-3">
          <b className="text-[15px]">{showing ? showing.run.label : label || 'preview'}</b>
          <span className="text-ink-muted">
            {showing && counts
              ? [
                  drivingThis ? (driving!.progress.paused ? 'paused' : 'running now') : showing.run.status === 'done' ? 'finished' : showing.run.status === 'running' ? 'started, not finished' : showing.run.status,
                  `${counts.done} of ${total} readings finished`,
                  `${inFlight} in progress`,
                  `${counts.failed} failed`,
                  drivingThis && `step ${driving!.progress.attempted} of ${driving!.progress.total - driving!.progress.skipped}`,
                  liveElapsed != null && `${formatElapsed(liveElapsed)} elapsed`,
                  showing.cost && `$${showing.cost.usd.toFixed(2)}`,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : selectedRun && detailErr
                ? detailErr
                : `Preview · ${calls} readings (one square each) will be queued`}
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            {drivingThis && (
              <>
                <Button type="button" variant="ghost" size="sm" className="text-ink-muted" onClick={pauseResume}>
                  {driving!.progress.paused ? 'Resume' : 'Pause'}
                </Button>
                <Button type="button" variant="ghost" size="sm" className="text-ink-muted" onClick={stopDrive} title="Stop dispatching; in-flight items finish. Continue later from the same place.">
                  Stop
                </Button>
              </>
            )}
            {showing && !drivingThis && hasPending && (
              <Button type="button" variant="ghost" size="sm" className="text-ink-muted" disabled={Boolean(driving)} onClick={() => startDrive(showing.run.id, 'all')} title="Drive every item not yet done">
                Continue run
              </Button>
            )}
            {showing && !drivingThis && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-ink-muted"
                disabled={!hasFailed || Boolean(driving)}
                onClick={() => startDrive(showing.run.id, 'failed')}
                title={hasFailed ? 'Re-run only the failed cells (and what they blocked)' : 'No failed cells'}
              >
                Re-run failed
              </Button>
            )}
          </span>
        </div>

        {showing && (
          <details className="rounded-md border border-line px-2.5 py-1.5">
            <summary className="cursor-pointer select-none text-xs text-ink-muted">Settings locked into this run</summary>
            <div className="mt-2 max-w-[560px]">
              <LockedSettings title="Settings locked into this run" rows={lockedRowsFromConfig(showing.run.config, gridCameras)} />
            </div>
          </details>
        )}

        <div className="flex items-center gap-3">
          <span className="text-ink-muted">Show the grid for</span>
          <span className="seg">
            {gridModels.map((m) => (
              <button key={m.id} type="button" data-on={activeModel === m.id} onClick={() => setViewModel(m.id)}>
                {FAMILIES.find((f) => f.id === m.family)?.label ?? m.family} {m.tier}
              </button>
            ))}
            {gridModels.length === 0 && <button type="button">no model selected</button>}
          </span>
          {activeModel && <span className="font-mono text-ink-faint">{activeModel}</span>}
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <Table className="text-[13px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="th-label px-2.5">scene</TableHead>
                {gridCameras.map((v) => (
                  <TableHead key={v} className="th-label px-2.5">
                    {v}
                  </TableHead>
                ))}
                <TableHead className="th-label px-2.5">no photo</TableHead>
                <TableHead />
              </TableRow>
              <TableRow className="hover:bg-transparent">
                <TableCell className="px-2.5 py-1 text-[11px] text-ink-muted" />
                {gridCameras.map((v) => (
                  <TableCell key={v} className="px-2.5 py-1 text-[11px] text-ink-muted">
                    {imageConds.map((c) => c.short).join(' · ') || '—'}
                  </TableCell>
                ))}
                <TableCell className="px-2.5 py-1 text-[11px] text-ink-muted">{ctxOnly ? 'context only' : '—'}</TableCell>
                <TableCell />
              </TableRow>
            </TableHeader>
            <TableBody>
              {gridScenes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={gridCameras.length + 3} className="px-2.5 py-6 text-center text-ink-faint">
                    No photo scenes in this period.
                  </TableCell>
                </TableRow>
              )}
              {gridScenes.map((s) => {
                const tones = activeModel && s.valid
                  ? [
                      ...gridCameras.flatMap((v) => imageConds.map((c) => cellTone(s.id, v, c.id, activeModel))),
                      ...(ctxOnly ? [cellTone(s.id, null, 'context_only', activeModel)] : []),
                    ]
                  : []
                const failedN = tones.filter((x) => x === 'failed').length
                const ctxErr = ctxOnly && s.valid && activeModel ? cellError(s.id, null, 'context_only', activeModel) : null
                const ctxTone: CellTone = ctxOnly && s.valid && activeModel ? cellTone(s.id, null, 'context_only', activeModel) : 'queued'
                const ctxClickable = Boolean(ctxOnly && showing && s.valid && activeModel && !drivingThis && ctxTone !== 'done')
                const rowStatus = !s.valid ? 'excluded' : failedN ? `${failedN} failed` : tones.includes('running') ? 'running' : tones.length && tones.every((x) => x === 'done') ? 'done' : 'queued'
                return (
                  <TableRow key={s.id} className={cn('hover:bg-transparent', !s.valid && 'opacity-50')}>
                    <TableCell className="px-2.5 py-1.5 whitespace-nowrap">
                      {dayShort(s.date)} · {capitalize(s.slot ?? 'meal').toLowerCase()} · photo {s.index}
                    </TableCell>
                    {gridCameras.map((v) => (
                      <TableCell key={v} className="px-2.5 py-1.5">
                        <span className="inline-flex gap-1">
                          {imageConds.map((c) => {
                            const err = s.valid && activeModel ? cellError(s.id, v, c.id, activeModel) : null
                            const tone = s.valid && activeModel ? cellTone(s.id, v, c.id, activeModel) : 'queued'
                            const clickable = Boolean(showing && s.valid && activeModel && !drivingThis && tone !== 'done')
                            return (
                              <button
                                key={c.id}
                                type="button"
                                disabled={!clickable}
                                onClick={() => clickable && startDrive(showing!.run.id, { keys: [cellKeyOf(s.id, v, c.id, activeModel!)] })}
                                title={`${v} · ${c.label}${activeModel ? ` · ${activeModel}` : ''}${err ? `\n${err}` : ''}${clickable ? '\nclick to run this cell' : ''}`}
                                className={cn('cell', `cell-${tone}`, !s.vantages.includes(v) && 'opacity-30', clickable && 'cursor-pointer')}
                              />
                            )
                          })}
                        </span>
                      </TableCell>
                    ))}
                    <TableCell className="px-2.5 py-1.5">
                      {ctxOnly && (
                        <button
                          type="button"
                          disabled={!ctxClickable}
                          onClick={() => ctxClickable && startDrive(showing!.run.id, { keys: [cellKeyOf(s.id, null, 'context_only', activeModel!)] })}
                          title={`context only (per scene)${activeModel ? ` · ${activeModel}` : ''}${ctxErr ? `\n${ctxErr}` : ''}${ctxClickable ? '\nclick to run this cell' : ''}`}
                          className={cn('cell', `cell-${ctxTone}`, ctxClickable && 'cursor-pointer')}
                        />
                      )}
                    </TableCell>
                    <TableCell className={cn('px-2.5 py-1.5 text-ink-muted', failedN > 0 && 'text-over-ink')}>
                      {rowStatus === 'excluded' ? 'not ready — left out' : rowStatus}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
        <div className="flex gap-3.5 text-ink-muted">
          <span>
            <span className="cell cell-done align-middle" /> done
          </span>
          <span>
            <span className="cell cell-running align-middle" /> in progress (read, then matched, then checked)
          </span>
          <span>
            <span className="cell cell-queued align-middle" /> queued
          </span>
          <span>
            <span className="cell cell-failed align-middle" /> failed
          </span>
        </div>
      </div>
    </main>
  )
}
