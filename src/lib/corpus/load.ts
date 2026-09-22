/* Corpus loader — pure mapping (docs/CORPUS.md §1). Turns one exported meal
   record (meals.jsonl line, or a CSV row with the columns documented in docs/CORPUS.md) into the CorpusMeal / CorpusDish /
   CorpusIngredient shape. No db, no fs: the script (scripts/load-corpus.ts)
   owns I/O and idempotency.

   Rules (CORPUS.md §1):
     * cutoff — any localDate ≥ CORPUS_CUTOFF_EXCLUSIVE is REFUSED (throws)
     * slot from meal_type (Breakfast/Lunch/Dinner/Snack)
     * portionClassPrefill: SNACK/SMALL → small · STANDARD → usual · LARGE/EXTRA_LARGE → large
     * gramsEst: unit table (src/lib/units.ts) on amount+unit → unit_table;
       else amount when the unit is g (or ml ≈ g, the app's own liquid figures) → app_estimate;
       else null → none. A prior, never a truth value.
     * tier: confirmed when is_confirmed, else unconfirmed
   NOTE: relative imports only (no db) so vitest loads it without stubs. */
import { estimateGrams, normalizeUnit, type UnitKey } from '../units'
import { normalizeIngredientName } from '../fdc'

/** First local date OUTSIDE the corpus window: the loader refuses it and anything later. */
export const CORPUS_CUTOFF_EXCLUSIVE = process.env.CORPUS_CUTOFF_EXCLUSIVE ?? '9999-12-31'

export type Slot = 'breakfast' | 'lunch' | 'dinner' | 'snack'
export type PortionClass = 'small' | 'usual' | 'large'
export type GramsSource = 'app_estimate' | 'unit_table' | 'none'
export type Tier = 'corrected' | 'confirmed' | 'unconfirmed'

/** One exported meal (meals.jsonl record = CSV row mapped by the exporter). */
export type MealRecord = {
  mealId: string
  name?: string | null
  description?: string | null
  mealTypeName?: string | null
  estimatedServingSize?: string | null
  summaryDateInUserTime?: string | null
  timestampInUserTimezone?: string | null
  isConfirmed?: boolean | null
  imageUrl?: string | null
  imageFile?: string | null
  imageSha256?: string | null
  dishes?: DishRecord[] | null
}
export type DishRecord = {
  dishId?: string | null
  name?: string | null
  description?: string | null
  preparation?: string | null
  estimatedServingSize?: string | null
  ingredients?: IngredientRecord[] | null
}
export type IngredientRecord = {
  name?: string | null
  amount?: number | string | null
  unit?: string | null
  notes?: string | null
}

export type CorpusIngredientInput = {
  name: string
  amount: number | null
  unit: string | null
  notes: string | null
  gramsEst: number | null
  gramsSource: GramsSource
  order: number
}
export type CorpusDishInput = {
  name: string
  description: string | null
  preparation: string | null
  servingSize: string | null
  order: number
  ingredients: CorpusIngredientInput[]
}
export type CorpusMealInput = {
  sourceMealId: string
  localDate: string // YYYY-MM-DD
  localTime: string // HH:MM
  slot: Slot
  name: string
  description: string | null
  servingSize: string | null
  portionClassPrefill: PortionClass
  imageFile: string | null
  imageSha256: string | null
  tier: Tier
  dishes: CorpusDishInput[]
}

/* ---- CSV row → MealRecord  */
export type CsvRowLike = Record<string, string | undefined>

/** pgAdmin writes SQL NULL as an empty cell or the literal `NULL`. */
export function isNullCell(v: string | undefined): boolean {
  return v === undefined || v === '' || v.trim().toUpperCase() === 'NULL'
}
const nul = (v: string | undefined): string | null => (isNullCell(v) ? null : (v as string))
const bool = (v: string | undefined): boolean => ['true', 't', '1'].includes((v ?? '').trim().toLowerCase())

export function csvRowToRecord(row: CsvRowLike): MealRecord {
  const mealId = (row.meal_id ?? '').trim()
  if (!mealId) throw new Error('CSV row has no meal_id')
  let dishes: DishRecord[] = []
  if (!isNullCell(row.dishes)) {
    let parsed: unknown
    try {
      parsed = JSON.parse((row.dishes as string).trim())
    } catch (e) {
      throw new Error(`${mealId}: dishes column is not valid JSON: ${e instanceof Error ? e.message : String(e)}`)
    }
    if (parsed !== null && !Array.isArray(parsed)) throw new Error(`${mealId}: dishes column is not a JSON array`)
    dishes = ((parsed ?? []) as Record<string, unknown>[]).map((d, i) => ({
      dishId: d.dish_id != null ? String(d.dish_id) : `${mealId}#${i}`,
      name: (d.name as string) ?? null,
      description: (d.description as string) ?? null,
      estimatedServingSize: (d.serving_size as string) ?? null,
      preparation: (d.preparation as string) ?? null,
      ingredients: (Array.isArray(d.ingredients) ? (d.ingredients as Record<string, unknown>[]) : []).map((g) => ({
        name: (g.name as string) ?? null,
        amount: (g.amount as number | string) ?? null,
        unit: (g.unit as string) ?? null,
        notes: (g.notes as string) ?? null,
      })),
    }))
  }
  return {
    mealId,
    name: nul(row.name),
    description: nul(row.description),
    mealTypeName: nul(row.meal_type),
    estimatedServingSize: nul(row.serving_size),
    isConfirmed: bool(row.is_confirmed),
    timestampInUserTimezone: nul(row.local_time),
    summaryDateInUserTime: nul(row.local_date),
    imageUrl: nul(row.image_url),
    imageFile: null,
    imageSha256: null,
    dishes,
  }
}

