/* Retrieval cascade (CORPUS.md §4): one query name → at most one DishCard.
     normalize → exact alias → token overlap ≥ 0.6 → embedding cosine ≥ θ → no match
   Pure. "Token overlap" = Jaccard over content tokens (stopwords dropped,
   plurals stemmed) against each of a card's names; the overlap coefficient
   was tried and rejected — one shared generic word ("soup") then matched
   every soup card. The embedding tier takes an injected `embed` (real:
   pinned embedding model, lib/retrieval/embed.ts); without one it falls back
   to character-bigram Dice similarity on the normalized names at
   MOCK_DICE_MIN, names compared space-stripped and only when their first
   letters agree (deterministic mock — catches spelling/spacing variants such
   as "oat meal" that tokens miss; the first-letter guard stops "oat meal" →
   "goat meat" (Dice 0.86), and its own threshold exists because a short
   generic word inside a long name already scores 0.5: "soup" vs "lentil soup"). The same cascade decides routine vs novel
   (lib/corpus/routine.ts) on truth names.
   NOTE: relative imports only (no db). */
import { dishTokens, jaccard, normalizeDishName } from '../corpus/normalize'

export type CardLike = { id: string; canonicalName: string; aliases: string[]; instanceCount: number }
export type CascadeMethod = 'exact' | 'token' | 'embedding' | 'none'
export type CascadeHit = { cardId: string; method: Exclude<CascadeMethod, 'none'>; score: number; matchedName: string }
export type Embedder = (texts: string[]) => Promise<number[][]>

export type CardIndexEntry = {
  card: CardLike
  /** normalized canonical + aliases */
  names: string[]
  /** token set per name (same order as `names`) */
  tokens: Set<string>[]
  /** character bigrams per name — the embedding-mock representation */
  bigrams: Set<string>[]
  vector?: number[]
}
export type CardIndex = { entries: CardIndexEntry[]; byName: Map<string, CardIndexEntry> }

export function indexCards(cards: CardLike[]): CardIndex {
  const byName = new Map<string, CardIndexEntry>()
  const entries = cards.map((card) => {
    const raw = [card.canonicalName, ...card.aliases]
    const names = raw.map(normalizeDishName)
    const tokens = raw.map(dishTokens)
    const e: CardIndexEntry = { card, names, tokens, bigrams: names.map(bigrams) }
    for (const n of names) {
      // first card wins an alias collision, unless the later one is seen more often
      const prev = byName.get(n)
      if (!prev || prev.card.instanceCount < card.instanceCount) byName.set(n, e)
    }
    return e
  })
  return { entries, byName }
}

/** Threshold of the mock third tier (bigram Dice); the real tier uses embedCosineMin. */
export const MOCK_DICE_MIN = 0.65

export type CascadeOptions = {
  tokenOverlapMin?: number // default 0.6
  embedCosineMin?: number // default 0.5 (pilot-set; also the Jaccard threshold of the mock)
  embed?: Embedder
}

/** Character bigrams of a normalized name with spaces removed ("oat meal" ≡ "oatmeal"). */
export function bigrams(s: string): Set<string> {
  const t = s.replace(/\s+/g, '')
  const out = new Set<string>()
  for (let i = 0; i + 1 < t.length; i++) out.add(t.slice(i, i + 2))
  return out
}

/** Dice coefficient 2|A∩B| / (|A|+|B|). */
export function dice<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 || b.size === 0) return 0
  let i = 0
  for (const x of a) if (b.has(x)) i++
  return (2 * i) / (a.size + b.size)
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb)
}

/** Text embedded per card in the real embedding tier. */
export const cardText = (c: CardLike): string => [c.canonicalName, ...c.aliases].join(' / ')

/** Resolve one query name against the index. Ties within a tier break on instanceCount. */
export async function cascade(query: string, index: CardIndex, opts: CascadeOptions = {}): Promise<CascadeHit | null> {
  const tokenMin = opts.tokenOverlapMin ?? 0.6
  const embedMin = opts.embedCosineMin ?? 0.5
  const q = normalizeDishName(query)
  if (!q) return null

  // 1. exact alias
  const exact = index.byName.get(q)
  if (exact) return { cardId: exact.card.id, method: 'exact', score: 1, matchedName: q }

  // 2. token overlap (Jaccard over content tokens, best over the card's names)
  const qt = dishTokens(query)
  let best: CascadeHit | null = null
  if (qt.size > 0) {
    for (const e of index.entries) {
      e.tokens.forEach((t, i) => {
        const s = jaccard(qt, t)
        if (s >= tokenMin && (!best || s > best.score || (s === best.score && e.card.instanceCount > cardOf(index, best.cardId).instanceCount))) {
          best = { cardId: e.card.id, method: 'token', score: s, matchedName: e.names[i] }
        }
      })
    }
    if (best) return best
  }

  // 3. embedding cosine (real) / character-bigram Dice (mock)
  if (opts.embed) {
    const missing = index.entries.filter((e) => !e.vector)
    if (missing.length) {
      const vecs = await opts.embed(missing.map((e) => cardText(e.card)))
      missing.forEach((e, i) => (e.vector = vecs[i]))
    }
    const [qv] = await opts.embed([query])
    for (const e of index.entries) {
      const s = cosine(qv, e.vector!)
      if (s >= embedMin && (!best || s > best.score)) best = { cardId: e.card.id, method: 'embedding', score: s, matchedName: e.names[0] }
    }
    return best
  }
  const qb = bigrams(q)
  for (const e of index.entries) {
    e.bigrams.forEach((b, i) => {
      if (e.names[i][0] !== q[0]) return
      const s = dice(qb, b)
      if (s >= MOCK_DICE_MIN && (!best || s > best.score || (s === best.score && e.card.instanceCount > cardOf(index, best.cardId).instanceCount))) {
        best = { cardId: e.card.id, method: 'embedding', score: s, matchedName: e.names[i] }
      }
    })
  }
  return best
}

function cardOf(index: CardIndex, id: string): CardLike {
  return index.entries.find((e) => e.card.id === id)!.card
}

export type RetrievalResult = {
  hits: (CascadeHit & { query: string })[]
  /** distinct card ids, best-first, capped at topK */
  cardIds: string[]
  /** method of the best hit; 'none' when nothing matched */
  method: CascadeMethod
}

/** Resolve several router names, dedupe by card, keep the top-k by (tier rank, score, instanceCount). */
export async function retrieve(queries: string[], index: CardIndex, opts: CascadeOptions & { topK?: number } = {}): Promise<RetrievalResult> {
  const topK = opts.topK ?? 3
  const hits: (CascadeHit & { query: string })[] = []
  for (const query of queries) {
    const h = await cascade(query, index, opts)
    if (h) hits.push({ ...h, query })
  }
  const rank: Record<CascadeHit['method'], number> = { exact: 0, token: 1, embedding: 2 }
  hits.sort((a, b) => rank[a.method] - rank[b.method] || b.score - a.score || cardOf(index, b.cardId).instanceCount - cardOf(index, a.cardId).instanceCount)
  const cardIds: string[] = []
  for (const h of hits) if (!cardIds.includes(h.cardId) && cardIds.length < topK) cardIds.push(h.cardId)
  return { hits, cardIds, method: hits[0]?.method ?? 'none' }
}
