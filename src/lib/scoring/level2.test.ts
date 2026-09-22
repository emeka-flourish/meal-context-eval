import { describe, it, expect } from 'vitest'
import { level2, nutrientErrors, summarizeNutrientErrors, type NutrientLookup, type Per100 } from './level2'
import { LUNCH_TRUTH } from './cases'
import type { Nutrients } from './types'

/* Fake per-100 g table: round numbers so sums are checkable by hand. */
const TABLE: Record<string, Per100> = {
  'salmon|cooked': { kcal: 200, protein: 22, fat: 12, carb: 0, fiber: 0, source: 'fdc' },
  'sweet potato|cooked': { kcal: 90, protein: 2, fat: 0, carb: 21, fiber: 3, source: 'fdc' },
  'brussels sprouts|cooked': { kcal: 40, protein: 3, fat: 0, carb: 8, fiber: 4, source: 'fdc' },
  'broccoli|cooked': { kcal: 35, protein: 2, fat: 0, carb: 7, fiber: 3, source: 'fdc' },
  'zucchini|cooked': { kcal: 20, protein: 1, fat: 0, carb: 4, fiber: 1, source: 'fdc' },
  'onion|cooked': { kcal: 40, protein: 1, fat: 0, carb: 10, fiber: 1, source: 'fdc' },
  'olive oil': { kcal: 900, protein: 0, fat: 100, carb: 0, fiber: 0, source: 'fdc' },
  'curry powder': { kcal: 300, protein: 12, fat: 14, carb: 50, fiber: 30, source: 'custom' },
  parsley: { kcal: 36, protein: 3, fat: 1, carb: 6, fiber: 3, source: 'fdc' },
  'roasted vegetables': { kcal: 999, protein: 99, fat: 99, carb: 99, fiber: 99, source: 'estimate' }, // must NOT be used for the composite
}
const lookup: NutrientLookup = (name, state) => TABLE[`${name}|${state}`] ?? TABLE[name] ?? null

describe('level2 — lunch truth through a fake lookup', () => {
  const r = level2(LUNCH_TRUTH, lookup)
  it('composite roasted vegetables is split equally across its five components, not looked up by its own name', () => {
    const veg = r.perItem.filter((i) => ['brussels sprouts', 'sweet potato', 'broccoli', 'zucchini', 'onion'].includes(i.name))
    // sweet potato appears twice: the core item (150 g) and the composite share (40 g)
    expect(veg.map((i) => i.grams).filter((g) => Math.abs(g - 40) < 1e-9).length).toBe(5)
    expect(r.perItem.find((i) => i.name === 'roasted vegetables')).toBeUndefined()
  })
  it('sums kcal / protein / fat / carb / fiber', () => {
    const expected: Nutrients = {
      kcal: 170 * 2 + 150 * 0.9 + 40 * (0.4 + 0.9 + 0.35 + 0.2 + 0.4) + 5 * 9 + 1 * 3 + 1 * 0.36,
      protein: 170 * 0.22 + 150 * 0.02 + 40 * (0.03 + 0.02 + 0.02 + 0.01 + 0.01) + 0 + 0.12 + 0.03,
      fat: 170 * 0.12 + 0 + 0 + 5 * 1 + 0.14 + 0.01,
      carb: 0 + 150 * 0.21 + 40 * (0.08 + 0.21 + 0.07 + 0.04 + 0.1) + 0 + 0.5 + 0.06,
      fiber: 0 + 150 * 0.03 + 40 * (0.04 + 0.03 + 0.03 + 0.01 + 0.01) + 0 + 0.3 + 0.03,
    }
    expect(r.kcal).toBeCloseTo(expected.kcal, 9)
    expect(r.protein).toBeCloseTo(expected.protein, 9)
    expect(r.fat).toBeCloseTo(expected.fat, 9)
    expect(r.carb).toBeCloseTo(expected.carb, 9)
    expect(r.fiber).toBeCloseTo(expected.fiber, 9)
  })
  it('ignore items (salt, pepper) are excluded and not reported as unresolved', () => {
    expect(r.unresolved).toEqual([])
    expect(r.skipped).toEqual([])
  })
  it('customShare = kcal from custom/estimate entries / total kcal (curry powder is custom)', () => {
    expect(r.customShare).toBeCloseTo(3 / r.kcal, 12)
  })
})