/* ---- field mappers ----------------------------------------------------------- */
export function slotOf(mealTypeName: string | null | undefined): Slot {
  const s = (mealTypeName ?? '').trim().toLowerCase()
  if (s === 'breakfast' || s === 'lunch' || s === 'dinner' || s === 'snack') return s
  if (s.includes('breakfast')) return 'breakfast'
  if (s.includes('lunch')) return 'lunch'
  if (s.includes('dinner') || s.includes('supper')) return 'dinner'
  return 'snack'
}

export function portionClassOf(servingSize: string | null | undefined): PortionClass {
  const s = (servingSize ?? '').trim().toUpperCase()
  if (s === 'SNACK' || s === 'SMALL') return 'small'
  if (s === 'LARGE' || s === 'EXTRA_LARGE') return 'large'
  return 'usual' // STANDARD and anything unknown/empty
}

/** YYYY-MM-DD from the record: summaryDateInUserTime, else the date part of the local timestamp. */
export function localDateOf(rec: MealRecord): string {
  const d = (rec.summaryDateInUserTime ?? '').slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d
  const t = (rec.timestampInUserTimezone ?? '').slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  throw new Error(`${rec.mealId}: no local date (summaryDateInUserTime / timestampInUserTimezone)`)
}

/** HH:MM from "2026-04-10 09:00:00" / "2026-04-10T09:00:00…"; "00:00" when absent. */
export function localTimeOf(rec: MealRecord): string {
  const m = (rec.timestampInUserTimezone ?? '').match(/(\d{2}):(\d{2})/)
  return m ? `${m[1]}:${m[2]}` : '00:00'
}

export function parseAmount(v: number | string | null | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (!s) return null
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/)
  if (frac) return Number(frac[1]) / Number(frac[2])
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const HEAD_NOUN_UNITS = new Set(['egg', 'avocado', 'banana', 'apple', 'orange', 'potato', 'plantain', 'fruit', 'whole'])

/** gramsEst for one ingredient (CORPUS.md §1). Multi-word units ("medium
    banana", "large egg") use their size word; a unit that IS the food
    ("egg", "avocado", "whole") means one piece. */
export function gramsFor(name: string, amount: number | null, unit: string | null): { gramsEst: number | null; gramsSource: GramsSource } {
  if (amount == null || amount <= 0) return { gramsEst: null, gramsSource: 'none' }
  const u = (unit ?? '').trim().toLowerCase()
  if (u === 'g' || u === 'gram' || u === 'grams' || u === 'ml' || u === 'milliliter' || u === 'milliliters') {
    return { gramsEst: round1(amount), gramsSource: 'app_estimate' }
  }
  const food = normalizeIngredientName(name)
  const tokens = u.split(/[\s-]+/).filter(Boolean)
  let key: UnitKey | null = null
  for (const t of tokens) {
    const k = normalizeUnit(t)
    if (k) {
      key = k
      break
    }
  }
  if (!key && tokens.length > 0) {
    const last = tokens[tokens.length - 1]
    const singular = last.replace(/s$/, '')
    if (HEAD_NOUN_UNITS.has(singular) || food.includes(singular)) key = 'piece'
  }
  if (!key) return { gramsEst: null, gramsSource: 'none' }
  // food key: the ingredient name, else the unit's own noun ("medium banana" on "Banana (ripe)")
  const candidates = [food, ...tokens.filter((t) => !normalizeUnit(t)).map((t) => t.replace(/s$/, ''))]
  for (const c of candidates) {
    const est = estimateGrams(c, amount, key) // null unless the table knows food×unit (or a food-independent volume unit)
    if (est) return { gramsEst: round1(est.grams), gramsSource: 'unit_table' }
  }
  return { gramsEst: null, gramsSource: 'none' }
}
const round1 = (n: number) => Math.round(n * 10) / 10

/* ---- record → CorpusMealInput ----------------------------------------------- */
export class CutoffError extends Error {
  constructor(
    public mealId: string,
    public localDate: string,
  ) {
    super(`${mealId}: localDate ${localDate} is on/after the corpus cutoff ${CORPUS_CUTOFF_EXCLUSIVE} — refused`)
  }
}

