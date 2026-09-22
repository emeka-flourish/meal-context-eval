import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { bad } from '../_shared'
import type { Condition, Vantage } from '@/lib/prompt-blocks'
import type { Identity, Tag } from '@/lib/scoring/types'
import type { MatchOverrideRequest, MatchOverrideResponse } from '@/lib/ui/results-types'
import { addMatchOverride } from '@/runners/match'
import { runScore } from '@/runners/score'

// POST /api/results/match-override — the owner's on-screen fix of one pairing
// (REBUILD-SPEC §3.4 "Match review"). Body: MatchOverrideRequest. Appends to
// MatchTable.overrides (the model's rows are never rewritten; override rate
// is published from overrides.length) and rescores the cell in place via the
// score runner with force=true (the /api/run-item contract has no force, so a
// plain re-post would be a no-op). A failed rescore still returns 200 with
// rescored=false — the Meal screen recomputes Level 1 from the match table
// and shows the cell as stale.

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const TAGS = new Set<Tag>(['core', 'secondary', 'garnish', 'spice', 'ignore'])

export async function POST(req: NextRequest) {
  let body: MatchOverrideRequest
  try {
    body = (await req.json()) as MatchOverrideRequest
  } catch {
    return bad('bad request: expected JSON body')
  }
  const { run, decompositionId, truthId } = body
  if (!run || !decompositionId || !truthId) return bad('run, decompositionId and truthId required')
  if (!Array.isArray(body.predIds) || body.predIds.some((p) => typeof p !== 'string')) return bad('predIds must be a string array')
  const identity: Identity = body.predIds.length === 0 ? 0 : body.identity === 0.5 ? 0.5 : body.identity === 1 ? 1 : 0
  if (body.predIds.length > 0 && identity === 0) return bad('identity must be 1 (exact) or 0.5 (substitute) when predIds are given')
  if (body.inventedTag !== undefined && !TAGS.has(body.inventedTag)) return bad('inventedTag must be a TAG-GUIDE tag')

  const deco = await db.decomposition.findUnique({
    where: { id: decompositionId },
    select: { id: true, runId: true, sceneId: true, vantage: true, condition: true, modelId: true },
  })
  if (!deco || deco.runId !== run || !deco.sceneId || !deco.condition || !deco.modelId) return bad('decomposition is not a result cell of this run', 404)
  const truth = await db.gtItem.findFirst({ where: { id: truthId, sceneId: deco.sceneId }, select: { id: true } })
  if (!truth) return bad('truthId is not a ground-truth item of this scene', 404)

  await addMatchOverride(deco.id, {
    truthId,
    predIds: body.predIds,
    identity,
    inventedTag: body.inventedTag,
    note: typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 500) : undefined,
  })
  const mt = await db.matchTable.findUnique({ where: { decompositionId: deco.id }, select: { overrides: true } })
  const overrideN = Array.isArray(mt?.overrides) ? mt.overrides.length : 0

  let rescored = false
  let rescoreError: string | null = null
  try {
    await runScore({
      runId: deco.runId!,
      sceneId: deco.sceneId,
      vantage: (deco.vantage as Vantage | null) ?? null,
      condition: deco.condition as Condition,
      modelId: deco.modelId,
      force: true,
    })
    rescored = true
  } catch (e) {
    rescoreError = e instanceof Error ? e.message : String(e)
  }
  const res: MatchOverrideResponse = { ok: true, overrideN, rescored, rescoreError }
  return NextResponse.json(res)
}
