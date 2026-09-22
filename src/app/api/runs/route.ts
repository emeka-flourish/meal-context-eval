import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createRun, enumerateCells, type CreateRunInput, type RunConfig } from '@/lib/runmatrix'

// POST /api/runs — create a Run from a config snapshot (REBUILD-SPEC §3.3).
// Body: { label, mealSet?: {kind:'all_valid'} | {kind:'dates', dates:[]} |
// {kind:'scenes', sceneIds:[]}, conditions?: Condition[], models?: [{id, family, tier}] }.
// Prompt block hashes, matcher/classifier pins and corpus/alias versions are
// stamped from CONFIG at creation; nothing runs here.
// GET /api/runs — run list with a config summary and cell count.

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: CreateRunInput
  try {
    body = (await req.json()) as CreateRunInput
  } catch {
    return NextResponse.json({ error: 'bad request: expected JSON body' }, { status: 400 })
  }
  try {
    const run = await createRun(body)
    return NextResponse.json({ ok: true, run }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 })
  }
}

export async function GET() {
  const runs = await db.run.findMany({ orderBy: { createdAt: 'desc' } })
  return NextResponse.json({
    runs: runs.map((r) => {
      const c = r.config as RunConfig
      return {
        id: r.id,
        label: r.label,
        createdAt: r.createdAt.toISOString(),
        status: r.status,
        summary: {
          scenes: c.sceneIds?.length ?? 0,
          conditions: c.conditions,
          models: c.models,
          promptVersion: c.promptVersion,
          matcher: c.matcher,
          classifier: c.classifier,
          corpusVersion: c.corpusVersion,
          aliasVersion: c.aliasVersion,
          cells: enumerateCells(c.sceneIds ?? [], c).length,
          consistency: c.consistency ?? null,
        },
      }
    }),
  })
}
