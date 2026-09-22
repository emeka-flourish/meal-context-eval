import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { gtEntryAllowed } from '@/lib/gt'
import { MealType, LocationType, Suppression } from '@/generated/prisma/enums'

const isoDate = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), 'invalid datetime')

// Round-trip check rejects calendar-impossible dates (2026-02-31 parses but
// normalizes to a different day).
function isCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const d = new Date(`${date}T00:00:00`)
  return !Number.isNaN(d.getTime()) && d.toLocaleDateString('en-CA') === date
}

// GET /api/meals?date=YYYY-MM-DD — day list with status chips
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date')
  if (date !== null && !isCalendarDate(date)) {
    return NextResponse.json(
      { error: 'date must be a valid YYYY-MM-DD calendar date' },
      { status: 400 },
    )
  }
  const where = date
    ? {
        eatenAt: {
          gte: new Date(`${date}T00:00:00`),
          lt: new Date(new Date(`${date}T00:00:00`).getTime() + 86400_000),
        },
      }
    : {}
  const meals = await db.meal.findMany({
    where,
    orderBy: { eatenAt: 'asc' },
    include: {
      artifacts: { select: { id: true, surface: true, isReference: true, blobUrl: true } },
      decompositions: {
        select: {
          id: true,
          source: true,
          surface: true,
          engine: true,
          lockedAt: true,
          _count: { select: { nutrientCalcs: true, triggerResults: true, judgeScoresAsEval: true } },
        },
      },
    },
  })
  const withStatus = meals.map((m) => {
    const gtRow = m.decompositions.find((d) => d.source === 'gt' || d.source === 'silver_assist')
    return {
      id: m.id,
      eatenAt: m.eatenAt,
      mealType: m.mealType,
      locationType: m.locationType,
      gtTier: m.gtTier,
      forgot: m.forgot,
      suppression: m.suppression,
      notes: m.notes,
      surfaces: [...new Set(m.artifacts.filter((a) => !a.isReference).map((a) => a.surface))],
      artifactCount: m.artifacts.length,
      captureCount: m.artifacts.filter((a) => !a.isReference).length,
      // interpretation is per-SURFACE (one call per capture device)
      surfaceCount: new Set(m.artifacts.filter((a) => !a.isReference).map((a) => a.surface)).size,
      // labeled thumbnails for the day view, ordered by surface
      thumbs: m.artifacts
        .filter((a) => !a.isReference && a.blobUrl)
        .sort((a, b) => a.surface.localeCompare(b.surface))
        .slice(0, 6)
        .map((a) => ({ url: a.blobUrl!, surface: a.surface })),
      // PRIMARY interpretations only — exploratory engine rows are secondary
      // and must not inflate the count (walkthrough bug: showed 9/3)
      pipelineDone: m.decompositions.filter(
        (d) => d.source === 'pipeline' && !d.engine && d.lockedAt,
      ).length,
      gtSaved: Boolean(gtRow),
      gtAllowed: gtEntryAllowed(m.artifacts, m.decompositions).allowed,
      // persistent processing stages (read from DB — survives navigation)
      stages: (() => {
        const primary = m.decompositions.filter((d) => d.source === 'pipeline' && !d.engine)
        const all = m.decompositions
        return {
          nutrients: all.length > 0 && all.every((d) => d._count.nutrientCalcs > 0),
          triggers: all.filter((d) => !d.engine).length > 0 &&
            all.filter((d) => !d.engine).every((d) => d._count.triggerResults > 0),
          judged: primary.length > 0 && primary.every((d) => d._count.judgeScoresAsEval > 0),
        }
      })(),
    }
  })
  // day-level insight status (insights are per-day, not per-meal)
  const insightCount = date
    ? await db.insight.count({ where: { date: new Date(date) } })
    : 0
  return NextResponse.json({ meals: withStatus, insightCount })
}

const createSchema = z.object({
  eatenAt: isoDate.optional(),
  mealType: z.enum(MealType).nullish(),
  locationType: z.enum(LocationType).optional(),
  forgot: z.boolean().optional(),
  suppression: z.enum(Suppression).optional(),
  suppressionSetting: z.string().nullish(),
  suppressionCompanions: z.string().nullish(),
  suppressionReason: z.string().nullish(),
  notes: z.string().nullish(),
  sameFoodAsMealId: z.string().nullish(),
})

// POST /api/meals — create a meal (backdated entry is first-class)
export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null)
  const result = createSchema.safeParse(json)
  if (!result.success) {
    return NextResponse.json(
      { error: 'invalid body', issues: result.error.issues },
      { status: 400 },
    )
  }
  const body = result.data
  const meal = await db.meal.create({
    data: {
      eatenAt: body.eatenAt ? new Date(body.eatenAt) : new Date(),
      mealType: body.mealType ?? null,
      locationType: body.locationType ?? 'home',
      forgot: body.forgot ?? false,
      suppression: body.suppression ?? 'none',
      suppressionSetting: body.suppressionSetting ?? null,
      suppressionCompanions: body.suppressionCompanions ?? null,
      suppressionReason: body.suppressionReason ?? null,
      notes: body.notes ?? null,
      sameFoodAsMealId: body.sameFoodAsMealId ?? null,
    },
  })
  return NextResponse.json({ meal }, { status: 201 })
}
