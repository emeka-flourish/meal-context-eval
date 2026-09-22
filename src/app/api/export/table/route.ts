import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { toCsv, type CsvValue } from '@/lib/csv'

// GET /api/export/table?table=<name> — full-table CSV download.
// Json columns are flattened to JSON strings by the serializer; dates → ISO.
// Hygiene invariant 4: excludeFromExport artifacts never appear — the artifact
// table filters them, and derived tables (decomposition and its children)
// drop rows attached to an excluded artifact.
// Hygiene invariant 2 (blind guard): insight arm/inputKind stay hidden until
// the owner has scored the insight (an InsightScore row with rater='self') —
// unscored rows export with those two cells EMPTY, all other columns intact.

export const dynamic = 'force-dynamic'

async function excludedDecoIds(): Promise<Set<string>> {
  const rows = await db.decomposition.findMany({
    where: { artifact: { excludeFromExport: true } },
    select: { id: true },
  })
  return new Set(rows.map((r) => r.id))
}

const FETCHERS: Record<string, () => Promise<Record<string, CsvValue>[]>> = {
  meal: () => db.meal.findMany({ orderBy: { eatenAt: 'asc' } }),
  artifact: () =>
    db.artifact.findMany({ where: { excludeFromExport: false }, orderBy: { uploadedAt: 'asc' } }),
  decomposition: () =>
    db.decomposition.findMany({
      where: { OR: [{ artifactId: null }, { artifact: { excludeFromExport: false } }] },
      orderBy: { createdAt: 'asc' },
    }),
  nutrient_calc: async () => {
    const excluded = await excludedDecoIds()
    const rows = await db.nutrientCalc.findMany({ orderBy: { createdAt: 'asc' } })
    return rows.filter((r) => !excluded.has(r.decompositionId))
  },
  judge_score: async () => {
    const excluded = await excludedDecoIds()
    const rows = await db.judgeScore.findMany({ orderBy: { createdAt: 'asc' } })
    return rows.filter(
      (r) => !excluded.has(r.gtDecompositionId) && !excluded.has(r.evalDecompositionId),
    )
  },
  trigger_result: async () => {
    const excluded = await excludedDecoIds()
    const rows = await db.triggerResult.findMany({ orderBy: { createdAt: 'asc' } })
    return rows.filter((r) => !excluded.has(r.decompositionId))
  },
  insight: async () => {
    // Blind guard (hygiene invariant 2): blank arm/inputKind on insights the
    // owner has not yet scored.
    const rows = await db.insight.findMany({ orderBy: { date: 'asc' } })
    const selfScored = await db.insightScore.findMany({
      where: { rater: 'self' },
      select: { insightId: true },
    })
    const scoredIds = new Set(selfScored.map((s) => s.insightId))
    return rows.map((r) =>
      scoredIds.has(r.id) ? r : { ...r, arm: null, inputKind: null },
    )
  },
  insight_score: () => db.insightScore.findMany({ orderBy: { createdAt: 'asc' } }),
  latency_trial: () => db.latencyTrial.findMany({ orderBy: [{ surface: 'asc' }, { trialNo: 'asc' }] }),
  field_note: () => db.fieldNote.findMany({ orderBy: { ts: 'asc' } }),
  llm_call: () => db.llmCall.findMany({ orderBy: { createdAt: 'asc' } }),
}

export async function GET(req: NextRequest) {
  const table = req.nextUrl.searchParams.get('table') ?? ''
  const fetcher = FETCHERS[table]
  if (!fetcher) {
    return NextResponse.json(
      { error: `unknown table — one of: ${Object.keys(FETCHERS).join(', ')}` },
      { status: 400 },
    )
  }
  const rows = await fetcher()
  const csv = toCsv(rows)
  const stamp = new Date().toISOString().slice(0, 10)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${table}-${stamp}.csv"`,
    },
  })
}
