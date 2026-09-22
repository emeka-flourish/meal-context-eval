import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import { recomputeScene, sceneDto, sceneInclude } from '../../_shared'

// PATCH /api/intake/scenes/[id] — the three things the owner edits on a scene
// from the Intake screen: verbatim notes, the same-scene confirmation, and
// the `different_plates` verdict. Validity is recomputed after every write.
const patchSchema = z.object({
  notes: z.string().nullable().optional(),
  sameSceneConfirmed: z.boolean().optional(),
  // only the UI verdict may be set/cleared by hand; other reasons are derived
  differentPlates: z.boolean().optional(),
})

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const parsed = patchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  }
  const body = parsed.data
  const data: Prisma.PhotoSceneUpdateInput = {}
  if (body.notes !== undefined) data.notes = body.notes && body.notes.trim() ? body.notes : null
  if (body.sameSceneConfirmed !== undefined) data.sameSceneConfirmed = body.sameSceneConfirmed
  if (body.differentPlates !== undefined) {
    data.exclusionReason = body.differentPlates ? 'different_plates' : null
    if (body.differentPlates) data.sameSceneConfirmed = false
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'no patchable fields in body' }, { status: 400 })
  }
  try {
    await db.photoScene.update({ where: { id }, data })
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }
    throw e
  }
  await recomputeScene(id)
  const scene = await db.photoScene.findUnique({ where: { id }, include: sceneInclude })
  return NextResponse.json({ scene: scene ? sceneDto(scene) : null })
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const scene = await db.photoScene.findUnique({ where: { id }, include: sceneInclude })
  if (!scene) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ scene: sceneDto(scene) })
}
