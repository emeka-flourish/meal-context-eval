import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/corpus/versions?id=<contextVersionId> — one version with its cards
// (sorted by instanceCount) and dishware snapshot; without id, the list.
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) {
    const versions = await db.contextVersion.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true, label: true, createdAt: true, cardCount: true, corpusHash: true } })
    return NextResponse.json({ versions })
  }
  const v = await db.contextVersion.findUnique({
    where: { id },
    include: { cards: { orderBy: [{ instanceCount: 'desc' }, { canonicalName: 'asc' }] }, dishware: { orderBy: { name: 'asc' } } },
  })
  if (!v) return NextResponse.json({ error: 'context version not found' }, { status: 404 })
  return NextResponse.json({ version: v })
}
