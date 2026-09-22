import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/llm', () => ({
  runLlm: async (args: { mock: () => unknown }) => ({ output: args.mock(), callId: 'mock-call', mocked: true, latencyMs: 0 }),
  willMock: () => true,
  mockForced: () => true,
}))

import { applyOverrides, matchLlmSchema, matchUserText, mockInventedTag, mockMatch, validateMatchOutput } from './match'
import { CASES, LUNCH_TRUTH, scoreCase } from '@/lib/scoring/cases'
import { level1 } from '@/lib/scoring/level1'
import type { MatchTable, PredItem } from '@/lib/scoring/types'

const byN = (n: number) => CASES.find((c) => c.n === n)!
const pairedRows = (t: MatchTable) => t.rows.filter((r) => r.predIds.length > 0).map((r) => ({ ...r, predIds: [...r.predIds].sort() }))
const sortRows = (rows: MatchTable['rows']) => [...rows].sort((a, b) => a.truthIds[0].localeCompare(b.truthIds[0]))

describe('mockMatch — blind, name-normalized (METRICS worked lunch case)', () => {
  it('reproduces the case-1 match table: 4 veg predictions summed onto the composite, lemon invented, curry + parsley missed', () => {
    const c = byN(1)
    const t = mockMatch({ truthItems: c.truth, predItems: c.preds })
    expect(sortRows(pairedRows(t))).toEqual(sortRows(pairedRows(c.match)))
    expect(t.invented).toEqual([{ predId: 'p-lemon', tag: 'garnish' }])
    expect(t.droppedDrinks).toEqual([])
    // missed truth items are explicit empty rows (ignore items never appear)
    const missed = t.rows.filter((r) => r.predIds.length === 0).flatMap((r) => r.truthIds).sort()
    expect(missed).toEqual(['t-curry', 't-parsley'])
    expect(t.rows.flatMap((r) => r.truthIds)).not.toContain('t-salt')
  })
  it('scores exactly like the worked case 1 through level1', () => {
    const c = byN(1)
    const mine = level1(c.truth, c.preds, mockMatch({ truthItems: c.truth, predItems: c.preds }))
    const ref = scoreCase(c)
    expect(mine.recognized).toBeCloseTo(ref.recognized, 6)
    expect(mine.invented).toBeCloseTo(ref.invented, 6)
    expect(mine.net).toBeCloseTo(ref.net, 6)
    expect(mine.quantity).toBeCloseTo(ref.quantity, 6)
    expect(mine.f1.f1).toBeCloseTo(ref.f1.f1, 6)
  })
  it('reproduces case 6 (padded log): invented tags by the keyword guide, salt/pepper ignore', () => {
    const c = byN(6)
    const t = mockMatch({ truthItems: c.truth, predItems: c.preds })
    const inv = Object.fromEntries(t.invented.map((i) => [i.predId, i.tag]))
    expect(inv).toEqual({ 'p-garlic': 'spice', 'p-lemonjuice': 'garnish', 'p-herbs': 'spice', 'p-butter': 'garnish', 'p-salt': 'ignore', 'p-pepper': 'ignore' })
    const mine = level1(c.truth, c.preds, t)
    const ref = scoreCase(c)
    expect(mine.net).toBeCloseTo(ref.net, 6)
    expect(mine.quantity).toBeCloseTo(ref.quantity, 6)
  })
  it('drops drink predictions and matches plurals / word order', () => {
    const preds: PredItem[] = [
      { id: 'w', dish: 'drink', name: 'water', isDrink: true },
      { id: 's', dish: 'salmon', name: 'Salmon fillets', grams: 200 },
      { id: 'sp', dish: 'sweet potatoes', name: 'Sweet potatoes', grams: 140 },
    ]
    const t = mockMatch({ truthItems: LUNCH_TRUTH, predItems: preds })
    expect(t.droppedDrinks).toEqual(['w'])
    expect(t.rows.find((r) => r.truthIds[0] === 't-salmon')?.predIds).toEqual(['s'])
    expect(t.rows.find((r) => r.truthIds[0] === 't-sp')?.predIds).toEqual(['sp'])
  })
  it('mockInventedTag follows grams when no keyword applies', () => {
    expect(mockInventedTag({ id: 'x', dish: 'x', name: 'chicken breast', grams: 200 })).toBe('core')
    expect(mockInventedTag({ id: 'x', dish: 'x', name: 'coleslaw', grams: 40 })).toBe('secondary')
    expect(mockInventedTag({ id: 'x', dish: 'x', name: 'sesame seeds', grams: 2 })).toBe('garnish')
  })
})

