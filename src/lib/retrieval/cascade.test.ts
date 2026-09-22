import { describe, it, expect, vi } from 'vitest'

vi.mock('../db', () => ({ db: {} }))

import { cascade, cosine, indexCards, retrieve, type CardLike, type Embedder } from './cascade'

const CARDS: CardLike[] = [
  { id: 'oat', canonicalName: 'Oatmeal', aliases: ['Plain Oatmeal', 'Oatmeal with Honey'], instanceCount: 113 },
  { id: 'egg', canonicalName: 'Scrambled Egg with Spinach and Onions', aliases: ['Scrambled Egg with Onions', 'Scrambled Eggs'], instanceCount: 106 },
  { id: 'lentil', canonicalName: 'Lentil Soup with Goat Meat', aliases: ['Lentil Soup (Half Portion)', 'Lentil Soup'], instanceCount: 12 },
  { id: 'edik', canonicalName: 'Minestrone Soup with Chicken', aliases: ['Minestrone Soup'], instanceCount: 9 },
  { id: 'rice', canonicalName: 'Vegetable Fried Rice', aliases: ['Fried Rice'], instanceCount: 12 },
  { id: 'mango', canonicalName: 'Fresh Mango', aliases: ['Mango Slices', 'Mango'], instanceCount: 77 },
  { id: 'toast', canonicalName: 'Avocado Tuna Toast', aliases: [], instanceCount: 31 },
]
const index = indexCards(CARDS)

describe('cascade tiers', () => {
  it('tier 1: exact alias after normalization (case, parentheticals)', async () => {
    expect(await cascade('OATMEAL', index)).toMatchObject({ cardId: 'oat', method: 'exact', score: 1 })
    expect(await cascade('lentil soup (half portion)', index)).toMatchObject({ cardId: 'lentil', method: 'exact' })
    expect(await cascade('Mango', index)).toMatchObject({ cardId: 'mango', method: 'exact' })
  })
  it('tier 2: token overlap ≥ 0.6 (Jaccard over content tokens, stemmed, best name)', async () => {
    // "scrambled eggs with spinach" {scrambled, egg, spinach} vs canonical {scrambled, egg, spinach, onion}: 3/4
    expect(await cascade('scrambled eggs with spinach', index)).toMatchObject({ cardId: 'egg', method: 'token', score: 0.75 })
    // "tuna toast" {tuna, toast} vs {avocado, tuna, toast}: 2/3
    expect(await cascade('tuna toast', index)).toMatchObject({ cardId: 'toast', method: 'token' })
    // "goat meat lentil" {goat, meat, lentil} vs {lentil, soup, goat, meat}: 3/4
    expect(await cascade('goat meat lentil', index)).toMatchObject({ cardId: 'lentil', method: 'token' })
    // "fried rice with egg" {fried, rice, egg} vs alias {fried, rice}: 2/3 (the alias, not the canonical 2/4)
    expect(await cascade('fried rice with egg', index)).toMatchObject({ cardId: 'rice', method: 'token', matchedName: 'fried rice' })
  })
  it('tier 3 (mock): character-bigram Dice ≥ 0.65 on the normalized names', async () => {
    // "oat meal" shares no token with "oatmeal"; space-stripped bigrams are identical → Dice 1
    const h = await cascade('oat meal', index)
    expect(h).toMatchObject({ cardId: 'oat', method: 'embedding', score: 1 })
    expect(await cascade('minestrone soups', index)).toMatchObject({ cardId: 'edik' })
    // first-letter guard: "oat meal" must not fall into "goat meat" (Dice 0.86 without it)
    const withGoat = indexCards([{ id: 'goat', canonicalName: 'Goat Meat', aliases: [], instanceCount: 5 }])
    expect(await cascade('oat meal', withGoat)).toBeNull()
    expect(await cascade('oat meat', indexCards([...CARDS, { id: 'goat', canonicalName: 'Goat Meat', aliases: [], instanceCount: 500 }]))).toMatchObject({ cardId: 'oat' })
  })
  it('no match: unrelated names and empty queries', async () => {
    expect(await cascade('grilled salmon fillet', index)).toBeNull()
    expect(await cascade('   ', index)).toBeNull()
    expect(await cascade('()', index)).toBeNull()
  })
  it('one generic word never matches: "soup" alone is no match', async () => {
    expect(await cascade('soup', index)).toBeNull()
  })
  it('ties in tier 2 break on instanceCount', async () => {
    const two = indexCards([
      { id: 'a', canonicalName: 'Chicken Salad', aliases: [], instanceCount: 2 },
      { id: 'b', canonicalName: 'Chicken Wrap', aliases: [], instanceCount: 9 },
    ])
    // {chicken, salad, wrap} is 2/3 with both → the more frequent card
    expect(await cascade('chicken salad wrap', two)).toMatchObject({ cardId: 'b', method: 'token' })
  })
})

describe('cascade with a real embedder', () => {
  it('embeds card texts once, then queries; cosine threshold applies', async () => {
    const calls: string[][] = []
    const vec = (t: string) => (/oat/i.test(t) ? [1, 0] : /mango/i.test(t) ? [0, 1] : [0.7, 0.7])
    const embed: Embedder = async (texts) => {
      calls.push(texts)
      return texts.map(vec)
    }
    const idx = indexCards(CARDS)
    const h = await cascade('porridge oats', idx, { embed, embedCosineMin: 0.9 })
    expect(h).toMatchObject({ cardId: 'oat', method: 'embedding' })
    expect(calls[0]).toHaveLength(CARDS.length) // all cards embedded once
    await cascade('porridge oats', idx, { embed, embedCosineMin: 0.9 })
    expect(calls.filter((c) => c.length === CARDS.length)).toHaveLength(1) // cached on the index
    const fresh = indexCards(CARDS)
    expect(await cascade('zzz', fresh, { embed: async (t) => t.map((x) => (x === 'zzz' ? [1, 0] : [0, 1])), embedCosineMin: 0.5 })).toBeNull()
  })
  it('cosine', () => {
    expect(cosine([1, 0], [1, 0])).toBe(1)
    expect(cosine([1, 0], [0, 1])).toBe(0)
    expect(cosine([0, 0], [1, 1])).toBe(0)
  })
})

describe('retrieve — top-k distinct cards from several router names', () => {
  it('dedupes, ranks exact > token > embedding, caps at topK', async () => {
    const r = await retrieve(['Oatmeal', 'scrambled eggs with spinach', 'fried rice with egg', 'Plain oatmeal', 'grilled salmon'], index, { topK: 3 })
    expect(r.cardIds).toEqual(['oat', 'egg', 'rice'])
    expect(r.method).toBe('exact')
    expect(r.hits.map((h) => h.query)).toContain('Plain oatmeal')
    expect(r.hits.map((h) => h.query)).not.toContain('grilled salmon')
  })
  it('method is none when nothing matched', async () => {
    const r = await retrieve(['grilled salmon', 'ceviche'], index)
    expect(r).toEqual({ hits: [], cardIds: [], method: 'none' })
  })
})
