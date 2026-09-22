/* Routine flag from the db (CORPUS.md §5; METRICS "split by routine vs novel").
   The pure rule lives in ./routine (classifyRoutine); this module loads the
   inputs: the run's config.contextVersionId → that version's DishCards (one
   cascade index per version, cached for the process) and the scene's GtItems.
   `null` when the run has no context version — the flag is then unknown, not
   novel. Used by the score runner (persisted on ScoreCell.routine) and by the
   one-off backfill. Embeddings are used when available (never under
   MOCK_LLM=1 — makeEmbedder returns null). */
import { db } from '../db'
import { CORPUS_CONFIG } from './config'
import { classifyRoutine } from './routine'
import { contextVersionIdOf } from '../retrieval/factory'
import { indexCards, type CardIndex } from '../retrieval/cascade'
import { makeEmbedder } from '../retrieval/embed'

const indexCache = new Map<string, Promise<CardIndex | null>>()

/** The cascade index of a context version; null when the version is unknown. */
export function cardIndexFor(contextVersionId: string): Promise<CardIndex | null> {
  let p = indexCache.get(contextVersionId)
  if (!p) {
    p = (async () => {
      const version = await db.contextVersion.findUnique({ where: { id: contextVersionId }, include: { cards: true } })
      return version ? indexCards(version.cards) : null
    })()
    indexCache.set(contextVersionId, p)
  }
  return p
}

/** Drop the per-process index cache (tests; after a distill run in the same process). */
export function resetCardIndexCache(): void {
  indexCache.clear()
}

function cascadeOpts() {
  const embed = makeEmbedder() ?? undefined
  return { tokenOverlapMin: CORPUS_CONFIG.tokenOverlapMin, embedCosineMin: CORPUS_CONFIG.embedCosineMin, embed, minInstances: CORPUS_CONFIG.routineMinInstances }
}

/** Routine / novel for one scene against one context version; null when the
    version is absent or unknown. */
export async function routineForScene(sceneId: string, contextVersionId: string | null): Promise<boolean | null> {
  if (!contextVersionId) return null
  const index = await cardIndexFor(contextVersionId)
  if (!index) return null
  const items = await db.gtItem.findMany({ where: { sceneId }, orderBy: { order: 'asc' }, select: { dish: true, name: true, tag: true } })
  return (await classifyRoutine(items, index, cascadeOpts())).routine
}

/** The flag for a cell of a run: the run's config.contextVersionId decides. */
export async function routineForCell(runId: string, sceneId: string): Promise<boolean | null> {
  const run = await db.run.findUnique({ where: { id: runId }, select: { config: true } })
  if (!run) throw new Error(`run ${runId} not found`)
  return routineForScene(sceneId, contextVersionIdOf(run.config))
}

/** One-off backfill: compute the flag for every ScoreCell of a run and write
    it (null for every cell when the run has no context version). */
export async function backfillRoutine(runId: string): Promise<{ runId: string; contextVersionId: string | null; cells: number; scenes: number; routine: number; novel: number; unknown: number }> {
  const run = await db.run.findUnique({ where: { id: runId }, select: { config: true } })
  if (!run) throw new Error(`run ${runId} not found`)
  const contextVersionId = contextVersionIdOf(run.config)
  const cells = await db.scoreCell.findMany({ where: { runId }, select: { id: true, sceneId: true } })
  const sceneIds = [...new Set(cells.map((c) => c.sceneId))]
  let routine = 0
  let novel = 0
  let unknown = 0
  for (const sceneId of sceneIds) {
    const flag = await routineForScene(sceneId, contextVersionId)
    const n = cells.filter((c) => c.sceneId === sceneId).length
    if (flag === null) unknown += n
    else if (flag) routine += n
    else novel += n
    await db.scoreCell.updateMany({ where: { runId, sceneId }, data: { routine: flag } })
  }
  return { runId, contextVersionId, cells: cells.length, scenes: sceneIds.length, routine, novel, unknown }
}
