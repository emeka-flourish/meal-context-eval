import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { localDate } from '../_shared'
import type { SceneListRow } from '@/lib/ui/intake-types'
import type { Vantage } from '@/lib/ui/format'

const PILOT_DATES = (process.env.PILOT_DATES ?? '').split(',').map((d) => d.trim()).filter(Boolean)

// GET /api/intake/scenes?set=pilot|all_valid|all — flat scene list for the
// Run screen's progress grid (rows = photo scenes). `pilot` = the dates in env PILOT_DATES (comma-separated)
// (REBUILD-SPEC §6), `all_valid` = every scene that passes the validity rules.
export async function GET(req: NextRequest) {
  const set = req.nextUrl.searchParams.get('set') ?? 'all'
  const scenes = await db.photoScene.findMany({
    include: {
      meal: { select: { eatenAt: true, mealType: true } },
      artifacts: { select: { vantage: true, surface: true, excludeFromExport: true, isReference: true } },
    },
  })
  const rows: SceneListRow[] = scenes
    .map((s) => ({
      id: s.id,
      mealId: s.mealId,
      date: localDate(s.meal.eatenAt),
      slot: s.meal.mealType,
      index: s.index,
      valid: s.valid,
      exclusionReason: s.exclusionReason,
      vantages: [
        ...new Set(
          s.artifacts
            .filter((a) => !a.isReference && !a.excludeFromExport)
            .map((a) => (a.vantage ?? a.surface) as Vantage),
        ),
      ],
      eatenAt: s.meal.eatenAt.getTime(),
    }))
    .filter((r) => {
      if (set === 'pilot') return PILOT_DATES.includes(r.date)
      if (set === 'all_valid') return r.valid
      return true
    })
    .sort((a, b) => a.eatenAt - b.eatenAt || a.index - b.index)
    .map((r) => {
      const { eatenAt: _ignored, ...rest } = r
      void _ignored
      return rest
    })
  return NextResponse.json({ set, scenes: rows })
}
