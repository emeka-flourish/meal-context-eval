import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { CONFIG } from '@/lib/config'

// GET /api/status — env checks, frozen config, LLM spend by runner.

export const dynamic = 'force-dynamic'

export async function GET() {
  let dbOk = false
  let dbError: string | null = null
  try {
    await db.$queryRaw`SELECT 1`
    dbOk = true
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e)
  }

  const env = {
    DATABASE_URL: Boolean(process.env.DATABASE_URL),
    BLOB_READ_WRITE_TOKEN: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY),
    ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
    GOOGLE_AI_API_KEY: Boolean(process.env.GOOGLE_AI_API_KEY),
    FDC_API_KEY: Boolean(process.env.FDC_API_KEY),
    LANGSMITH_API_KEY: Boolean(process.env.LANGSMITH_API_KEY),
  }

  // LLM spend: cost + call counts + error counts, grouped by runner.
  type SpendRow = {
    runner: string
    calls: number
    errors: number
    costUsd: number
    tokensIn: number
    tokensOut: number
  }
  const byRunner = new Map<string, SpendRow>()
  if (dbOk) {
    const grouped = await db.llmCall.groupBy({
      by: ['runner', 'status'],
      _count: true,
      _sum: { costUsdEst: true, tokensIn: true, tokensOut: true },
    })
    for (const g of grouped) {
      const row = byRunner.get(g.runner) ?? {
        runner: g.runner,
        calls: 0,
        errors: 0,
        costUsd: 0,
        tokensIn: 0,
        tokensOut: 0,
      }
      row.calls += g._count
      if (g.status === 'error') row.errors += g._count
      row.costUsd += g._sum.costUsdEst ?? 0
      row.tokensIn += g._sum.tokensIn ?? 0
      row.tokensOut += g._sum.tokensOut ?? 0
      byRunner.set(g.runner, row)
    }
  }
  const spend: SpendRow[] = [...byRunner.values()]
  spend.sort((a, b) => b.costUsd - a.costUsd)
  const totals = spend.reduce(
    (t, r) => ({
      calls: t.calls + r.calls,
      errors: t.errors + r.errors,
      costUsd: t.costUsd + r.costUsd,
    }),
    { calls: 0, errors: 0, costUsd: 0 },
  )

  return NextResponse.json({
    db: { ok: dbOk, error: dbError },
    env,
    config: CONFIG,
    // Study progress — the 'so what' for a status page (walkthrough: it was
    // all plumbing, no sense of how the data collection is going)
    progress: await (async () => {
      const meals = await db.meal.findMany({
        select: {
          gtTier: true,
          artifacts: { select: { surface: true, isReference: true } },
          decompositions: { select: { source: true, engine: true, lockedAt: true } },
        },
      })
      const real = meals.filter((m) => m.artifacts.some((a) => !a.isReference))
      const gold = real.filter((m) => m.gtTier === 'gold').length
      const silver = real.filter((m) => m.gtTier === 'silver').length
      const unrated = real.filter((m) => m.gtTier === 'unrated').length
      const pendingGt = real.filter((m) => m.gtTier === 'pending').length
      const captures = real.reduce(
        (n, m) => n + new Set(m.artifacts.filter((a) => !a.isReference).map((a) => a.surface)).size,
        0,
      )
      const scoredCaptures = real.reduce(
        (n, m) =>
          n +
          (m.gtTier === 'gold' || m.gtTier === 'silver'
            ? m.decompositions.filter((d) => d.source === 'pipeline' && !d.engine && d.lockedAt).length
            : 0),
        0,
      )
      const [judgeTotal, judgeHuman, insightTotal, insightScored, latency] = await Promise.all([
        db.judgeScore.count(),
        db.judgeScore.count({ where: { humanOverall0100: { not: null } } }),
        db.insight.count(),
        db.insightScore.count({ where: { rater: 'self' } }),
        db.latencyTrial.groupBy({ by: ['surface'], _count: true }),
      ])
      return {
        meals: real.length,
        gold,
        silver,
        unrated,
        pendingGt,
        captures,
        scoredCaptures,
        goldTarget: 40, // protocol §3
        judgeHuman,
        judgeTotal,
        judgeHumanTarget: 20, // protocol: 15–20
        insightScored,
        insightTotal,
        latencyBySurface: Object.fromEntries(latency.map((l) => [l.surface, l._count])),
      }
    })(),
    spend,
    totals,
    now: new Date().toISOString(),
  })
}
