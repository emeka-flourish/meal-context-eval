import { describe, it, expect, vi } from 'vitest'

// The cutoff is read from the environment when load.ts is first imported; pin one for these tests.
vi.hoisted(() => {
  process.env.CORPUS_CUTOFF_EXCLUSIVE = '2026-06-10'
})

// load.ts → ../fdc (normalizeIngredientName) → ./db: stub the singleton so no client is built.
vi.mock('../db', () => ({ db: {} }))

import {
  CORPUS_CUTOFF_EXCLUSIVE,
  CutoffError,
  csvRowToRecord,
  gramsFor,
  localTimeOf,
  mapMeal,
  parseAmount,
  planMeal,
  portionClassOf,
  slotOf,
  summarize,
  type MealRecord,
} from './load'

const REC: MealRecord = {
  mealId: 'm1',
  name: 'Avocado Tuna Toast',
  description: 'toast',
  mealTypeName: 'Breakfast',
  estimatedServingSize: 'STANDARD',
  summaryDateInUserTime: '2026-05-02',
  timestampInUserTimezone: '2026-05-02 08:15:00',
  isConfirmed: false,
  imageUrl: 'https://example.com/meal-images/x.jpeg',
  imageFile: null,
  imageSha256: null,
  dishes: [
    {
      dishId: 'd1',
      name: 'Avocado Tuna Toast',
      description: null,
      preparation: 'Toasted',
      estimatedServingSize: 'STANDARD',
      ingredients: [
        { name: 'Wheat bread', amount: 2, unit: 'slices', notes: '' },
        { name: 'Avocado', amount: 0.5, unit: 'avocado', notes: null },
        { name: 'Tuna', amount: 60, unit: 'g', notes: null },
        { name: 'Olive oil', amount: 5, unit: 'ml', notes: null },
        { name: 'Almond butter', amount: 1, unit: 'tbsp', notes: null },
        { name: 'Goat meat', amount: 1, unit: 'drumstick', notes: null },
        { name: 'Banana', amount: '1', unit: 'medium banana', notes: null },
      ],
    },
  ],
}

