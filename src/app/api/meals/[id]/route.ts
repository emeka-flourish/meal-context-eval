import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import { MealType, LocationType, Suppression } from '@/generated/prisma/enums'
import { gtEntryAllowed, pipelineOutputsVisible } from '@/lib/gt'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const meal = await db.meal.findUnique({
    where: { id },
    include: {
      artifacts: true,
      decompositions: {
        include: {
          triggerResults: {
            include: { profile: { select: { code: true, name: true } } },
          },
          nutrientCalcs: true,
          // Presence only — judge NUMBERS never reach the meal page (the owner
          // hand-scores the agreement subset blind; see Score tab withholding).
          judgeScoresAsEval: {
            select: { id: true, humanOverall0100: true, judgeModelId: true, guidelineVersion: true },
          },
        },
      },
    },
  })
  if (!meal) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const gtRow = meal.decompositions.find(
    (d) => d.source === 'gt' || d.source === 'silver_assist',
  )
  const gtAllowed = gtEntryAllowed(meal.artifacts, meal.decompositions)
  const reveal = pipelineOutputsVisible(Boolean(gtRow), meal.gtTier)

  // Anchoring reveal gate (DECISIONS.md #4): withhold pipeline payloads
  // SERVER-SIDE until GT is saved — not merely hidden in the UI.
  const decompositions = meal.decompositions.map((d) =>
    d.source === 'pipeline' && !reveal
      ? { ...d, payload: null, withheld: true as const }
      : { ...d, withheld: false as const },
  )

  return NextResponse.json({
    meal: { ...meal, decompositions },
    gtAllowed,
    reveal,
    gtSaved: Boolean(gtRow),
  })
}

// DELETE — remove an erroneous entry entirely (owner request 2026-08-11;
// deviation from BUILD-SPEC §7 "no destructive deletes", logged in DECISIONS.md
// #26: mistaken test/duplicate entries are not study data. UI double-confirms.
// Media blobs stay on disk — camera roll remains the capture source of truth.
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const meal = await db.meal.findUnique({
    where: { id },
    include: { decompositions: { select: { id: true } } },
  })
  if (!meal) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const decoIds = meal.decompositions.map((d) => d.id)
  await db.$transaction([
    db.judgeScore.deleteMany({
      where: {
        OR: [{ gtDecompositionId: { in: decoIds } }, { evalDecompositionId: { in: decoIds } }],
      },
    }),
    db.triggerResult.deleteMany({ where: { decompositionId: { in: decoIds } } }),
    db.nutrientCalc.deleteMany({ where: { decompositionId: { in: decoIds } } }),
    db.gtCorrection.deleteMany({ where: { decompositionId: { in: decoIds } } }),
    db.decomposition.deleteMany({ where: { mealId: id } }),
    db.artifact.deleteMany({ where: { mealId: id } }),
    db.meal.updateMany({ where: { sameFoodAsMealId: id }, data: { sameFoodAsMealId: null } }),
    db.meal.delete({ where: { id } }),
  ])
  return NextResponse.json({ deleted: true })
}

const isoDate = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), 'invalid datetime')

const patchSchema = z.object({
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

// PATCH — tags/notes (suppression, forgot, location, unrated marking)
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const json = await req.json().catch(() => null)
  const result = patchSchema.safeParse(json)
  if (!result.success) {
    return NextResponse.json(
      { error: 'invalid body', issues: result.error.issues },
      { status: 400 },
    )
  }
  const body = json as Record<string, unknown>
  if ('gtTier' in body && body.gtTier !== 'unrated') {
    return NextResponse.json(
      { error: "gt_tier is derived from gt_method — only 'unrated' may be set directly" },
      { status: 400 },
    )
  }
  const data: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(result.data)) {
    data[k] = k === 'eatenAt' ? new Date(v as string) : v
  }
  // Owner may mark a meal unrated (insufficient GT basis) — a terminal decision.
  if (body.gtTier === 'unrated') data.gtTier = 'unrated'
  try {
    const meal = await db.meal.update({ where: { id }, data })
    return NextResponse.json({ meal })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }
    throw e
  }
}
