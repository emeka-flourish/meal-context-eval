/* The eight worked cases of docs/UNDERSTANDING-SCORE-CASES.md (all invented),
   encoded as fixtures under the METRICS.md Level 1 rules. Test-only helpers —
   nothing here is imported by app code. `renderCaseTable()` produces the
   markdown section the tests write back into the doc. */

import { level1 } from './level1'
import type { Level1Result, MatchTable, PredItem, TruthItem } from './types'

/* ---- invented dinner truth (after hidden-fat check) ------------------------------------------- */
export const LUNCH_TRUTH: TruthItem[] = [
  { id: 't-salmon', dish: 'salmon', name: 'salmon', grams: 170, basis: 'weighed', tag: 'core', state: 'cooked' },
  { id: 't-sp', dish: 'sweet potato', name: 'sweet potato', grams: 150, basis: 'weighed', tag: 'core', state: 'cooked' },
  {
    id: 't-veg',
    dish: 'roasted vegetables',
    name: 'roasted vegetables',
    grams: 200,
    basis: 'weighed',
    tag: 'secondary',
    state: 'cooked',
    components: ['brussels sprouts', 'sweet potato', 'broccoli', 'zucchini', 'onion'],
  },
  { id: 't-oil', dish: 'roasted vegetables', name: 'olive oil', grams: 5, basis: 'estimated', tag: 'garnish' },
  { id: 't-curry', dish: 'salmon', name: 'curry powder', grams: 1, basis: 'estimated', tag: 'spice' },
  { id: 't-parsley', dish: 'sweet potato', name: 'parsley', grams: 1, basis: 'estimated', tag: 'garnish' },
  { id: 't-salt', dish: 'salmon', name: 'salt', basis: 'estimated', tag: 'ignore' },
  { id: 't-pepper', dish: 'salmon', name: 'black pepper', basis: 'estimated', tag: 'ignore' },
]

/* ---- invented breakfast truth (case 7 uses the oatmeal dish only) ---------------------------- */
export const OATMEAL_TRUTH: TruthItem[] = [
  { id: 't-oat', dish: 'oatmeal', name: 'oatmeal', grams: 220, basis: 'converted', tag: 'core', state: 'cooked' },
  { id: 't-honey', dish: 'oatmeal', name: 'honey', grams: 15, basis: 'estimated', tag: 'secondary' },
  { id: 't-blue', dish: 'oatmeal', name: 'blueberries', grams: 60, basis: 'weighed', tag: 'secondary' },
]

const p = (id: string, name: string, grams?: number, extra: Partial<PredItem> = {}): PredItem => ({
  id,
  dish: extra.dish ?? name,
  name,
  grams,
  ...extra,
})

export type ScoreCase = {
  n: number
  title: string
  prediction: string
  expected: string
  truth: TruthItem[]
  preds: PredItem[]
  match: MatchTable
}

const exact = (t: string, ...preds: string[]) => ({ truthIds: [t], predIds: preds, identity: 1 as const })
const sub = (t: string, ...preds: string[]) => ({ truthIds: [t], predIds: preds, identity: 0.5 as const })
const wrong = (t: string, ...preds: string[]) => ({ truthIds: [t], predIds: preds, identity: 0 as const })

/* case 2 predictions are reused by cases 4, 5 and 6 */
const CASE2_PREDS: PredItem[] = [
  p('p-salmon', 'salmon', 175),
  p('p-sp', 'sweet potato', 160),
  p('p-veg', 'roasted vegetables', 205),
  p('p-oil', 'olive oil', 3, { inferred: true }),
  p('p-curry', 'curry powder', 1),
  p('p-parsley', 'parsley', 1),
]
const CASE2_ROWS = [
  exact('t-salmon', 'p-salmon'),
  exact('t-sp', 'p-sp'),
  exact('t-veg', 'p-veg'),
  exact('t-oil', 'p-oil'),
  exact('t-curry', 'p-curry'),
  exact('t-parsley', 'p-parsley'),
]

