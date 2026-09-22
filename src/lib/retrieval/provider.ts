/* The real ContextProvider (interpret.ts interface) backed by one
   ContextVersion (CORPUS.md §4). Per call:
     image_context  router(image) → names → cascade → top-3 cards
     context_only   no image: cards by slot affinity (slotMix[slot] × instanceCount)
   then cards + habit profile + dishware rendered into the Block 5 slots.
   Returns {hit, cardsRetrieved, method} on top of the ContextFill; interpret
   stamps hit/cardsRetrieved on Decomposition.contextUsed. Cards, profile and
   dishware are loaded once per provider instance (one per run). */
import { db } from '../db'
import type { ContextProvider, ContextResult } from '@/runners/interpret'
import { routeScene, routeSceneV2 } from '@/runners/router'
import type { Vantage } from '../prompt-blocks'
import { CORPUS_CONFIG } from '../corpus/config'
import type { CardIngredient } from '../corpus/cards'
import type { PortionClass, Slot } from '../corpus/load'
import { cascade, indexCards, retrieve, type CardIndex, type CardLike, type CascadeMethod, type Embedder } from './cascade'
import { makeEmbedder } from './embed'

export type ProviderCard = CardLike & {
  lastSeen: string
  portionClassMix: Record<PortionClass, number>
  priorGrams: number | null
  ingredients: CardIngredient[]
  features: { homeShare: number | null; slotMix: Record<Slot, number> }
}
export type ProviderDishware = { name: string; capacityMl: number | null; capacityG: number | null; usedFor: string | null }

export type ContextResultV2 = ContextResult & { method: CascadeMethod | 'slot'; routerNames: string[]; routerDishware: string[] }

const pct = (x: number) => `${Math.round(x * 100)}%`

/* ---- retrieval v2 (pure parts) --------------------------------------------- */
export type RetrievalVersion = 'v1' | 'v2'
export const VOCABULARY_MIN_LOGS = 3
export const VOCABULARY_MAX = 60
export const V2_MAX_CARDS = 5

/** The person's dish vocabulary for router.v2: cards logged ≥ 3 times, most frequent first. */
export function vocabularyOf(cards: ProviderCard[]): string[] {
  return [...cards].filter((c) => c.instanceCount >= VOCABULARY_MIN_LOGS).sort((a, b) => b.instanceCount - a.instanceCount || a.canonicalName.localeCompare(b.canonicalName)).slice(0, VOCABULARY_MAX).map((c) => c.canonicalName)
}

/** known names → their cards (exact, case-insensitive; names not on the list are ignored), in router order. */
export function cardsForKnown(known: string[], cards: ProviderCard[]): ProviderCard[] {
  const byName = new Map(cards.map((c) => [c.canonicalName.trim().toLowerCase(), c]))
  const out: ProviderCard[] = []
  for (const n of known) {
    const c = byName.get(n.trim().toLowerCase())
    if (c && !out.includes(c)) out.push(c)
  }
  return out
}

const COOKING_WATER = /^(hot |boiling |cold )?water$/i

/* ---- rendering (pure) ---------------------------------------------------- */
/** v2 rendering: as-served wording — cooking water is not listed as an ingredient (v1 cards read like recipes,
    "rolled oats (dry) 30 g + water 200 g", and the models answered in recipe form). */
export function renderCardV2(c: ProviderCard): string {
  return renderCard({ ...c, ingredients: c.ingredients.filter((g) => !COOKING_WATER.test(g.name.trim())) }).replace('usual ingredients (inclusion rate, typical grams)', 'usual ingredients as logged (inclusion rate, typical grams; the typical total above is the served weight, cooking water included)')
}

