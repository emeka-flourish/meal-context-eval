/* Run matrix (REBUILD-SPEC §1 "Result cell", §3.3): the work items of a Run.
   Successor of runday.ts for the v2 path (runday.ts stays for the legacy
   routes). Pure enumeration + a db-backed work-list builder; execution is
   per-item fan-out via POST /api/run-item exactly as before.

   Cells = valid scene × vantage × {image_only, image_context} × model
         + valid scene × model for context_only (no vantage).
   Per cell, in order: interpret → match → classify(estimate) → score.
   Per scene, once: classify(truth). Done-ness is read from the target rows;
   failures from RunItemError (last error per item, cleared on success).
   NOTE: relative imports (no '@/') so vitest loads it with a db stub. */
import { db } from './db'
import type { Prisma } from '../generated/prisma/client'
import { CONFIG, type RosterModel } from './config'
import { BLOCK_KEYS, parsePromptBlocks, type BlockKey, type Condition, type Vantage } from './prompt-blocks'
import { loadPrompt } from './config'
import { STUDY_VANTAGES } from './intake'

export const VANTAGES: readonly Vantage[] = ['phone', 'glasses', 'tripod'] as const
export const CONDITIONS: readonly Condition[] = ['image_only', 'image_context', 'context_only'] as const

export type RunModel = { id: string; family: string; tier: string }

export type MealSet =
  | { kind: 'all_valid' }
  | { kind: 'dates'; dates: string[] } // YYYY-MM-DD, local
  | { kind: 'scenes'; sceneIds: string[] }

export type RunConfig = {
  label: string
  mealSet: MealSet
  /** frozen at creation: the valid scenes the run covers */
  sceneIds: string[]
  conditions: Condition[]
  models: RunModel[]
  promptVersion: string
  /** sha256 of each SOURCE block of the interpret prompt */
  promptBlockHashes: Record<BlockKey, string>
  matcher: { modelId: string; promptVersion: string }
  classifier: { modelId: string; promptVersion: string }
  corpusVersion: string
  aliasVersion: string
  /** ContextVersion used by the DbContextProvider (null → NullContextProvider: empty context) */
  contextVersionId: string | null
  contextVersionLabel: string | null
  /** cameras asked per scene; absent on older runs (= phone, glasses, tripod) */
  vantages?: Vantage[]
  /** retrieval behind the context conditions: v1 = generic router + name cascade; v2 = router picks from the person's dish names, frequent cards preferred, up to 5 cards, as-served cards */
  retrievalVersion?: 'v1' | 'v2'
  consistency?: unknown
}

export type Cell = { sceneId: string; vantage: Vantage | null; condition: Condition; modelId: string; key: string }

export function cellKey(c: { sceneId: string; vantage: Vantage | null; condition: Condition; modelId: string }): string {
  return `${c.sceneId}|${c.vantage ?? 'none'}|${c.condition}|${c.modelId}`
}

/** All result cells of a run. context_only has no vantage and runs once per scene × model. */
export function enumerateCells(sceneIds: string[], config: { conditions: readonly Condition[]; models: readonly { id: string }[]; vantages?: readonly Vantage[] }): Cell[] {
  const cells: Cell[] = []
  for (const sceneId of sceneIds) {
    for (const condition of config.conditions) {
      for (const m of config.models) {
        if (condition === 'context_only') {
          const c = { sceneId, vantage: null, condition, modelId: m.id }
          cells.push({ ...c, key: cellKey(c) })
          continue
        }
        for (const vantage of config.vantages ?? VANTAGES) {
          const c = { sceneId, vantage, condition, modelId: m.id }
          cells.push({ ...c, key: cellKey(c) })
        }
      }
    }
  }
  return cells
}

/* ---- run creation ------------------------------------------------------------ */
export type CreateRunInput = {
  label: string
  retrievalVersion?: 'v1' | 'v2'
  mealSet?: MealSet
  conditions?: Condition[]
  models?: RunModel[]
  /** ContextVersion to retrieve from for image_context / context_only; omitted → latest version */
  contextVersionId?: string | null
}

const isCondition = (c: string): c is Condition => (CONDITIONS as readonly string[]).includes(c)

export async function resolveSceneIds(mealSet: MealSet): Promise<string[]> {
  if (mealSet.kind === 'scenes') {
    const rows = await db.photoScene.findMany({ where: { id: { in: mealSet.sceneIds }, valid: true }, select: { id: true } })
    return rows.map((r) => r.id)
  }
  if (mealSet.kind === 'dates') {
    const ranges = mealSet.dates.map((d) => {
      const start = new Date(`${d}T00:00:00`)
      return { eatenAt: { gte: start, lt: new Date(start.getTime() + 86400_000) } }
    })
    if (ranges.length === 0) return []
    const rows = await db.photoScene.findMany({
      where: { valid: true, meal: { OR: ranges } },
      orderBy: [{ meal: { eatenAt: 'asc' } }, { index: 'asc' }],
      select: { id: true },
    })
    return rows.map((r) => r.id)
  }
  const rows = await db.photoScene.findMany({ where: { valid: true }, orderBy: [{ meal: { eatenAt: 'asc' } }, { index: 'asc' }], select: { id: true } })
  return rows.map((r) => r.id)
}

