import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parsePer100g } from '@/lib/fdc'

// Owner approval step: PATCH {approve: true, per100g?, approvalNotes?}
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }
  const { approve, approvalNotes } = body as { approve?: unknown; approvalNotes?: unknown }
  if (approve !== true) {
    return NextResponse.json({ error: 'approve must be true' }, { status: 400 })
  }

  const rawPer100g = (body as { per100g?: unknown }).per100g
  const per100g = rawPer100g === undefined ? null : parsePer100g(rawPer100g)
  if (rawPer100g !== undefined && !per100g) {
    return NextResponse.json({ error: 'invalid per100g' }, { status: 400 })
  }

  const existing = await db.customFood.findUnique({ where: { id } })
  if (!existing) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const customFood = await db.customFood.update({
    where: { id },
    data: {
      approvedAt: new Date(),
      approvalNotes: typeof approvalNotes === 'string' ? approvalNotes : null,
      ...(per100g ? { per100g, version: { increment: 1 } } : {}),
    },
  })

  // Keep alias caches consistent with the approved (possibly edited) values.
  if (per100g) {
    await db.fdcAlias.updateMany({
      where: { customFoodId: id },
      data: { per100gCache: per100g },
    })
  }

  return NextResponse.json({ customFood })
}
