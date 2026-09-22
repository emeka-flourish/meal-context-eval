/* Level 2 lookup chain (METRICS.md Level 2): one chain, identical on both
   sides, resolved ONCE per run cell and handed to the pure level2() as a
   synchronous NutrientLookup. Order:
     1. alias memory       FdcAlias (state-matched "<name> <state>" first, then name)
     2. custom entry       CustomFood by name / alias — approved entries first
     3. database search    FDC search (pageSize 25) with a query ladder —
                           "<name> <prep>", "<name> <state>", "<name>" — and the
                           deterministic scored pick below (pickFdcCandidate);
                           the pick is saved as an alias under "<name> <state>"
                           so the pair resolves identically next time. Skipped
                           under MOCK_LLM=1 (no network leaves the process) —
                           a deterministic stand-in tagged `estimate` is used.
     4. LLM estimate       runners/nutrientEstimate.ts (real mode only): pinned
                           model, prompt nutrient-estimate.v1, saved as an
                           UNAPPROVED CustomFood + alias, reported as `estimate`.
     -. unavailable        the FDC search itself failed (typed
                           FdcSearchUnavailableError after retries): the name is
                           listed under `unavailable`, NOT estimated and NOT
                           aliased, so a transient throttle never silently
                           replaces a database value with a model guess.
     -. unresolved         nothing matched and no estimate was possible →
                           level2 lists it; the run routes it to the queue.
   Fiber: the search response carries nutrient 1079; alias/custom rows may
   carry `fiber_g`; otherwise fiber = 0. */
import { db } from './db'
import { mockForced } from './llm'
import {
  FdcSearchUnavailableError,
  normalizeIngredientName,
  parsePer100g,
  resolveIngredient,
  saveAlias,
  searchFdc,
  singularize,
  type Per100g,
} from './fdc'
import { estimateFoodName, estimateNutrients, nutrientEstimateWouldMock } from '../runners/nutrientEstimate'
import type { LookupSource, NutrientLookup, Per100 } from './scoring/level2'

export type LookupItem = {
  name: string
  /** cooked | raw | dry (GtItem.state) */
  state?: string
  /** preparation word when the truth item names one (fried, grilled, …) — sharpens the FDC query */
  prep?: string
  components?: string[]
}

export type ResolvedEntry = Per100 & {
  source: LookupSource
  ref?: string
  /** FDC description / custom-food name when known (not known for alias hits) */
  description?: string
}

export type LookupBuild = {
  lookup: NutrientLookup
  resolved: Record<string, ResolvedEntry>
  /** names nothing could resolve (no match, no estimate possible) */
  unresolved: string[]
  /** names whose FDC search failed after retries (throttle / outage) — retry later, never estimated */
  unavailable: string[]
}

export type LookupOptions = {
  /** step 4 (LLM estimate) — default true; verify scripts turn it off to audit FDC coverage first */
  estimate?: boolean
}

export type ResolveOutcome =
  | { status: 'resolved'; entry: ResolvedEntry; step: 'alias' | 'custom' | 'mock' | 'fdc' | 'estimate'; query?: string }
  | { status: 'unresolved'; queries: string[] }
  | { status: 'unavailable'; error: FdcSearchUnavailableError; queries: string[] }