export const CASES: ScoreCase[] = [
  {
    n: 1,
    title: 'phone, image only',
    prediction: 'salmon 210, sweet potato 190, veg 250 (4 items summed), olive oil 10 inferred, lemon 8 invented; curry+parsley missed',
    expected: 'baseline',
    truth: LUNCH_TRUTH,
    preds: [
      p('p-salmon', 'salmon', 210),
      p('p-sp', 'sweet potato', 190),
      p('p-brussels', 'brussels sprouts', 65, { dish: 'roasted vegetables' }),
      p('p-sp2', 'roasted sweet potato', 65, { dish: 'roasted vegetables' }),
      p('p-broccoli', 'broccoli', 60, { dish: 'roasted vegetables' }),
      p('p-zucchini', 'zucchini', 60, { dish: 'roasted vegetables' }),
      p('p-oil', 'olive oil', 10, { inferred: true }),
      p('p-lemon', 'lemon', 8),
    ],
    match: {
      rows: [
        exact('t-salmon', 'p-salmon'),
        exact('t-sp', 'p-sp'),
        exact('t-veg', 'p-brussels', 'p-sp2', 'p-broccoli', 'p-zucchini'),
        exact('t-oil', 'p-oil'),
      ],
      invented: [{ predId: 'p-lemon', tag: 'garnish' }],
      droppedDrinks: [],
    },
  },
  {
    n: 2,
    title: 'phone, image + context',
    prediction: 'salmon 175, sweet potato 160, veg 205, oil 3 inferred, curry 1, parsley 1',
    expected: 'gain over case 1 is mostly Quantity',
    truth: LUNCH_TRUTH,
    preds: CASE2_PREDS,
    match: { rows: CASE2_ROWS, invented: [], droppedDrinks: [] },
  },
  {
    n: 3,
    title: 'protein missed, garnishes found',
    prediction: 'sweet potato 160, veg 215, oil 5, curry 1, parsley 2; no salmon',
    expected: 'below case 1 on Net and Quantity although item-F1 ranks it above',
    truth: LUNCH_TRUTH,
    preds: [
      p('p-sp', 'sweet potato', 160),
      p('p-veg', 'roasted vegetables', 215),
      p('p-oil', 'olive oil', 5),
      p('p-curry', 'curry powder', 1),
      p('p-parsley', 'parsley', 2),
    ],
    match: {
      rows: [
        exact('t-sp', 'p-sp'),
        exact('t-veg', 'p-veg'),
        exact('t-oil', 'p-oil'),
        exact('t-curry', 'p-curry'),
        exact('t-parsley', 'p-parsley'),
      ],
      invented: [],
      droppedDrinks: [],
    },
  },
  {
    n: 4,
    title: 'substitute name',
    prediction: 'trout 175 for salmon, rest as case 2',
    expected: 'costs Recognized, not Quantity',
    truth: LUNCH_TRUTH,
    preds: [p('p-trout', 'trout', 175), ...CASE2_PREDS.slice(1)],
    match: { rows: [sub('t-salmon', 'p-trout'), ...CASE2_ROWS.slice(1)], invented: [], droppedDrinks: [] },
  },
  {
    n: 5,
    title: 'wrong item, confident',
    prediction: 'chicken breast 200 for salmon (wrong pairing = missed + invented core), rest as case 2',
    expected: 'below case 3: wrong-and-confident < missed; 200 g enters the Quantity denominator',
    truth: LUNCH_TRUTH,
    preds: [p('p-chicken', 'chicken breast', 200, { confidence: 'high' }), ...CASE2_PREDS.slice(1)],
    match: { rows: [wrong('t-salmon', 'p-chicken'), ...CASE2_ROWS.slice(1)], invented: [], droppedDrinks: [] },
  },
  {
    n: 6,
    title: 'padded log',
    prediction: 'case 2 + invented garlic 3 (spice), lemon juice 5 (garnish), herbs 1 (spice), butter 10 (garnish); salt/pepper ignore',
    expected: 'four phantom small items cost little',
    truth: LUNCH_TRUTH,
    preds: [
      ...CASE2_PREDS,
      p('p-garlic', 'garlic', 3),
      p('p-lemonjuice', 'lemon juice', 5),
      p('p-herbs', 'mixed herbs', 1),
      p('p-butter', 'butter', 10),
      p('p-salt', 'salt', 1),
      p('p-pepper', 'black pepper', 1),
    ],
    match: {
      rows: CASE2_ROWS,
      invented: [
        { predId: 'p-garlic', tag: 'spice' },
        { predId: 'p-lemonjuice', tag: 'garnish' },
        { predId: 'p-herbs', tag: 'spice' },
        { predId: 'p-butter', tag: 'garnish' },
        { predId: 'p-salt', tag: 'ignore' },
        { predId: 'p-pepper', tag: 'ignore' },
      ],
      droppedDrinks: [],
    },
  },
  {
    n: 7,
    title: 'small high-consequence miss',
    prediction: 'oatmeal 220 core, honey 15 secondary, blueberries 60 secondary; pred oatmeal 220, blueberries 45, honey missed',
    expected: 'mass weighting hides honey; Recognized flags it; Level 2/3 is the switch',
    truth: OATMEAL_TRUTH,
    preds: [p('p-oat', 'oatmeal', 220), p('p-blue', 'blueberries', 45)],
    match: { rows: [exact('t-oat', 'p-oat'), exact('t-blue', 'p-blue')], invented: [], droppedDrinks: [] },
  },
  {
    n: 8,
    title: 'context only, routine meal',
    prediction: 'card: salmon 165, sweet potato 155, veg 190, oil 3, curry 1; parsley missed',
    expected: '≈ case 2: camera adds little to memory on a routine meal',
    truth: LUNCH_TRUTH,
    preds: [
      p('p-salmon', 'salmon', 165),
      p('p-sp', 'sweet potato', 155),
      p('p-veg', 'roasted vegetables', 190),
      p('p-oil', 'olive oil', 3),
      p('p-curry', 'curry powder', 1),
    ],
    match: {
      rows: [
        exact('t-salmon', 'p-salmon'),
        exact('t-sp', 'p-sp'),
        exact('t-veg', 'p-veg'),
        exact('t-oil', 'p-oil'),
        exact('t-curry', 'p-curry'),
      ],
      invented: [],
      droppedDrinks: [],
    },
  },
]

