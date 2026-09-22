import { describe, it, expect, vi } from 'vitest'
import {
  decideFodmapLight,
  decideHighFat,
  decideLargeKcal,
  decideLargeMass,
  decideNauseaIrritant,
  decideProteinAdequate,
  level3,
  type Classifier,
  type DecisionItem,
} from './level3'
import type { Nutrients } from './types'

const N = (over: Partial<Nutrients>): Nutrients => ({ kcal: 500, protein: 20, fat: 10, carb: 60, fiber: 5, ...over })

/* Deterministic classifier double: keyword rules over the item list. */
const fakeClassify: Classifier = (items) => {
  const names = items.map((i) => i.name.toLowerCase())
  const has = (k: string) => names.some((n) => n.includes(k))
  const light = has('garlic') && has('onion') ? 'red' : has('onion') || has('garlic') || has('wheat') ? 'amber' : 'green'
  const fried = items.some((i) => i.name.toLowerCase().includes('fried') && (i.grams ?? 0) >= 30)
  return { light, reason: `rule:${light}`, fried, spicy: has('chili') }
}

describe('D-FAT high-fat: share ≥ 40 % AND fat ≥ 15 g', () => {
  it('both sides over → agree, positive margins', () => {
    const d = decideHighFat(N({ kcal: 500, fat: 30 }), N({ kcal: 500, fat: 25 })) // 54 %, 45 %
    expect(d).toMatchObject({ truth: true, est: true, agree: true, direction: 'agree' })
    expect(d.marginTruth).toBeGreaterThan(0)
    expect(d.marginEst).toBeGreaterThan(0)
  })
  it('truth over, est under → miss with negative est margin', () => {
    const d = decideHighFat(N({ kcal: 500, fat: 25 }), N({ kcal: 500, fat: 15 })) // 45 % vs 27 %
    expect(d).toMatchObject({ truth: true, est: false, direction: 'miss', agree: false })
    expect(d.marginEst).toBeLessThan(0)
    expect(d.marginTruth).toBeGreaterThan(0)
  })
  it('truth under, est over → false alarm', () => {
    const d = decideHighFat(N({ kcal: 500, fat: 15 }), N({ kcal: 500, fat: 25 }))
    expect(d.direction).toBe('false_alarm')
  })
  it('the 15 g floor: 90 kcal handful of nuts at 80 % fat share is NOT high-fat; margin is the binding one', () => {
    const d = decideHighFat(N({ kcal: 90, fat: 8 }), N({ kcal: 90, fat: 8 }))
    expect(d.truth).toBe(false)
    expect(d.marginTruth).toBeCloseTo((8 - 15) / 15, 12)
  })
  it('exactly on the line counts as over (≥)', () => {
    const d = decideHighFat(N({ kcal: 337.5, fat: 15 }), N({ kcal: 337.5, fat: 15 })) // 15·9/337.5 = 0.40
    expect(d.truth).toBe(true)
    expect(d.marginTruth).toBeCloseTo(0, 12)
  })
  it('zero kcal does not divide by zero', () => {
    const d = decideHighFat(N({ kcal: 0, fat: 0 }), N({ kcal: 0, fat: 0 }))
    expect(d.truth).toBe(false)
    expect(Number.isFinite(d.marginTruth!)).toBe(true)
  })
})

describe('D-LARGE kcal ≥ 750', () => {
  it('margins are (value − 750)/750 with the decision sign', () => {
    const d = decideLargeKcal(N({ kcal: 900 }), N({ kcal: 600 }))
    expect(d).toMatchObject({ truth: true, est: false, direction: 'miss' })
    expect(d.marginTruth).toBeCloseTo(0.2, 12)
    expect(d.marginEst).toBeCloseTo(-0.2, 12)
  })
  it('749 vs 750 flips', () => {
    const d = decideLargeKcal(N({ kcal: 749 }), N({ kcal: 750 }))
    expect(d).toMatchObject({ truth: false, est: true, direction: 'false_alarm' })
  })
})

describe('L1 protein adequate: ≥ 25 g main, ≥ 10 g snack', () => {
  it('main meal threshold 25', () => {
    const d = decideProteinAdequate(N({ protein: 30 }), N({ protein: 20 }), 'dinner')
    expect(d).toMatchObject({ truth: true, est: false, direction: 'miss' })
    expect(d.marginTruth).toBeCloseTo(0.2, 12)
    expect(d.marginEst).toBeCloseTo(-0.2, 12)
  })
  it('snack threshold 10', () => {
    const d = decideProteinAdequate(N({ protein: 12 }), N({ protein: 9 }), 'snack')
    expect(d).toMatchObject({ truth: true, est: false })
    expect(d.marginTruth).toBeCloseTo(0.2, 12)
    expect(d.explanation).toContain('target 10 g')
  })
  it('defaults to a main meal', () => {
    expect(decideProteinAdequate(N({ protein: 12 }), N({ protein: 12 })).truth).toBe(false)
  })
})

