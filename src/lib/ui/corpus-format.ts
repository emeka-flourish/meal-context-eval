/* Pure helpers for the Corpus screen: the per-meal edit model, the diff that
   turns it into /api/corpus/annotate payloads, and display formatting.
   No DB, no I/O. Tested in corpus-format.test.ts. */
import type {
  AnnotationPayload,
  CorpusTier,
  DishCardDto,
  EditedIngredient,
  PortionClass,
  QueueDish,
  QueueMeal,
  VersionSummary,
} from './corpus-types'

// ---- edit model -----------------------------------------------------------------

export type EditIngredient = {
  key: string
  /** CorpusIngredient id; null for an ingredient added on this screen */
  id: string | null
  name: string
  /** the app's prior — kept for retained ingredients, null for added ones; never edited */
  gramsEst: number | null
}

export type EditDish = {
  dishId: string
  name: string
  portionClass: PortionClass
  removed: boolean
  ingredients: EditIngredient[]
}

let keySeq = 0
export const newKey = (): string => `k${++keySeq}`

export function dishFromQueue(d: QueueDish, prefill: PortionClass): EditDish {
  return {
    dishId: d.id,
    name: d.name,
    portionClass: prefill,
    removed: false,
    ingredients: d.ingredients.map((g) => ({ key: g.id, id: g.id, name: g.name, gramsEst: g.gramsEst })),
  }
}

export function editStateFor(meal: QueueMeal): EditDish[] {
  return meal.dishes.map((d) => dishFromQueue(d, meal.portionClassPrefill))
}

/** Sum of the app's gram priors over a dish's (current) ingredients; null when none are convertible. */
export function priorGrams(ings: { gramsEst: number | null }[]): number | null {
  let sum = 0
  let any = false
  for (const g of ings) {
    if (typeof g.gramsEst === 'number' && Number.isFinite(g.gramsEst)) {
      sum += g.gramsEst
      any = true
    }
  }
  return any ? Math.round(sum) : null
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ')

/** Did the edit touch the dish's identity or ingredient list (portion class aside)? */
export function dishEdited(orig: QueueDish, cur: EditDish): boolean {
  if (norm(orig.name) !== norm(cur.name)) return true
  const a = orig.ingredients.map((g) => norm(g.name).toLowerCase())
  const b = cur.ingredients.map((g) => norm(g.name).toLowerCase()).filter(Boolean)
  if (a.length !== b.length) return true
  return a.some((n, i) => n !== b[i])
}

export type AnnotatePlan = {
  /** dish-level rows first (the meal stays in the queue if any fail), then the meal-level row */
  payloads: AnnotationPayload[]
  changedDishes: number
  removedDishes: number
}

/** Agree (optionally after Fix): one dish-level annotation per dish that
    changed (portion class vs the prefill, name / ingredients, or removal) and
    one meal-level `agreed`. Grams are never sent for an edited ingredient
    except the app's own prior on retained ones (distill keeps the prior). */
export function planAgree(meal: QueueMeal, edits: EditDish[]): AnnotatePlan {
  const payloads: AnnotationPayload[] = []
  let changedDishes = 0
  let removedDishes = 0
  for (const cur of edits) {
    const orig = meal.dishes.find((d) => d.id === cur.dishId)
    if (!orig) continue
    if (cur.removed) {
      payloads.push({ mealId: meal.id, dishId: cur.dishId, excluded: true })
      removedDishes++
      continue
    }
    const edited = dishEdited(orig, cur)
    const portionChanged = cur.portionClass !== meal.portionClassPrefill
    if (!edited && !portionChanged) continue
    const p: AnnotationPayload = { mealId: meal.id, dishId: cur.dishId, portionClass: cur.portionClass }
    if (edited) {
      const ingredients: EditedIngredient[] = cur.ingredients
        .filter((g) => norm(g.name))
        .map((g) => (typeof g.gramsEst === 'number' ? { name: norm(g.name), gramsEst: g.gramsEst } : { name: norm(g.name) }))
      p.editedJson = { name: norm(cur.name) || orig.name, portionClass: cur.portionClass, ingredients }
    }
    payloads.push(p)
    changedDishes++
  }
  payloads.push({ mealId: meal.id, agreed: true })
  return { payloads, changedDishes, removedDishes }
}

export function planExclude(meal: QueueMeal): AnnotationPayload[] {
  return [{ mealId: meal.id, excluded: true }]
}

/** A Fix must leave something to distill: at least one kept dish with a name. */
export function editsValid(edits: EditDish[]): string | null {
  const kept = edits.filter((d) => !d.removed)
  if (kept.length === 0) return 'every dish is removed — use Exclude instead'
  for (const d of kept) {
    if (!norm(d.name)) return 'a dish has no name'
  }
  return null
}

// ---- display ----------------------------------------------------------------------

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Jul 22" from YYYY-MM-DD (or an ISO timestamp — date part only, no zone shift). */
export function shortDate(ymd: string | null | undefined): string {
  if (!ymd) return '—'
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return ymd
  return `${MONTHS_SHORT[m - 1]} ${d}`
}

/** "Jul 22, 2026" */
export function longDate(ymd: string | null | undefined): string {
  if (!ymd) return '—'
  return `${shortDate(ymd)}, ${ymd.slice(0, 4)}`
}

export function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('en-US').format(Math.round(n))
}

