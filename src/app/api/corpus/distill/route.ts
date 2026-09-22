import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { runDistill } from '@/runners/distill'

// POST /api/corpus/distill — build a ContextVersion from the non-excluded
// corpus (CORPUS.md §3). Body: { label? }. Mock mode when MOCK_LLM=1 or no key.
// GET  /api/corpus/distill — list context versions (newest first).
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  let body: { label?: string } = {}
  try {
    body = (await req.json()) ?? {}
  } catch {
    /* empty body is fine */
  }
  try {
    const result = await runDistill({ label: body.label })
    return NextResponse.json({ ok: true, ...result }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 })
  }
}

export async function GET() {
  const versions = await db.contextVersion.findMany({ orderBy: { createdAt: 'desc' }, include: { _count: { select: { cards: true, dishware: true } } } })
  return NextResponse.json({
    versions: versions.map((v) => ({
      id: v.id,
      label: v.label,
      createdAt: v.createdAt.toISOString(),
      corpusHash: v.corpusHash,
      cardCount: v.cardCount,
      dishwareCount: v._count.dishware,
      config: v.config,
      habitProfile: v.habitProfile,
    })),
  })
}
