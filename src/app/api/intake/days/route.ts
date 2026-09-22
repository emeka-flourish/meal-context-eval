import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { localDate, monthRange } from '../_shared'
import type { DaySummary, DaysPayload } from '@/lib/ui/intake-types'
import type { Vantage } from '@/lib/ui/format'

// GET /api/intake/days?month=YYYY-MM — calendar rail: per-day completeness
// (which vantages captured anything that day), GT status, and the meal list.
export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month') ?? localDate(new Date()).slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 })
  }
  const meals = await db.meal.findMany({
    where: { eatenAt: monthRange(month) },
    orderBy: { eatenAt: 'asc' },
    include: {
      scenes: {
        include: {
          artifacts: { select: { vantage: true, surface: true, excludeFromExport: true, isReference: true } },
          _count: { select: { gtItems: true } },
        },
      },
    },
  })
  const byDay = new Map<string, DaySummary>()
  for (const m of meals) {
    const date = localDate(m.eatenAt)
    let d = byDay.get(date)
    if (!d) {
      d = {
        date,
        mealCount: 0,
        sceneCount: 0,
        validScenes: 0,
        vantages: { phone: false, glasses: false, tripod: false },
        gt: 'none',
        meals: [],
      }
      byDay.set(date, d)
    }
    d.mealCount++
    d.sceneCount += m.scenes.length
    d.validScenes += m.scenes.filter((s) => s.valid).length
    for (const s of m.scenes) {
      for (const a of s.artifacts) {
        if (a.isReference || a.excludeFromExport) continue
        const v = (a.vantage ?? a.surface) as Vantage
        if (v in d.vantages) d.vantages[v] = true
      }
    }
    const withGt = m.scenes.filter((s) => s._count.gtItems > 0).length
    d.meals.push({
      id: m.id,
      slot: m.mealType,
      eatenAt: m.eatenAt.toISOString(),
      scenes: m.scenes.length,
      gt: m.scenes.length === 0 || withGt === 0 ? 'missing' : withGt === m.scenes.length ? 'confirmed' : 'partial',
    })
  }
  for (const d of byDay.values()) {
    const confirmed = d.meals.filter((m) => m.gt === 'confirmed').length
    const any = d.meals.some((m) => m.gt !== 'missing')
    d.gt = confirmed === d.meals.length && d.meals.length > 0 ? 'confirmed' : any ? 'partial' : 'none'
  }
  const payload: DaysPayload = { month, days: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)) }
  return NextResponse.json(payload)
}