export function renderCard(c: ProviderCard): string {
  const aliases = c.aliases.length ? ` (also logged as: ${c.aliases.slice(0, 6).join(', ')}${c.aliases.length > 6 ? ', …' : ''})` : ''
  const pc = c.portionClassMix
  const slots = (Object.entries(c.features.slotMix) as [Slot, number][])
    .filter(([, v]) => v >= 0.05)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${pct(v)}`)
    .join(' · ')
  const ingr = c.ingredients
    .filter((g) => g.inclusionRate >= 0.2)
    .slice(0, 10)
    .map((g) => `${g.name} (${pct(g.inclusionRate)}${g.medianGramsEst != null ? `, ≈${Math.round(g.medianGramsEst)} g` : ''})`)
    .join(' · ')
  return [
    `Dish card: ${c.canonicalName}${aliases} — logged ${c.instanceCount}×, last ${c.lastSeen}`,
    `  usual portion: small ${pct(pc.small)} · usual ${pct(pc.usual)} · large ${pct(pc.large)}${c.priorGrams != null ? `; typical total ≈ ${Math.round(c.priorGrams)} g (estimated prior, not weighed)` : ''}`,
    ingr ? `  usual ingredients (inclusion rate, typical grams): ${ingr}` : '  usual ingredients: (none recorded)',
    slots ? `  when: ${slots}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export function renderDishware(rows: ProviderDishware[]): string {
  return rows
    .map((d) => {
      const cap = [d.capacityMl != null ? `${d.capacityMl} ml` : null, d.capacityG != null ? `${d.capacityG} g` : null].filter(Boolean).join(' / ')
      return `- ${d.name}${cap ? ` — capacity ${cap}` : ''}${d.usedFor ? `; used for ${d.usedFor}` : ''}`
    })
    .join('\n')
}

export function cardsBySlot(cards: ProviderCard[], slot: Slot, k: number): ProviderCard[] {
  return [...cards]
    .map((c) => ({ c, s: (c.features.slotMix[slot] ?? 0) * c.instanceCount }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.c.canonicalName.localeCompare(b.c.canonicalName))
    .slice(0, k)
    .map((x) => x.c)
}

export function slotOfTime(eatenAt: Date): Slot {
  const h = eatenAt.getHours()
  if (h < 10.5) return 'breakfast'
  if (h < 15) return 'lunch'
  if (h < 21) return 'dinner'
  return 'snack'
}

/* ---- provider ------------------------------------------------------------ */
export class DbContextProvider implements ContextProvider {
  private loaded: Promise<{ cards: ProviderCard[]; index: CardIndex; habitProfile: string; dishware: ProviderDishware[] }> | null = null
  private embed: Embedder | undefined

  constructor(
    readonly contextVersionId: string,
    readonly runId?: string,
    readonly retrievalVersion: RetrievalVersion = 'v1',
  ) {
    this.embed = makeEmbedder() ?? undefined
  }

  private load() {
    if (!this.loaded) {
      this.loaded = (async () => {
        const v = await db.contextVersion.findUnique({
          where: { id: this.contextVersionId },
          include: { cards: { orderBy: [{ instanceCount: 'desc' }, { canonicalName: 'asc' }] }, dishware: { orderBy: { name: 'asc' } } },
        })
        if (!v) throw new Error(`context version ${this.contextVersionId} not found`)
        const cards: ProviderCard[] = v.cards.map((c) => ({
          id: c.id,
          canonicalName: c.canonicalName,
          aliases: c.aliases,
          instanceCount: c.instanceCount,
          lastSeen: c.lastSeen.toISOString().slice(0, 10),
          portionClassMix: c.portionClassMix as Record<PortionClass, number>,
          priorGrams: c.priorGrams,
          ingredients: c.ingredients as unknown as CardIngredient[],
          features: c.features as ProviderCard['features'],
        }))
        return { cards, index: indexCards(cards), habitProfile: v.habitProfile ?? '', dishware: v.dishware }
      })()
    }
    return this.loaded
  }

  /** Resolve arbitrary names (routine rule, queue) with this version's index. */
  async match(name: string) {
    const { index } = await this.load()
    return cascade(name, index, { tokenOverlapMin: CORPUS_CONFIG.tokenOverlapMin, embedCosineMin: CORPUS_CONFIG.embedCosineMin, embed: this.embed })
  }

  async getContext(scene: { id: string; mealId: string; index: number }, vantage: Vantage | null): Promise<ContextResultV2> {
    const { cards, index, habitProfile, dishware } = await this.load()
    let picked: ProviderCard[] = []
    let method: CascadeMethod | 'slot' = 'none'
    let routerNames: string[] = []
    let routerDishware: string[] = []
    if (vantage && this.retrievalVersion === 'v2') {
      // v2: the router picks from the person's own dish names; free names fall back to the cascade, but a
      // fallback card must have been logged at least twice.
      const r = await routeSceneV2({ sceneId: scene.id, vantage, runId: this.runId, vocabulary: vocabularyOf(cards) })
      routerNames = [...r.known_dishes, ...r.other_dishes]
      routerDishware = r.dishware
      picked = cardsForKnown(r.known_dishes, cards)
      method = picked.length ? 'exact' : 'none'
      if (r.other_dishes.length && picked.length < V2_MAX_CARDS) {
        const res = await retrieve(r.other_dishes, index, { tokenOverlapMin: CORPUS_CONFIG.tokenOverlapMin, embedCosineMin: CORPUS_CONFIG.embedCosineMin, embed: this.embed, topK: V2_MAX_CARDS })
        for (const id of res.cardIds) {
          const c = cards.find((x) => x.id === id)!
          if (c.instanceCount >= 2 && !picked.includes(c) && picked.length < V2_MAX_CARDS) picked.push(c)
        }
        if (method === 'none' && picked.length) method = res.method
      }
      picked = picked.slice(0, V2_MAX_CARDS)
    } else if (vantage) {
      const r = await routeScene({ sceneId: scene.id, vantage, runId: this.runId })
      routerNames = r.dish_names
      routerDishware = r.dishware
      const res = await retrieve(routerNames, index, { tokenOverlapMin: CORPUS_CONFIG.tokenOverlapMin, embedCosineMin: CORPUS_CONFIG.embedCosineMin, embed: this.embed, topK: CORPUS_CONFIG.topK })
      picked = res.cardIds.map((id) => cards.find((c) => c.id === id)!)
      method = res.method
    } else {
      const meal = await db.meal.findUnique({ where: { id: scene.mealId }, select: { eatenAt: true, mealType: true } })
      const slot: Slot = (meal?.mealType as Slot | null) ?? (meal ? slotOfTime(meal.eatenAt) : 'dinner')
      picked = cardsBySlot(cards, slot, CORPUS_CONFIG.topK)
      method = picked.length ? 'slot' : 'none'
    }
    return {
      dishCards: picked.map(this.retrievalVersion === 'v2' ? renderCardV2 : renderCard).join('\n\n'),
      habitProfile,
      dishware: renderDishware(dishware),
      hit: picked.length > 0 && method !== 'slot',
      cardsRetrieved: picked.map((c) => c.canonicalName),
      method,
      routerNames,
      routerDishware,
    }
  }
}
