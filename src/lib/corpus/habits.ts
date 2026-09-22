/* Habit profile (CORPUS.md §3): 5–8 notable findings from CARD-LEVEL
   statistics only — never raw meals. This module is the deterministic mock
   (five template findings) and the stats digest the real pinned model reads.
   Pure. */
import type { DishCardData } from './cards'
import type { PortionClass, Slot } from './load'
import { round } from './normalize'

export type CardStatsDigest = {
  cardCount: number
  instanceTotal: number
  topDishes: { name: string; instances: number; share: number; priorGrams: number | null; portionClassMix: Record<PortionClass, number> }[]
  portionClassOverall: Record<PortionClass, number>
  bySlot: Record<Slot, { name: string; instances: number }[]>
  cookingFats: { name: string; dishes: number }[]
  homeShare: number | null
}

const FAT_RE = /\b(oil|butter|ghee|lard|margarine|shortening)\b/i

export function digestCards(cards: DishCardData[], top = 8): CardStatsDigest {
  const instanceTotal = cards.reduce((s, c) => s + c.instanceCount, 0)
  const sorted = [...cards].sort((a, b) => b.instanceCount - a.instanceCount || a.canonicalName.localeCompare(b.canonicalName))
  const pc: Record<PortionClass, number> = { small: 0, usual: 0, large: 0 }
  for (const c of cards) for (const k of ['small', 'usual', 'large'] as const) pc[k] += c.portionClassMix[k] * c.instanceCount
  const portionClassOverall = Object.fromEntries(Object.entries(pc).map(([k, v]) => [k, instanceTotal ? round(v / instanceTotal) : 0])) as Record<PortionClass, number>
  const bySlot = {} as Record<Slot, { name: string; instances: number }[]>
  for (const s of ['breakfast', 'lunch', 'dinner', 'snack'] as const) {
    bySlot[s] = cards
      .map((c) => ({ name: c.canonicalName, instances: Math.round(c.features.slotMix[s] * c.instanceCount) }))
      .filter((x) => x.instances > 0)
      .sort((a, b) => b.instances - a.instances || a.name.localeCompare(b.name))
      .slice(0, 3)
  }
  const fats = new Map<string, number>()
  for (const c of cards) {
    for (const g of c.ingredients) {
      if (!FAT_RE.test(g.name) || g.inclusionRate < 0.5) continue
      const k = g.name.toLowerCase()
      fats.set(k, (fats.get(k) ?? 0) + 1)
    }
  }
  const known = cards.filter((c) => c.features.homeShare != null)
  const homeShare = known.length ? round(known.reduce((s, c) => s + (c.features.homeShare as number) * c.instanceCount, 0) / known.reduce((s, c) => s + c.instanceCount, 0)) : null
  return {
    cardCount: cards.length,
    instanceTotal,
    topDishes: sorted.slice(0, top).map((c) => ({
      name: c.canonicalName,
      instances: c.instanceCount,
      share: instanceTotal ? round(c.instanceCount / instanceTotal) : 0,
      priorGrams: c.priorGrams,
      portionClassMix: c.portionClassMix,
    })),
    portionClassOverall,
    bySlot,
    cookingFats: [...fats.entries()].map(([name, dishes]) => ({ name, dishes })).sort((a, b) => b.dishes - a.dishes || a.name.localeCompare(b.name)).slice(0, 4),
    homeShare,
  }
}

const pct = (x: number) => `${Math.round(x * 100)}%`
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/** Five deterministic template findings from the digest (mock mode). */
export function mockHabitProfile(d: CardStatsDigest): string {
  const lines: string[] = []
  const top3 = d.topDishes.slice(0, 3)
  if (top3.length) {
    const share = top3.reduce((s, t) => s + t.share, 0)
    lines.push(`Most frequent dishes: ${list(top3.map((t) => `${t.name} (${t.instances}×)`))} — together ${pct(share)} of all ${d.instanceTotal} logged dish instances across ${d.cardCount} dish cards.`)
  }
  const p = d.portionClassOverall
  const dominant = ([...(['usual', 'small', 'large'] as const)] as PortionClass[]).sort((a, b) => p[b] - p[a])[0]
  lines.push(`Portions are usually "${dominant}": small ${pct(p.small)} · usual ${pct(p.usual)} · large ${pct(p.large)} of dish instances (app serving-size prefill unless annotated).`)
  const slotLine = (['breakfast', 'lunch', 'dinner'] as const)
    .filter((s) => d.bySlot[s].length)
    .map((s) => `${s}: ${list(d.bySlot[s].map((x) => x.name))}`)
  if (slotLine.length) lines.push(`Typical dishes by slot — ${slotLine.join('; ')}.`)
  if (d.cookingFats.length) lines.push(`Cooking fats that recur (present in ≥ 50% of a dish's instances): ${list(d.cookingFats.map((f) => `${f.name} (${f.dishes} dish${f.dishes === 1 ? '' : 'es'})`))}.`)
  else lines.push('No cooking fat recurs in ≥ 50% of any dish\'s instances; fats are logged ad hoc.')
  const withPrior = d.topDishes.filter((t) => t.priorGrams != null).slice(0, 4)
  if (withPrior.length) lines.push(`Estimated-grams priors for frequent dishes: ${list(withPrior.map((t) => `${t.name} ≈ ${Math.round(t.priorGrams as number)} g`))} (median of the app's per-ingredient estimates; not weighed).`)
  lines.push(d.homeShare == null ? 'Home vs away is unknown for the whole corpus (location was never logged); treat every meal as location-agnostic.' : `Share of dish instances eaten at home: ${pct(d.homeShare)}.`)
  return lines.slice(0, 8).map((l, i) => `${i + 1}. ${l}`).join('\n')
}