export function buildRunConfig(input: CreateRunInput, sceneIds: string[]): RunConfig {
  const conditions = (input.conditions ?? [...CONDITIONS]).filter(isCondition)
  if (conditions.length === 0) throw new Error('run needs at least one condition')
  const models: RunModel[] = (input.models ?? CONFIG.roster.map((m: RosterModel) => ({ ...m }))).map((m) => ({
    id: String(m.id),
    family: String(m.family),
    tier: String(m.tier ?? 'frontier'),
  }))
  if (models.length === 0) throw new Error('run needs at least one model')
  const blocks = parsePromptBlocks(loadPrompt(CONFIG.interpret.promptVersion))
  const promptBlockHashes = {} as Record<BlockKey, string>
  for (const k of BLOCK_KEYS) promptBlockHashes[k] = blocks.sourceHashes[k]
  return {
    label: input.label,
    mealSet: input.mealSet ?? { kind: 'all_valid' },
    sceneIds,
    conditions,
    models,
    promptVersion: CONFIG.interpret.promptVersion,
    promptBlockHashes,
    matcher: { modelId: CONFIG.matcher.modelId, promptVersion: CONFIG.matcher.promptVersion },
    classifier: { modelId: CONFIG.classifier.modelId, promptVersion: CONFIG.classifier.promptVersion },
    corpusVersion: CONFIG.versions.corpus,
    aliasVersion: CONFIG.versions.alias,
    contextVersionId: null,
    contextVersionLabel: null,
    vantages: [...STUDY_VANTAGES],
    retrievalVersion: input.retrievalVersion ?? (process.env.RETRIEVAL_VERSION === 'v1' ? 'v1' : 'v2'),
  }
}

export async function createRun(input: CreateRunInput): Promise<{ id: string; config: RunConfig; cellCount: number }> {
  if (!input.label?.trim()) throw new Error('label required')
  const sceneIds = await resolveSceneIds(input.mealSet ?? { kind: 'all_valid' })
  const config = buildRunConfig(input, sceneIds)
  // Context version: explicit id, else the latest ContextVersion when any context condition is in the run.
  const needsContext = config.conditions.some((c) => c === 'image_context' || c === 'context_only')
  let cv: { id: string; label: string } | null = null
  if (input.contextVersionId) {
    cv = await db.contextVersion.findUnique({ where: { id: input.contextVersionId }, select: { id: true, label: true } })
    if (!cv) throw new Error(`contextVersionId ${input.contextVersionId} not found`)
  } else if (needsContext) {
    cv = await db.contextVersion.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true, label: true } })
    if (!cv) throw new Error('a context condition is selected but no ContextVersion exists — build context first (Corpus → Build context)')
  }
  config.contextVersionId = cv?.id ?? null
  config.contextVersionLabel = cv?.label ?? null
  if (cv) config.corpusVersion = cv.label
  const run = await db.run.create({
    data: { label: input.label.trim(), config: config as unknown as Prisma.InputJsonObject },
    select: { id: true },
  })
  return { id: run.id, config, cellCount: enumerateCells(sceneIds, config).length }
}

/* ---- work list --------------------------------------------------------------- */
export type RunWorkKind = 'interpret' | 'match' | 'classify' | 'score'

export type RunWorkItem = {
  kind: RunWorkKind
  ref: string // JSON args for /api/run-item
  label: string
  key: string // cell key, or `${sceneId}|truth` for the truth classification
  sceneId: string
  done: boolean
  failed: string | null
}

export type CellState = 'queued' | 'interpreted' | 'matched' | 'classified' | 'done' | 'failed'

export type RunProgress = {
  runId: string
  status: string
  cells: Array<Cell & { state: CellState; error: string | null }>
  counts: Record<CellState, number>
  byKind: Record<RunWorkKind, { total: number; done: number; failed: number }>
  scenes: number
}