const fiberOf = (raw: unknown): number => {
  const v = (raw as { fiber_g?: unknown } | null)?.fiber_g
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function toPer100(p: Per100g, source: LookupSource, raw: unknown, ref?: string, description?: string): ResolvedEntry {
  return { kcal: p.kcal, protein: p.protein_g, fat: p.fat_g, carb: p.carbs_g, fiber: fiberOf(raw), source, ref, description }
}

/** Deterministic per-100 g stand-in (mock mode only), tagged `estimate`. */
export function mockPer100(name: string): ResolvedEntry {
  let seed = 0
  for (const ch of normalizeIngredientName(name)) seed = (seed * 31 + ch.charCodeAt(0)) % 997
  const kcal = 60 + (seed % 240)
  return {
    kcal,
    protein: Math.round(kcal * 0.08 * 10) / 10,
    carb: Math.round(kcal * 0.12 * 10) / 10,
    fat: Math.round(kcal * 0.04 * 10) / 10,
    fiber: Math.round(kcal * 0.012 * 10) / 10,
    source: 'estimate',
    ref: '[MOCK]',
  }
}

/* ---- FDC candidate scoring ------------------------------------------------
   Deterministic, unit-tested against the real 25-result lists captured in
   src/lib/__fixtures__/fdc-search/*.json (2026-09-17). Score in [0, 1]:
     base       head noun of the query in the description's first two
                comma-segments ("Fish, salmon, …" for "salmon"; "Sweet potato, …")
                0.5 · third segment 0.45 · later 0.3 · absent → 0
     coverage   + 0.2 × share of query words present anywhere; − 0.2 when any
                query word is missing ("lemon pepper" ≠ "Pepper, banana, raw")
     state      + 0.18 the item's prep word ("fried"; a cooking word inside
                the name — "grilled chicken" — counts as prep, not content) ·
                + 0.12 generic state match (cooked/NFS/"NS as to cooking
                method", raw, dry) · + 0.10 a cooking method (baked/grilled/
                roasted/boiled/…) · + 0.06 no state word at all · − 0.15
                contradiction (raw for a cooked item, cooked for raw) · − 0.20
                "fried" when not the prep · no state given: NFS/cooked + 0.08
                (as commonly eaten), raw + 0.06, dry − 0.05
     fiber      − 0.03 when the row carries no fiber value (some Foundation
                rows) so an otherwise equal SR Legacy/Survey row wins
     extras     − 0.05 per extra word that is not a qualifier/category/state
                (cap 0.2) · − 0.15 per extra word in the first segment ("Lomi salmon")
                · − 0.10 when the first segment names something else that is not
                a category word ("Almonds, honey roasted")
     derivative − 0.25 part/derivative words (yolk, white, leaves, candied,
                smoked, pickled, …) · − 0.30 a conjunction of foods ("Beef and
                broccoli", "drumstick and thigh")
     dish       → 0 when a dish/derivative word appears that the query did not
                ask for (salad, cake, patty, sandwich, sushi, roll, tots, pie,
                chips, fries, casserole, bread, soup, sauce, juice, oil, baby
                food, formula, school, frozen meal, …)
     empty      − 0.5 when the row carries no nutrients at all (data-less)
   Ties: Foundation > SR Legacy > Survey, then the shorter description, then
   list order. Accept ≥ 0.6, else fall through. */
export type PickQuery = { name: string; state?: string; prep?: string }
export type PickCandidate = { description: string; dataType?: string; per100g?: Per100g }

export const FDC_ACCEPT = 0.6

const STOP = new Set([
  'ns', 'nfs', 'as', 'to', 'form', 'fat', 'added', 'no', 'cooking', 'method', 'skin', 'eaten', 'from', 'fresh', 'frozen',
  'canned', 'with', 'without', 'in', 'or', 'and', 'made', 'home', 'recipe', 'drained', 'solid', 'bone', 'whole', 'plain',
  'regular', 'large', 'medium', 'small', 'grade', 'a', 'all', 'type', 'commercial', 'commercially', 'prepared',
  'unprepared', 'water', 'salt', 'unsalted', 'salted', 'heat', 'moist', 'only', 'meat', 'flesh', 'broiler', 'fryer',
  'roasting', 'atlantic', 'pacific', 'farmed', 'wild', 'raised', 'u', 'imported', 'average', 'value', 'of', 'the', 'for',
  'use', 'on', 'ingredient', 'style', 'mature', 'edible', 'portion', 'per', 'about', 'not', 'nfd', 'each',
])
// FDC category prefixes: "Fish, sardines, canned"; "Spices, curry powder"; "Nuts, almond butter"; "Squash, summer, zucchini"
// Kept to true hypernyms: a specific food in the first segment ("Beef and
// broccoli", "Almonds, honey roasted") must stay an "extra", never a category.
const CATEGORY = new Set([
  'fish', 'spice', 'beverage', 'vegetable', 'fruit', 'nut', 'grain', 'legume', 'poultry', 'dairy', 'cereal', 'seafood',
  'snack', 'restaurant', 'shellfish', 'herb', 'game', 'lettuce', 'squash', 'mushroom', 'seed', 'sweetener', 'seasoning',
])
const COOKED_GENERIC = new Set(['cooked', 'nfs'])
const COOKED_METHOD = new Set([
  'baked', 'grilled', 'roasted', 'boiled', 'steamed', 'broiled', 'rotisserie', 'stewed', 'sauteed', 'braised', 'poached',
  'microwaved', 'simmered', 'scrambled', 'pan', 'roast', 'grill', 'bake', 'boil', 'steam', 'stew', 'braise',
])
const RAW = new Set(['raw', 'uncooked'])
const DRY = new Set(['dry', 'dried', 'uncooked', 'dehydrated'])
const FRIED = new Set(['fried', 'fry'])
const PART_OR_DERIVATIVE = new Set([
  'yolk', 'white', 'leaf', 'leave', 'peel', 'shell', 'stem', 'flake', 'toasted', 'candied', 'glazed', 'sweetened', 'pickled',
  'smoked', 'breaded', 'coated', 'battered', 'stuffed', 'creamed', 'dehydrated', 'mashed', 'flavored', 'reduced', 'sugar',
  'light', 'lite', 'free', 'diet', 'imitation', 'substitute', 'mix', 'dice', 'strained', 'junior', 'toddler',
])
const DISH = new Set([
  'salad', 'cake', 'patty', 'sandwich', 'sushi', 'roll', 'tot', 'pie', 'chip', 'fry', 'casserole', 'bread', 'soup',
  'sauce', 'juice', 'oil', 'formula', 'school', 'dressing', 'dip', 'spread', 'cookie', 'cracker', 'muffin', 'bagel',
  'pancake', 'waffle', 'bar', 'candy', 'candie', 'dessert', 'yogurt', 'cheese', 'pasta', 'pudding', 'smoothie', 'nectar',
  'syrup', 'souffle', 'benedict', 'omelet', 'omelette', 'quiche', 'burrito', 'taquito', 'quesadilla', 'congee', 'butter',
  'powder', 'milk', 'extract', 'batter', 'sopaipilla', 'mustard', 'sausage', 'ham', 'ring', 'puff', 'nugget', 'filling',
  'tart', 'pastry', 'cereal', 'granola', 'jam', 'jelly', 'preserve', 'wine', 'beer', 'liqueur', 'tea', 'coffee', 'soda',
  'drink', 'shake', 'stuffing', 'pizza', 'taco', 'wrap', 'dumpling', 'noodle', 'lomi', 'ice', 'cream', 'gravy', 'relish',
  'paste', 'puree', 'concentrate',
])
const DISH_PHRASES = ['baby food', 'babyfood', 'frozen meal', 'ice cream', 'fast food', 'infant', 'applebee', 'mcdonald', "denny", 'burger king', 'kfc', 'wendy', 'taco bell', 'pizza hut', 'subway']
const ZERO_OK = new Set(['salt', 'water', 'ice', 'vinegar', 'sweetener', 'stevia', 'tea', 'coffee'])
const QUERY_FILLER = new Set(['and', 'or', 'with', 'of', 'in', 'the', 'a', 'fresh', 'whole', 'plain', 'cooked', 'raw', 'dry', 'dried', 'uncooked'])

const DATA_TYPE_RANK: Record<string, number> = { Foundation: 0, 'SR Legacy': 1, 'Survey (FNDDS)': 2 }
// qualifiers that mention a dish word without making the row a dish
const NEUTRAL_PHRASES = /\b(without (sauce|oil|fat|salt|skin|dressing|breading)|no (sauce|added fat|fat added)|(canned|packed) in (oil|water)|cooked with (oil|butter or margarine|fat))\b/g
const PREP_LIKE = new Set([...COOKED_METHOD, ...FRIED])

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0)
    .map(singularize)
}

