import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))
vi.mock('@/lib/llm', () => ({
  runLlm: async (args: { mock: () => unknown }) => ({ output: args.mock(), callId: 'mock-call', mocked: true, latencyMs: 0 }),
  willMock: () => true,
  mockForced: () => true,
}))

import { classifyLlmSchema, classifyUserText, ingredientLines, mockClassify, toScoringClassification, type IngredientLine } from './classify'

const L = (name: string, grams?: number, preparation?: string, dish = 'plate'): IngredientLine => ({ name, grams, preparation, dish })

describe('mockClassify — keyword rules', () => {
  it('plain plate → green, no irritants', () => {
    const c = mockClassify([L('salmon', 170, 'baked'), L('sweet potato', 150, 'baked'), L('olive oil', 5)])
    expect(c.fodmap.light).toBe('green')
    expect(c.nausea.fried).toBe(false)
    expect(c.nausea.spicy).toBe(false)
    expect(classifyLlmSchema.safeParse(c).success).toBe(true)
  })
  it('one FODMAP hit → amber; two hits or a large serve → red; deciding lists the family', () => {
    expect(mockClassify([L('onion', 20), L('rice', 200)]).fodmap.light).toBe('amber')
    const red = mockClassify([L('onion', 20), L('garlic', 5), L('rice', 200)])
    expect(red.fodmap.light).toBe('red')
    expect(red.fodmap.deciding.map((d) => d.ingredient)).toEqual(['onion', 'garlic'])
    expect(red.fodmap.deciding[0].family).toBe('fructan')
    expect(mockClassify([L('wheat bread', 90)]).fodmap.light).toBe('red')
    expect(mockClassify([L('honey', 21)]).fodmap.light).toBe('amber')
  })
  it('fried / crispy items count only at 30 g or more', () => {
    expect(mockClassify([L('plantain', 120, 'fried')]).nausea.fried).toBe(true)
    expect(mockClassify([L('crispy onions', 10)]).nausea.fried).toBe(false)
    expect(mockClassify([L('fried chicken', 150)]).nausea.fried_items).toEqual(['fried chicken'])
  })
  it('chili-bearing items and hot sauce are spicy at any amount; jollof is inferred spicy', () => {
    expect(mockClassify([L('hot sauce', 3)]).nausea.spicy).toBe(true)
    expect(mockClassify([L('scotch bonnet', 4)]).nausea.spicy_items).toEqual(['scotch bonnet'])
    const j = mockClassify([L('jollof rice', 200)])
    expect(j.nausea.spicy).toBe(true)
    expect(j.nausea.spicy_inferred).toBe(true)
    expect(mockClassify([L('black pepper', 1)]).nausea.spicy).toBe(false)
  })
})

describe('ingredientLines / classifyUserText — blind input', () => {
  it('drops drinks and ignore items, keeps name · grams · preparation · dish', () => {
    const lines = ingredientLines([
      { name: 'salmon', grams: 170, dish: 'salmon', preparation: 'baked', tag: 'core' },
      { name: 'salt', tag: 'ignore', dish: 'salmon' },
      { name: 'coffee', grams: 250, isDrink: true, dish: 'drink' },
    ])
    expect(lines).toEqual([{ name: 'salmon', grams: 170, preparation: 'baked', dish: 'salmon' }])
    const text = classifyUserText('lunch', lines)
    expect(text).toMatch(/^Meal slot: lunch/)
    expect(text).toMatch(/salmon · 170 g · baked · salmon/)
    expect(text).not.toMatch(/truth|estimate|phone|glasses|tripod/)
  })
})

describe('toScoringClassification', () => {
  it('maps the payload to the level3 Classification shape', () => {
    const c = toScoringClassification(mockClassify([L('onion', 20), L('fried chicken', 150), L('hot sauce', 5)]))
    expect(c).toMatchObject({ light: 'amber', fried: true, spicy: true, deciding: ['onion'] })
    expect(typeof c.reason).toBe('string')
  })
})