export function scoreCase(c: ScoreCase): Level1Result {
  return level1(c.truth, c.preds, c.match)
}

const f3 = (x: number | null) => (x === null ? '—' : x.toFixed(3))
const f1 = (x: number | null) => (x === null ? '—' : x.toFixed(1))

/** Markdown block written into UNDERSTANDING-SCORE-CASES.md by cases.test.ts. */
export function renderCaseTable(): string {
  const lines: string[] = []
  lines.push('| # | Case | Recognized | Invented | Net | Quantity | Qty (no subst.) | F1 | mass MAE g (n) | MSA % | SSPB % | Expected property |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const c of CASES) {
    const r = scoreCase(c)
    lines.push(
      `| ${c.n} | ${c.title} | ${f3(r.recognized)} | ${f3(r.invented)} | ${f3(r.net)} | ${f3(r.quantity)} | ${f3(r.quantityNoSubstitutes)} | ${f3(r.f1.f1)} | ${f1(r.massError.mae)} (${r.massError.n}) | ${f1(r.msa)} | ${f1(r.sspb)} | ${c.expected} |`,
    )
  }
  lines.push('')
  lines.push('Sums behind the ratios (Σw, Σw·id, Σw_inv, Σp·w_inv, Σg, Σg·grade, Σe_inv):')
  lines.push('')
  lines.push('| # | Σw | Σw·id | Σw_inv | Σp·w_inv | Σg | Σg·grade | Σe_inv |')
  lines.push('|---|---|---|---|---|---|---|---|')
  for (const c of CASES) {
    const s = scoreCase(c).sums
    lines.push(
      `| ${c.n} | ${s.sumW.toFixed(2)} | ${s.sumWId.toFixed(2)} | ${s.sumInventedW.toFixed(2)} | ${s.sumPenalisedInventedW.toFixed(3)} | ${s.sumG.toFixed(0)} | ${s.sumGGrade.toFixed(1)} | ${s.sumInventedE.toFixed(0)} |`,
    )
  }
  return lines.join('\n')
}