export function pct(share: number | null | undefined): string {
  if (share == null || !Number.isFinite(share)) return '—'
  return `${Math.round(share * 100)}%`
}

/** "usual 71% · large 21% · small 8%" — shares ≥ 1%, largest first. */
export function portionMixLabel(mix: Partial<Record<PortionClass, number>> | null | undefined, max = 3): string {
  if (!mix) return '—'
  const parts = (Object.entries(mix) as [PortionClass, number][])
    .filter(([, v]) => typeof v === 'number' && v >= 0.005)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([k, v]) => `${k} ${pct(v)}`)
  return parts.length ? parts.join(' · ') : '—'
}

/** "breakfast 92% · lunch 7%" — slots ≥ 5%, largest first. */
export function slotMixLabel(mix: DishCardDto['features']['slotMix'] | null | undefined): string {
  if (!mix) return ''
  return Object.entries(mix)
    .filter(([, v]) => typeof v === 'number' && v >= 0.05)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .map(([k, v]) => `${k} ${pct(v as number)}`)
    .join(' · ')
}

/** "21 / 10 / 3" — corrected / confirmed / unconfirmed instance counts. */
export function tierMixLabel(mix: Partial<Record<CorpusTier, number>> | null | undefined): string {
  if (!mix) return '—'
  return `${mix.corrected ?? 0} / ${mix.confirmed ?? 0} / ${mix.unconfirmed ?? 0}`
}

/** "rice 100 · stew base 100 · oil 88 · pepper 41" — top ingredients by inclusion. */
export function ingredientSummary(ings: DishCardDto['ingredients'], max = 4): string {
  return [...ings]
    .sort((a, b) => b.inclusionRate - a.inclusionRate)
    .slice(0, max)
    .map((g) => `${g.name.toLowerCase()} ${Math.round(g.inclusionRate * 100)}`)
    .join(' · ')
}

/** Version ordinal by creation order: the oldest version is v1. */
export function versionOrdinal(versions: VersionSummary[], id: string): number {
  const asc = [...versions].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return asc.findIndex((v) => v.id === id) + 1
}

/** "context v1 · built Sep 17" */
export function versionChip(versions: VersionSummary[], v: VersionSummary | null): string {
  if (!v) return 'no context built yet'
  return `context v${versionOrdinal(versions, v.id)} · built ${shortDate(v.createdAt)}`
}

/** Habit profile text → bullets (numbered or dashed lines, blank lines dropped). */
export function habitBullets(text: string | null | undefined): string[] {
  if (!text) return []
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, '').trim())
    .filter(Boolean)
}

/** Case-insensitive substring search over canonical name + aliases. */
export function matchesSearch(card: DishCardDto, q: string): boolean {
  const s = q.trim().toLowerCase()
  if (!s) return true
  return card.canonicalName.toLowerCase().includes(s) || card.aliases.some((a) => a.toLowerCase().includes(s))
}

export function servingLabel(servingSize: string | null): string {
  if (!servingSize) return 'no serving size'
  return `app: ${servingSize.toLowerCase().replace(/_/g, ' ')}`
}

export function fmtCapacity(d: { capacityMl: number | null; capacityG: number | null }): string {
  const parts: string[] = []
  if (d.capacityMl != null) parts.push(`${fmtInt(d.capacityMl)} ml`)
  if (d.capacityG != null) parts.push(`${fmtInt(d.capacityG)} g`)
  return parts.length ? parts.join(' · ') : '—'
}