export async function buildRunWorkList(runId: string): Promise<{ config: RunConfig; items: RunWorkItem[]; progress: RunProgress }> {
  const run = await db.run.findUnique({ where: { id: runId } })
  if (!run) throw new Error(`run ${runId} not found`)
  const config = run.config as RunConfig
  const cells = enumerateCells(config.sceneIds, config)

  const [decos, matchTables, classifications, scoreCells, errors, scenes] = await Promise.all([
    db.decomposition.findMany({ where: { runId, source: 'pipeline' }, select: { id: true, sceneId: true, vantage: true, condition: true, modelId: true } }),
    db.matchTable.findMany({ where: { runId }, select: { decompositionId: true } }),
    db.classification.findMany({ where: { runId }, select: { sceneId: true, side: true, decompositionId: true } }),
    db.scoreCell.findMany({ where: { runId }, select: { sceneId: true, vantage: true, condition: true, modelId: true } }),
    db.runItemError.findMany({ where: { runId }, select: { kind: true, key: true, error: true } }),
    db.photoScene.findMany({
      where: { id: { in: config.sceneIds } },
      select: { id: true, index: true, meal: { select: { eatenAt: true, mealType: true } } },
    }),
  ])

  const decoByKey = new Map<string, string>()
  for (const d of decos) {
    if (!d.sceneId || !d.condition || !d.modelId) continue
    decoByKey.set(cellKey({ sceneId: d.sceneId, vantage: (d.vantage as Vantage | null) ?? null, condition: d.condition, modelId: d.modelId }), d.id)
  }
  const matched = new Set(matchTables.map((m) => m.decompositionId))
  const truthClassified = new Set(classifications.filter((c) => c.side === 'truth').map((c) => c.sceneId))
  const estClassified = new Set(classifications.filter((c) => c.side === 'estimate' && c.decompositionId).map((c) => c.decompositionId as string))
  const scored = new Set(scoreCells.map((s) => cellKey({ sceneId: s.sceneId, vantage: (s.vantage as Vantage | null) ?? null, condition: s.condition, modelId: s.modelId })))
  const errorByKey = new Map(errors.map((e) => [`${e.kind}|${e.key}`, e.error]))
  const sceneLabel = new Map(
    scenes.map((s) => [s.id, `${s.meal.eatenAt.toLocaleDateString('en-CA')} ${s.meal.mealType ?? 'meal'} · photo ${s.index}`]),
  )

  const items: RunWorkItem[] = []
  const progressCells: RunProgress['cells'] = []
  const counts: Record<CellState, number> = { queued: 0, interpreted: 0, matched: 0, classified: 0, done: 0, failed: 0 }
  const byKind: RunProgress['byKind'] = {
    interpret: { total: 0, done: 0, failed: 0 },
    match: { total: 0, done: 0, failed: 0 },
    classify: { total: 0, done: 0, failed: 0 },
    score: { total: 0, done: 0, failed: 0 },
  }
  const push = (item: RunWorkItem) => {
    items.push(item)
    byKind[item.kind].total += 1
    if (item.done) byKind[item.kind].done += 1
    if (item.failed) byKind[item.kind].failed += 1
  }

  // once per scene: classify(truth)
  for (const sceneId of config.sceneIds) {
    const key = `${sceneId}|truth`
    push({
      kind: 'classify',
      ref: JSON.stringify({ runId, sceneId, side: 'truth' }),
      label: `classify · truth · ${sceneLabel.get(sceneId) ?? sceneId}`,
      key,
      sceneId,
      done: truthClassified.has(sceneId),
      failed: errorByKey.get(`classify|${key}`) ?? null,
    })
  }

  for (const c of cells) {
    const decoId = decoByKey.get(c.key)
    const where = `${c.vantage ?? 'no photo'} · ${c.condition} · ${c.modelId} · ${sceneLabel.get(c.sceneId) ?? c.sceneId}`
    const ref = JSON.stringify({ runId, sceneId: c.sceneId, vantage: c.vantage, condition: c.condition, modelId: c.modelId })
    const interpreted = Boolean(decoId)
    const isMatched = Boolean(decoId && matched.has(decoId))
    const isClassified = Boolean(decoId && estClassified.has(decoId))
    const isScored = scored.has(c.key)
    push({ kind: 'interpret', ref, label: `interpret · ${where}`, key: c.key, sceneId: c.sceneId, done: interpreted, failed: errorByKey.get(`interpret|${c.key}`) ?? null })
    push({ kind: 'match', ref, label: `match · ${where}`, key: c.key, sceneId: c.sceneId, done: isMatched, failed: errorByKey.get(`match|${c.key}`) ?? null })
    push({
      kind: 'classify',
      ref: JSON.stringify({ runId, sceneId: c.sceneId, side: 'estimate', vantage: c.vantage, condition: c.condition, modelId: c.modelId }),
      label: `classify · estimate · ${where}`,
      key: c.key,
      sceneId: c.sceneId,
      done: isClassified,
      failed: errorByKey.get(`classify|${c.key}`) ?? null,
    })
    push({ kind: 'score', ref, label: `score · ${where}`, key: c.key, sceneId: c.sceneId, done: isScored, failed: errorByKey.get(`score|${c.key}`) ?? null })

    const error =
      errorByKey.get(`interpret|${c.key}`) ?? errorByKey.get(`match|${c.key}`) ?? errorByKey.get(`classify|${c.key}`) ?? errorByKey.get(`score|${c.key}`) ?? null
    const state: CellState = error ? 'failed' : isScored ? 'done' : isClassified ? 'classified' : isMatched ? 'matched' : interpreted ? 'interpreted' : 'queued'
    counts[state] += 1
    progressCells.push({ ...c, state, error })
  }

  // derived run status (never overwrites a failed/aborted status set elsewhere)
  const allDone = items.length > 0 && items.every((i) => i.done)
  const anyStarted = items.some((i) => i.done)
  const status = allDone ? 'done' : anyStarted ? 'running' : run.status
  if (status !== run.status && (run.status === 'created' || run.status === 'running')) {
    await db.run.update({ where: { id: runId }, data: { status } })
  }

  return {
    config,
    items,
    progress: { runId, status, cells: progressCells, counts, byKind, scenes: config.sceneIds.length },
  }
}
