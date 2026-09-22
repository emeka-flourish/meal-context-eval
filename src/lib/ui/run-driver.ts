/* Run driver (REBUILD-SPEC §3.3): executes the work list of a Run by posting
   one item at a time to POST /api/run-item — the same client-side fan-out the
   August RunDay used, generalised over the v2 work list of lib/runmatrix.ts.

   Pure: no fetch, no DOM. The caller injects `post(item)`; the browser
   (RunScreen) and the CLI (scripts/run.ts) share this file.

   Dependencies (per cell key k): interpret(k) → match(k) → classify(k,
   estimate) → score(k); score(k) also waits for classify(scene, truth), which
   runs once per scene and has no dependency. An item already `done` on the
   work list satisfies its dependants without being posted (resume). An item
   whose dependency failed is `blocked` — never posted, reported separately.

   Bounded concurrency (default 4): a pool of workers pulls the next READY
   item in work-list order, so a cell tends to complete before the next cell
   starts and the grid fills cell by cell.

   Failures are per item and never stop the run — except a FATAL result
   (auth/config: HTTP 401/403, or `fatal: true` from post), which stops
   dispatching; in-flight items finish, the rest stay `queued`.

   Pause stops dispatching (in-flight finish); resume continues; abort stops
   for good. Progress is reported through callbacks after every state change. */

export type DriverKind = 'interpret' | 'match' | 'classify' | 'score'

export type DriverItem = {
  kind: DriverKind
  ref: string
  key: string // cell key, or `${sceneId}|truth`
  sceneId: string
  done: boolean
  failed?: string | null
  label?: string
}

export type PostResult = { ok: true } | { ok: false; error: string; status?: number; fatal?: boolean }

export type ItemState = 'skipped' | 'queued' | 'running' | 'done' | 'failed' | 'blocked'

export type ItemOutcome = { item: DriverItem; state: ItemState; error: string | null; ms: number | null }

export type DriverProgress = {
  total: number // items the driver was asked to consider
  attempted: number // items posted (done + failed so far + running)
  done: number
  failed: number
  blocked: number
  skipped: number // already done on the work list
  queued: number
  running: number
  elapsedMs: number
  fatal: string | null
  paused: boolean
}

export type DriverSummary = DriverProgress & {
  outcomes: ItemOutcome[]
  stopped: 'finished' | 'fatal' | 'aborted'
}

export type DriverOptions = {
  post: (item: DriverItem) => Promise<PostResult>
  concurrency?: number
  /** restrict the attempt set (deps outside the set still gate, via the work list's done flags) */
  only?: (item: DriverItem) => boolean
  /** fires when an item starts (`running`) and when it settles (`done` | `failed` | `blocked`) */
  onItem?: (outcome: ItemOutcome, progress: DriverProgress) => void
  onProgress?: (progress: DriverProgress) => void
  /** override what counts as fatal (default: HTTP 401/403 or `fatal: true`) */
  isFatal?: (r: Exclude<PostResult, { ok: true }>) => boolean
  now?: () => number
}

export type DriverHandle = {
  done: Promise<DriverSummary>
  pause: () => void
  resume: () => void
  abort: () => void
  progress: () => DriverProgress
}

export const DEFAULT_CONCURRENCY = 4

export const itemId = (i: { kind: DriverKind; key: string }) => `${i.kind}|${i.key}`
export const truthKey = (sceneId: string) => `${sceneId}|truth`

/** The ids of the items an item waits for. */
export function dependenciesOf(item: DriverItem): string[] {
  const truth = item.key.endsWith('|truth')
  switch (item.kind) {
    case 'interpret':
      return []
    case 'match':
      return [itemId({ kind: 'interpret', key: item.key })]
    case 'classify':
      return truth ? [] : [itemId({ kind: 'match', key: item.key })]
    case 'score':
      return [itemId({ kind: 'classify', key: item.key }), itemId({ kind: 'classify', key: truthKey(item.sceneId) })]
  }
}