/** Query words after normalization; the head noun is the last content word. */
export function queryTokens(name: string): string[] {
  return tokens(normalizeIngredientName(name)).filter((w) => !QUERY_FILLER.has(w))
}

export function scoreFdcCandidate(query: PickQuery, cand: PickCandidate): number {
  const allQ = queryTokens(query.name)
  // a cooking word inside the name ("grilled chicken", "fried rice") is a prep hint, not a content word
  const qTokens = allQ.filter((w) => !PREP_LIKE.has(w))
  if (qTokens.length === 0) return 0
  const head = qTokens[qTokens.length - 1]
  const qSet = new Set(allQ)
  const prep = [...(query.prep ? tokens(query.prep) : []), ...allQ.filter((w) => PREP_LIKE.has(w))]
  for (const p of prep) qSet.add(p)

  const desc = normalizeIngredientName(cand.description)
  const segs = desc.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
  const segTokens = segs.map(tokens)
  const dTokens = segTokens.flat()
  const dSet = new Set(dTokens)

  if (!dSet.has(head)) return 0
  for (const phrase of DISH_PHRASES) if (desc.includes(phrase) && !normalizeIngredientName(query.name).includes(phrase)) return 0
  const dishScan = tokens(desc.replace(NEUTRAL_PHRASES, ' '))
  for (const w of dishScan) if (DISH.has(w) && !qSet.has(w)) return 0

  const headSeg = segTokens.findIndex((st) => st.includes(head))
  let score = headSeg <= 1 ? 0.5 : headSeg === 2 ? 0.45 : 0.3
  const covered = qTokens.filter((w) => dSet.has(w)).length
  score += 0.2 * (covered / qTokens.length)
  if (covered < qTokens.length) score -= 0.2

  // state / preparation
  const has = (set: Set<string>) => dTokens.some((w) => set.has(w))
  const nsCookingMethod = /\bns as to cooking method\b/.test(desc)
  const prepHit = prep.length > 0 && prep.some((p) => dSet.has(p))
  const state = query.state ? normalizeIngredientName(query.state) : undefined
  if (prepHit) score += 0.18
  else if (state === 'cooked') {
    if (has(COOKED_GENERIC) || nsCookingMethod) score += 0.12
    else if (has(FRIED)) score -= 0.2
    else if (has(COOKED_METHOD)) score += 0.1
    else if (has(RAW) || has(DRY)) score -= 0.15
    else score += 0.06
  } else if (state === 'raw') {
    if (has(RAW)) score += 0.12
    else if (dSet.has('cooked') || has(COOKED_METHOD) || has(FRIED) || has(DRY)) score -= 0.15
    else score += 0.06 // NFS or no state word: acceptable generic
  } else if (state === 'dry') {
    if (has(DRY)) score += 0.12
    else if (has(RAW)) score += 0.08
    else if (dSet.has('cooked') || has(COOKED_METHOD) || has(FRIED)) score -= 0.15
    else score += 0.06
  } else {
    // no state given: "as commonly eaten" — NFS / cooked first, raw next, dry weight last
    if (has(FRIED)) score -= 0.1
    else if (has(COOKED_GENERIC)) score += 0.08
    else if (has(COOKED_METHOD)) score += 0.04
    else if (has(DRY)) score -= 0.05
    else score += 0.06
  }

  // extras: words the query did not ask for
  const isKnown = (w: string) =>
    qSet.has(w) || STOP.has(w) || CATEGORY.has(w) || COOKED_GENERIC.has(w) || COOKED_METHOD.has(w) || RAW.has(w) || DRY.has(w) || FRIED.has(w) || /^\d+$/.test(w)
  const extras = dTokens.filter((w) => !isKnown(w) && !PART_OR_DERIVATIVE.has(w))
  score -= Math.min(0.2, 0.05 * extras.length)
  const firstSegExtras = (segTokens[0] ?? []).filter((w) => !isKnown(w) && !PART_OR_DERIVATIVE.has(w))
  score -= 0.15 * firstSegExtras.length
  const firstSeg = segTokens[0] ?? []
  if (!firstSeg.some((w) => qSet.has(w)) && !firstSeg.some((w) => CATEGORY.has(w))) score -= 0.1

  // parts / derivatives / conjunctions
  const derivatives = dTokens.filter((w) => PART_OR_DERIVATIVE.has(w) && !qSet.has(w))
  score -= 0.25 * derivatives.length
  for (const st of segTokens) {
    if ((st.includes('and') || st.includes('or')) && st.some((w) => !isKnown(w))) {
      score -= 0.3
      break
    }
  }

  // data-less row (Foundation rows without energy used to land here before the Atwater fallback)
  const p = cand.per100g
  if (p && p.kcal === 0 && p.protein_g === 0 && p.fat_g === 0 && p.carbs_g === 0 && !ZERO_OK.has(head)) score -= 0.5
  if (p && typeof (p as { fiber_g?: unknown }).fiber_g !== 'number') score -= 0.03

  return Math.max(0, Math.min(1, Math.round(score * 1000) / 1000))
}

