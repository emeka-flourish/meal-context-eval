import { describe, it, expect } from 'vitest'
import { grade, level1, median, msaSspb } from './level1'
import { CASES, LUNCH_TRUTH, scoreCase } from './cases'
import type { MatchTable, PredItem, TruthItem } from './types'

const byN = (n: number) => CASES.find((c) => c.n === n)!

describe('grade = min/max', () => {
  it('doubling and halving grade equal (0.5)', () => {
    expect(grade(200, 100)).toBeCloseTo(0.5, 12)
    expect(grade(50, 100)).toBeCloseTo(0.5, 12)
    expect(grade(200, 100)).toBe(grade(50, 100))
  })
  it('exact = 1, zero either side = 0', () => {
    expect(grade(100, 100)).toBe(1)
    expect(grade(0, 100)).toBe(0)
    expect(grade(100, 0)).toBe(0)
  })
})

describe('median / MSA / SSPB', () => {
  it('median handles odd and even', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBeNull()
  })
  it('MSA and SSPB from ratios (Morley 2018)', () => {
    // all estimates 20 % high → MSA 20, SSPB +20
    const { msa, sspb } = msaSspb([1.2, 1.2, 1.2])
    expect(msa).toBeCloseTo(20, 9)
    expect(sspb).toBeCloseTo(20, 9)
    // symmetric: 2× and ½× have the same |ln r|
    const s = msaSspb([2, 0.5])
    expect(s.msa).toBeCloseTo(100, 9)
    expect(s.sspb).toBeCloseTo(0, 9)
    // all low → negative SSPB
    expect(msaSspb([0.8]).sspb).toBeCloseTo(-25, 9)
    expect(msaSspb([]).msa).toBeNull()
  })
})

describe('level1 — lunch, image only (case 1) exact values', () => {
  const r = scoreCase(byN(1))
  it('Σw = 2.75 (salt/pepper ignore dropped)', () => {
    expect(r.sums.sumW).toBeCloseTo(2.75, 12)
  })
  it('Recognized = 2.60 / 2.75', () => {
    expect(r.sums.sumWId).toBeCloseTo(2.6, 12)
    expect(r.recognized).toBeCloseTo(2.6 / 2.75, 12)
  })
  it('Invented = 0.1 / 2.75 (lemon, garnish)', () => {
    expect(r.sums.sumInventedW).toBeCloseTo(0.1, 12)
    expect(r.invented).toBeCloseTo(0.1 / 2.75, 12)
    expect(r.inventedItems).toEqual([expect.objectContaining({ predId: 'p-lemon', tag: 'garnish', p: 0.5, grams: 8 })])
  })
  it('Net = (2.60 − 0.05) / 2.75 (garnish penalty halved)', () => {
    expect(r.sums.sumPenalisedInventedW).toBeCloseTo(0.05, 12)
    expect(r.net).toBeCloseTo((2.6 - 0.05) / 2.75, 12)
    // sensitivity line: p = 1 everywhere
    expect(r.netP1).toBeCloseTo((2.6 - 0.1) / 2.75, 12)
  })
  it('Quantity = Σg·grade / (527 + 8)', () => {
    expect(r.sums.sumG).toBe(527)
    expect(r.sums.sumInventedE).toBe(8)
    const gg = 170 * (170 / 210) + 150 * (150 / 190) + 200 * (200 / 250) + 5 * 0.5
    expect(r.sums.sumGGrade).toBeCloseTo(gg, 9)
    expect(r.quantity).toBeCloseTo(gg / 535, 9)
    // per-item arithmetic from the doc
    const g = Object.fromEntries(r.perItem.map((i) => [i.id, i]))
    expect(g['t-salmon'].grade).toBeCloseTo(170 / 210, 12)
    expect(g['t-sp'].grade).toBeCloseTo(150 / 190, 12)
    expect(g['t-veg'].grade).toBeCloseTo(200 / 250, 12)
    expect(g['t-oil'].grade).toBeCloseTo(0.5, 12)
    expect(g['t-curry'].grade).toBe(0)
    expect(g['t-parsley'].grade).toBe(0)
    expect(g['t-curry'].status).toBe('missed')
  })
  it('many-to-one: four vegetable predictions are summed (250) against one truth item', () => {
    const veg = r.perItem.find((i) => i.id === 't-veg')!
    expect(veg.estimate).toBe(250)
    expect(veg.identity).toBe(1)
  })
  it('F1: exact rows are TP, many-to-one counted once, lemon FP, curry+parsley FN', () => {
    expect(r.f1).toMatchObject({ tp: 4, fp: 1, fn: 2 })
    expect(r.f1.precision).toBeCloseTo(0.8, 12)
    expect(r.f1.recall).toBeCloseTo(4 / 6, 12)
  })
  it('mass error over matched weighed units only (salmon, sweet potato, veg group)', () => {
    expect(r.massError.n).toBe(3)
    expect(r.massError.mae).toBeCloseTo((40 + 40 + 50) / 3, 9)
    expect(r.massError.mape).toBeCloseTo(((40 / 170 + 40 / 150 + 50 / 200) / 3) * 100, 9)
    // weighed 3 of 6 gram-bearing items (oil, curry, parsley are estimated)
    expect(r.massError.coverage).toBeCloseTo(0.5, 12)
    // all three over-estimated → positive SSPB, MSA = median |ln r|
    const ratios = [210 / 170, 190 / 150, 250 / 200].sort((a, b) => a - b)
    expect(r.msa).toBeCloseTo(100 * (ratios[1] - 1), 9)
    expect(r.sspb).toBeCloseTo(100 * (ratios[1] - 1), 9)
  })
  it('ignore-tagged truth never appears in perItem', () => {
    expect(r.perItem.map((i) => i.id)).not.toContain('t-salt')
  })
})

