/* Level 2 — Nutrients (METRICS.md rev 7/8.1). Both sides converted
   independently through one injected lookup; no pairing. Pure.

   - lookup(name, state?) → per-100 g Nutrients (+ optional source tag) | null.
   - composite items (`components`) split their one weight equally across the
     components, each looked up under its own name (never by the estimate's
     proportions; a known-recipe split is the caller's job — pass the
     components already weighed as separate items).
   - drinks and `ignore` items are excluded; items without grams contribute
     nothing and are listed under `skipped`.
   - unresolved names (lookup → null) contribute nothing and are listed under
     `unresolved` so the run can route them to the custom-entry queue.
   - customShare = kcal resolved through custom/estimate entries / total kcal
     (the "instrument" line in METRICS Level 2); null when no source tags. */

import { NUTRIENT_KEYS, ZERO_NUTRIENTS, type Nutrients, type NutrientKey, type Tag } from './types'

export type LookupSource = 'fdc' | 'custom' | 'estimate'

export type Per100 = Nutrients & { source?: LookupSource }

export type NutrientLookup = (name: string, state?: string) => Per100 | null

export type Level2Item = {
  id?: string
  name: string
  grams?: number
  state?: string
  components?: string[]
  componentWeights?: number[]
  tag?: Tag
  isDrink?: boolean
}

export type Level2Result = Nutrients & {
  /** share of kcal resolved through custom or estimate entries; null when no lookup reported a source */
  customShare: number | null
  /** names the lookup could not resolve (contribute 0) */
  unresolved: string[]
  /** items skipped for lack of grams (non-drink, non-ignore) */
  skipped: string[]
  perItem: Array<{ name: string; grams: number; source: LookupSource | 'unresolved'; nutrients: Nutrients }>
}

export function addNutrients(a: Nutrients, b: Nutrients): Nutrients {
  const out = { ...ZERO_NUTRIENTS }
  for (const k of NUTRIENT_KEYS) out[k] = a[k] + b[k]
  return out
}

export function scaleNutrients(per100: Nutrients, grams: number): Nutrients {
  const out = { ...ZERO_NUTRIENTS }
  for (const k of NUTRIENT_KEYS) out[k] = (per100[k] * grams) / 100
  return out
}

export function level2(items: Level2Item[], lookup: NutrientLookup): Level2Result {
  let total = { ...ZERO_NUTRIENTS }
  let customKcal = 0
  let sawSource = false
  const unresolved: string[] = []
  const skipped: string[] = []
  const perItem: Level2Result['perItem'] = []

  const addOne = (name: string, grams: number, state?: string) => {
    const hit = lookup(name, state)
    if (!hit) {
      unresolved.push(name)
      perItem.push({ name, grams, source: 'unresolved', nutrients: { ...ZERO_NUTRIENTS } })
      return
    }
    const n = scaleNutrients(hit, grams)
    total = addNutrients(total, n)
    if (hit.source) {
      sawSource = true
      if (hit.source !== 'fdc') customKcal += n.kcal
    }
    perItem.push({ name, grams, source: hit.source ?? 'fdc', nutrients: n })
  }

  for (const it of items) {
    if (it.isDrink || it.tag === 'ignore') continue
    if (typeof it.grams !== 'number' || !Number.isFinite(it.grams)) {
      skipped.push(it.name)
      continue
    }
    if (it.components && it.components.length > 0) {
      const w = it.componentWeights
      const weighted = Array.isArray(w) && w.length === it.components.length && w.every((x) => x > 0)
      const sumW = weighted ? w!.reduce((a, b) => a + b, 0) : it.components.length
      it.components.forEach((c, i) => addOne(c, (it.grams! * (weighted ? w![i] : 1)) / sumW, it.state))
    } else {
      addOne(it.name, it.grams, it.state)
    }
  }

  return {
    ...total,
    customShare: sawSource && total.kcal > 0 ? customKcal / total.kcal : sawSource ? 0 : null,
    unresolved,
    skipped,
    perItem,
  }
}

/* ---- errors ------------------------------------------------------------------------------ */

export type NutrientError = {
  /** |est − truth| in real units */
  mae: number
  /** |est − truth| / truth × 100; null when truth is 0 */
  ape: number | null
  /** (est − truth) / truth × 100; null when truth is 0 */
  signed: number | null
  /** MAE as % of the STUDY mean of truth — needs the run's mean; filled by summarizeNutrientErrors */
  pctOfMean: number | null
}

export type NutrientErrors = Record<NutrientKey, NutrientError>

/** Per-meal error, one entry per nutrient. pctOfMean is a placeholder (null) here
    because it needs the study mean; use summarizeNutrientErrors over all meals. */
export function nutrientErrors(truthN: Nutrients, estN: Nutrients): NutrientErrors {
  const out = {} as NutrientErrors
  for (const k of NUTRIENT_KEYS) {
    const t = truthN[k]
    const e = estN[k]
    const diff = e - t
    out[k] = {
      mae: Math.abs(diff),
      ape: t > 0 ? (Math.abs(diff) / t) * 100 : null,
      signed: t > 0 ? (diff / t) * 100 : null,
      pctOfMean: null,
    }
  }
  return out
}

export type NutrientSummary = {
  n: number
  mae: number | null
  /** mean MAE / mean(truth) × 100 (Nutrition5k form) */
  pctOfMean: number | null
  mape: number | null
  medianApe: number | null
  /** mean (est − truth)/truth × 100 */
  signedBias: number | null
  within20: number
  within10: number
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const med = (xs: number[]): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Study-level summary per nutrient over meals (pairs of truth / estimate totals). */
export function summarizeNutrientErrors(
  rows: Array<{ truth: Nutrients; est: Nutrients }>,
): Record<NutrientKey, NutrientSummary> {
  const out = {} as Record<NutrientKey, NutrientSummary>
  for (const k of NUTRIENT_KEYS) {
    const errs = rows.map((r) => nutrientErrors(r.truth, r.est)[k])
    const truths = rows.map((r) => r.truth[k])
    const maes = errs.map((e) => e.mae)
    const apes = errs.map((e) => e.ape).filter((x): x is number => x !== null)
    const signed = errs.map((e) => e.signed).filter((x): x is number => x !== null)
    const meanTruth = mean(truths)
    const meanMae = mean(maes)
    out[k] = {
      n: rows.length,
      mae: meanMae,
      pctOfMean: meanMae !== null && meanTruth !== null && meanTruth > 0 ? (meanMae / meanTruth) * 100 : null,
      mape: mean(apes),
      medianApe: med(apes),
      signedBias: mean(signed),
      within20: apes.filter((a) => a <= 20).length,
      within10: apes.filter((a) => a <= 10).length,
    }
  }
  return out
}