describe('validateMatchOutput — model output → MatchTable', () => {
  const c = byN(1)
  it('accepts a well-formed table and maps identity words', () => {
    const raw = matchLlmSchema.parse({
      rows: [
        { truth_ids: ['t-salmon'], pred_ids: ['p-salmon'], identity: 'exact', note: null },
        { truth_ids: ['t-sp'], pred_ids: ['p-sp'], identity: 'substitute', note: 'close' },
        { truth_ids: ['t-veg'], pred_ids: ['p-brussels', 'p-sp2', 'p-broccoli', 'p-zucchini'], identity: 'exact', note: null },
      ],
      invented: [{ pred_id: 'p-lemon', tag: 'garnish', note: null }],
      dropped_drinks: [],
    })
    const t = validateMatchOutput(raw, c.truth, c.preds)
    expect(t.rows.find((r) => r.truthIds[0] === 't-sp')?.identity).toBe(0.5)
    expect(t.rows.find((r) => r.truthIds[0] === 't-veg')?.predIds).toHaveLength(4)
    // unlisted truth → empty row; unlisted prediction (p-oil) → invented garnish
    expect(t.rows.find((r) => r.truthIds[0] === 't-oil')?.predIds).toEqual([])
    expect(t.invented).toContainEqual({ predId: 'p-oil', tag: 'garnish' })
  })
  it('drops unknown ids and uses each prediction at most once (first use wins)', () => {
    const raw = matchLlmSchema.parse({
      rows: [
        { truth_ids: ['t-salmon', 'nope'], pred_ids: ['p-salmon', 'ghost'], identity: 'exact', note: null },
        { truth_ids: ['t-sp'], pred_ids: ['p-salmon'], identity: 'exact', note: null },
      ],
      invented: [{ pred_id: 'p-salmon', tag: 'core', note: null }, { pred_id: 'ghost', tag: 'core', note: null }],
      dropped_drinks: ['p-salmon'],
    })
    const t = validateMatchOutput(raw, c.truth, c.preds)
    const uses = [...t.rows.flatMap((r) => r.predIds), ...t.invented.map((i) => i.predId), ...t.droppedDrinks].filter((id) => id === 'p-salmon')
    expect(uses).toHaveLength(1)
    expect(t.rows[0]).toEqual({ truthIds: ['t-salmon'], predIds: ['p-salmon'], identity: 1 })
    expect(t.rows.find((r) => r.truthIds[0] === 't-sp')).toEqual({ truthIds: ['t-sp'], predIds: [], identity: 0 })
    expect(JSON.stringify(t)).not.toContain('ghost')
  })
  it('a prediction flagged isDrink that the model forgot is dropped, not invented', () => {
    const preds: PredItem[] = [...c.preds, { id: 'p-tea', dish: 'tea', name: 'tea', isDrink: true }]
    const raw = matchLlmSchema.parse({ rows: [], invented: [], dropped_drinks: [] })
    const t = validateMatchOutput(raw, c.truth, preds)
    expect(t.droppedDrinks).toEqual(['p-tea'])
    expect(t.invented.map((i) => i.predId)).not.toContain('p-tea')
  })
})

describe('applyOverrides — the owner fixes applied on read', () => {
  const c = byN(5) // chicken breast paired WRONG with salmon
  it('re-pairs a truth item and frees the old prediction as invented', () => {
    const fixed = applyOverrides(c.match, [{ truthId: 't-salmon', predIds: [], identity: 0, inventedTag: 'core' }], c.preds)
    expect(fixed.rows.find((r) => r.truthIds[0] === 't-salmon')).toEqual({ truthIds: ['t-salmon'], predIds: [], identity: 0 })
    expect(fixed.invented).toContainEqual({ predId: 'p-chicken', tag: 'core' })
    // net rises from the wrong-pairing case to the plain-miss case (case 3 territory)
    expect(level1(c.truth, c.preds, fixed).recognized).toBeCloseTo(scoreCase(c).recognized, 6)
    expect(level1(c.truth, c.preds, fixed).invented).toBeCloseTo(scoreCase(c).invented, 6)
  })
  it('moving a prediction into another row removes it from its old row', () => {
    const c1 = byN(1)
    const fixed = applyOverrides(c1.match, [{ truthId: 't-sp', predIds: ['p-sp', 'p-sp2'], identity: 1 }], c1.preds)
    expect(fixed.rows.find((r) => r.truthIds[0] === 't-veg')?.predIds).toEqual(['p-brussels', 'p-broccoli', 'p-zucchini'])
    expect(fixed.rows.find((r) => r.truthIds[0] === 't-sp')?.predIds).toEqual(['p-sp', 'p-sp2'])
    expect(applyOverrides(c1.match, [], c1.preds)).toBe(c1.match)
  })
})

describe('matchUserText — blind input', () => {
  it('lists only item fields, no vantage / condition / model, and drops ignore truth', () => {
    const c = byN(1)
    const text = matchUserText(c.truth, c.preds)
    expect(text).toMatch(/t-salmon · salmon · salmon · 170 g · cooked/)
    expect(text).toMatch(/t-veg · roasted vegetables · roasted vegetables · 200 g · cooked · brussels sprouts, sweet potato/)
    expect(text).not.toMatch(/t-salt/)
    expect(text).not.toMatch(/phone|glasses|tripod|image_only|gpt|claude|gemini/)
  })
})

describe('capInventedTag (tag-guide cap on phantoms)', () => {
  it('oils under a tablespoon are garnish even if the matcher said secondary', async () => {
    const { capInventedTag } = await import('./match')
    expect(capInventedTag('secondary', { id: 'x', dish: 'd', name: 'Olive oil', grams: 5 })).toBe('garnish')
    expect(capInventedTag('secondary', { id: 'x', dish: 'd', name: 'Butter on sweet potato', grams: 7 })).toBe('garnish')
    expect(capInventedTag('secondary', { id: 'x', dish: 'd', name: 'Olive oil', grams: 20 })).toBe('secondary')
  })
  it('small extras cannot be core; spices stay spice; big items keep the tag', async () => {
    const { capInventedTag } = await import('./match')
    expect(capInventedTag('core', { id: 'x', dish: 'd', name: 'Potato, diced', grams: 30 })).toBe('secondary')
    expect(capInventedTag('core', { id: 'x', dish: 'd', name: 'Potato, diced', grams: 80 })).toBe('core')
    expect(capInventedTag('secondary', { id: 'x', dish: 'd', name: 'Paprika seasoning blend', grams: 2 })).toBe('spice')
    expect(capInventedTag('secondary', { id: 'x', dish: 'd', name: 'Lemon juice on salmon', grams: 5 })).toBe('garnish')
  })
})
