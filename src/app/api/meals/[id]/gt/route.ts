import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { gtEntryAllowed, tierForMethod } from '@/lib/gt'
import { decompositionPayloadSchema } from '@/lib/decomposition'
import { GtMethod } from '@/generated/prisma/enums'

// POST — save GT (invariant 1 enforced server-side; tier derived, never chosen)
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await req.json()

  const meal = await db.meal.findUnique({
    where: { id },
    include: { artifacts: true, decompositions: true },
  })
  if (!meal) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const gate = gtEntryAllowed(meal.artifacts, meal.decompositions)
  if (!gate.allowed) {
    return NextResponse.json({ error: `GT locked: ${gate.reason}` }, { status: 409 })
  }
  const existing = meal.decompositions.find(
    (d) => d.source === 'gt' || d.source === 'silver_assist',
  )
  if (existing) {
    return NextResponse.json(
      { error: 'GT already exists — use PATCH to amend (correction is logged).' },
      { status: 409 },
    )
  }

  const parsed = decompositionPayloadSchema.safeParse(body.payload)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid payload', details: parsed.error.format() }, { status: 400 })
  }
  const gtMethod = body.gtMethod as GtMethod
  if (!['weighed_components', 'weighed_meal_described', 'attested_description'].includes(gtMethod)) {
    return NextResponse.json({ error: 'invalid gtMethod' }, { status: 400 })
  }

  const [deco] = await db.$transaction([
    db.decomposition.create({
      data: {
        mealId: id,
        artifactId: null,
        source: body.source === 'silver_assist' ? 'silver_assist' : 'gt',
        payload: parsed.data,
        gtMethod,
        plateTotalGrams: body.plateTotalGrams ?? null,
        // raw prose is load-bearing evidence (protocol silver-tier rule)
        attestation: body.attestation || null,
        lockedAt: new Date(),
      },
    }),
    db.meal.update({
      where: { id },
      data: { gtTier: tierForMethod(gtMethod) },
    }),
  ])
  return NextResponse.json({ decomposition: deco, gtTier: tierForMethod(gtMethod) }, { status: 201 })
}

// PATCH — amend GT (owner ruling #7: editable, but every amendment logged)
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await req.json()
  if (!body.note) {
    return NextResponse.json({ error: 'amendment note required' }, { status: 400 })
  }
  const gtRow = await db.decomposition.findFirst({
    where: { mealId: id, source: { in: ['gt', 'silver_assist'] } },
  })
  if (!gtRow) return NextResponse.json({ error: 'no GT to amend' }, { status: 404 })

  const parsed = decompositionPayloadSchema.safeParse(body.payload)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid payload', details: parsed.error.format() }, { status: 400 })
  }
  // Tier is derived from method — an unknown method would silently corrupt it.
  if (
    body.gtMethod != null &&
    !(typeof body.gtMethod === 'string' && body.gtMethod in GtMethod)
  ) {
    return NextResponse.json({ error: 'invalid gtMethod' }, { status: 400 })
  }
  const gtMethod = (body.gtMethod as GtMethod) ?? gtRow.gtMethod

  const [updated] = await db.$transaction([
    db.decomposition.update({
      where: { id: gtRow.id },
      data: {
        payload: parsed.data,
        gtMethod,
        plateTotalGrams: body.plateTotalGrams ?? gtRow.plateTotalGrams,
        gtAmendedAt: new Date(),
      },
    }),
    db.gtCorrection.create({
      data: {
        decompositionId: gtRow.id,
        note: body.note,
        payloadBefore: gtRow.payload as object,
      },
    }),
    db.meal.update({ where: { id }, data: { gtTier: tierForMethod(gtMethod!) } }),
  ])
  return NextResponse.json({ decomposition: updated })
}