/** Best candidate at or above FDC_ACCEPT, deterministic tie-break; null → fall through. */
export function pickFdcCandidate<T extends PickCandidate>(query: PickQuery | string, candidates: T[]): T | null {
  const q: PickQuery = typeof query === 'string' ? { name: query } : query
  const rank = (x: T) => DATA_TYPE_RANK[x.dataType ?? ''] ?? 3
  let best: { c: T; score: number } | null = null
  for (const c of candidates) {
    const score = scoreFdcCandidate(q, c)
    if (score < FDC_ACCEPT) continue
    if (!best || score > best.score) {
      best = { c, score }
      continue
    }
    if (score < best.score) continue
    if (rank(c) < rank(best.c) || (rank(c) === rank(best.c) && c.description.length < best.c.description.length)) best = { c, score }
  }
  return best ? best.c : null
}

/** Scored view of every candidate (for verify scripts and tests). */
export function rankFdcCandidates<T extends PickCandidate>(query: PickQuery | string, candidates: T[]): Array<{ candidate: T; score: number }> {
  const q: PickQuery = typeof query === 'string' ? { name: query } : query
  return candidates
    .map((candidate) => ({ candidate, score: scoreFdcCandidate(q, candidate) }))
    .sort((a, b) => b.score - a.score || (DATA_TYPE_RANK[a.candidate.dataType ?? ''] ?? 3) - (DATA_TYPE_RANK[b.candidate.dataType ?? ''] ?? 3))
}