export function defaultIsFatal(r: Exclude<PostResult, { ok: true }>): boolean {
  return Boolean(r.fatal) || r.status === 401 || r.status === 403
}

/** Order-preserving, dependency-aware, bounded-concurrency execution. */
export function driveRun(items: DriverItem[], opts: DriverOptions): DriverHandle {
  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? DEFAULT_CONCURRENCY))
  const now = opts.now ?? (() => Date.now())
  const isFatal = opts.isFatal ?? defaultIsFatal
  const t0 = now()

  // state per item id
  const byId = new Map<string, DriverItem>()
  for (const it of items) byId.set(itemId(it), it)
  const state = new Map<string, ItemState>()
  const error = new Map<string, string | null>()
  const ms = new Map<string, number | null>()
  const outcomes: ItemOutcome[] = []

  const inScope = (it: DriverItem) => (opts.only ? opts.only(it) : true)
  for (const it of items) {
    const id = itemId(it)
    if (it.done) state.set(id, 'skipped')
    else if (!inScope(it)) state.set(id, 'skipped')
    else state.set(id, 'queued')
    error.set(id, null)
    ms.set(id, null)
  }

  let fatal: string | null = null
  let paused = false
  let aborted = false
  let running = 0
  let finished = false

  const counts = (): DriverProgress => {
    let done = 0
    let failed = 0
    let blocked = 0
    let skipped = 0
    let queued = 0
    let runningN = 0
    for (const s of state.values()) {
      if (s === 'done') done++
      else if (s === 'failed') failed++
      else if (s === 'blocked') blocked++
      else if (s === 'skipped') skipped++
      else if (s === 'queued') queued++
      else if (s === 'running') runningN++
    }
    return {
      total: items.length,
      attempted: done + failed + runningN,
      done,
      failed,
      blocked,
      skipped,
      queued,
      running: runningN,
      elapsedMs: now() - t0,
      fatal,
      paused,
    }
  }
  const emit = () => opts.onProgress?.(counts())

  const satisfied = (id: string): boolean => {
    const s = state.get(id)
    // a dependency outside the work list (e.g. truth of a scene not listed) is treated as satisfied
    return s === undefined || s === 'done' || s === 'skipped'
  }
  const upstreamFailed = (id: string): boolean => {
    const s = state.get(id)
    return s === 'failed' || s === 'blocked'
  }

  // Propagate blocks: every queued item with a failed/blocked dependency becomes blocked (transitively).
  const propagateBlocks = () => {
    let changed = true
    while (changed) {
      changed = false
      for (const it of items) {
        const id = itemId(it)
        if (state.get(id) !== 'queued') continue
        const deps = dependenciesOf(it)
        const bad = deps.find((d) => upstreamFailed(d))
        if (bad) {
          state.set(id, 'blocked')
          const badItem = byId.get(bad)
          const reason = `blocked: ${badItem ? badItem.kind : bad} ${state.get(bad)}${error.get(bad) ? ` — ${error.get(bad)}` : ''}`
          error.set(id, reason)
          outcomes.push({ item: it, state: 'blocked', error: reason, ms: null })
          opts.onItem?.({ item: it, state: 'blocked', error: reason, ms: null }, counts())
          changed = true
        }
      }
    }
  }

  const nextReady = (): DriverItem | null => {
    for (const it of items) {
      const id = itemId(it)
      if (state.get(id) !== 'queued') continue
      if (dependenciesOf(it).every(satisfied)) return it
    }
    return null
  }
  const anyQueued = () => [...state.values()].some((s) => s === 'queued')

  let resolveDone!: (s: DriverSummary) => void
  const done = new Promise<DriverSummary>((r) => (resolveDone = r))

  const finish = () => {
    if (finished) return
    finished = true
    const stopped: DriverSummary['stopped'] = fatal ? 'fatal' : aborted ? 'aborted' : 'finished'
    resolveDone({ ...counts(), outcomes, stopped })
  }

  const runOne = async (it: DriverItem) => {
    const id = itemId(it)
    state.set(id, 'running')
    running++
    opts.onItem?.({ item: it, state: 'running', error: null, ms: null }, counts())
    emit()
    const t = now()
    let r: PostResult
    try {
      r = await opts.post(it)
    } catch (e) {
      r = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    const took = now() - t
    running--
    ms.set(id, took)
    if (r.ok) {
      state.set(id, 'done')
      error.set(id, null)
      const o: ItemOutcome = { item: it, state: 'done', error: null, ms: took }
      outcomes.push(o)
      opts.onItem?.(o, counts())
    } else {
      state.set(id, 'failed')
      error.set(id, r.error)
      const o: ItemOutcome = { item: it, state: 'failed', error: r.error, ms: took }
      outcomes.push(o)
      if (!fatal && isFatal(r)) fatal = r.error
      opts.onItem?.(o, counts())
      propagateBlocks()
    }
    emit()
  }

  // The pump: fill the pool up to `concurrency` with ready items, then wait
  // for something to finish and pump again. Items become ready as their
  // dependencies complete; a queued item with no ready path left (only when
  // every dependency has been resolved) cannot exist — its dependencies are
  // either done/skipped (ready), failed/blocked (it gets blocked) or running.
  let pumping = false
  const pump = () => {
    if (finished || pumping) return
    pumping = true
    try {
      while (!paused && !aborted && !fatal && running < concurrency) {
        const it = nextReady()
        if (!it) break
        void runOne(it).then(pump)
      }
      if (running === 0) {
        if (aborted || fatal) finish()
        else if (!anyQueued()) finish()
        // paused with nothing in flight: wait for resume()
      }
    } finally {
      pumping = false
    }
  }

  const handle: DriverHandle = {
    done,
    pause: () => {
      if (finished) return
      paused = true
      emit()
    },
    resume: () => {
      if (finished || !paused) return
      paused = false
      emit()
      pump()
    },
    abort: () => {
      if (finished) return
      aborted = true
      emit()
      if (running === 0) finish()
    },
    progress: counts,
  }

  // start asynchronously so the caller holds the handle before the first post
  Promise.resolve().then(() => {
    if (items.length === 0 || !anyQueued()) {
      finish()
      return
    }
    pump()
  })
  return handle
}

