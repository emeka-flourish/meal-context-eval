import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { CORPUS_CONFIG } from '@/lib/corpus/config'
import { cascade, indexCards } from '@/lib/retrieval/cascade'

// GET /api/corpus/ui/cards?version=<id|latest>&q=<dish name>&q=… — the dish
// card(s) a meal touches (REBUILD-SPEC §3.2 side panel): each query name is
// resolved with the retrieval cascade (normalize → exact alias → token
// overlap → bigram mock; no embeddings, so free and deterministic) against
// one context version's cards. Read-only. Without q, returns the version only.
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const want = sp.get('version') ?? 'latest'
  const queries = sp
    .getAll('q')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20)

  const version =
    want === 'latest'
      ? await db.contextVersion.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true, label: true, createdAt: true, cardCount: true, corpusHash: true } })
      : await db.contextVersion.findUnique({ where: { id: want }, select: { id: true, label: true, createdAt: true, cardCount: true, corpusHash: true } })
  if (!version) {
    if (want !== 'latest') return NextResponse.json({ error: 'context version not found' }, { status: 404 })
    return NextResponse.json({ version: null, matches: queries.map((q) => ({ query: q, method: 'none', score: 0, card: null })) })
  }
  const v = { ...version, createdAt: version.createdAt.toISOString() }
  if (queries.length === 0) return NextResponse.json({ version: v, matches: [] })

  const cards = await db.dishCard.findMany({ where: { contextVersionId: version.id } })
  const index = indexCards(cards)
  const byId = new Map(cards.map((c) => [c.id, c]))
  const opts = { tokenOverlapMin: CORPUS_CONFIG.tokenOverlapMin, embedCosineMin: CORPUS_CONFIG.embedCosineMin }
  const matches = []
  for (const q of queries) {
    const hit = await cascade(q, index, opts)
    const card = hit ? byId.get(hit.cardId) : null
    matches.push({
      query: q,
      method: hit?.method ?? 'none',
      score: hit?.score ?? 0,
      card: card ? { ...card, lastSeen: card.lastSeen.toISOString().slice(0, 10) } : null,
    })
  }
  return NextResponse.json({ version: v, matches })
}