/* ---- query ladder --------------------------------------------------------- */

const STATE_QUERY_WORD: Record<string, string> = { cooked: 'cooked', raw: 'raw', dry: 'dry' }

/** "<name> <prep>", "<name> <state>", "<name>" — deduplicated, in order. */
export function fdcQueries(item: { name: string; state?: string; prep?: string }): string[] {
  const name = normalizeIngredientName(item.name)
  const out: string[] = []
  const push = (q: string) => {
    const n = normalizeIngredientName(q)
    if (n && !out.includes(n)) out.push(n)
  }
  const prepWord = item.prep ? normalizeIngredientName(item.prep) : undefined
  if (prepWord && !name.split(' ').includes(prepWord)) push(`${name} ${prepWord}`)
  const stateWord = item.state ? STATE_QUERY_WORD[normalizeIngredientName(item.state)] : undefined
  if (stateWord && !name.split(' ').includes(stateWord)) push(`${name} ${stateWord}`)
  push(name)
  return out
}

/** Alias key for a (name, state) pair: "<name> <state>" when a state is given. */
export function aliasKey(name: string, state?: string): string {
  return estimateFoodName(name, state)
}

export async function resolveLookupItem(item: { name: string; state?: string; prep?: string }, opts: LookupOptions = {}): Promise<ResolveOutcome> {
  const { name, state, prep } = item
  // 1. alias memory, state-matched first
  const aliasKeys = state ? [aliasKey(name, state), name] : [name]
  for (const key of aliasKeys) {
    const hit = await resolveIngredient(key)
    if (hit) {
      const source: LookupSource = hit.kind === 'custom_food' ? 'custom' : 'fdc'
      return { status: 'resolved', step: 'alias', entry: toPer100(hit.per100g, source, hit.per100g, hit.kind === 'fdc' ? `fdc:${hit.fdcId}` : `custom:${hit.customFoodId}`) }
    }
  }
  // 2. custom entry (approved first), state-specific name first
  const normalized = normalizeIngredientName(name)
  const customNames = state ? [aliasKey(name, state), normalized] : [normalized]
  const custom = await db.customFood.findFirst({
    where: { OR: customNames.flatMap((n) => [{ name: n }, { aliases: { has: n } }]) },
    orderBy: [{ approvedAt: { sort: 'desc', nulls: 'last' } }, { version: 'desc' }],
  })
  if (custom) {
    const p = parsePer100g(custom.per100g)
    if (p) return { status: 'resolved', step: 'custom', entry: toPer100(p, 'custom', custom.per100g, `custom:${custom.id}`, custom.name) }
  }
  // 3. database search (never under MOCK_LLM=1)
  if (mockForced()) return { status: 'resolved', step: 'mock', entry: mockPer100(name) }
  const queries = fdcQueries({ name, state, prep })
  try {
    for (const q of queries) {
      const matches = await searchFdc(q)
      const pick = pickFdcCandidate({ name, state, prep }, matches)
      if (pick) {
        // negative ids are offline mock matches (no FDC_API_KEY) — never persisted as identities
        if (pick.fdcId > 0) await saveAlias(aliasKey(name, state), { fdcId: pick.fdcId, per100g: pick.per100g })
        return { status: 'resolved', step: 'fdc', query: q, entry: toPer100(pick.per100g, 'fdc', pick.per100g, `fdc:${pick.fdcId}`, pick.description) }
      }
    }
  } catch (e) {
    if (e instanceof FdcSearchUnavailableError) return { status: 'unavailable', error: e, queries }
    throw e
  }
  // 4. LLM estimate → unapproved CustomFood (real mode only)
  if (opts.estimate !== false && !nutrientEstimateWouldMock()) {
    const est = await estimateNutrients(name, state)
    return {
      status: 'resolved',
      step: 'estimate',
      entry: toPer100(est.per100g, 'estimate', est.per100g, `custom:${est.customFoodId}`, aliasKey(name, state)),
    }
  }
  return { status: 'unresolved', queries }
}

