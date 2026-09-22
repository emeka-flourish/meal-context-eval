// FDC identity layer (risk R4): both GT and pipeline nutrient calc resolve
// ingredient names through FdcAlias so one name maps to one identity.
// Works without FDC_API_KEY (deterministic mock mode) so the console runs
// offline and in CI.
//
// NOTE: imports use relative paths (not '@/lib/...') so vitest can run this
// module without an alias config — see fdc.test.ts.

import { db } from './db'

export type Per100g = {
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
}

/** Per100g plus the fiber the search response carries (nutrient 1079). */
export type Per100gWithFiber = Per100g & { fiber_g?: number }

export type FdcMatch = {
  fdcId: number
  description: string
  dataType: string
  per100g: Per100gWithFiber
}

export type Resolution = {
  kind: 'fdc' | 'custom_food'
  fdcId?: number
  customFoodId?: string
  /** fiber_g is carried through when the cached pick recorded it */
  per100g: Per100gWithFiber
}

// lowercase, strip parentheticals, collapse whitespace, trim
export function normalizeIngredientName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Crude English singular for matching ("blueberries"→"blueberry",
    "potatoes"→"potato", "beans"→"bean"). NOT applied to alias keys —
    normalizeIngredientName is the identity key of the whole alias layer and
    changing it would orphan stored rows; this is a comparison helper only. */
export function singularize(word: string): string {
  if (word.length <= 3) return word
  if (/ies$/.test(word)) return word.slice(0, -3) + 'y'
  if (/(oes|ches|shes|xes|sses)$/.test(word)) return word.slice(0, -2)
  if (/(ss|us|is)$/.test(word)) return word
  if (/s$/.test(word)) return word.slice(0, -1)
  return word
}

export function parsePer100g(value: unknown): Per100g | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  const fields = ['kcal', 'protein_g', 'carbs_g', 'fat_g'] as const
  for (const f of fields) {
    if (typeof v[f] !== 'number' || !Number.isFinite(v[f])) return null
  }
  return { kcal: v.kcal, protein_g: v.protein_g, carbs_g: v.carbs_g, fat_g: v.fat_g } as Per100g
}

// --- search -----------------------------------------------------------------

const FDC_SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search'

/** 25, not 5: for plain names the top-5 are dishes ("Lomi salmon", "Salmon
    salad", "Sweet potato tots") and the picker rightly rejects them; the plain
    rows ("Fish, salmon, NFS", "Sweet potato, NFS") sit further down
    (verified 2026-09-17 against the live API — fixtures in __fixtures__/fdc-search). */
export const FDC_PAGE_SIZE = 25
export const FDC_DATA_TYPES = 'Foundation,SR Legacy,Survey (FNDDS)'

// nutrientNumber → Per100g key (values are per 100 g in the search response)
// The search response labels each nutrient two ways: `nutrientId` (1008 = Energy) and
// `nutrientNumber` ('208' = Energy). Earlier code keyed this table by id but read
// nutrientNumber, so every extraction returned zeros (found 2026-09-17). Both keys now map.
const NUTRIENT_KEYS: Record<string, keyof Per100gWithFiber> = {
  '1008': 'kcal', '208': 'kcal', // Energy (kcal)
  '1003': 'protein_g', '203': 'protein_g', // Protein
  '1005': 'carbs_g', '205': 'carbs_g', // Carbohydrate, by difference
  '1004': 'fat_g', '204': 'fat_g', // Total lipid (fat)
  '1079': 'fiber_g', '291': 'fiber_g', // Fiber, total dietary
}
// Foundation rows carry NO nutrient 1008; their energy is 2048 (Atwater
// Specific Factors) and/or 2047 (Atwater General). Used only when 1008 is absent.
const ENERGY_FALLBACK_RANK: Record<string, number> = {
  '2048': 1, '958': 1, // Atwater Specific Factors (preferred)
  '2047': 2, '957': 2, // Atwater General Factors
}

export type FdcApiNutrient = {
  nutrientId?: number
  nutrientName?: string
  nutrientNumber?: string
  value?: number
  unitName?: string
}

export type FdcApiFood = {
  fdcId: number
  description: string
  dataType: string
  foodNutrients?: FdcApiNutrient[]
}

