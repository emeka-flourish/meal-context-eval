/* Study-scope aggregation (METRICS.md "Units"): scene cells → meals (pooled
   sums; the Net / Quantity identities hold at every level) → study (mean over
   meals, 95 % bootstrap CI, condition differences paired within meal).
   Level 3 counts stay per scene because decisions are scored per scene.
   Pure: every input is plain data; the bootstrap is seeded. */

import { aggregate, bootstrapCI, pairedGain, type Aggregate, type AggregateOptions } from '@/lib/scoring/aggregate'
import { nutrientErrors, summarizeNutrientErrors, type Level2Result, type NutrientErrors } from '@/lib/scoring/level2'
import type { Level3Result } from '@/lib/scoring/level3'
import { NUTRIENT_KEYS, ZERO_NUTRIENTS, type Level1Result, type NutrientKey, type Nutrients } from '@/lib/scoring/types'
import { VANTAGES, type Vantage } from './format'
import { DECISIONS } from './results-format'
import type {
  Condition,
  DecisionCounts,
  DecisionKey,
  KcalBiasRow,
  Level1Bar,
  Level1Figure,
  Level1Gain,
  Level1Row,
  Level2Block,
  Level3Row,
  ModelTableRow,
  NutrientGain,
  NutrientRow,
  RunModel,
} from './results-types'

export const BOOTSTRAP: AggregateOptions = { bootstrap: 2000, seed: 20260916 }

export type Level2Cell = { truth: Level2Result; est: Level2Result; errors: NutrientErrors; identityOnly?: boolean }

export type CellLite = {
  sceneId: string
  mealId: string
  vantage: Vantage | null
  condition: Condition
  modelId: string
  level1: Level1Result
  level2: Level2Cell
  level3: Level3Result
}

/* ---- meal pooling ------------------------------------------------------------- */

type Pooled = {
  mealId: string
  scenes: number
  sumW: number
  sumWId: number
  sumInventedW: number
  sumPenalisedInventedW: number
  sumG: number
  sumGGrade: number
  sumInventedE: number
  tp: number
  fp: number
  fn: number
  maeSum: number
  mapeSum: number
  massN: number
  truthN: Nutrients
  estN: Nutrients
}

function emptyPooled(mealId: string): Pooled {
  return {
    mealId,
    scenes: 0,
    sumW: 0,
    sumWId: 0,
    sumInventedW: 0,
    sumPenalisedInventedW: 0,
    sumG: 0,
    sumGGrade: 0,
    sumInventedE: 0,
    tp: 0,
    fp: 0,
    fn: 0,
    maeSum: 0,
    mapeSum: 0,
    massN: 0,
    truthN: { ...ZERO_NUTRIENTS },
    estN: { ...ZERO_NUTRIENTS },
  }
}

const add = (a: Nutrients, b: Nutrients | undefined): Nutrients => {
  const out = { ...a }
  if (!b) return out
  for (const k of NUTRIENT_KEYS) out[k] += typeof b[k] === 'number' ? b[k] : 0
  return out
}

/** Pool the cells of one (vantage, condition, model) group into meals. */
export function poolByMeal(cells: CellLite[]): Pooled[] {
  const byMeal = new Map<string, Pooled>()
  for (const c of cells) {
    const p = byMeal.get(c.mealId) ?? emptyPooled(c.mealId)
    const s = c.level1.sums
    p.scenes += 1
    p.sumW += s.sumW
    p.sumWId += s.sumWId
    p.sumInventedW += s.sumInventedW
    p.sumPenalisedInventedW += s.sumPenalisedInventedW
    p.sumG += s.sumG
    p.sumGGrade += s.sumGGrade
    p.sumInventedE += s.sumInventedE
    p.tp += c.level1.f1?.tp ?? 0
    p.fp += c.level1.f1?.fp ?? 0
    p.fn += c.level1.f1?.fn ?? 0
    const me = c.level1.massError
    if (me && me.n > 0 && me.mae !== null) {
      p.maeSum += me.mae * me.n
      p.mapeSum += (me.mape ?? 0) * me.n
      p.massN += me.n
    }
    if (!c.level2?.identityOnly) {
      p.truthN = add(p.truthN, c.level2?.truth)
      p.estN = add(p.estN, c.level2?.est)
    }
    byMeal.set(c.mealId, p)
  }
  return [...byMeal.values()].sort((a, b) => a.mealId.localeCompare(b.mealId))
}