/** Resolve every name (and composite component) once; return a sync lookup. */
export async function buildNutrientLookup(items: LookupItem[], opts: LookupOptions = {}): Promise<LookupBuild> {
  const wanted = new Map<string, { name: string; state?: string; prep?: string }>()
  for (const it of items) {
    const isComposite = Boolean(it.components && it.components.length > 0)
    const names = isComposite ? (it.components as string[]) : [it.name]
    for (const n of names) {
      const key = `${normalizeIngredientName(n)}|${it.state ?? ''}`
      // a prep word belongs to the item itself, not to its components
      if (!wanted.has(key)) wanted.set(key, { name: n, state: it.state, prep: isComposite ? undefined : it.prep })
    }
  }
  const resolved: Record<string, ResolvedEntry> = {}
  const unresolved: string[] = []
  const unavailable: string[] = []
  for (const [key, item] of wanted) {
    const out = await resolveLookupItem(item, opts)
    if (out.status === 'resolved') resolved[key] = out.entry
    else if (out.status === 'unavailable') {
      unavailable.push(item.name)
      console.warn(`[nutrient-lookup] FDC search unavailable for "${item.name}": ${out.error.message}`)
    } else unresolved.push(item.name)
  }
  const lookup: NutrientLookup = (name, state) => {
    const exact = resolved[`${normalizeIngredientName(name)}|${state ?? ''}`]
    if (exact) return exact
    // state-less fallback (a component looked up under its dish's state)
    return resolved[`${normalizeIngredientName(name)}|`] ?? null
  }
  return { lookup, resolved, unresolved, unavailable }
}