describe('level1 — the rules the cases exercise', () => {
  it('case 3 < case 1 on Net and Quantity, although F1 ranks case 3 above', () => {
    const c1 = scoreCase(byN(1))
    const c3 = scoreCase(byN(3))
    expect(c3.net).toBeLessThan(c1.net)
    expect(c3.quantity).toBeLessThan(c1.quantity)
    expect(c3.f1.f1).toBeGreaterThan(c1.f1.f1)
    expect(c3.recognized).toBeCloseTo(1.75 / 2.75, 12)
  })
  it('case 5 (wrong, confident) < case 3 (missed): same Recognized, Net and Quantity lower', () => {
    const c3 = scoreCase(byN(3))
    const c5 = scoreCase(byN(5))
    expect(c5.recognized).toBeCloseTo(c3.recognized, 12)
    expect(c5.net).toBeLessThan(c3.net)
    expect(c5.quantity).toBeLessThan(c3.quantity)
  })
  it('wrong pairing: pred grams go into the Quantity denominator, tag comes from the paired truth item', () => {
    const c5 = scoreCase(byN(5))
    expect(c5.sums.sumInventedE).toBe(200)
    expect(c5.inventedItems).toEqual([
      expect.objectContaining({ predId: 'p-chicken', tag: 'core', w: 1, p: 1, origin: 'wrong_pairing' }),
    ])
    expect(c5.invented).toBeCloseTo(1 / 2.75, 12)
    expect(c5.net).toBeCloseTo((1.75 - 1) / 2.75, 12)
    expect(c5.perItem.find((i) => i.id === 't-salmon')).toMatchObject({ status: 'wrong', identity: 0, grade: 0 })
    // F1: chicken is FP, salmon FN
    expect(c5.f1).toMatchObject({ tp: 5, fp: 1, fn: 1 })
  })
  it('substitute costs Recognized, not Quantity (case 4 vs case 2)', () => {
    const c2 = scoreCase(byN(2))
    const c4 = scoreCase(byN(4))
    expect(c4.recognized).toBeCloseTo(2.25 / 2.75, 12)
    expect(c2.recognized).toBeCloseTo(1, 12)
    expect(c4.quantity).toBeCloseTo(c2.quantity, 12)
    // F1 sibling: substitute = FP + FN
    expect(c4.f1).toMatchObject({ tp: 5, fp: 1, fn: 1 })
    // sensitivity line drops the substitute row from both sums
    expect(c4.quantityNoSubstitutes).toBeCloseTo((c4.sums.sumGGrade - 170 * (170 / 175)) / (527 - 170), 9)
    expect(c2.quantityNoSubstitutes).toBeCloseTo(c2.quantity, 12)
  })
  it('padded log costs little: four phantom small items', () => {
    const c2 = scoreCase(byN(2))
    const c6 = scoreCase(byN(6))
    expect(c6.recognized).toBeCloseTo(1, 12)
    expect(c6.sums.sumInventedW).toBeCloseTo(0.3, 12)
    expect(c6.net).toBeCloseTo((2.75 - 0.15) / 2.75, 12)
    expect(c2.net - c6.net).toBeLessThan(0.06)
    expect(c6.quantity).toBeCloseTo(c2.sums.sumGGrade / (527 + 19), 9)
    expect(c2.quantity - c6.quantity).toBeLessThan(0.04)
    // ignore-tagged invented (salt/pepper) are dropped on the prediction side too
    expect(c6.inventedItems.map((i) => i.predId)).not.toContain('p-salt')
    expect(c6.sums.sumInventedE).toBe(19)
  })
  it('case 7: mass weighting hides the honey miss; Recognized flags it', () => {
    const c7 = scoreCase(byN(7))
    expect(c7.recognized).toBeCloseTo(0.75, 12)
    expect(c7.quantity).toBeCloseTo((220 + 60 * 0.75) / 295, 9)
  })
  it('case 8 ≈ case 2', () => {
    const c2 = scoreCase(byN(2))
    const c8 = scoreCase(byN(8))
    expect(c8.recognized).toBeCloseTo(2.65 / 2.75, 12)
    expect(c8.quantity).toBeCloseTo((165 + 150 * (150 / 155) + 190 + 3 + 1) / 527, 9)
    expect(Math.abs(c8.net - c2.net)).toBeLessThan(0.05)
    expect(Math.abs(c8.quantity - c2.quantity)).toBeLessThan(0.02)
  })
  it('case 2 gain over case 1 is mostly Quantity', () => {
    const c1 = scoreCase(byN(1))
    const c2 = scoreCase(byN(2))
    expect(c2.quantity - c1.quantity).toBeGreaterThan(c2.net - c1.net)
  })
})