export type MealMetrics = {
  mealId: string
  recognized: number | null
  invented: number | null
  net: number | null
  quantity: number | null
  f1: number | null
  massMae: number | null
  massMape: number | null
  truthN: Nutrients
  estN: Nutrients
}

export function mealMetrics(p: Pooled): MealMetrics {
  const recognized = p.sumW > 0 ? p.sumWId / p.sumW : null
  const invented = p.sumW > 0 ? p.sumInventedW / p.sumW : null
  const net = p.sumW > 0 ? Math.max(0, (p.sumWId - p.sumPenalisedInventedW) / p.sumW) : null
  const qd = p.sumG + p.sumInventedE
  const quantity = qd > 0 ? p.sumGGrade / qd : null
  const fd = 2 * p.tp + p.fp + p.fn
  const f1 = fd > 0 ? (2 * p.tp) / fd : null
  return {
    mealId: p.mealId,
    recognized,
    invented,
    net,
    quantity,
    f1,
    massMae: p.massN > 0 ? p.maeSum / p.massN : null,
    massMape: p.massN > 0 ? p.mapeSum / p.massN : null,
    truthN: p.truthN,
    estN: p.estN,
  }
}

/* ---- grouping ----------------------------------------------------------------- */

export type GroupKey = { vantage: Vantage | null; condition: Condition }

const gk = (vantage: Vantage | null, condition: Condition) => `${vantage ?? 'none'}|${condition}`

/** meals per (vantage, condition) for one model */
export function groupMeals(cells: CellLite[], modelId: string): Map<string, MealMetrics[]> {
  const groups = new Map<string, CellLite[]>()
  for (const c of cells) {
    if (c.modelId !== modelId) continue
    const k = gk(c.vantage, c.condition)
    const arr = groups.get(k) ?? []
    arr.push(c)
    groups.set(k, arr)
  }
  const out = new Map<string, MealMetrics[]>()
  for (const [k, arr] of groups) out.set(k, poolByMeal(arr).map(mealMetrics))
  return out
}

function aligned(a: MealMetrics[], b: MealMetrics[], pick: (m: MealMetrics) => number | null): [Array<number | null>, Array<number | null>] {
  const bById = new Map(b.map((m) => [m.mealId, m]))
  const xs: Array<number | null> = []
  const ys: Array<number | null> = []
  for (const m of a) {
    const o = bById.get(m.mealId)
    if (!o) continue
    xs.push(pick(m))
    ys.push(pick(o))
  }
  return [xs, ys]
}

/* ---- Level 1 ------------------------------------------------------------------ */

export function level1Figure(groups: Map<string, MealMetrics[]>, conditions: Condition[], modelId: string): Level1Figure {
  const bars: Level1Bar[] = []
  for (const vantage of VANTAGES) {
    for (const condition of conditions) {
      if (condition === 'context_only') continue
      const meals = groups.get(gk(vantage, condition))
      if (!meals || meals.length === 0) continue
      bars.push({
        vantage,
        condition,
        n: meals.length,
        recognized: aggregate(meals.map((m) => m.recognized), BOOTSTRAP),
        invented: aggregate(meals.map((m) => m.invented), BOOTSTRAP),
        net: aggregate(meals.map((m) => m.net), BOOTSTRAP),
        quantity: aggregate(meals.map((m) => m.quantity), BOOTSTRAP),
      })
    }
  }
  const ctx = groups.get(gk(null, 'context_only'))
  return {
    modelId,
    bars,
    contextOnly:
      ctx && ctx.length
        ? { n: ctx.length, net: aggregate(ctx.map((m) => m.net), BOOTSTRAP), quantity: aggregate(ctx.map((m) => m.quantity), BOOTSTRAP) }
        : null,
  }
}