describe('L3 large meal by mass ≥ 500 g (grams only, no lookup)', () => {
  const t: DecisionItem[] = [
    { name: 'rice', grams: 300 },
    { name: 'stew', grams: 250 },
    { name: 'water', grams: 300, isDrink: true },
    { name: 'salt', grams: 2, tag: 'ignore' },
    { name: 'parsley' },
  ]
  it('drinks and ignore items are removed; gram-less items add nothing', () => {
    const d = decideLargeMass(t, [{ name: 'rice', grams: 250 }, { name: 'stew', grams: 200 }])
    expect(d).toMatchObject({ truth: true, est: false, direction: 'miss' })
    expect(d.marginTruth).toBeCloseTo(0.1, 12)
    expect(d.marginEst).toBeCloseTo(-0.1, 12)
  })
  it('false alarm when the estimate over-shoots', () => {
    const d = decideLargeMass([{ name: 'rice', grams: 400 }], [{ name: 'rice', grams: 520 }])
    expect(d.direction).toBe('false_alarm')
  })
})

describe('I1 FODMAP light via injected classifier', () => {
  it('same light → agree', () => {
    const d = decideFodmapLight([{ name: 'rice', grams: 200 }], [{ name: 'rice', grams: 180 }], fakeClassify)
    expect(d).toMatchObject({ truth: 'green', est: 'green', agree: true, direction: 'agree' })
    expect(d.reasonTruth).toBe('rule:green')
  })
  it('one step apart → within_one', () => {
    const d = decideFodmapLight([{ name: 'rice' }], [{ name: 'rice' }, { name: 'onion', grams: 40 }], fakeClassify)
    expect(d).toMatchObject({ truth: 'green', est: 'amber', agree: false, direction: 'within_one' })
  })
  it('two steps apart → differs', () => {
    const d = decideFodmapLight([{ name: 'rice' }], [{ name: 'onion' }, { name: 'garlic' }], fakeClassify)
    expect(d).toMatchObject({ truth: 'green', est: 'red', direction: 'differs' })
  })
  it('drinks are removed before the classifier sees the list', () => {
    const seen: DecisionItem[][] = []
    const spy: Classifier = (items) => {
      seen.push(items)
      return fakeClassify(items)
    }
    decideFodmapLight([{ name: 'rice' }, { name: 'onion juice', isDrink: true }], [{ name: 'rice' }], spy)
    expect(seen[0].map((i) => i.name)).toEqual(['rice'])
  })
})

describe('L4 nausea irritant: fried item ≥ 30 g or spicy item', () => {
  it('fried 30 g present in truth, missing in est → miss', () => {
    const d = decideNauseaIrritant([{ name: 'fried plantain', grams: 30 }], [{ name: 'plantain', grams: 30 }], fakeClassify)
    expect(d).toMatchObject({ truth: true, est: false, direction: 'miss' })
    expect(d.explanation).toContain('truth fried')
  })
  it('fried under 30 g does not fire (classifier double applies the floor)', () => {
    const d = decideNauseaIrritant([{ name: 'fried onion', grams: 20 }], [{ name: 'fried onion', grams: 20 }], fakeClassify)
    expect(d.truth).toBe(false)
  })
  it('spicy on the estimate only → false alarm', () => {
    const d = decideNauseaIrritant([{ name: 'rice' }], [{ name: 'rice' }, { name: 'chili flakes', grams: 1 }], fakeClassify)
    expect(d).toMatchObject({ truth: false, est: true, direction: 'false_alarm' })
  })
})

describe('level3 — six decisions per meal', () => {
  const truthItems: DecisionItem[] = [
    { name: 'fried chicken', grams: 220 },
    { name: 'rice', grams: 300 },
    { name: 'onion', grams: 40 },
    { name: 'cola', grams: 330, isDrink: true },
  ]
  const estItems: DecisionItem[] = [
    { name: 'chicken', grams: 180 },
    { name: 'rice', grams: 250 },
  ]
  const truthN = N({ kcal: 900, fat: 45, protein: 50 }) // fat share 45 %
  const estN = N({ kcal: 700, fat: 25, protein: 40 }) // fat share 32 %

  it('computes every decision with direction and margins', () => {
    const r = level3(truthItems, truthN, estItems, estN, fakeClassify, { mealSlot: 'dinner' })
    expect(r.fodmapLight).toMatchObject({ truth: 'amber', est: 'green', direction: 'within_one' })
    expect(r.highFat).toMatchObject({ truth: true, est: false, direction: 'miss' })
    expect(r.largeKcal).toMatchObject({ truth: true, est: false, direction: 'miss' })
    expect(r.proteinAdequate).toMatchObject({ truth: true, est: true, direction: 'agree' })
    expect(r.largeMass).toMatchObject({ truth: true, est: false, direction: 'miss' }) // 560 (cola removed) vs 430
    expect(r.largeMass.marginTruth).toBeCloseTo(0.12, 12)
    expect(r.nauseaIrritant).toMatchObject({ truth: true, est: false, direction: 'miss' })
    expect(r.agreementRate).toBeCloseTo(1 / 6, 12)
  })
  it('calls the classifier once per side (memoised across the two classifier decisions)', () => {
    const spy = vi.fn(fakeClassify)
    level3(truthItems, truthN, estItems, estN, spy)
    expect(spy).toHaveBeenCalledTimes(2)
  })
  it('identical sides agree on everything', () => {
    const r = level3(truthItems, truthN, truthItems, truthN, fakeClassify)
    expect(r.agreementRate).toBe(1)
  })
})
