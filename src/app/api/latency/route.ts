import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { Surface } from '@/generated/prisma/enums'

// Latency trials (RQ1 reference measurements): two-tap captured→available
// pairs per surface. trialNo auto-increments per surface server-side.

// GET /api/latency — recent trials, newest first
export async function GET() {
  const trials = await db.latencyTrial.findMany({
    orderBy: { capturedAt: 'desc' },
    take: 50,
  })
  return NextResponse.json({ trials })
}

const isoDate = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), 'invalid datetime')

const bodySchema = z
  .object({
    surface: z.enum(Surface),
    capturedAt: isoDate,
    availableAt: isoDate,
    conditions: z.string().optional(),
  })
  .refine((b) => new Date(b.availableAt).getTime() >= new Date(b.capturedAt).getTime(), {
    message: 'availableAt must be >= capturedAt',
    path: ['availableAt'],
  })

// POST /api/latency — { surface, capturedAt, availableAt, conditions }
export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null)
  const result = bodySchema.safeParse(json)
  if (!result.success) {
    return NextResponse.json(
      { error: 'invalid body', issues: result.error.issues },
      { status: 400 },
    )
  }
  const { surface, capturedAt, availableAt, conditions } = result.data
  // max+create inside one transaction: two concurrent trials must not race to
  // the same trialNo.
  const trial = await db.$transaction(async (tx) => {
    const max = await tx.latencyTrial.aggregate({
      where: { surface },
      _max: { trialNo: true },
    })
    return tx.latencyTrial.create({
      data: {
        surface,
        trialNo: (max._max.trialNo ?? 0) + 1,
        capturedAt: new Date(capturedAt),
        availableAt: new Date(availableAt),
        conditions: conditions ?? '',
      },
    })
  })
  return NextResponse.json({ trial }, { status: 201 })
}

// DELETE /api/latency?id=… — remove one trial (cleanup of test junk)
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  try {
    await db.latencyTrial.delete({ where: { id } })
  } catch {
    return NextResponse.json({ error: 'trial not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
