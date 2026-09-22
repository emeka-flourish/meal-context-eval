import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseDishware } from '@/lib/corpus/dishware'

// Dishware registry (CORPUS.md §3), hand-entered by the owner.
// GET  /api/corpus/dishware[?contextVersion=<id>] — the live registry
//      (contextVersionId NULL) or one version's snapshot.
// POST /api/corpus/dishware — create a live row:
//      { name, capacityMl?, capacityG?, usedFor?, photo? }
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const contextVersionId = req.nextUrl.searchParams.get('contextVersion')
  const rows = await db.dishware.findMany({ where: { contextVersionId: contextVersionId ?? null }, orderBy: [{ name: 'asc' }] })
  return NextResponse.json({ dishware: rows })
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'bad request: expected JSON body' }, { status: 400 })
  }
  const parsed = parseDishware(body)
  if (typeof parsed === 'string') return NextResponse.json({ error: parsed }, { status: 400 })
  const row = await db.dishware.create({ data: { ...parsed, name: parsed.name as string } })
  return NextResponse.json({ ok: true, dishware: row }, { status: 201 })
}
