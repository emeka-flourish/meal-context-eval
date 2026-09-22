/* Level 3 — Decisions per persona (METRICS.md rev 8.1, pilot = IBS + GLP-1).
   Six decisions per meal, identical rules on truth and estimate; agreement =
   same answer. The FODMAP light and the fried/spicy judgement come from an
   INJECTED classifier (pinned model, blind, temperature 0 in production; a
   deterministic double in tests). Everything else is arithmetic on Level 2
   nutrients and Level 1 grams.

   Thresholds (PERSONA-DECISIONS.md, all "(proposal)"):
     D-FAT   fat·9/kcal ≥ 0.40 AND fat ≥ 15 g
     D-LARGE kcal ≥ 750
     L1      protein ≥ 25 g main meal, ≥ 10 g snack
     L3      Σ grams ≥ 500 (truth: gram-bearing non-ignore items; est: gram-bearing non-drink items)
     L4      classifier: any fried item ≥ 30 g, or any spicy (chili-bearing) item; drinks removed
     I1      classifier: green / amber / red per Monash serve logic

   Margin = (value − threshold) / threshold; for D-FAT (two conditions ANDed)
   the margin is the smaller of the two so its sign matches the decision. */

import type { Nutrients, Tag } from './types'

export type FodmapLight = 'green' | 'amber' | 'red'
export const LIGHT_RANK: Record<FodmapLight, number> = { green: 0, amber: 1, red: 2 }

export type DecisionItem = {
  id?: string
  name: string
  grams?: number
  state?: string
  tag?: Tag
  isDrink?: boolean
  components?: string[]
}

/** What the pinned classifier returns for one item list (drinks/ignore already
    removed by level3). `fried` / `spicy` are the L4 answers under the written
    rule the classifier is given (fried item ≥ 30 g; any chili-bearing item). */
export type Classification = {
  light: FodmapLight
  reason: string
  /** ingredients that decided the light (for attribution) */
  deciding?: string[]
  fried: boolean
  spicy: boolean
}

export type Classifier = (items: DecisionItem[]) => Classification

export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export type Direction = 'agree' | 'false_alarm' | 'miss' | 'within_one' | 'differs'

export type Decision<V> = {
  truth: V
  est: V
  agree: boolean
  marginTruth?: number
  marginEst?: number
  direction: Direction
  explanation: string
}

export const THRESHOLDS = {
  fatShare: 0.4,
  fatGrams: 15,
  largeKcal: 750,
  proteinMain: 25,
  proteinSnack: 10,
  largeMass: 500,
  friedGrams: 30,
} as const

export type Level3Result = {
  fodmapLight: Decision<FodmapLight> & { reasonTruth: string; reasonEst: string }
  highFat: Decision<boolean>
  largeKcal: Decision<boolean>
  proteinAdequate: Decision<boolean>
  largeMass: Decision<boolean>
  nauseaIrritant: Decision<boolean>
  /** share of the six that agree */
  agreementRate: number
}

export type Level3Options = { mealSlot?: MealSlot }

const r1 = (x: number) => Math.round(x * 10) / 10
const pct = (x: number) => `${Math.round(x * 100)}%`

function binaryDirection(truth: boolean, est: boolean): Direction {
  if (truth === est) return 'agree'
  return est ? 'false_alarm' : 'miss'
}

function numeric(
  truthValue: number,
  estValue: number,
  threshold: number,
  label: (side: 'truth' | 'est', v: number) => string,
): Decision<boolean> {
  const truth = truthValue >= threshold
  const est = estValue >= threshold
  const marginTruth = threshold > 0 ? (truthValue - threshold) / threshold : 0
  const marginEst = threshold > 0 ? (estValue - threshold) / threshold : 0
  return {
    truth,
    est,
    agree: truth === est,
    marginTruth,
    marginEst,
    direction: binaryDirection(truth, est),
    explanation: `${label('truth', truthValue)}; ${label('est', estValue)}`,
  }
}

export function fatShare(n: Nutrients): number {
  return n.kcal > 0 ? (n.fat * 9) / n.kcal : 0
}

/** D-FAT: fat share ≥ 40 % AND fat ≥ 15 g. Margin = min(share margin, grams margin). */
export function decideHighFat(truthN: Nutrients, estN: Nutrients): Decision<boolean> {
  const side = (n: Nutrients) => {
    const share = fatShare(n)
    const value = share >= THRESHOLDS.fatShare && n.fat >= THRESHOLDS.fatGrams
    const margin = Math.min(
      (share - THRESHOLDS.fatShare) / THRESHOLDS.fatShare,
      (n.fat - THRESHOLDS.fatGrams) / THRESHOLDS.fatGrams,
    )
    return { share, value, margin }
  }
  const t = side(truthN)
  const e = side(estN)
  return {
    truth: t.value,
    est: e.value,
    agree: t.value === e.value,
    marginTruth: t.margin,
    marginEst: e.margin,
    direction: binaryDirection(t.value, e.value),
    explanation:
      `High-fat (limit 40% and 15 g): truth ${r1(truthN.fat)} g = ${pct(t.share)} of ${Math.round(truthN.kcal)} kcal; ` +
      `est ${r1(estN.fat)} g = ${pct(e.share)} of ${Math.round(estN.kcal)} kcal`,
  }
}