export function mapMeal(rec: MealRecord): CorpusMealInput {
  if (!rec.mealId) throw new Error('meal record has no mealId')
  const localDate = localDateOf(rec)
  if (localDate >= CORPUS_CUTOFF_EXCLUSIVE) throw new CutoffError(rec.mealId, localDate)
  const dishes: CorpusDishInput[] = (rec.dishes ?? []).map((d, di) => ({
    name: (d.name ?? '').trim() || `dish ${di + 1}`,
    description: d.description?.trim() || null,
    preparation: d.preparation?.trim() || null,
    servingSize: d.estimatedServingSize?.trim() || null,
    order: di,
    ingredients: (d.ingredients ?? []).map((g, gi) => {
      const name = (g.name ?? '').trim() || `ingredient ${gi + 1}`
      const amount = parseAmount(g.amount)
      const unit = g.unit?.trim() || null
      return { name, amount, unit, notes: g.notes?.trim() || null, order: gi, ...gramsFor(name, amount, unit) }
    }),
  }))
  return {
    sourceMealId: rec.mealId,
    localDate,
    localTime: localTimeOf(rec),
    slot: slotOf(rec.mealTypeName),
    name: (rec.name ?? '').trim() || dishes[0]?.name || '(unnamed meal)',
    description: rec.description?.trim() || null,
    servingSize: rec.estimatedServingSize?.trim() || null,
    portionClassPrefill: portionClassOf(rec.estimatedServingSize),
    imageFile: rec.imageFile?.trim() || null,
    imageSha256: rec.imageSha256?.trim() || null,
    tier: rec.isConfirmed ? 'confirmed' : 'unconfirmed',
    dishes,
  }
}

/* ---- idempotency plan ---------------------------------------------------------
   Existing meals are matched by sourceMealId. Dishes/ingredients are written
   once (they never change in the export); a re-run only refreshes the meal's
   scalar fields — in particular imageFile/imageSha256 once the image step ran.
   tier/excluded are annotation-owned and never touched on update. */
export type ExistingMeal = {
  sourceMealId: string
  name: string
  description: string | null
  servingSize: string | null
  imageFile: string | null
  imageSha256: string | null
  dishCount: number
}
export type MealPatch = Partial<Pick<CorpusMealInput, 'name' | 'description' | 'servingSize' | 'imageFile' | 'imageSha256'>>
export type PlanEntry =
  | { action: 'create'; meal: CorpusMealInput }
  | { action: 'update'; sourceMealId: string; patch: MealPatch }
  | { action: 'unchanged'; sourceMealId: string }

export function planMeal(meal: CorpusMealInput, existing: ExistingMeal | undefined): PlanEntry {
  if (!existing) return { action: 'create', meal }
  const patch: MealPatch = {}
  if (existing.name !== meal.name) patch.name = meal.name
  if (existing.description !== meal.description) patch.description = meal.description
  if (existing.servingSize !== meal.servingSize) patch.servingSize = meal.servingSize
  // an image is only ever picked up, never dropped by a later run without one
  if (meal.imageFile && existing.imageFile !== meal.imageFile) patch.imageFile = meal.imageFile
  if (meal.imageSha256 && existing.imageSha256 !== meal.imageSha256) patch.imageSha256 = meal.imageSha256
  return Object.keys(patch).length === 0 ? { action: 'unchanged', sourceMealId: meal.sourceMealId } : { action: 'update', sourceMealId: meal.sourceMealId, patch }
}

export type LoadSummary = {
  create: number
  update: number
  unchanged: number
  meals: number
  dishes: number
  ingredients: number
  gramsBySource: Record<GramsSource, number>
  bySlot: Record<Slot, number>
  byPortionClass: Record<PortionClass, number>
  withImage: number
  dateRange: { start: string; end: string } | null
}

export function summarize(meals: CorpusMealInput[], plan: PlanEntry[]): LoadSummary {
  const s: LoadSummary = {
    create: 0,
    update: 0,
    unchanged: 0,
    meals: meals.length,
    dishes: 0,
    ingredients: 0,
    gramsBySource: { app_estimate: 0, unit_table: 0, none: 0 },
    bySlot: { breakfast: 0, lunch: 0, dinner: 0, snack: 0 },
    byPortionClass: { small: 0, usual: 0, large: 0 },
    withImage: 0,
    dateRange: null,
  }
  for (const p of plan) s[p.action]++
  const dates: string[] = []
  for (const m of meals) {
    dates.push(m.localDate)
    s.bySlot[m.slot]++
    s.byPortionClass[m.portionClassPrefill]++
    if (m.imageFile) s.withImage++
    for (const d of m.dishes) {
      s.dishes++
      for (const g of d.ingredients) {
        s.ingredients++
        s.gramsBySource[g.gramsSource]++
      }
    }
  }
  dates.sort()
  if (dates.length) s.dateRange = { start: dates[0], end: dates[dates.length - 1] }
  return s
}
