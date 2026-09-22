import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@/generated/prisma/client'
import { Surface } from '@/generated/prisma/enums'

// PATCH /api/artifacts/[id] — measurement/hygiene fields only:
// captureTimeSampleSecs (RQ1 stopwatch), excludeFromExport (invariant 4),
// typingSecs (manual-surface effort sample), surface + isReference
// (correctable ONLY before the meal's pipeline is locked — reassigning after
// interpretation would corrupt the surface↔decomposition mapping).

function isNumberOrNull(v: unknown): v is number | null {
  return v === null || (typeof v === 'number' && Number.isFinite(v))
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await req.json().catch(() => null)
  if (body === null || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
  const data: Record<string, unknown> = {}
  if ('captureTimeSampleSecs' in body) {
    if (!isNumberOrNull(body.captureTimeSampleSecs)) {
      return NextResponse.json(
        { error: 'captureTimeSampleSecs must be a number or null' },
        { status: 400 },
      )
    }
    data.captureTimeSampleSecs = body.captureTimeSampleSecs
  }
  if ('excludeFromExport' in body) data.excludeFromExport = Boolean(body.excludeFromExport)
  if ('typingSecs' in body) {
    if (!isNumberOrNull(body.typingSecs)) {
      return NextResponse.json({ error: 'typingSecs must be a number or null' }, { status: 400 })
    }
    data.typingSecs = body.typingSecs
  }
  if ('surface' in body || 'isReference' in body) {
    const artifact = await db.artifact.findUnique({ where: { id } })
    if (!artifact) return NextResponse.json({ error: 'not found' }, { status: 404 })
    const lockedRows = await db.decomposition.count({
      where: { mealId: artifact.mealId, source: 'pipeline', lockedAt: { not: null } },
    })
    if (lockedRows > 0) {
      return NextResponse.json(
        { error: 'surface/reference are frozen once the pipeline is locked' },
        { status: 409 },
      )
    }
    if ('surface' in body) {
      if (typeof body.surface !== 'string' || !(body.surface in Surface)) {
        return NextResponse.json({ error: 'invalid surface' }, { status: 400 })
      }
      data.surface = body.surface
    }
    if ('isReference' in body) data.isReference = Boolean(body.isReference)
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'no patchable fields in body' }, { status: 400 })
  }
  try {
    const artifact = await db.artifact.update({ where: { id }, data })
    return NextResponse.json({ artifact })
  } catch (e) {
    // Only a missing row is a 404 — anything else is a real server error.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }
    throw e
  }
}
