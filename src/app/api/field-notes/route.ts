import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { FieldNoteTag } from '@/generated/prisma/enums'

// Field notes — timestamped observations tagged platform/social/build/
// meta_rollout/other.

// GET /api/field-notes — recent 50, newest first
export async function GET() {
  const notes = await db.fieldNote.findMany({ orderBy: { ts: 'desc' }, take: 50 })
  return NextResponse.json({ notes })
}

const bodySchema = z.object({
  tag: z.enum(FieldNoteTag),
  text: z.string().trim().min(1, 'text is required'),
})

// POST /api/field-notes — { tag, text }
export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null)
  const result = bodySchema.safeParse(json)
  if (!result.success) {
    return NextResponse.json(
      { error: 'invalid body', issues: result.error.issues },
      { status: 400 },
    )
  }
  const note = await db.fieldNote.create({
    data: { tag: result.data.tag, text: result.data.text },
  })
  return NextResponse.json({ note }, { status: 201 })
}

// DELETE /api/field-notes?id=… — remove one note (cleanup of test junk)
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  try {
    await db.fieldNote.delete({ where: { id } })
  } catch {
    return NextResponse.json({ error: 'note not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
