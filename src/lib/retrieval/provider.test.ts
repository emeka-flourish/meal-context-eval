import { describe, it, expect, vi } from 'vitest'

vi.mock('../db', () => ({ db: {} }))
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/runners/router', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/runners/router')>()), routeScene: vi.fn() }))
vi.mock('./embed', () => ({ makeEmbedder: () => null, embeddingsAvailable: () => false }))

import { cardsBySlot, renderCard, renderDishware, slotOfTime, type ProviderCard } from './provider'
import { mockRouterNames } from '@/runners/router'
import { validateAnnotation } from '../corpus/annotate'
import { parseDishware } from '../corpus/dishware'

const card = (over: Partial<ProviderCard>): ProviderCard => ({
  id: 'x',
  canonicalName: 'Oatmeal',
  aliases: ['Plain Oatmeal'],
  instanceCount: 113,
  lastSeen: '2026-08-09',
  portionClassMix: { small: 0.3, usual: 0.6, large: 0.1 },
  priorGrams: 200.5,
  ingredients: [
    { name: 'Oats', inclusionRate: 1, medianGramsEst: 40 },
    { name: 'Honey', inclusionRate: 0.45, medianGramsEst: 21 },
    { name: 'Cinnamon', inclusionRate: 0.05, medianGramsEst: null },
  ],
  features: { homeShare: null, slotMix: { breakfast: 0.95, lunch: 0.05, dinner: 0, snack: 0 } },
  ...over,
})

describe('Block 5 rendering', () => {
  it('renders a dish card with aliases, portion mix, prior, ingredients ≥ 20% and slots ≥ 5%', () => {
    const text = renderCard(card({}))
    expect(text).toContain('Dish card: Oatmeal (also logged as: Plain Oatmeal) — logged 113×, last 2026-08-09')
    expect(text).toContain('usual portion: small 30% · usual 60% · large 10%; typical total ≈ 201 g (estimated prior, not weighed)')
    expect(text).toContain('Oats (100%, ≈40 g) · Honey (45%, ≈21 g)')
    expect(text).not.toContain('Cinnamon')
    expect(text).toContain('when: breakfast 95% · lunch 5%')
  })
  it('renders dishware with capacities', () => {
    expect(renderDishware([{ name: 'Blue soup bowl', capacityMl: 450, capacityG: null, usedFor: 'soups' }, { name: 'Side plate', capacityMl: null, capacityG: null, usedFor: null }])).toBe(
      '- Blue soup bowl — capacity 450 ml; used for soups\n- Side plate',
    )
  })
  it('context_only picks cards by slot affinity', () => {
    const cards = [
      card({ id: 'a', canonicalName: 'Oatmeal' }),
      card({ id: 'b', canonicalName: 'Lentil Soup', instanceCount: 40, features: { homeShare: null, slotMix: { breakfast: 0, lunch: 0.4, dinner: 0.6, snack: 0 } } }),
      card({ id: 'c', canonicalName: 'Banana', instanceCount: 60, features: { homeShare: null, slotMix: { breakfast: 0.5, lunch: 0.3, dinner: 0.2, snack: 0 } } }),
    ]
    expect(cardsBySlot(cards, 'dinner', 3).map((c) => c.id)).toEqual(['b', 'c'])
    expect(cardsBySlot(cards, 'breakfast', 1).map((c) => c.id)).toEqual(['a'])
    expect(slotOfTime(new Date(2026, 7, 11, 8, 0))).toBe('breakfast')
    expect(slotOfTime(new Date(2026, 7, 11, 19, 30))).toBe('dinner')
  })
})