describe('level2 — rules', () => {
  it('drinks are excluded on both sides', () => {
    const r = level2([{ name: 'coffee', grams: 200, isDrink: true }, { name: 'olive oil', grams: 10 }], lookup)
    expect(r.kcal).toBeCloseTo(90, 9)
    expect(r.perItem.map((i) => i.name)).toEqual(['olive oil'])
  })
  it('unresolved names contribute nothing and are listed', () => {
    const r = level2([{ name: 'lentil', grams: 100 }, { name: 'olive oil', grams: 10 }], lookup)
    expect(r.unresolved).toEqual(['lentil'])
    expect(r.kcal).toBeCloseTo(90, 9)
  })
  it('items without grams are skipped and listed', () => {
    const r = level2([{ name: 'parsley' }], lookup)
    expect(r.skipped).toEqual(['parsley'])
    expect(r.kcal).toBe(0)
  })
  it('state-matched lookup: state is passed through', () => {
    const seen: Array<[string, string | undefined]> = []
    const spy: NutrientLookup = (n, s) => {
      seen.push([n, s])
      return TABLE['olive oil']
    }
    level2([{ name: 'oatmeal', grams: 175, state: 'cooked' }], spy)
    expect(seen).toEqual([['oatmeal', 'cooked']])
  })
  it('customShare is null when the lookup reports no sources', () => {
    const plain: NutrientLookup = () => ({ kcal: 100, protein: 1, fat: 1, carb: 1, fiber: 1 })
    expect(level2([{ name: 'x', grams: 50 }], plain).customShare).toBeNull()
  })
  it('a substitute is looked up under the predicted name (no pairing)', () => {
    const t = level2([{ name: 'salmon', grams: 170, state: 'cooked' }], lookup)
    const e = level2([{ name: 'trout', grams: 170, state: 'cooked' }], lookup)
    expect(t.kcal).toBeCloseTo(340, 9)
    expect(e.unresolved).toEqual(['trout'])
    expect(e.kcal).toBe(0)
  })
})

describe('nutrientErrors / summarizeNutrientErrors', () => {
  const truth: Nutrients = { kcal: 500, protein: 40, fat: 20, carb: 50, fiber: 0 }
  const est: Nutrients = { kcal: 600, protein: 30, fat: 20, carb: 40, fiber: 2 }
  it('per-meal errors: MAE, APE %, signed %, pctOfMean placeholder', () => {
    const e = nutrientErrors(truth, est)
    expect(e.kcal).toEqual({ mae: 100, ape: 20, signed: 20, pctOfMean: null })
    expect(e.protein).toEqual({ mae: 10, ape: 25, signed: -25, pctOfMean: null })
    expect(e.fat).toEqual({ mae: 0, ape: 0, signed: 0, pctOfMean: null })
    // truth 0 → APE undefined
    expect(e.fiber).toEqual({ mae: 2, ape: null, signed: null, pctOfMean: null })
  })
  it('study summary fills pctOfMean from the mean of truth and counts within ±20 / ±10', () => {
    const rows = [
      { truth, est },
      { truth: { ...truth, kcal: 300 }, est: { ...est, kcal: 315 } }, // +5 %
      { truth: { ...truth, kcal: 400 }, est: { ...est, kcal: 340 } }, // −15 %
    ]
    const s = summarizeNutrientErrors(rows)
    expect(s.kcal.n).toBe(3)
    expect(s.kcal.mae).toBeCloseTo((100 + 15 + 60) / 3, 9)
    expect(s.kcal.pctOfMean).toBeCloseTo(((100 + 15 + 60) / 3 / ((500 + 300 + 400) / 3)) * 100, 9)
    expect(s.kcal.mape).toBeCloseTo((20 + 5 + 15) / 3, 9)
    expect(s.kcal.medianApe).toBe(15)
    expect(s.kcal.signedBias).toBeCloseTo((20 + 5 - 15) / 3, 9)
    expect(s.kcal.within20).toBe(3)
    expect(s.kcal.within10).toBe(1)
    expect(s.fiber.mape).toBeNull()
  })
})

describe('weighted composite split', () => {
  it('splits a composite by componentWeights instead of equally', async () => {
    const { level2: mealNutrients } = await import('./level2')
    const lookup = (name: string) => (name === 'a' ? { kcal: 100, protein_g: 0, fat_g: 0, carb_g: 0, fiber_g: 0 } : { kcal: 0, protein_g: 0, fat_g: 0, carb_g: 0, fiber_g: 0 })
    const r = mealNutrients([{ name: 'bowl', grams: 400, components: ['a', 'b'], componentWeights: [1, 3] }], lookup as never)
    expect(r.kcal).toBeCloseTo(100) // 100 g of "a" at 100 kcal/100 g
  })
})