export function extractPer100g(nutrients: FdcApiNutrient[]): Per100gWithFiber {
  const out: Per100gWithFiber = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  let sawEnergy = false
  let fallbackRank = Infinity
  let fallbackKcal: number | null = null
  for (const n of nutrients) {
    if (typeof n.value !== 'number') continue
    const ids = [n.nutrientId != null ? String(n.nutrientId) : null, n.nutrientNumber ?? null]
    const key = ids.map((id) => (id ? NUTRIENT_KEYS[id] : undefined)).find(Boolean)
    if (key) {
      // Energy sometimes appears twice (kcal and kJ); keep the KCAL row only.
      if (key === 'kcal') {
        if (n.unitName && n.unitName.toUpperCase() !== 'KCAL') continue
        sawEnergy = true
      }
      out[key] = n.value
      continue
    }
    const rank = ids.map((id) => (id ? ENERGY_FALLBACK_RANK[id] : undefined)).find((r) => r != null)
    if (rank != null && rank < fallbackRank && (!n.unitName || n.unitName.toUpperCase() === 'KCAL')) {
      fallbackRank = rank
      fallbackKcal = n.value
    }
  }
  if (!sawEnergy && fallbackKcal != null) out.kcal = fallbackKcal
  return out
}

/** Thrown when the FDC search endpoint could not be used (throttled, 5xx,
    non-JSON body, network) after all retries — distinct from "no match" (an
    empty list). Callers must not treat it as "unresolved". */
export class FdcSearchUnavailableError extends Error {
  readonly status: number | null
  readonly attempts: number
  constructor(message: string, status: number | null, attempts: number) {
    super(message)
    this.name = 'FdcSearchUnavailableError'
    this.status = status
    this.attempts = attempts
  }
}

export const FDC_MAX_ATTEMPTS = 3
/** Backoff before attempt 2 and 3 (2 s, 6 s — the edge's HTML-400 answers clear within seconds;
    verified 2026-09-17: 7 names that failed 3 quick tries all resolved on an immediate second pass).
    Overridable for tests (FDC_RETRY_DELAYS_MS="0,0"). */
function retryDelaysMs(): number[] {
  const env = process.env.FDC_RETRY_DELAYS_MS
  if (env) return env.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n))
  return [2000, 6000]
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

type FetchOutcome = { ok: true; foods: FdcApiFood[] } | { ok: false; status: number | null; reason: string; retry: boolean }

/** What is sent to FDC's search box. FDC parses "/" (and the other search
    operators) itself and answers a JSON 400 "Invalid request" for
    "turmeric/curry seasoning blend dry" ; the cache and
    alias keys keep the normalized name, only the wire text is scrubbed. */
