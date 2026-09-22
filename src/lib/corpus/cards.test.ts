import { describe, it, expect, vi } from 'vitest'

vi.mock('../db', () => ({ db: {} }))

import { buildCard, TIER_WEIGHT, type CardInstance } from './cards'
import { digestCards, mockHabitProfile } from './habits'

const base = (over: Partial<CardInstance>): CardInstance => ({
  dishId: 'd',
  mealId: 'm',
  name: 'Oatmeal',
  localDate: '2026-05-01',
  slot: 'breakfast',
  tier: 'unconfirmed',
  portionClass: 'usual',
  homeOrAway: null,
  ingredients: [
    { name: 'Oats', gramsEst: 40 },
    { name: 'Water', gramsEst: 200 },
  ],
  ...over,
})

describe('buildCard — CORPUS.md §3 stats', () => {
  const instances: CardInstance[] = [
    base({ dishId: 'a', localDate: '2026-05-01', tier: 'unconfirmed', portionClass: 'usual' }),
    base({ dishId: 'b', localDate: '2026-06-01', tier: 'corrected', portionClass: 'small', ingredients: [{ name: 'oats', gramsEst: 30 }, { name: 'Honey', gramsEst: 21 }] }),
    base({ dishId: 'c', localDate: '2026-05-15', tier: 'confirmed', portionClass: 'usual', slot: 'dinner', ingredients: [{ name: 'Oats', gramsEst: null }, { name: 'Milk', gramsEst: 244 }] }),
  ]
  const card = buildCard({ canonicalName: 'Oatmeal', aliases: ['Oats porridge'] }, instances)
  const W = TIER_WEIGHT.unconfirmed + TIER_WEIGHT.corrected + TIER_WEIGHT.confirmed // 2.2

  it('counts, lastSeen, tierMix', () => {
    expect(card.instanceCount).toBe(3)
    expect(card.lastSeen).toBe('2026-06-01')
    expect(card.tierMix).toEqual({ corrected: 1, confirmed: 1, unconfirmed: 1 })
    expect(card.aliases).toEqual(['Oats porridge'])
  })
  it('portionClassMix and slotMix are tier-weighted shares', () => {
    expect(card.portionClassMix.small).toBeCloseTo(1 / W, 3)
    expect(card.portionClassMix.usual).toBeCloseTo((0.5 + 0.7) / W, 3)
    expect(card.portionClassMix.large).toBe(0)
    expect(card.features.slotMix.breakfast).toBeCloseTo(1.5 / W, 3)
    expect(card.features.slotMix.dinner).toBeCloseTo(0.7 / W, 3)
  })
  it('priorGrams = median of per-instance summed gramsEst (instances with any grams)', () => {
    // sums: 240, 51, 244 → median 240
    expect(card.priorGrams).toBe(240)
  })
  it('ingredients: normalized grouping, weighted inclusion rate, median grams, sorted by inclusion', () => {
    const oats = card.ingredients.find((i) => i.name === 'Oats')!
    expect(oats.inclusionRate).toBe(1)
    expect(oats.medianGramsEst).toBe(35) // 40, 30 (null dropped)
    const water = card.ingredients.find((i) => i.name === 'Water')!
    expect(water.inclusionRate).toBeCloseTo(0.5 / W, 3)
    expect(card.ingredients[0].name).toBe('Oats')
    expect(card.ingredients.map((i) => i.name).sort()).toEqual(['Honey', 'Milk', 'Oats', 'Water'])
  })
  it('homeShare null when location is unknown everywhere; weighted otherwise', () => {
    expect(card.features.homeShare).toBeNull()
    const c2 = buildCard({ canonicalName: 'x', aliases: [] }, [base({ homeOrAway: 'home', tier: 'corrected' }), base({ homeOrAway: 'away', tier: 'unconfirmed' }), base({ homeOrAway: null })])
    expect(c2.features.homeShare).toBeCloseTo(1 / 1.5, 3)
  })
  it('priorGrams null when no instance carries grams', () => {
    const c = buildCard({ canonicalName: 'x', aliases: [] }, [base({ ingredients: [{ name: 'Goat', gramsEst: null }] })])
    expect(c.priorGrams).toBeNull()
    expect(c.ingredients[0].medianGramsEst).toBeNull()
  })
})

describe('habit profile (mock)', () => {
  const cards = [
    buildCard({ canonicalName: 'Oatmeal', aliases: [] }, Array.from({ length: 5 }, (_, i) => base({ dishId: `o${i}` }))),
    buildCard({ canonicalName: 'Jollof Rice', aliases: [] }, Array.from({ length: 3 }, (_, i) => base({ dishId: `j${i}`, slot: 'dinner', portionClass: 'large', ingredients: [{ name: 'Rice', gramsEst: 200 }, { name: 'Vegetable oil', gramsEst: 14 }] }))),
    buildCard({ canonicalName: 'Banana', aliases: [] }, [base({ dishId: 'b', slot: 'lunch', portionClass: 'small', ingredients: [{ name: 'Banana', gramsEst: 118 }] })]),
  ]
  const d = digestCards(cards)
  it('digest is card-level only', () => {
    expect(d.cardCount).toBe(3)
    expect(d.instanceTotal).toBe(9)
    expect(d.topDishes[0]).toMatchObject({ name: 'Oatmeal', instances: 5 })
    expect(d.bySlot.dinner[0].name).toBe('Jollof Rice')
    expect(d.cookingFats).toEqual([{ name: 'vegetable oil', dishes: 1 }])
    expect(d.homeShare).toBeNull()
    expect(d.portionClassOverall.large).toBeCloseTo(3 / 9, 3)
  })
  it('renders five numbered findings', () => {
    const text = mockHabitProfile(d)
    const lines = text.split('\n')
    expect(lines).toHaveLength(6)
    expect(lines[0]).toMatch(/^1\. Most frequent dishes: Oatmeal \(5×\)/)
    expect(text).toContain('vegetable oil')
    expect(text).toContain('Oatmeal ≈ 240 g')
    expect(text).toMatch(/Home vs away is unknown/)
  })
})
