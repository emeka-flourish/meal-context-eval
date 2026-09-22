import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { CORPUS_CONFIG } from '@/lib/corpus/config'
import { classifyRoutine } from '@/lib/corpus/routine'
import { indexCards } from '@/lib/retrieval/cascade'
import { makeEmbedder } from '@/lib/retrieval/embed'
import type { RunConfig } from '@/lib/runmatrix'

// GET /api/corpus/routine?run=<id>&contextVersion=<id>
// Routine / novel per scene of the run (CORPUS.md §5): any core GT item whose
// dish label or name resolves through the cascade to a DishCard with
// instanceCount ≥ 3. contextVersion defaults to the run's config.contextVersionId.
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const runId = req.nextUrl.searchParams.get('run')
  let contextVersionId = req.nextUrl.searchParams.get('contextVersion')
  if (!runId) return NextResponse.json({ error: 'run required' }, { status: 400 })
  const run = await db.run.findUnique({ where: { id: runId }, select: { config: true } })
  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 })
  const cfg = run.config as RunConfig & { contextVersionId?: string }
  contextVersionId = contextVersionId ?? cfg.contextVersionId ?? null
  if (!contextVersionId) return NextResponse.json({ error: 'contextVersion required (the run has none in its config)' }, { status: 400 })
  const version = await db.contextVersion.findUnique({ where: { id: contextVersionId }, include: { cards: true } })
  if (!version) return NextResponse.json({ error: 'context version not found' }, { status: 404 })

  const index = indexCards(version.cards)
  const embed = makeEmbedder() ?? undefined
  const opts = { tokenOverlapMin: CORPUS_CONFIG.tokenOverlapMin, embedCosineMin: CORPUS_CONFIG.embedCosineMin, embed, minInstances: CORPUS_CONFIG.routineMinInstances }
  const scenes = await db.photoScene.findMany({
    where: { id: { in: cfg.sceneIds ?? [] } },
    include: { gtItems: { orderBy: { order: 'asc' }, select: { dish: true, name: true, tag: true } }, meal: { select: { eatenAt: true, mealType: true } } },
    orderBy: [{ meal: { eatenAt: 'asc' } }, { index: 'asc' }],
  })
  const out = []
  for (const s of scenes) {
    const v = await classifyRoutine(s.gtItems, index, opts)
    out.push({ sceneId: s.id, mealId: s.mealId, index: s.index, eatenAt: s.meal.eatenAt.toISOString(), slot: s.meal.mealType, ...v })
  }
  const routine = out.filter((o) => o.routine).length
  return NextResponse.json({
    runId,
    contextVersionId,
    minInstances: CORPUS_CONFIG.routineMinInstances,
    embeddings: Boolean(embed),
    counts: { scenes: out.length, routine, novel: out.length - routine },
    scenes: out,
  })
}
