import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { cellKey, type RunWorkKind } from '@/lib/runmatrix'
import type { Condition, Vantage } from '@/lib/prompt-blocks'
import { runInterpret } from '@/runners/interpret'
import { runMatch } from '@/runners/match'
import { runClassify } from '@/runners/classify'
import { runScore } from '@/runners/score'

// POST /api/run-item — execute exactly ONE work item (per-item fan-out from
// the browser; failures stay per-item so the client can re-run just this one).
// Body: {kind, ref} where ref is the JSON-encoded args from buildRunWorkList.
//
// Kinds: interpret | match | classify | score —
// idempotent by the target row's unique key; a failure is recorded in
// RunItemError (visible in GET /api/runs/[id], retryable by re-posting) and
// cleared on the next success. Ledger (llm_call) rows are written by the
// runner core.
export const maxDuration = 300

const V2_KINDS = new Set<RunWorkKind>(['interpret', 'match', 'classify', 'score'])

const notFound = (what: string) => NextResponse.json({ error: `${what} not found` }, { status: 404 })
const bad = (msg: string) => NextResponse.json({ error: msg }, { status: 400 })

type CellRef = { runId: string; sceneId: string; vantage: Vantage | null; condition: Condition; modelId: string; side?: 'truth' | 'estimate' }

const VANTAGES = new Set(['phone', 'glasses', 'tripod'])
const CONDITIONS = new Set(['image_only', 'image_context', 'context_only'])

function parseCellRef(ref: Record<string, unknown>): CellRef | string {
  const runId = typeof ref.runId === 'string' ? ref.runId : ''
  const sceneId = typeof ref.sceneId === 'string' ? ref.sceneId : ''
  const condition = typeof ref.condition === 'string' ? ref.condition : ''
  const modelId = typeof ref.modelId === 'string' ? ref.modelId : ''
  const vantageRaw = ref.vantage
  if (!runId || !sceneId) return 'runId and sceneId required'
  if (!CONDITIONS.has(condition)) return `condition must be one of: ${[...CONDITIONS].join(', ')}`
  if (!modelId) return 'modelId required'
  const vantage = condition === 'context_only' ? null : typeof vantageRaw === 'string' && VANTAGES.has(vantageRaw) ? (vantageRaw as Vantage) : null
  if (condition !== 'context_only' && !vantage) return `vantage must be one of: ${[...VANTAGES].join(', ')}`
  return { runId, sceneId, vantage, condition: condition as Condition, modelId }
}

async function recordFailure(runId: string, kind: string, key: string, error: string) {
  await db.runItemError.upsert({
    where: { runId_kind_key: { runId, kind, key } },
    create: { runId, kind, key, error: error.slice(0, 2000) },
    update: { error: error.slice(0, 2000), createdAt: new Date() },
  })
}
async function clearFailure(runId: string, kind: string, key: string) {
  await db.runItemError.deleteMany({ where: { runId, kind, key } })
}

/** Resolve the decomposition of a cell (interpret must have run). */
async function decompositionForCell(c: CellRef) {
  return db.decomposition.findFirst({
    where: { runId: c.runId, sceneId: c.sceneId, vantage: c.vantage, condition: c.condition, modelId: c.modelId, source: 'pipeline' },
    select: { id: true },
  })
}

async function runV2(kind: RunWorkKind, ref: Record<string, unknown>): Promise<{ key: string; runId: string; result: unknown } | NextResponse> {
  // classify(truth) is scene-scoped; every other item is cell-scoped
  if (kind === 'classify' && ref.side === 'truth') {
    const runId = typeof ref.runId === 'string' ? ref.runId : ''
    const sceneId = typeof ref.sceneId === 'string' ? ref.sceneId : ''
    if (!runId || !sceneId) return bad('runId and sceneId required')
    const key = `${sceneId}|truth`
    try {
      const result = await runClassify({ runId, sceneId, side: 'truth' })
      await clearFailure(runId, kind, key)
      return { key, runId, result }
    } catch (e) {
      await recordFailure(runId, kind, key, e instanceof Error ? e.message : String(e))
      throw e
    }
  }
  const parsed = parseCellRef(ref)
  if (typeof parsed === 'string') return bad(parsed)
  const c = parsed
  const key = cellKey(c)
  const run = await db.run.findUnique({ where: { id: c.runId }, select: { id: true } })
  if (!run) return notFound('run')
  try {
    let result: unknown
    switch (kind) {
      case 'interpret':
        result = await runInterpret(c)
        break
      case 'match': {
        const deco = await decompositionForCell(c)
        if (!deco) throw new Error('no decomposition for this cell yet (run interpret first)')
        result = await runMatch({ runId: c.runId, decompositionId: deco.id })
        break
      }
      case 'classify': {
        const deco = await decompositionForCell(c)
        if (!deco) throw new Error('no decomposition for this cell yet (run interpret first)')
        result = await runClassify({ runId: c.runId, sceneId: c.sceneId, side: 'estimate', decompositionId: deco.id })
        break
      }
      case 'score':
        result = await runScore(c)
        break
    }
    await clearFailure(c.runId, kind, key)
    return { key, runId: c.runId, result }
  } catch (e) {
    await recordFailure(c.runId, kind, key, e instanceof Error ? e.message : String(e))
    throw e
  }
}

export async function POST(req: NextRequest) {
  let kind = ''
  let ref: Record<string, unknown> = {}
  try {
    const body = await req.json()
    kind = body.kind
    ref = typeof body.ref === 'string' ? JSON.parse(body.ref) : (body.ref ?? {})
  } catch {
    return NextResponse.json({ error: 'bad request: expected {kind, ref}' }, { status: 400 })
  }

  try {
    if (V2_KINDS.has(kind as RunWorkKind)) {
      const out = await runV2(kind as RunWorkKind, ref)
      if (out instanceof NextResponse) return out
      return NextResponse.json({ ok: true, kind, key: out.key, runId: out.runId, result: out.result })
    }
    return NextResponse.json({ error: `unknown kind: ${kind}` }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
