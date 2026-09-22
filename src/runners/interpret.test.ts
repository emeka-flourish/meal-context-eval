import { describe, it, expect, vi } from 'vitest'

// No db, no network: interpret.ts imports '@/lib/db' and '@/lib/llm' — stubbed.
vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/llm', () => ({
  runLlm: async (args: { mock: () => unknown }) => ({ output: args.mock(), callId: 'mock-call', mocked: true, latencyMs: 0 }),
  willMock: () => true,
  mockForced: () => true,
}))

import { interpretLlmSchema, isDrinkName, mockInterpret, situationFor, toPredItems, type InterpretLlmOutput } from './interpret'
import { LUNCH_TRUTH } from '@/lib/scoring/cases'

const OUT: InterpretLlmOutput = {
  plates: [
    {
      plate_index: 1,
      dishes: [
        {
          dish_name: 'salmon',
          preparation: 'baked',
          ingredients: [
            { name: 'salmon', grams_est: 205, state: 'cooked', preparation: null, confidence: 'high', inferred: false },
            { name: 'olive oil', grams_est: 3, state: null, preparation: null, confidence: 'low', inferred: true },
          ],
        },
        {
          dish_name: 'roasted vegetables',
          preparation: 'roasted',
          ingredients: [
            { name: 'brussels sprouts', grams_est: 60, state: 'cooked', preparation: 'roasted', confidence: 'medium', inferred: null },
            { name: 'broccoli', grams_est: 0, state: null, preparation: null, confidence: null, inferred: null },
          ],
        },
      ],
    },
    {
      plate_index: 2,
      dishes: [{ dish_name: 'side', preparation: null, ingredients: [{ name: 'sparkling water', grams_est: 250, state: 'as_served', preparation: null, confidence: 'high', inferred: false }] }],
    },
  ],
  uncertain: [{ name: 'lemon wedge', grams_est: 8, confidence: 'low', inferred: false }],
}

describe('toPredItems — interpret output → PredItem[]', () => {
  const items = toPredItems(interpretLlmSchema.parse(OUT))

  it('walks plates → dishes → ingredients with deterministic ids and the plate index', () => {
    expect(items.map((i) => i.id)).toEqual(['p1-d1-i1', 'p1-d1-i2', 'p1-d2-i1', 'p1-d2-i2', 'p2-d1-i1', 'u-1'])
    expect(items[0]).toMatchObject({ plate: 1, dish: 'salmon', name: 'salmon', grams: 205, confidence: 'high', state: 'cooked', preparation: 'baked' })
    expect(items[4].plate).toBe(2)
  })
  it('carries inferred, drops non-positive grams, inherits the dish preparation', () => {
    expect(items[1]).toMatchObject({ name: 'olive oil', inferred: true, grams: 3 })
    expect(items[0].inferred).toBeUndefined()
    expect(items[3].grams).toBeUndefined()
    expect(items[2].preparation).toBe('roasted')
  })
  it('flags drinks by keyword — never drops them', () => {
    expect(items[4]).toMatchObject({ name: 'sparkling water', isDrink: true })
    expect(items.filter((i) => i.isDrink)).toHaveLength(1)
  })
  it('appends uncertain items with confidence low under dish "uncertain"', () => {
    expect(items[5]).toMatchObject({ id: 'u-1', dish: 'uncertain', name: 'lemon wedge', grams: 8, confidence: 'low', uncertain: true })
  })
})

describe('isDrinkName', () => {
  it('recognises beverages but not milk-as-ingredient', () => {
    expect(isDrinkName('coffee')).toBe(true)
    expect(isDrinkName('orange juice')).toBe(true)
    expect(isDrinkName('a glass of milk')).toBe(true)
    expect(isDrinkName('milk')).toBe(true)
    expect(isDrinkName('coconut milk')).toBe(false)
    expect(isDrinkName('salmon')).toBe(false)
    expect(isDrinkName('watermelon')).toBe(false)
  })
})

describe('mockInterpret — deterministic prediction from truth', () => {
  it('is stable for the same key and differs across conditions', () => {
    const a = mockInterpret(LUNCH_TRUTH, { vantage: 'phone', condition: 'image_only', modelId: 'm' })
    const b = mockInterpret(LUNCH_TRUTH, { vantage: 'phone', condition: 'image_only', modelId: 'm' })
    const c = mockInterpret(LUNCH_TRUTH, { vantage: 'phone', condition: 'image_context', modelId: 'm' })
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
    expect(interpretLlmSchema.safeParse(a).success).toBe(true)
  })
  it('drops ignore items; drops spice without context; invents a garnish under image_only', () => {
    const io = toPredItems(mockInterpret(LUNCH_TRUTH, { vantage: 'phone', condition: 'image_only', modelId: 'm' }))
    const names = io.map((i) => i.name)
    expect(names).not.toContain('salt')
    expect(names).not.toContain('curry powder')
    expect(names).toContain('lemon wedge')
    const ic = toPredItems(mockInterpret(LUNCH_TRUTH, { vantage: 'phone', condition: 'image_context', modelId: 'm' }))
    expect(ic.map((i) => i.name)).toContain('curry powder')
    expect(ic.find((i) => i.name === 'olive oil')?.inferred).toBe(true)
  })
})

describe('situationFor', () => {
  it('derives weekday, local time and home/away from the meal', () => {
    const s = situationFor({ eatenAt: new Date('2026-08-14T13:05:00'), locationType: 'restaurant' })
    expect(s).toEqual({ weekday: 'Friday', localTime: '13:05', homeOrAway: 'away' })
    expect(situationFor({ eatenAt: new Date('2026-08-14T08:00:00'), locationType: 'home' }).homeOrAway).toBe('home')
  })
})

describe('cooking water is not a drink', () => {
  it('keeps water listed beside oats; drops a standalone glass of water', async () => {
    const { toPredItems } = await import('./interpret')
    const ing = (name: string, g: number) => ({ name, grams_est: g, state: null, preparation: null, confidence: null, inferred: null })
    const items = toPredItems({ plates: [{ plate_index: 1, dishes: [{ dish_name: 'Oatmeal', preparation: null, ingredients: [ing('Rolled oats (dry)', 35), ing('Water', 200)] }, { dish_name: 'Glass of water', preparation: null, ingredients: [ing('Water', 250)] }] }], uncertain: [] })
    expect(items.map((i) => Boolean(i.isDrink))).toEqual([false, false, true])
  })
})