export function level1Table(groups: Map<string, MealMetrics[]>, conditions: Condition[]): Level1Row[] {
  const rows: Level1Row[] = []
  const push = (vantage: Vantage | null, condition: Condition) => {
    const meals = groups.get(gk(vantage, condition))
    if (!meals || meals.length === 0) return
    rows.push({
      vantage,
      condition,
      n: meals.length,
      recognized: aggregate(meals.map((m) => m.recognized), BOOTSTRAP),
      invented: aggregate(meals.map((m) => m.invented), BOOTSTRAP),
      net: aggregate(meals.map((m) => m.net), BOOTSTRAP),
      quantity: aggregate(meals.map((m) => m.quantity), BOOTSTRAP),
      f1: aggregate(meals.map((m) => m.f1), BOOTSTRAP),
      massMae: aggregate(meals.map((m) => m.massMae), BOOTSTRAP),
      massMape: aggregate(meals.map((m) => m.massMape), BOOTSTRAP),
    })
  }
  for (const vantage of VANTAGES) for (const c of conditions) if (c !== 'context_only') push(vantage, c)
  if (conditions.includes('context_only')) push(null, 'context_only')
  return rows
}

export function level1Gain(groups: Map<string, MealMetrics[]>): Level1Gain[] {
  const out: Level1Gain[] = []
  for (const vantage of VANTAGES) {
    const a = groups.get(gk(vantage, 'image_only'))
    const b = groups.get(gk(vantage, 'image_context'))
    if (!a || !b) continue
    const g = (pick: (m: MealMetrics) => number | null) => {
      const [xs, ys] = aligned(a, b, pick)
      const r = pairedGain(xs, ys, BOOTSTRAP)
      return { n: r.n, mean: r.mean, ci: r.ci, se: r.se }
    }
    out.push({ vantage, net: g((m) => m.net), quantity: g((m) => m.quantity), recognized: g((m) => m.recognized), invented: g((m) => m.invented) })
  }
  return out
}

/* ---- Level 2 ------------------------------------------------------------------ */

export function level2Blocks(groups: Map<string, MealMetrics[]>, conditions: Condition[]): Record<NutrientKey, Level2Block> {
  const out = {} as Record<NutrientKey, Level2Block>
  for (const k of NUTRIENT_KEYS) {
    const rows: NutrientRow[] = []
    const push = (vantage: Vantage | null, condition: Condition) => {
      const meals = groups.get(gk(vantage, condition))
      if (!meals || meals.length === 0) return
      const pairs = meals.filter((m) => m.truthN.kcal > 0).map((m) => ({ truth: m.truthN, est: m.estN })) // a meal made only of identity-only scenes has no nutrient truth
      const s = summarizeNutrientErrors(pairs)[k]
      const errs = pairs.map((p) => nutrientErrors(p.truth, p.est)[k])
      rows.push({
        vantage,
        condition,
        n: meals.length,
        mae: aggregate(errs.map((e) => e.mae), BOOTSTRAP),
        pctOfMean: s.pctOfMean,
        mape: s.mape,
        medianApe: s.medianApe,
        signedBias: bootstrapCI(errs.map((e) => e.signed), BOOTSTRAP),
        within20: s.within20,
        within10: s.within10,
      })
    }
    for (const vantage of VANTAGES) for (const c of conditions) if (c !== 'context_only') push(vantage, c)
    if (conditions.includes('context_only')) push(null, 'context_only')

    const gain: NutrientGain[] = []
    for (const vantage of VANTAGES) {
      const a = groups.get(gk(vantage, 'image_only'))
      const b = groups.get(gk(vantage, 'image_context'))
      if (!a || !b) continue
      const ape = (m: MealMetrics) => nutrientErrors(m.truthN, m.estN)[k].ape
      const [xs, ys] = aligned(a, b, ape)
      const r = pairedGain(xs, ys, BOOTSTRAP)
      gain.push({ vantage, ape: { n: r.n, mean: r.mean, ci: r.ci, se: r.se } })
    }
    out[k] = { rows, gain }
  }
  return out
}

