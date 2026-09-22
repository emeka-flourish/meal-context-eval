import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recomputeScene, sceneDto, sceneInclude } from '../../../_shared'

// POST /api/intake/meals/[id]/scenes — "new scene" from the unsorted tray:
// appends Photo N+1 to the meal (invalid until captures + notes arrive).
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const meal = await db.meal.findUnique({
    where: { id },
    select: { id: true, scenes: { select: { index: true } } },
  })
  if (!meal) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const index = meal.scenes.reduce((m, s) => Math.max(m, s.index), 0) + 1
  const created = await db.photoScene.create({ data: { mealId: id, index } })
  await recomputeScene(created.id)
  const scene = await db.photoScene.findUnique({ where: { id: created.id }, include: sceneInclude })
  return NextResponse.json({ scene: scene ? sceneDto(scene) : null }, { status: 201 })
}
