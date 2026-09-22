import { describe, it, expect } from 'vitest'
import { gtItemToTruth, isShortFoodName, parseComponents, weighedShare } from './truth-items'

describe('parseComponents', () => {
  it('splits a comma list of ≥ 2 digit-free names', () => {
    expect(parseComponents('Brussels sprouts, sweet potatoes, broccoli, zucchini, onions')).toEqual([
      'brussels sprouts',
      'sweet potatoes',
      'broccoli',
      'zucchini',
      'onions',
    ])
  })
  it('treats a conversion note or a single name as a note, not components', () => {
    expect(parseComponents('27 g dry')).toBeUndefined()
    expect(parseComponents('oats')).toBeUndefined()
    expect(parseComponents(null)).toBeUndefined()
  })
  it('accepts the real composite lists (note-style rows), any separator', () => {
    expect(parseComponents('lettuce, brown rice, roasted squash, black beans, pear, grilled tofu, lemon dressing')).toEqual([
      'lettuce', 'brown rice', 'roasted squash', 'black beans', 'pear', 'grilled tofu', 'lemon dressing',
    ])
    expect(parseComponents('Carrots, cauliflower, mushrooms, zucchini, onion')).toEqual(['carrots', 'cauliflower', 'mushrooms', 'zucchini', 'onion'])
    expect(parseComponents('rice · beans · plantain')).toEqual(['rice', 'beans', 'plantain'])
    expect(parseComponents('lettuce / tomato / cucumber')).toEqual(['lettuce', 'tomato', 'cucumber'])
    expect(parseComponents('spinach and onions')).toEqual(['spinach', 'onions'])
  })
  it('rejects preparation / quantity / default notes even when comma-separated (note-style rows)', () => {
    const notes = [
      'sautéed with olive oil, salt, pepper',
      'used for frying egg',
      'used for frying, no amount stated; default 5 g as per cooking fat rule',
      'Used for frying egg and kale; default small amount for cooking fat with no stated quantity',
      'fried with garlic salt',
      'fried',
      'One large egg, fried in olive oil with kale and tomatoes',
      'One large egg fried in olive oil',
      'One tbsp hummus',
      'One tbsp peanut butter - 25 g (note: differs from standard 16 g/tbsp table)',
      'One half medium avocado (0.5 × 136 g)',
      'half banana',
      '20 raspberries; no quantity given, default fruit 100 g',
      '1/2 cup uncooked oats, cooked with water (dry weight 40.5 g × 6.48 = 263 g as served)',
      'Sprinkle of tomatoes with egg',
      'sprinkle of tomatoes',
      '40 g kale cooked with egg',
      'Cooked with egg',
      'Cooking liquid for oatmeal',
      '1/2 tuna can',
      'Two slices wheat bread (2 × 28 g per slice)',
    ]
    for (const n of notes) expect(parseComponents(n), n).toBeUndefined()
  })
  it('isShortFoodName: 1–3 letter words, no digits, no note words', () => {
    expect(isShortFoodName('grilled chicken')).toBe(true)
    expect(isShortFoodName('balsamic vinaigrette')).toBe(true)
    expect(isShortFoodName("brussels sprouts")).toBe(true)
    expect(isShortFoodName('fried in avocado oil')).toBe(false)
    expect(isShortFoodName('one tbsp honey')).toBe(false)
    expect(isShortFoodName('27 g dry')).toBe(false)
    expect(isShortFoodName('very long composite dish name')).toBe(false)
    expect(isShortFoodName('')).toBe(false)
  })
})

describe('gtItemToTruth', () => {
  it('maps a GtItem row, defaulting basis and dropping null grams', () => {
    const t = gtItemToTruth({ id: 'g1', dish: 'salmon', name: 'curry powder', grams: null, basis: null, tag: 'spice', state: null, componentsNote: null })
    expect(t).toEqual({ id: 'g1', dish: 'salmon', name: 'curry powder', basis: 'estimated', tag: 'spice' })
  })
  it('weighedShare = weighed grams / gram-bearing grams over non-ignore items', () => {
    const items = [
      gtItemToTruth({ id: 'a', dish: 'd', name: 'salmon', grams: 200, basis: 'weighed', tag: 'core', state: null, componentsNote: null }),
      gtItemToTruth({ id: 'b', dish: 'd', name: 'oil', grams: 50, basis: 'estimated', tag: 'secondary', state: null, componentsNote: null }),
      gtItemToTruth({ id: 'c', dish: 'd', name: 'water', grams: 300, basis: 'weighed', tag: 'ignore', state: null, componentsNote: null }),
    ]
    expect(weighedShare(items)).toBeCloseTo(0.8)
    expect(weighedShare([])).toBeNull()
  })
})

describe('parseWeightedComponents', () => {
  it('reads "name N g" lists into names + weights', async () => {
    const { parseWeightedComponents } = await import('./truth-items')
    expect(parseWeightedComponents('romaine 90 g, wild rice 110 g, grilled chicken (70 g)')).toEqual({ names: ['romaine', 'wild rice', 'grilled chicken'], weights: [90, 110, 70] })
  })
  it('is undefined for a plain list or a note', async () => {
    const { parseWeightedComponents } = await import('./truth-items')
    expect(parseWeightedComponents('romaine, wild rice')).toBeUndefined()
    expect(parseWeightedComponents('27 g dry')).toBeUndefined()
  })
})