describe('router mock', () => {
  it('distinct GT dish labels first, padded with item names to ≥ 3, capped at 5, ignore-tagged dropped', () => {
    expect(
      mockRouterNames([
        { dish: 'Salmon plate', name: 'salmon', tag: 'core' },
        { dish: 'Salmon plate', name: 'sweet potato', tag: 'core' },
        { dish: 'Drink', name: 'water', tag: 'ignore' },
      ]),
    ).toEqual(['Salmon plate', 'salmon', 'sweet potato'])
    const many = Array.from({ length: 8 }, (_, i) => ({ dish: `dish ${i}`, name: `item ${i}`, tag: 'core' }))
    expect(mockRouterNames(many)).toHaveLength(5)
  })
})

describe('annotation + dishware validation', () => {
  it('annotation: requires mealId and something to record; rejects agreed+excluded', () => {
    expect(validateAnnotation({})).toMatch(/mealId/)
    expect(validateAnnotation({ mealId: 'm' })).toMatch(/nothing to record/)
    expect(validateAnnotation({ mealId: 'm', agreed: true, excluded: true })).toMatch(/both/)
    expect(validateAnnotation({ mealId: 'm', portionClass: 'huge' })).toMatch(/portionClass/)
    expect(validateAnnotation({ mealId: 'm', dishId: 'd', agreed: true, portionClass: 'large', editedJson: { name: 'Oats', ingredients: [{ name: 'Oats', gramsEst: 40 }] } })).toMatchObject({
      mealId: 'm',
      dishId: 'd',
      agreed: true,
      excluded: false,
      portionClass: 'large',
    })
    expect(validateAnnotation({ mealId: 'm', editedJson: { ingredients: [{ gramsEst: 1 }] } })).toMatch(/needs a name/)
  })
  it('dishware: name required on create, numbers validated, partial patch', () => {
    expect(parseDishware({})).toBe('name required')
    expect(parseDishware({ name: 'Bowl', capacityMl: '450', usedFor: ' soups ' })).toEqual({ name: 'Bowl', capacityMl: 450, usedFor: 'soups' })
    expect(parseDishware({ name: 'Bowl', capacityG: -1 })).toMatch(/capacityG/)
    expect(parseDishware({ capacityMl: null }, true)).toEqual({ capacityMl: null })
    expect(parseDishware({ name: '  ' }, true)).toMatch(/empty/)
  })
})

describe('retrieval v2 helpers', () => {
  const card = (canonicalName: string, instanceCount: number, ingredients: { name: string; inclusionRate: number; medianGramsEst: number | null }[] = []) =>
    ({ id: canonicalName, canonicalName, aliases: [], instanceCount, lastSeen: '2026-08-01', portionClassMix: { small: 0, usual: 1, large: 0 }, priorGrams: 200, ingredients, features: { homeShare: null, slotMix: { breakfast: 1, lunch: 0, dinner: 0, snack: 0 } } }) as never
  it('vocabulary = cards logged 3+ times, most frequent first', async () => {
    const { vocabularyOf } = await import('./provider')
    expect(vocabularyOf([card('Fufu', 3), card('Soft Polenta', 9), card('One-off Stew', 1)])).toEqual(['Soft Polenta', 'Fufu'])
  })
  it('known names map to their cards exactly and ignore names not on the list', async () => {
    const { cardsForKnown } = await import('./provider')
    const cards = [card('Soft Polenta', 9), card('Minestrone Soup with Chicken', 9)]
    expect(cardsForKnown(['minestrone soup with chicken', 'Made Up Dish', 'Soft Polenta'], cards).map((c: { canonicalName: string }) => c.canonicalName)).toEqual(['Minestrone Soup with Chicken', 'Soft Polenta'])
  })
  it('v2 card text leaves cooking water out', async () => {
    const { renderCardV2 } = await import('./provider')
    const text = renderCardV2(card('Oatmeal', 110, [{ name: 'Rolled Oats (dry)', inclusionRate: 1, medianGramsEst: 30 }, { name: 'Water', inclusionRate: 0.99, medianGramsEst: 200 }]))
    expect(text).toContain('Rolled Oats')
    expect(text).not.toMatch(/Water \(/)
    expect(text).toContain('served weight')
  })
})
