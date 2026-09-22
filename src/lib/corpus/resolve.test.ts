import { describe, it, expect, vi } from 'vitest'

vi.mock('../db', () => ({ db: {} }))

import { canonicalOf, findCandidates, groupByName, mockConfirm, resolveDishes, type ResolveInstance } from './resolve'
import { dishTokens, normalizeDishName, overlapCoefficient, jaccard, median } from './normalize'

const inst = (id: string, name: string, ingredients: string[]): ResolveInstance => ({ id, name, ingredientNames: ingredients })

const CORPUS: ResolveInstance[] = [
  inst('1', 'Lentil Soup with Goat Meat', ['Lentil', 'Goat meat', 'Palm oil', 'Spinach']),
  inst('2', 'Lentil Soup with Goat Meat', ['Lentil', 'Goat meat', 'Palm oil']),
  inst('3', 'Lentil Soup with Goat Meat (Half Portion)', ['Lentil', 'Goat meat', 'Palm oil']),
  inst('4', 'Fresh Mango', ['Mango']),
  inst('5', 'Sliced Mango', ['Mango']),
  inst('6', 'Mango Slices', ['Mango']),
  inst('7', 'Oatmeal', ['Oats', 'Water', 'Honey']),
  inst('8', 'Oatmeal', ['Oats', 'Water']),
  inst('9', 'Fried Rice', ['Rice', 'Egg', 'Vegetable oil', 'Mixed vegetables']),
  inst('10', 'Rice', ['Rice']),
  inst('11', 'Lentil Soup with Chicken', ['Lentil', 'Chicken', 'Palm oil', 'Crayfish']),
  inst('12', 'Chicken Salad', ['Chicken', 'Lettuce', 'Tomato']),
  inst('13', 'Chicken Wrap', ['Chicken', 'Lettuce', 'Tomato', 'Tortilla']),
]

describe('normalize', () => {
  it('normalizeDishName strips parentheticals and punctuation', () => {
    expect(normalizeDishName('Lentil Soup (Half Portion)')).toBe('lentil soup')
    expect(normalizeDishName('  Scrambled Egg, with Onions ')).toBe('scrambled egg with onions')
  })
  it('dishTokens drops stopwords and stems plurals', () => {
    expect([...dishTokens('Scrambled Egg with Spinach and Onions')]).toEqual(['scrambled', 'egg', 'spinach', 'onion'])
    expect([...dishTokens('Mango Slices')]).toEqual(['mango', 'slice'])
    expect([...dishTokens('Mixed Berries and Banana')]).toEqual(['mixed', 'berry', 'banana'])
  })
  it('set similarity', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3)
    expect(overlapCoefficient(new Set(['a', 'b']), new Set(['b', 'c', 'd']))).toBeCloseTo(0.5)
    expect(overlapCoefficient(new Set(), new Set(['a']))).toBe(0)
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
    expect(median([])).toBeNull()
  })
})

describe('groupByName + candidates', () => {
  const groups = groupByName(CORPUS)
  it('groups by normalized name and computes typical ingredients (≥ 50%)', () => {
    const lentil = groups.find((g) => g.key === 'lentil soup with goat meat')!
    expect(lentil.instanceIds).toEqual(['1', '2', '3'])
    expect([...lentil.typicalIngredients].sort()).toEqual(['goat meat', 'lentil', 'palm oil']) // spinach 1/3 < 50%
    expect([...lentil.names.keys()]).toEqual(['Lentil Soup with Goat Meat', 'Lentil Soup with Goat Meat (Half Portion)'])
  })
  it('candidates: ≥ 2 shared tokens OR ingredient Jaccard ≥ 0.6; Rice never merges into Fried Rice', () => {
    const cands = findCandidates(groups)
    const pairs = cands.map((c) => [c.a.key, c.b.key, c.reason].join('|'))
    expect(pairs).toContain('lentil soup with goat meat|lentil soup with chicken|tokens')
    expect(pairs).toContain('chicken salad|chicken wrap|ingredients')
    expect(pairs).toContain('fresh mango|sliced mango|ingredients')
    expect(pairs).toContain('fresh mango|mango slices|ingredients')
    expect(pairs.some((p) => p.startsWith('fried rice|rice') || p.startsWith('rice|fried rice'))).toBe(false)
    expect(pairs.some((p) => p.includes('oatmeal'))).toBe(false)
  })
})

