import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { CORPUS_CONFIG } from '@/lib/corpus/config'
import { normalizeDishName } from '@/lib/corpus/normalize'
import { cascade, indexCards } from '@/lib/retrieval/cascade'

// GET /api/corpus/queue?order=pilot|frequency&limit=50&offset=0
// Annotation queue (CORPUS.md §2): meals not yet annotated at meal level and
// not excluded. `pilot` = meals whose dish names fuzzy-match (cascade, no
// embeddings — free and deterministic) the GT dish labels / item names of the
// VALID study scenes first, then by dish frequency; `frequency` = frequency only.
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const order = req.nextUrl.searchParams.get('order') === 'frequency' ? 'frequency' : 'pilot'
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit') ?? 50), 1), 500)
  const offset = Math.max(Number(req.nextUrl.searchParams.get('offset') ?? 0), 0)

  const meals = await db.corpusMeal.findMany({
    where: { excluded: false },
    include: { dishes: { orderBy: { order: 'asc' }, include: { ingredients: { orderBy: { order: 'asc' } } } }, annotations: { where: { dishId: null }, select: { id: true } } },
    orderBy: { localDate: 'asc' },
  })
  const pending = meals.filter((m) => m.annotations.length === 0)

  // dish-name frequency across the whole (non-excluded) corpus
  const freq = new Map<string, number>()
  for (const m of meals) for (const d of m.dishes) freq.set(normalizeDishName(d.name), (freq.get(normalizeDishName(d.name)) ?? 0) + 1)
  const frequency = (m: (typeof meals)[number]) => m.dishes.reduce((s, d) => s + (freq.get(normalizeDishName(d.name)) ?? 0), 0)

  // pilot dishes: GT dish labels + core item names of valid scenes, as pseudo-cards
  let pilotOf: (m: (typeof meals)[number]) => Promise<string | null> = async () => null
  if (order === 'pilot') {
    const gt = await db.gtItem.findMany({ where: { scene: { valid: true }, tag: { in: ['core', 'secondary'] } }, select: { dish: true, name: true } })
    const names = new Map<string, number>()
    for (const g of gt) for (const n of [g.dish, g.name]) if (n.trim()) names.set(n.trim(), (names.get(n.trim()) ?? 0) + 1)
    const index = indexCards([...names.entries()].map(([n, c]) => ({ id: n, canonicalName: n, aliases: [], instanceCount: c })))
    pilotOf = async (m) => {
      for (const d of m.dishes) {
        const hit = await cascade(d.name, index, { tokenOverlapMin: CORPUS_CONFIG.tokenOverlapMin, embedCosineMin: CORPUS_CONFIG.embedCosineMin })
        if (hit) return hit.cardId
      }
      return null
    }
  }

  const scored = []
  for (const m of pending) scored.push({ m, pilot: await pilotOf(m), frequency: frequency(m) })
  scored.sort((a, b) => Number(Boolean(b.pilot)) - Number(Boolean(a.pilot)) || b.frequency - a.frequency || a.m.localDate.getTime() - b.m.localDate.getTime())

  const page = scored.slice(offset, offset + limit).map(({ m, pilot, frequency }) => ({
    id: m.id,
    sourceMealId: m.sourceMealId,
    localDate: m.localDate.toISOString().slice(0, 10),
    localTime: m.localTime,
    slot: m.slot,
    name: m.name,
    description: m.description,
    servingSize: m.servingSize,
    portionClassPrefill: m.portionClassPrefill,
    imageFile: m.imageFile,
    tier: m.tier,
    pilotMatch: pilot,
    frequency,
    dishes: m.dishes.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
      preparation: d.preparation,
      servingSize: d.servingSize,
      ingredients: d.ingredients.map((g) => ({ id: g.id, name: g.name, amount: g.amount, unit: g.unit, notes: g.notes, gramsEst: g.gramsEst, gramsSource: g.gramsSource })),
    })),
  }))
  return NextResponse.json({
    order,
    counts: { total: meals.length, pending: pending.length, annotated: meals.length - pending.length, pilot: scored.filter((s) => s.pilot).length },
    offset,
    limit,
    meals: page,
  })
}
