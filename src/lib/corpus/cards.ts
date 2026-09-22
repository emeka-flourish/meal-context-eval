/* DishCard statistics (CORPUS.md §3) from a cluster's instances. Pure.
   Tier weights: corrected 1.0 · confirmed 0.7 · unconfirmed 0.5 — applied to
   every share (portion-class mix, inclusion rate, slot mix, home share).
   instanceCount and tierMix are plain counts; priorGrams and the per-
   ingredient medianGramsEst are unweighted medians (a prior, model-estimated). */
import { median, normalizeIngredientName, round } from './normalize'
import type { PortionClass, Slot, Tier } from './load'

export const TIER_WEIGHT: Record<Tier, number> = { corrected: 1, confirmed: 0.7, unconfirmed: 0.5 }

export type CardInstance = {
  dishId: string
  mealId: string
  name: string
  localDate: string // YYYY-MM-DD
  slot: Slot
  tier: Tier
  portionClass: PortionClass
  homeOrAway: 'home' | 'away' | null
  ingredients: { name: string; gramsEst: number | null }[]
}

export type CardIngredient = { name: string; inclusionRate: number; medianGramsEst: number | null }

export type DishCardData = {
  canonicalName: string
  aliases: string[]
  instanceCount: number
  lastSeen: string
  portionClassMix: Record<PortionClass, number>
  priorGrams: number | null
  ingredients: CardIngredient[]
  features: { homeShare: number | null; slotMix: Record<Slot, number> }
  tierMix: Record<Tier, number>
}

export function buildCard(cluster: { canonicalName: string; aliases: string[] }, instances: CardInstance[]): DishCardData {
  if (instances.length === 0) throw new Error(`card ${cluster.canonicalName}: no instances`)
  const W = instances.reduce((s, i) => s + TIER_WEIGHT[i.tier], 0)
  const pc: Record<PortionClass, number> = { small: 0, usual: 0, large: 0 }
  const slot: Record<Slot, number> = { breakfast: 0, lunch: 0, dinner: 0, snack: 0 }
  const tier: Record<Tier, number> = { corrected: 0, confirmed: 0, unconfirmed: 0 }
  let homeW = 0
  let knownW = 0
  const totals: number[] = []
  const ingr = new Map<string, { names: Map<string, number>; weight: number; grams: number[] }>()
  let lastSeen = ''
  for (const inst of instances) {
    const w = TIER_WEIGHT[inst.tier]
    pc[inst.portionClass] += w
    slot[inst.slot] += w
    tier[inst.tier]++
    if (inst.homeOrAway) {
      knownW += w
      if (inst.homeOrAway === 'home') homeW += w
    }
    if (inst.localDate > lastSeen) lastSeen = inst.localDate
    const withGrams = inst.ingredients.filter((g) => typeof g.gramsEst === 'number')
    if (withGrams.length > 0) totals.push(withGrams.reduce((s, g) => s + (g.gramsEst as number), 0))
    const seen = new Set<string>()
    for (const g of inst.ingredients) {
      const key = normalizeIngredientName(g.name)
      let e = ingr.get(key)
      if (!e) {
        e = { names: new Map(), weight: 0, grams: [] }
        ingr.set(key, e)
      }
      e.names.set(g.name, (e.names.get(g.name) ?? 0) + 1)
      if (!seen.has(key)) {
        e.weight += w
        seen.add(key)
      }
      if (typeof g.gramsEst === 'number') e.grams.push(g.gramsEst)
    }
  }
  const share = <K extends string>(r: Record<K, number>): Record<K, number> =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, W > 0 ? round((v as number) / W) : 0])) as Record<K, number>
  const ingredients: CardIngredient[] = [...ingr.entries()]
    .map(([, e]) => {
      const name = [...e.names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
      const med = median(e.grams)
      return { name, inclusionRate: W > 0 ? round(e.weight / W) : 0, medianGramsEst: med == null ? null : round(med, 1) }
    })
    .sort((a, b) => b.inclusionRate - a.inclusionRate || a.name.localeCompare(b.name))
  const prior = median(totals)
  return {
    canonicalName: cluster.canonicalName,
    aliases: cluster.aliases,
    instanceCount: instances.length,
    lastSeen,
    portionClassMix: share(pc),
    priorGrams: prior == null ? null : round(prior, 1),
    ingredients,
    features: { homeShare: knownW > 0 ? round(homeW / knownW) : null, slotMix: share(slot) },
    tierMix: tier,
  }
}
