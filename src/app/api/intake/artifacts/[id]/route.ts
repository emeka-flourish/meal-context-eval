import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { artifactDto, recomputeScene } from '../../_shared'

// PATCH /api/intake/artifacts/[id] — place an unsorted capture: attach it to
// a photo scene (the meal follows the scene), optionally fixing its vantage
// (clears the importer's guess flag). Both scenes involved are recomputed.
// UNDO: { sceneId: null } takes the photo out of its scene. Nothing is deleted:
// the row, its file and its meal stay; with no scene it matches the unsorted
// tray query of GET /api/intake/day (sceneId = null, isReference = false), and
// the scene it left is recomputed (it usually becomes "no <camera> photo").
const schema = z.object({
  sceneId: z.string().nullable(),
  vantage: z.enum(['phone', 'glasses', 'tripod']).optional(),
})

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  }
  const artifact = await db.artifact.findUnique({ where: { id } })
  if (!artifact) return NextResponse.json({ error: 'not found' }, { status: 404 })

  let mealId = artifact.mealId
  if (parsed.data.sceneId) {
    const scene = await db.photoScene.findUnique({ where: { id: parsed.data.sceneId }, select: { mealId: true } })
    if (!scene) return NextResponse.json({ error: 'scene not found' }, { status: 404 })
    mealId = scene.mealId
  }
  const updated = await db.artifact.update({
    where: { id },
    data: {
      sceneId: parsed.data.sceneId,
      mealId,
      ...(parsed.data.vantage
        ? { vantage: parsed.data.vantage, surface: parsed.data.vantage, vantageGuessed: false }
        : {}),
    },
  })
  if (artifact.sceneId) await recomputeScene(artifact.sceneId)
  if (updated.sceneId && updated.sceneId !== artifact.sceneId) await recomputeScene(updated.sceneId)
  return NextResponse.json({ artifact: artifactDto(updated) })
}