export function fdcSearchText(query: string): string {
  return query
    .replace(/[\/\\()"*+:^~\[\]{}|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchOnce(query: string): Promise<FetchOutcome> {
  // POST with a JSON body, not GET with query parameters: the api.data.gov edge
  // answered a GET whose dataType carried "Survey (FNDDS)" with an nginx HTML
  // 400 about half the time (observed in testing: 8 of 16 GETs vs 0 of 16 POSTs).
  const params = new URLSearchParams({ api_key: process.env.FDC_API_KEY ?? '' })
  let res: Response
  try {
    res = await fetch(`${FDC_SEARCH_URL}?${params.toString()}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: fdcSearchText(query), pageSize: FDC_PAGE_SIZE, dataType: FDC_DATA_TYPES.split(',') }),
    })
  } catch (e) {
    return { ok: false, status: null, reason: `network: ${(e as Error).message}`, retry: true }
  }
  // 429 = throttled (1000/hour); 5xx = upstream; the edge also answers a
  // throttled burst with an nginx HTML "400 Bad Request" page (seen 2026-09-17),
  // so any non-JSON body is treated as a transient failure too.
  const text = await res.text()
  let body: { foods?: FdcApiFood[] } | null = null
  try {
    body = JSON.parse(text) as { foods?: FdcApiFood[] }
  } catch {
    body = null
  }
  if (res.ok && body && typeof body === 'object') return { ok: true, foods: body.foods ?? [] }
  if (body === null) {
    console.warn(`[fdc] non-JSON ${res.status} for "${query}": ${text.replace(/\s+/g, ' ').slice(0, 160)}`)
    return { ok: false, status: res.status, reason: `non-JSON body (${res.status})`, retry: true }
  }
  if (res.status === 429 || res.status >= 500) return { ok: false, status: res.status, reason: `HTTP ${res.status}`, retry: true }
  // a JSON 4xx (bad key, bad params) will not get better on retry
  return { ok: false, status: res.status, reason: `HTTP ${res.status}: ${text.slice(0, 200)}`, retry: false }
}

// FoodData Central allows 1,000 requests per key per hour. A run fans out dozens of novel
// predicted names at once; without pacing the API throttles (non-JSON 400s) and every cell
// fails with "unavailable". Serialize live searches at one per FDC_MIN_INTERVAL_MS (default
// 4 s ≈ 900/hour). The search cache means each distinct query is fetched once.
const FDC_MIN_INTERVAL_MS = Number(process.env.FDC_MIN_INTERVAL_MS ?? (process.env.VITEST ? 0 : 4000)) // no pacing under the test runner (fake fetch)
// The gate lives on globalThis (the Prisma-singleton pattern): the Next dev
// server bundles this module once per route chunk and again on every hot
// reload, and module-level state gave each copy its own gate — testing
// showed fetches 0.6 s apart and the edge answering with HTML 400s.
type FdcGate = { chain: Promise<void>; lastAt: number }
const g = globalThis as unknown as { __fdcGate?: FdcGate }
const fdcGate: FdcGate = (g.__fdcGate ??= { chain: Promise.resolve(), lastAt: 0 })
function paced<T>(fn: () => Promise<T>): Promise<T> {
  const run = fdcGate.chain.then(async () => {
    const wait = fdcGate.lastAt + FDC_MIN_INTERVAL_MS - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    fdcGate.lastAt = Date.now()
  })
  fdcGate.chain = run.catch(() => {})
  return run.then(fn)
}

export async function fetchFromFdc(query: string): Promise<FdcMatch[]> {
  return paced(() => fetchFromFdcNow(query))
}

async function fetchFromFdcNow(query: string): Promise<FdcMatch[]> {
  const delays = retryDelaysMs()
  let last: Extract<FetchOutcome, { ok: false }> | null = null
  let attempts = 0
  for (let attempt = 1; attempt <= FDC_MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) await sleep(delays[attempt - 2] ?? delays[delays.length - 1] ?? 0)
    attempts = attempt
    const out = await fetchOnce(query)
    if (out.ok) {
      return out.foods.map((f) => ({
        fdcId: f.fdcId,
        description: f.description,
        dataType: f.dataType,
        per100g: extractPer100g(f.foodNutrients ?? []),
      }))
    }
    last = out
    if (!out.retry) break
  }
  throw new FdcSearchUnavailableError(
    `FDC search unavailable for "${query}": ${last?.reason ?? 'unknown'}`,
    last?.status ?? null,
    attempts,
  )
}

// Deterministic offline stand-ins: same query → same matches, negative fdcIds
// so they can never collide with real FDC ids.
function mockMatches(query: string): FdcMatch[] {
  let seed = 0
  for (const ch of query) seed = (seed * 31 + ch.charCodeAt(0)) % 997
  const variants = ['raw', 'cooked', 'generic'] as const
  return variants.map((variant, i) => {
    const kcal = 60 + ((seed + i * 53) % 240)
    return {
      fdcId: -(i + 1),
      description: `[MOCK] ${query}, ${variant}`,
      dataType: 'Survey (FNDDS)',
      per100g: {
        kcal,
        protein_g: Math.round(kcal * 0.08 * 10) / 10,
        carbs_g: Math.round(kcal * 0.12 * 10) / 10,
        fat_g: Math.round(kcal * 0.04 * 10) / 10,
      },
    }
  })
}

// Cache is valid forever (study stability: a query must resolve identically
// across the whole study window). Mock results are NOT cached so a later-added
// real API key isn't shadowed by stored mocks. A search failure (typed
// FdcSearchUnavailableError) propagates and is never cached either.
export async function searchFdc(query: string): Promise<FdcMatch[]> {
  const normalized = normalizeIngredientName(query)
  const cached = await db.fdcSearchCache.findUnique({ where: { query: normalized } })
  if (cached) return cached.results as FdcMatch[]

  if (!process.env.FDC_API_KEY) return mockMatches(normalized)

  const matches = await fetchFromFdc(normalized)
  await db.fdcSearchCache.upsert({
    where: { query: normalized },
    create: { query: normalized, results: matches },
    update: {}, // a concurrent resolver may have cached the same query first; keep theirs
  })
  return matches
}

// --- alias resolution -------------------------------------------------------

export async function resolveIngredient(name: string): Promise<Resolution | null> {
  const normalizedName = normalizeIngredientName(name)
  const alias = await db.fdcAlias.findUnique({ where: { normalizedName } })
  if (!alias) return null

  const parsed = parsePer100g(alias.per100gCache) ?? { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  const fiber = (alias.per100gCache as { fiber_g?: unknown } | null)?.fiber_g
  const per100g: Per100gWithFiber =
    typeof fiber === 'number' && Number.isFinite(fiber) ? { ...parsed, fiber_g: fiber } : parsed
  if (alias.customFoodId) {
    return { kind: 'custom_food', customFoodId: alias.customFoodId, per100g }
  }
  if (alias.fdcId != null) {
    return { kind: 'fdc', fdcId: alias.fdcId, per100g }
  }
  return null
}

export async function saveAlias(
  name: string,
  pick: { fdcId?: number; customFoodId?: string; per100g: Per100gWithFiber }
): Promise<void> {
  const normalizedName = normalizeIngredientName(name)
  const fields = {
    fdcId: pick.fdcId ?? null,
    customFoodId: pick.customFoodId ?? null,
    per100gCache: pick.per100g,
    pickedAt: new Date(),
  }
  await db.fdcAlias.upsert({
    where: { normalizedName },
    create: { normalizedName, ...fields },
    update: fields,
  })
}
