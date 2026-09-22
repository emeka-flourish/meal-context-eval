import { describe, it, expect } from 'vitest'
import { aggregate, bootstrapCI, makeRng, pairedGain, quantile } from './aggregate'

describe('makeRng', () => {
  it('is deterministic for a seed and in [0, 1)', () => {
    const a = makeRng(42)
    const b = makeRng(42)
    const xs = Array.from({ length: 1000 }, () => a())
    const ys = Array.from({ length: 1000 }, () => b())
    expect(xs).toEqual(ys)
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true)
    expect(new Set(xs).size).toBeGreaterThan(990)
  })
  it('differs by seed', () => {
    expect(makeRng(1)()).not.toBe(makeRng(2)())
  })
})

describe('quantile', () => {
  it('interpolates', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(quantile([1, 2, 3, 4], 0)).toBe(1)
    expect(quantile([1, 2, 3, 4], 1)).toBe(4)
    expect(quantile([5], 0.3)).toBe(5)
  })
})

describe('aggregate — mean + 95 % bootstrap CI over meals', () => {
  const rows = [0.8, 0.9, 0.7, 0.95, 0.85, 0.6, 0.75, 0.9]
  it('point estimate is the plain mean; CI brackets it; same seed → same CI', () => {
    const a = aggregate(rows, { bootstrap: 2000, seed: 7 })
    const b = aggregate(rows, { bootstrap: 2000, seed: 7 })
    expect(a.n).toBe(8)
    expect(a.mean).toBeCloseTo(rows.reduce((s, x) => s + x, 0) / 8, 12)
    expect(a.ci![0]).toBeLessThan(a.mean!)
    expect(a.ci![1]).toBeGreaterThan(a.mean!)
    expect(a.ci![0]).toBeGreaterThanOrEqual(0.6)
    expect(a.ci![1]).toBeLessThanOrEqual(0.95)
    expect(a).toEqual(b)
  })
  it('different seed → (almost surely) different CI, same mean', () => {
    const a = aggregate(rows, { seed: 1 })
    const b = aggregate(rows, { seed: 2 })
    expect(a.mean).toBe(b.mean)
    expect(a.ci).not.toEqual(b.ci)
  })
  it('nulls (excluded scenes) are dropped', () => {
    const a = aggregate([1, null, 0, undefined, 1], { seed: 3 })
    expect(a.n).toBe(3)
    expect(a.mean).toBeCloseTo(2 / 3, 12)
  })
  it('n = 0 and n = 1 are well-defined', () => {
    expect(aggregate([])).toEqual({ n: 0, mean: null, ci: null, se: null })
    expect(aggregate([0.5])).toEqual({ n: 1, mean: 0.5, ci: [0.5, 0.5], se: 0 })
  })
  it('constant rows → zero-width CI', () => {
    const a = aggregate([1, 1, 1, 1], { seed: 9 })
    expect(a.ci).toEqual([1, 1])
    expect(a.se).toBe(0)
  })
  it('agreement rates: 0/1 rows work the same way', () => {
    const a = aggregate([1, 1, 0, 1, 1, 0, 1, 1, 1, 1], { seed: 11 })
    expect(a.mean).toBeCloseTo(0.8, 12)
    expect(a.ci![0]).toBeLessThan(0.8)
  })
  it('bootstrapCI accepts another statistic (median)', () => {
    const med = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b)
      return s[Math.floor(s.length / 2)]
    }
    const a = bootstrapCI([1, 2, 3, 100], { seed: 5 }, med)
    expect(a.mean).toBe(3)
  })
  it('CI covers the true mean for a known distribution (sanity, seeded)', () => {
    const rng = makeRng(99)
    const sample = Array.from({ length: 60 }, () => rng()) // uniform, mean 0.5
    const a = aggregate(sample, { seed: 100 })
    expect(a.ci![0]).toBeLessThan(0.5)
    expect(a.ci![1]).toBeGreaterThan(0.5)
  })
})

describe('pairedGain — within-meal difference B − A', () => {
  it('pairs by index, drops pairs with a missing side, sign = B higher', () => {
    const imageOnly = [0.8, 0.7, null, 0.9, 0.6]
    const withContext = [0.9, 0.8, 0.95, null, 0.7]
    const g = pairedGain(imageOnly, withContext, { seed: 1 })
    expect(g.diffs.map((d) => +d.toFixed(12))).toEqual([0.1, 0.1, 0.1])
    expect(g.n).toBe(3)
    expect(g.mean).toBeCloseTo(0.1, 12)
    expect(g.ci).toEqual([expect.closeTo(0.1, 12), expect.closeTo(0.1, 12)])
  })
  it('a real gain has a CI excluding zero; no gain straddles zero', () => {
    const a = [0.5, 0.6, 0.55, 0.65, 0.5, 0.6, 0.58, 0.62]
    const gain = pairedGain(
      a,
      a.map((x) => x + 0.1),
      { seed: 2 },
    )
    expect(gain.ci![0]).toBeGreaterThan(0)
    const noise = pairedGain(a, [0.55, 0.55, 0.6, 0.6, 0.45, 0.65, 0.55, 0.65], { seed: 2 })
    expect(noise.ci![0]).toBeLessThan(0)
    expect(noise.ci![1]).toBeGreaterThan(0)
  })
  it('refuses unequal lengths', () => {
    expect(() => pairedGain([1, 2], [1])).toThrow(/length mismatch/)
  })
})