/** Convenience: run to completion. */
export async function driveRunToEnd(items: DriverItem[], opts: DriverOptions): Promise<DriverSummary> {
  return driveRun(items, opts).done
}

/* ---- helpers shared by the browser and the CLI --------------------------- */

/** The cell keys that carry at least one failed item (for "Re-run failed"). */
export function failedKeys(items: DriverItem[]): Set<string> {
  const s = new Set<string>()
  for (const it of items) if (it.failed) s.add(it.key)
  return s
}

/** Predicate: items of the given cell keys, plus the truth classification of
    their scenes; a truth key in the set widens to every item of that scene
    (its scores were blocked, not failed). Done items are skipped regardless. */
export function onlyKeys(keys: Set<string>, items: DriverItem[]): (item: DriverItem) => boolean {
  const scenes = new Set<string>()
  const truthScenes = new Set<string>()
  for (const it of items) {
    if (!keys.has(it.key)) continue
    scenes.add(it.sceneId)
    if (it.key === truthKey(it.sceneId)) truthScenes.add(it.sceneId)
  }
  return (it) => keys.has(it.key) || (it.key === truthKey(it.sceneId) && scenes.has(it.sceneId)) || truthScenes.has(it.sceneId)
}

/** Interpret an HTTP response of POST /api/run-item as a PostResult. */
export function postResultFromResponse(status: number, body: { ok?: boolean; error?: string } | null): PostResult {
  if (status >= 200 && status < 300 && body?.ok !== false) return { ok: true }
  const error = body?.error ?? `HTTP ${status}`
  return { ok: false, error, status, fatal: status === 401 || status === 403 }
}

export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const mm = String(m % 60).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}