export function kcalBias(blocks: Record<NutrientKey, Level2Block>): KcalBiasRow[] {
  const rows = blocks.kcal.rows
  const find = (vantage: Vantage, condition: Condition): Aggregate | null =>
    rows.find((r) => r.vantage === vantage && r.condition === condition)?.signedBias ?? null
  return VANTAGES.map((vantage) => ({ vantage, imageOnly: find(vantage, 'image_only'), withContext: find(vantage, 'image_context') })).filter(
    (r) => r.imageOnly || r.withContext,
  )
}

/* ---- Level 3 ------------------------------------------------------------------ */

function positive(key: DecisionKey, value: unknown): boolean {
  if (key === 'fodmapLight') return value === 'amber' || value === 'red'
  return value === true
}

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function level3Rows(cells: CellLite[], modelId: string, conditions: Condition[]): Level3Row[] {
  const mine = cells.filter((c) => c.modelId === modelId)
  // base rate: one cell per scene (the truth side is identical across cells of a scene)
  const firstPerScene = new Map<string, CellLite>()
  for (const c of mine) if (!firstPerScene.has(c.sceneId)) firstPerScene.set(c.sceneId, c)

  return DECISIONS.map((d) => {
    const scenes = [...firstPerScene.values()].filter((c) => !c.level2?.identityOnly)
    const baseRate = { positives: scenes.filter((c) => positive(d.key, c.level3?.[d.key]?.truth)).length, N: scenes.length }
    const rowCells: Level3Row['cells'] = []
    const push = (vantage: Vantage | null, condition: Condition) => {
      const group = mine.filter((c) => c.vantage === vantage && c.condition === condition && c.level3?.[d.key] && !c.level2?.identityOnly)
      if (group.length === 0) return
      const counts: DecisionCounts = { N: group.length, agree: 0, falseAlarm: 0, miss: 0, withinOne: 0, marginMedian: null }
      const margins: number[] = []
      for (const c of group) {
        const dec = c.level3[d.key]
        if (dec.agree) counts.agree += 1
        if (dec.direction === 'false_alarm') counts.falseAlarm += 1
        if (dec.direction === 'miss') counts.miss += 1
        if (dec.direction === 'within_one') counts.withinOne += 1
        if (d.numeric && typeof dec.marginEst === 'number') margins.push(Math.abs(dec.marginEst))
      }
      counts.marginMedian = median(margins)
      rowCells.push({ vantage, condition, ...counts })
    }
    for (const vantage of VANTAGES) for (const c of conditions) if (c !== 'context_only') push(vantage, c)
    if (conditions.includes('context_only')) push(null, 'context_only')
    return { key: d.key, label: d.label, persona: d.persona, rule: d.rule, baseRate, cells: rowCells }
  })
}

/* ---- model table -------------------------------------------------------------- */

export function modelTable(cells: CellLite[], models: RunModel[], headline: string): ModelTableRow[] {
  return models.map((m) => {
    const groups = groupMeals(cells, m.id)
    const byVantage = {} as ModelTableRow['byVantage']
    for (const vantage of VANTAGES) {
      const a = groups.get(gk(vantage, 'image_only'))
      const b = groups.get(gk(vantage, 'image_context'))
      const mean = (xs: MealMetrics[] | undefined, pick: (m: MealMetrics) => number | null) => (xs && xs.length ? aggregate(xs.map(pick), BOOTSTRAP).mean : null)
      const change = (pick: (m: MealMetrics) => number | null) => {
        if (!a || !b) return null
        const [xs, ys] = aligned(a, b, pick)
        return pairedGain(xs, ys, BOOTSTRAP).mean
      }
      byVantage[vantage] = {
        net: { imageOnly: mean(a, (x) => x.net), withContext: mean(b, (x) => x.net), change: change((x) => x.net) },
        quantity: { imageOnly: mean(a, (x) => x.quantity), withContext: mean(b, (x) => x.quantity), change: change((x) => x.quantity) },
      }
    }
    return { modelId: m.id, family: m.family, tier: m.tier, headline: m.id === headline, byVantage }
  })
}
