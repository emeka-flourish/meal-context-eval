import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/corpus/ui/stats — header tiles of the Corpus screen (read-only):
// meal count by tier, excluded, annotated at meal level, what the queue still
// serves, and the context versions (newest first). Same definitions as
// /api/corpus/queue counts: pending = not excluded AND no meal-level annotation.
export const dynamic = 'force-dynamic'

export async function GET() {
  const [tiers, total, excluded, withImage, annotated, versions] = await Promise.all([
    db.corpusMeal.groupBy({ by: ['tier'], _count: { _all: true } }),
    db.corpusMeal.count(),
    db.corpusMeal.count({ where: { excluded: true } }),
    db.corpusMeal.count({ where: { imageFile: { not: null } } }),
    db.corpusMeal.count({ where: { excluded: false, annotations: { some: { dishId: null } } } }),
    db.contextVersion.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true, label: true, createdAt: true, cardCount: true, corpusHash: true } }),
  ])
  const byTier = { corrected: 0, confirmed: 0, unconfirmed: 0 }
  for (const t of tiers) byTier[t.tier] = t._count._all
  const vs = versions.map((v) => ({ ...v, createdAt: v.createdAt.toISOString() }))
  return NextResponse.json({
    total,
    byTier,
    excluded,
    annotated,
    inQueue: total - excluded - annotated,
    withImage,
    versions: vs,
    latestVersion: vs[0] ?? null,
  })
}
