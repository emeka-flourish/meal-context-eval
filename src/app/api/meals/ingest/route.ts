import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { MealType, Surface } from '@/generated/prisma/enums'

// Commits upload groupings from the review UI: one Meal per group.
// eatenAt precedence: client-provided | earliest EXIF in group | now.
// EXIF is a default only — the user confirms/overrides in the UI.

const isoDate = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), 'invalid datetime')

const bodySchema = z.object({
  groups: z
    .array(
      z.object({
        eatenAt: isoDate.optional(),
        mealType: z.enum(MealType).optional(),
        artifacts: z
          .array(
            z.object({
              url: z.string().min(1),
              exifTakenAt: isoDate.optional(),
              surface: z.enum(Surface),
              isReference: z.boolean().optional(),
            })
          )
          .min(1),
      })
    )
    .min(1),
})

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null)
  const result = bodySchema.safeParse(json)
  if (!result.success) {
    return NextResponse.json(
      { error: 'invalid body', issues: result.error.issues },
      { status: 400 }
    )
  }

  const mealIds: string[] = []
  for (const group of result.data.groups) {
    const exifTimes = group.artifacts
      .map((a) => (a.exifTakenAt ? new Date(a.exifTakenAt) : null))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())
    const eatenAt = group.eatenAt
      ? new Date(group.eatenAt)
      : exifTimes[0] ?? new Date()

    const meal = await db.meal.create({
      data: {
        eatenAt,
        mealType: group.mealType ?? null,
        artifacts: {
          create: group.artifacts.map((a) => ({
            surface: a.surface,
            blobUrl: a.url,
            exifTakenAt: a.exifTakenAt ? new Date(a.exifTakenAt) : null,
            isReference: a.isReference ?? false,
          })),
        },
      },
    })
    mealIds.push(meal.id)
  }

  return NextResponse.json({ mealIds })
}