/** D-LARGE (kcal): kcal ≥ 750. */
export function decideLargeKcal(truthN: Nutrients, estN: Nutrients): Decision<boolean> {
  return numeric(truthN.kcal, estN.kcal, THRESHOLDS.largeKcal, (s, v) => `${s} ${Math.round(v)} kcal (limit 750)`)
}

/** L1: protein ≥ 25 g at a main meal, ≥ 10 g at a snack. */
export function decideProteinAdequate(truthN: Nutrients, estN: Nutrients, slot: MealSlot = 'lunch'): Decision<boolean> {
  const th = slot === 'snack' ? THRESHOLDS.proteinSnack : THRESHOLDS.proteinMain
  return numeric(truthN.protein, estN.protein, th, (s, v) => `${s} protein ${r1(v)} g (target ${th} g, ${slot})`)
}

const gramSum = (items: DecisionItem[]) =>
  items.reduce((s, it) => s + (typeof it.grams === 'number' && Number.isFinite(it.grams) ? it.grams : 0), 0)

/** Items that enter a decision: no drinks, no ignore-tagged items. */
export function decisionItems(items: DecisionItem[]): DecisionItem[] {
  return items.filter((it) => !it.isDrink && it.tag !== 'ignore')
}

/** L3: total mass ≥ 500 g — the one decision that tests measured grams with no lookup. */
export function decideLargeMass(truthItems: DecisionItem[], estItems: DecisionItem[]): Decision<boolean> {
  const t = gramSum(decisionItems(truthItems))
  const e = gramSum(decisionItems(estItems))
  return numeric(t, e, THRESHOLDS.largeMass, (s, v) => `${s} mass ${Math.round(v)} g (limit 500 g)`)
}

/** I1: FODMAP light via the injected classifier; "within one light" is the soft agreement. */
export function decideFodmapLight(
  truthItems: DecisionItem[],
  estItems: DecisionItem[],
  classify: Classifier,
): Level3Result['fodmapLight'] {
  const t = classify(decisionItems(truthItems))
  const e = classify(decisionItems(estItems))
  const diff = Math.abs(LIGHT_RANK[t.light] - LIGHT_RANK[e.light])
  const direction: Direction = diff === 0 ? 'agree' : diff === 1 ? 'within_one' : 'differs'
  return {
    truth: t.light,
    est: e.light,
    agree: diff === 0,
    marginTruth: LIGHT_RANK[t.light],
    marginEst: LIGHT_RANK[e.light],
    direction,
    reasonTruth: t.reason,
    reasonEst: e.reason,
    explanation: `FODMAP truth ${t.light} (${t.reason}); est ${e.light} (${e.reason})`,
  }
}

/** L4: nausea irritant present — classifier's fried (≥ 30 g rule) or spicy answer. */
export function decideNauseaIrritant(
  truthItems: DecisionItem[],
  estItems: DecisionItem[],
  classify: Classifier,
): Decision<boolean> {
  const t = classify(decisionItems(truthItems))
  const e = classify(decisionItems(estItems))
  const tv = t.fried || t.spicy
  const ev = e.fried || e.spicy
  const why = (c: Classification) => (c.fried && c.spicy ? 'fried + spicy' : c.fried ? 'fried' : c.spicy ? 'spicy' : 'none')
  return {
    truth: tv,
    est: ev,
    agree: tv === ev,
    direction: binaryDirection(tv, ev),
    explanation: `Nausea irritant: truth ${why(t)}; est ${why(e)}`,
  }
}

export function level3(
  truthItems: DecisionItem[],
  truthN: Nutrients,
  estItems: DecisionItem[],
  estN: Nutrients,
  classify: Classifier,
  opts: Level3Options = {},
): Level3Result {
  // one classifier call per side, shared by the two classifier-driven decisions
  const cache = new Map<string, Classification>()
  const memo: Classifier = (items) => {
    const key = JSON.stringify(items)
    const hit = cache.get(key)
    if (hit) return hit
    const c = classify(items)
    cache.set(key, c)
    return c
  }
  const tItems = decisionItems(truthItems)
  const eItems = decisionItems(estItems)

  const fodmapLight = decideFodmapLight(tItems, eItems, memo)
  const highFat = decideHighFat(truthN, estN)
  const largeKcal = decideLargeKcal(truthN, estN)
  const proteinAdequate = decideProteinAdequate(truthN, estN, opts.mealSlot)
  const largeMass = decideLargeMass(tItems, eItems)
  const nauseaIrritant = decideNauseaIrritant(tItems, eItems, memo)
  const all = [fodmapLight, highFat, largeKcal, proteinAdequate, largeMass, nauseaIrritant]
  return {
    fodmapLight,
    highFat,
    largeKcal,
    proteinAdequate,
    largeMass,
    nauseaIrritant,
    agreementRate: all.filter((d) => d.agree).length / all.length,
  }
}