describe('resolveDishes', () => {
  it('mock mode: containment or shared-token+ingredients merge; different mains stay apart', async () => {
    const r = await resolveDishes(CORPUS)
    const by = Object.fromEntries(r.clusters.map((c) => [c.canonicalName, c]))
    expect(r.groups).toBe(10)
    expect(r.accepted).toBeLessThan(r.candidates.length) // Lentil goat vs chicken (2 shared tokens, ingredients 0.4) is a candidate the mock rejects
    expect(by['Lentil Soup with Chicken'].instanceIds).toEqual(['11'])
    expect(by['Chicken Wrap'].instanceIds.sort()).toEqual(['12', '13']) // shares 'chicken' + ingredient Jaccard 0.75 → mock merge; tie → shortest name
    expect(by['Lentil Soup with Goat Meat'].instanceIds.sort()).toEqual(['1', '2', '3'])
    expect(by['Lentil Soup with Goat Meat'].aliases).toEqual(['Lentil Soup with Goat Meat (Half Portion)'])
    expect(by['Fresh Mango'].instanceIds.sort()).toEqual(['4', '5', '6'])
    expect(by['Fresh Mango'].aliases.sort()).toEqual(['Mango Slices', 'Sliced Mango'])
    expect(by['Oatmeal'].instanceIds).toEqual(['7', '8'])
    expect(by['Rice'].instanceIds).toEqual(['10'])
    expect(by['Fried Rice'].instanceIds).toEqual(['9'])
    expect(r.clusters.length).toBe(7)
    // sorted by instance count desc
    expect(r.clusters[0].instanceIds.length).toBeGreaterThanOrEqual(r.clusters[1].instanceIds.length)
  })
  it('no transitive chaining: a member is confirmed against the cluster head, never via another member', async () => {
    // A ⊂ B by tokens and A ⊂ C by tokens, but B vs C are different dishes: B and C must not end up together.
    const r = await resolveDishes([
      inst('b1', 'Lentil Soup with Goat Meat', ['Lentil', 'Goat meat', 'Palm oil']),
      inst('b2', 'Lentil Soup with Goat Meat', ['Lentil', 'Goat meat', 'Palm oil']),
      inst('c1', 'Lentil Soup with Chicken', ['Lentil', 'Chicken', 'Crayfish', 'Stockfish']),
      inst('a1', 'Lentil Soup', ['Lentil']),
    ])
    const names = r.clusters.map((c) => c.canonicalName).sort()
    expect(names).toEqual(['Lentil Soup with Chicken', 'Lentil Soup with Goat Meat'])
    expect(r.clusters.find((c) => c.canonicalName === 'Lentil Soup with Goat Meat')!.instanceIds.sort()).toEqual(['a1', 'b1', 'b2'])
  })
  it('generic shared words (soup, fried, mixed…) do not license an ingredient merge in mock mode', () => {
    const [lentil, edik] = groupByName([inst('a', 'Lentil Soup', ['Palm oil', 'Crayfish', 'Spinach']), inst('b', 'Minestrone Soup', ['Palm oil', 'Crayfish', 'Spinach'])])
    expect(mockConfirm(lentil, edik)).toBe(false)
  })
  it('a rejecting confirm keeps groups apart', async () => {
    const r = await resolveDishes(CORPUS, { confirm: async (a, b) => !(a.key.includes('mango') && b.key.includes('mango')) })
    const names = r.clusters.map((c) => c.canonicalName).sort()
    expect(names).toContain('Sliced Mango')
    expect(names).toContain('Mango Slices')
    expect(names).toContain('Fresh Mango')
    expect(r.clusters.find((c) => c.canonicalName === 'Lentil Soup with Goat Meat')!.instanceIds.length).toBe(4) // an accepting confirm also merges the chicken variant (2 shared tokens)
  })
  it('mockConfirm: containment needs ≥ 2 tokens on the smaller side', () => {
    const [rice, fried] = groupByName([inst('a', 'Rice', ['Rice']), inst('b', 'Fried Rice', ['Rice', 'Egg', 'Oil'])])
    expect(mockConfirm(rice, fried)).toBe(false)
    const [half, full] = groupByName([inst('a', 'Lentil Soup', ['Lentil']), inst('b', 'Lentil Soup with Goat Meat', ['Lentil', 'Goat meat'])])
    expect(mockConfirm(half, full)).toBe(true)
    const [fresh, slices] = groupByName([inst('a', 'Fresh Mango', ['Mango']), inst('b', 'Mango Slices', ['Mango'])])
    expect(mockConfirm(fresh, slices)).toBe(true)
  })
  it('canonicalOf: most frequent wins, ties → shortest', () => {
    expect(canonicalOf(new Map([['Banana', 3], ['Ripe Banana', 3], ['Fresh Banana', 1]]))).toEqual({ canonicalName: 'Banana', aliases: ['Ripe Banana', 'Fresh Banana'] })
  })
})
