import { describe, it, expect } from 'vitest'
import { UNIT_GRAMS, estimateGrams, normalizeUnit, OATS_COOKED_PER_DRY, UNSTATED_COOKING_FAT_G } from './units'

describe('household-unit table — TAG-GUIDE numbers', () => {
  it('carries the published figures', () => {
    expect(UNIT_GRAMS.bread.slice).toBe(28)
    expect(UNIT_GRAMS['almond butter'].tbsp).toBe(16)
    expect(UNIT_GRAMS.honey.tbsp).toBe(21)
    expect(UNIT_GRAMS.egg.medium).toBe(44)
    expect(UNIT_GRAMS.avocado.medium).toBe(136)
    expect(Math.round(UNIT_GRAMS.oats.cup! / 3)).toBe(27)
  })
  it('converts quantity × unit for a known food', () => {
    expect(estimateGrams('wheat bread', 2.5, 'slice')?.grams).toBe(70)
    expect(estimateGrams('avocado', 0.5, 'medium')?.grams).toBe(68)
    expect(estimateGrams('almond butter', 1, 'tbsp')?.grams).toBe(16)
    expect(estimateGrams('egg', 1, 'medium')?.grams).toBe(44)
    expect(estimateGrams('honey', 1, 'tbsp')?.grams).toBe(21)
  })
  it('1/3 cup dry oats = 27 g → 175 g cooked', () => {
    const dry = estimateGrams('oats', 0.333, 'cup')!.grams
    expect(dry).toBe(27)
    expect(Math.round(dry * OATS_COOKED_PER_DRY)).toBe(175)
  })
  it('volume units fall back to food-independent defaults; unknown units return null', () => {
    expect(estimateGrams('mystery paste', 2, 'tbsp')?.grams).toBe(30)
    expect(estimateGrams('mystery', 1, 'slice')).toBeNull()
    expect(estimateGrams('egg', 0, 'medium')).toBeNull()
  })
  it('normalizes unit spellings', () => {
    expect(normalizeUnit('tablespoons')).toBe('tbsp')
    expect(normalizeUnit('Slices')).toBe('slice')
    expect(normalizeUnit('med')).toBe('medium')
    expect(normalizeUnit('bowlful')).toBeNull()
  })
  it('unstated cooking fat is a small pour', () => {
    expect(UNSTATED_COOKING_FAT_G).toBeLessThan(14)
  })
})