describe('level1 — edge rules', () => {
  const truth: TruthItem[] = [
    { id: 'a', dish: 'd', name: 'rice', grams: 200, basis: 'weighed', tag: 'core' },
    { id: 'b', dish: 'd', name: 'stew', grams: 100, basis: 'estimated', tag: 'secondary' },
    { id: 'c', dish: 'd', name: 'cilantro', basis: 'estimated', tag: 'garnish' },
  ]
  const empty: MatchTable = { rows: [], invented: [], droppedDrinks: [] }

  it('everything missed → zeros, no NaN', () => {
    const r = level1(truth, [], empty)
    expect(r.recognized).toBe(0)
    expect(r.invented).toBe(0)
    expect(r.net).toBe(0)
    expect(r.quantity).toBe(0)
    expect(r.f1).toEqual({ precision: 0, recall: 0, f1: 0, tp: 0, fp: 0, fn: 3 })
    expect(r.massError).toEqual({ mae: null, mape: null, n: 0, coverage: 0.5 })
    expect(r.msa).toBeNull()
  })

  it('drinks are dropped, never invented (isDrink flag or droppedDrinks list)', () => {
    const preds: PredItem[] = [
      { id: 'p1', dish: 'd', name: 'rice', grams: 200 },
      { id: 'p2', dish: 'd', name: 'water', grams: 250, isDrink: true },
      { id: 'p3', dish: 'd', name: 'coffee', grams: 200 },
    ]
    const r = level1(truth, preds, {
      rows: [{ truthIds: ['a'], predIds: ['p1'], identity: 1 }],
      invented: [{ predId: 'p3', tag: 'secondary' }],
      droppedDrinks: ['p3'],
    })
    expect(r.inventedItems).toEqual([])
    expect(r.invented).toBe(0)
    expect(r.sums.sumInventedE).toBe(0)
  })

  it('unpaired predictions not in the invented list default to garnish', () => {
    const preds: PredItem[] = [
      { id: 'p1', dish: 'd', name: 'rice', grams: 200 },
      { id: 'px', dish: 'd', name: 'lime', grams: 4 },
    ]
    const r = level1(truth, preds, { rows: [{ truthIds: ['a'], predIds: ['p1'], identity: 1 }], invented: [], droppedDrinks: [] })
    expect(r.inventedItems).toEqual([expect.objectContaining({ predId: 'px', tag: 'garnish', origin: 'unpaired' })])
    expect(r.sums.sumInventedE).toBe(4)
  })

  it('a matched prediction without grams is graded 0 (its mass was not captured)', () => {
    const preds: PredItem[] = [{ id: 'p1', dish: 'd', name: 'rice' }]
    const r = level1(truth, preds, { rows: [{ truthIds: ['a'], predIds: ['p1'], identity: 1 }], invented: [], droppedDrinks: [] })
    expect(r.recognized).toBeCloseTo(1 / 1.6, 12)
    expect(r.perItem.find((i) => i.id === 'a')!.grade).toBe(0)
    expect(r.massError.n).toBe(0)
  })

  it('truth items without grams are excluded from Quantity but count in Recognized', () => {
    const preds: PredItem[] = [{ id: 'p1', dish: 'd', name: 'cilantro', grams: 2 }]
    const r = level1(truth, preds, { rows: [{ truthIds: ['c'], predIds: ['p1'], identity: 1 }], invented: [], droppedDrinks: [] })
    expect(r.recognized).toBeCloseTo(0.1 / 1.6, 12)
    expect(r.sums.sumG).toBe(300)
    expect(r.perItem.find((i) => i.id === 'c')!.grade).toBeNull()
  })

  it('one-to-many: pred grams vs sum of truth grams, each truth item takes the group grade', () => {
    const preds: PredItem[] = [{ id: 'p1', dish: 'd', name: 'rice and stew', grams: 150 }]
    const r = level1(truth, preds, { rows: [{ truthIds: ['a', 'b'], predIds: ['p1'], identity: 1 }], invented: [], droppedDrinks: [] })
    const g = 150 / 300
    expect(r.perItem.find((i) => i.id === 'a')!.grade).toBeCloseTo(g, 12)
    expect(r.perItem.find((i) => i.id === 'b')!.grade).toBeCloseTo(g, 12)
    expect(r.quantity).toBeCloseTo((200 * g + 100 * g) / 300, 12)
    expect(r.f1.tp).toBe(1) // one row, one TP
    // the group is one mass-error unit, but stew is estimated so the unit is not weighed → excluded
    expect(r.massError.n).toBe(0)
  })

  it('one-to-many wrong pairing tags the invented prediction from the highest-weight truth item', () => {
    const preds: PredItem[] = [{ id: 'p1', dish: 'd', name: 'pasta', grams: 300 }]
    const r = level1(truth, preds, { rows: [{ truthIds: ['b', 'a'], predIds: ['p1'], identity: 0 }], invented: [], droppedDrinks: [] })
    expect(r.inventedItems[0]).toMatchObject({ predId: 'p1', tag: 'core', origin: 'wrong_pairing' })
    expect(r.f1).toMatchObject({ tp: 0, fp: 1, fn: 3 })
  })

  it('a row with identity 1 but no predictions is a miss', () => {
    const r = level1(truth, [], { rows: [{ truthIds: ['a'], predIds: [], identity: 1 }], invented: [], droppedDrinks: [] })
    expect(r.recognized).toBe(0)
    expect(r.perItem.find((i) => i.id === 'a')!.status).toBe('missed')
  })

  it('rows referencing unknown ids are ignored, not crashed on', () => {
    const r = level1(truth, [{ id: 'p1', dish: 'd', name: 'rice', grams: 200 }], {
      rows: [{ truthIds: ['nope'], predIds: ['p1'], identity: 1 }],
      invented: [{ predId: 'ghost' }],
      droppedDrinks: [],
    })
    expect(r.recognized).toBe(0)
    // p1 ends up unpaired → invented garnish
    expect(r.inventedItems.map((i) => i.predId)).toEqual(['p1'])
  })

  it('Invented can exceed 1', () => {
    const preds: PredItem[] = [
      { id: 'p1', dish: 'd', name: 'chicken', grams: 200 },
      { id: 'p2', dish: 'd', name: 'beef', grams: 200 },
    ]
    const r = level1(truth, preds, {
      rows: [],
      invented: [
        { predId: 'p1', tag: 'core' },
        { predId: 'p2', tag: 'core' },
      ],
      droppedDrinks: [],
    })
    expect(r.invented).toBeCloseTo(2 / 1.6, 12)
    expect(r.net).toBe(0) // floored
  })

  it('LUNCH_TRUTH carries a composite item with components (for Level 2)', () => {
    expect(LUNCH_TRUTH.find((t) => t.id === 't-veg')!.components!.length).toBe(5)
  })
})