describe('mapMeal — CORPUS.md §1 mapping', () => {
  const m = mapMeal(REC)
  it('maps the meal scalars', () => {
    expect(m.sourceMealId).toBe('m1')
    expect(m.localDate).toBe('2026-05-02')
    expect(m.localTime).toBe('08:15')
    expect(m.slot).toBe('breakfast')
    expect(m.portionClassPrefill).toBe('usual')
    expect(m.tier).toBe('unconfirmed')
    expect(m.imageFile).toBeNull()
  })
  it('gramsEst: unit table → unit_table; g / ml → app_estimate; unknown → none', () => {
    const g = Object.fromEntries(m.dishes[0].ingredients.map((i) => [i.name, [i.gramsEst, i.gramsSource]]))
    expect(g['Wheat bread']).toEqual([56, 'unit_table'])
    expect(g['Avocado']).toEqual([68, 'unit_table'])
    expect(g['Tuna']).toEqual([60, 'app_estimate'])
    expect(g['Olive oil']).toEqual([5, 'app_estimate'])
    expect(g['Almond butter']).toEqual([16, 'unit_table'])
    expect(g['Goat meat']).toEqual([null, 'none'])
    expect(g['Banana']).toEqual([118, 'unit_table'])
  })
  it('keeps dish + ingredient order and raw amount/unit', () => {
    expect(m.dishes[0].order).toBe(0)
    expect(m.dishes[0].ingredients.map((i) => i.order)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(m.dishes[0].ingredients[1]).toMatchObject({ amount: 0.5, unit: 'avocado' })
  })
  it('is_confirmed → confirmed tier', () => {
    expect(mapMeal({ ...REC, isConfirmed: true }).tier).toBe('confirmed')
  })
})

describe('cutoff refusal', () => {
  it(`refuses localDate ≥ ${CORPUS_CUTOFF_EXCLUSIVE}`, () => {
    expect(() => mapMeal({ ...REC, summaryDateInUserTime: '2026-06-10' })).toThrow(CutoffError)
    expect(() => mapMeal({ ...REC, summaryDateInUserTime: '2026-06-14' })).toThrow(/refused/)
  })
  it('accepts the last day of the window', () => {
    expect(mapMeal({ ...REC, summaryDateInUserTime: '2026-06-09' }).localDate).toBe('2026-06-09')
  })
  it('falls back to the local timestamp when the summary date is missing', () => {
    expect(mapMeal({ ...REC, summaryDateInUserTime: null }).localDate).toBe('2026-05-02')
    expect(() => mapMeal({ ...REC, summaryDateInUserTime: null, timestampInUserTimezone: '2026-06-11 09:00:00' })).toThrow(CutoffError)
  })
})

describe('field mappers', () => {
  it('slot', () => {
    expect(slotOf('Breakfast')).toBe('breakfast')
    expect(slotOf('LUNCH')).toBe('lunch')
    expect(slotOf('Dinner')).toBe('dinner')
    expect(slotOf('Snack')).toBe('snack')
    expect(slotOf(null)).toBe('snack')
  })
  it('portion class prefill', () => {
    expect(portionClassOf('SNACK')).toBe('small')
    expect(portionClassOf('SMALL')).toBe('small')
    expect(portionClassOf('STANDARD')).toBe('usual')
    expect(portionClassOf('LARGE')).toBe('large')
    expect(portionClassOf('EXTRA_LARGE')).toBe('large')
    expect(portionClassOf(null)).toBe('usual')
  })
  it('local time', () => {
    expect(localTimeOf({ mealId: 'x', timestampInUserTimezone: '2026-04-10T16:24:00.000' })).toBe('16:24')
    expect(localTimeOf({ mealId: 'x' })).toBe('00:00')
  })
  it('amounts: numbers, numeric strings, fractions', () => {
    expect(parseAmount(2)).toBe(2)
    expect(parseAmount('1.5')).toBe(1.5)
    expect(parseAmount('1/3')).toBeCloseTo(1 / 3)
    expect(parseAmount('some')).toBeNull()
    expect(parseAmount(null)).toBeNull()
  })
  it('gramsFor edge cases', () => {
    expect(gramsFor('Egg', 2, 'large egg')).toEqual({ gramsEst: 100, gramsSource: 'unit_table' })
    expect(gramsFor('Egg', 1, 'egg')).toEqual({ gramsEst: 44, gramsSource: 'unit_table' })
    expect(gramsFor('Oatmeal', 0.5, 'cup')).toEqual({ gramsEst: 40.5, gramsSource: 'unit_table' })
    expect(gramsFor('Chicken', 1, 'cup')).toEqual({ gramsEst: null, gramsSource: 'none' }) // no cup weight for chicken
    expect(gramsFor('Mango', 0, 'g')).toEqual({ gramsEst: null, gramsSource: 'none' })
    expect(gramsFor('Honey', 1, 'tsp')).toEqual({ gramsEst: 7, gramsSource: 'unit_table' })
  })
})

describe('csvRowToRecord — CSV columns → MealRecord', () => {
  it('maps a pgAdmin row incl. the NULL marker and the dishes JSON', () => {
    const rec = csvRowToRecord({
      meal_id: 'abc',
      local_date: '2026-04-10',
      local_time: '2026-04-10 09:00:00',
      meal_type: 'Lunch',
      name: 'Banana',
      description: 'NULL',
      serving_size: 'SNACK',
      is_confirmed: 'False',
      image_url: 'NULL',
      dishes: '[{"dish_id":"d","name":"Fresh Banana","serving_size":"SNACK","preparation":"Raw","ingredients":[{"name":"Banana","amount":1,"unit":"medium banana","notes":""}]}]',
    })
    expect(rec.mealId).toBe('abc')
    expect(rec.description).toBeNull()
    expect(rec.imageUrl).toBeNull()
    expect(rec.isConfirmed).toBe(false)
    expect(rec.dishes?.[0]).toMatchObject({ dishId: 'd', name: 'Fresh Banana', preparation: 'Raw', estimatedServingSize: 'SNACK' })
    const m = mapMeal(rec)
    expect(m.slot).toBe('lunch')
    expect(m.portionClassPrefill).toBe('small')
    expect(m.dishes[0].ingredients[0]).toMatchObject({ gramsEst: 118, gramsSource: 'unit_table' })
  })
  it('refuses a row without meal_id and a non-JSON dishes column', () => {
    expect(() => csvRowToRecord({ meal_id: '' })).toThrow(/meal_id/)
    expect(() => csvRowToRecord({ meal_id: 'x', dishes: '{oops' })).toThrow(/not valid JSON/)
  })
})

describe('planMeal — idempotent by sourceMealId', () => {
  const m = mapMeal(REC)
  it('creates when absent', () => {
    expect(planMeal(m, undefined)).toEqual({ action: 'create', meal: m })
  })
  it('is unchanged on an identical re-run', () => {
    const ex = { sourceMealId: 'm1', name: m.name, description: m.description, servingSize: m.servingSize, imageFile: null, imageSha256: null, dishCount: 1 }
    expect(planMeal(m, ex)).toEqual({ action: 'unchanged', sourceMealId: 'm1' })
  })
  it('picks up the image on a later run and never drops it', () => {
    const ex = { sourceMealId: 'm1', name: m.name, description: m.description, servingSize: m.servingSize, imageFile: null, imageSha256: null, dishCount: 1 }
    const withImg = mapMeal({ ...REC, imageFile: 'm1.jpg', imageSha256: 'ab' })
    expect(planMeal(withImg, ex)).toEqual({ action: 'update', sourceMealId: 'm1', patch: { imageFile: 'm1.jpg', imageSha256: 'ab' } })
    const exImg = { ...ex, imageFile: 'm1.jpg', imageSha256: 'ab' }
    expect(planMeal(m, exImg)).toEqual({ action: 'unchanged', sourceMealId: 'm1' })
  })
  it('summarizes counts', () => {
    const s = summarize([m], [planMeal(m, undefined)])
    expect(s).toMatchObject({ create: 1, meals: 1, dishes: 1, ingredients: 7, bySlot: { breakfast: 1, lunch: 0, dinner: 0, snack: 0 } })
    expect(s.gramsBySource).toEqual({ app_estimate: 2, unit_table: 4, none: 1 })
    expect(s.dateRange).toEqual({ start: '2026-05-02', end: '2026-05-02' })
  })
})
