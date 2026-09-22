import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseDishware } from '@/lib/corpus/dishware'

// PATCH  /api/corpus/dishware/[id] — edit a LIVE registry row (snapshots are immutable)
// DELETE /api/corpus/dishware/[id] — remove a live row
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

async function liveRow(id: string) {
  const row = await db.dishware.findUnique({ where: { id } })
  if (!row) return { error: NextResponse.json({ error: 'dishware not found' }, { status: 404 }) }
  if (row.contextVersionId) return { error: NextResponse.json({ error: 'this row is a context-version snapshot and is immutable; edit the live registry' }, { status: 409 }) }
  return { row }
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const { error } = await liveRow(id)
  if (error) return error
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'bad request: expected JSON body' }, { status: 400 })
  }
  const parsed = parseDishware(body, true)
  if (typeof parsed === 'string') return NextResponse.json({ error: parsed }, { status: 400 })
  const row = await db.dishware.update({ where: { id }, data: parsed })
  return NextResponse.json({ ok: true, dishware: row })
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const { error } = await liveRow(id)
  if (error) return error
  await db.dishware.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
