/* Deterministic nutrient calc (§5.2) — one decomposition → one NutrientCalc.
   Measurement-integrity requirement: EVERY ingredient entry in fdcMappings
   carries nutrientSource ('fdc' | 'custom_food' | 'llm_estimate' | 'manual')
   so analysis can report with/without LLM-sourced rows. Totals may sum across
   sources; the per-ingredient tag is what forbids silent mixing.

   Fallback chain per ingredient:
     (1) FdcAlias hit (resolveIngredient)            → fdc | custom_food
     (2) FDC search, auto-accept ONLY on an exact-ish
         description match; alias saved              → fdc
     (3) one-off LLM per-100g estimate (family C,
         same call shape as draftCustomFood but NO
         CustomFood row and no alias)                → llm_estimate
     (4) zero row flagged for owner review           → manual + needsReview */
import { db } from '@/lib/db'
import { runLlm } from '@/lib/llm'
import { CONFIG } from '@/lib/config'
import {
  normalizeIngredientName,
  resolveIngredient,
  saveAlias,
  searchFdc,
  type Per100g,
} from '@/lib/fdc'
import {
  CUSTOM_FOOD_DRAFT_SYSTEM,
  customFoodDraftSchema,
  mockCustomFoodDraft,
  type CustomFoodDraft,
} from './customFood'
import type { DecompositionPayload, Ingredient } from '@/lib/decomposition'
import type { Decomposition } from '@/generated/prisma/client'

export type NutrientSource = 'fdc' | 'custom_food' | 'llm_estimate' | 'manual'

export type FdcMapping = {
  ingredientPath: string // 'dishes[0].ingredients[2]' | 'condiments[1]'
  name: string
  grams: number
  fdcId?: number
  customFoodId?: string
  nutrientSource: NutrientSource
  per100g: Per100g
  kcal: number
  protein_g: number
  carbs_g: number
  fat_g: number
  needsReview?: boolean
}

const ZERO: Per100g = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }

const r1 = (n: number) => Math.round(n * 10) / 10

/** FDC candidate selection (owner audit 2026-08-18). Two failure modes had
    been degrading the derived-nutrient measure:
      (a) too STRICT: 'black pepper' vs FDC's 'Spices, pepper, black' fell to
          an LLM estimate (68/174 rows);
      (b) too LOOSE / top-only: 'green beans' → 'Green bean casserole',
          'salt' → 'Pecans, salted', 'banana' → 'Bananas, dehydrated' — the
          first substring hit was a composite/processed food, silently wrong.
    Rule: score EVERY candidate; require all query content words present and
    the head noun present exactly; penalize composite/processed/brand/derived
    forms and extra unrelated words; prefer short whole-food descriptions and
    'raw'. Accept only above a threshold; else fall to the LLM estimate. */
const FILLER = new Set(['and', 'or', 'with', 'of', 'in', 'the', 'a', 'raw', 'cooked', 'fresh', 'sliced', 'chopped', 'diced', 'canned', 'ground', 'whole', 'plain', 'meat', 'flesh'])
const REJECT_DESC = /\b(babyfood|baby food|infant|formula|applebee|mcdonald|burger king|kfc|denny|restaurant|fast food|school lunch)\b/i
const stem = (w: string) => w.replace(/(ies|es|s)$/, (m) => (m === 'ies' ? 'i' : ''))
const contentWords = (t: string) =>
  t.split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !FILLER.has(w)).map(stem)

// FDC prefixes many entries with a CATEGORY word ('Fish, sardines, canned';
// 'Spices, pepper, black'; 'Beverages, water'). Those aren't "extra" foods.
const CATEGORY_WORDS = new Set(['fish', 'spice', 'spic', 'beverage', 'beverag', 'vegetable', 'vegetabl', 'fruit', 'nut', 'seed', 'oil', 'grain', 'legume', 'legum', 'poultry', 'beef', 'pork', 'dairy', 'cereal', 'bread', 'egg', 'seafood'])
// preparation/state words that don't change WHAT the food is
const STATE_WORDS = new Set(['raw', 'cooked', 'fresh', 'frozen', 'boiled', 'steamed', 'baked', 'roasted', 'grilled', 'stewed', 'sauteed', 'rotisserie', 'rotisseri', 'drained', 'solid', 'bone', 'skin', 'eaten', 'not', 'unprepared', 'prepared', 'grade', 'large', 'larg', 'nfs', 'water', 'oil', 'light', 'white', 'yellow', 'atlantic', 'pacific', 'old', 'fashioned', 'table', 'tabl', 'kernel', 'drumstick', 'glutinous', 'long', 'short', 'medium', 'regular', 'enriched', 'unenriched', 'black', 'red', 'green', 'sweet', 'canned', 'dried', 'crushed', 'minced', 'sliced', 'chopped', 'diced', 'skinless', 'boneless', 'lean', 'only'])
// dish/derivative markers — this is a DIFFERENT food than the plain ingredient
const DISH_WORDS = /\b(casserole|dressing|chips|dehydrated|powder|milk|juice|creamed|pie|cake|soup|sauce|salad|sandwich|batter|benedict|omelet|omelette|scrambled|souffle|quiche|extract|syrup|candy|bar|drink|dessert|ice cream|yogurt|cheese|pasta|roll|russian|steak|stuffed|fried rice|pudding|smoothie|beans and|and rice|with rice|dip|spread|glutinous)\b/i

/** 0..1 confidence that this FDC description IS the queried ingredient. */
export function fdcMatchScore(query: string, description: string): number {
  const q = normalizeIngredientName(query)
  const d = normalizeIngredientName(description)
  if (REJECT_DESC.test(d)) return 0
  const qw = contentWords(q)
  if (qw.length === 0) return 0
  const dw = contentWords(d)
  const head = qw[qw.length - 1]
  const has = (w: string) => dw.some((x) => x === w || x.startsWith(w) || w.startsWith(x))
  if (!has(head)) return 0
  if (!qw.every(has)) return 0
  // a dish/derivative the query didn't ask for → different food
  const qJoined = ' ' + q + ' '
  const dishHit = d.match(DISH_WORDS)?.[0]
  if (dishHit && !qJoined.includes(' ' + dishHit.toLowerCase() + ' ')) return 0.15
  let score = 0.7
  const extra = dw.filter((x) => !qw.some((w) => x === w || x.startsWith(w) || w.startsWith(x)))
  const meaningfulExtra = extra.filter((x) => !CATEGORY_WORDS.has(x) && !STATE_WORDS.has(x))
  // any extra FOOD word the query didn't mention (beans in 'beans and white rice')
  score -= meaningfulExtra.length * 0.2
  score -= Math.min(0.15, extra.length * 0.03) // mild length drift
  if (d === q || d.startsWith(q + ',') || d.startsWith(q + ' ')) score += 0.15
  if (/\braw\b/.test(d)) score += 0.1
  return Math.max(0, Math.min(1, score))
}

const FDC_ACCEPT = 0.6

/** Best FDC candidate above threshold, or null → LLM fallback. */
export function pickFdcCandidate<T extends { description: string }>(query: string, candidates: T[]): T | null {
  let best: T | null = null
  let bestScore = 0
  for (const c of candidates) {
    const sc = fdcMatchScore(query, c.description)
    if (sc > bestScore) {
      best = c
      bestScore = sc
    }
  }
  return bestScore >= FDC_ACCEPT ? best : null
}

type Resolved = {
  per100g: Per100g
  nutrientSource: NutrientSource
  fdcId?: number
  customFoodId?: string
  needsReview?: boolean
}

async function resolvePer100g(name: string, subjectRef: string): Promise<Resolved> {
  // (1) alias hit — the shared identity layer always wins (risk R4)
  const alias = await resolveIngredient(name)
  if (alias) {
    return {
      per100g: alias.per100g,
      nutrientSource: alias.kind,
      fdcId: alias.fdcId,
      customFoodId: alias.customFoodId,
    }
  }

  // (2) FDC search — score ALL candidates, accept the best clean whole-food
  // match above threshold, persist as alias so the name resolves identically
  // (both GT and pipeline sides) next time
  try {
    const candidates = await searchFdc(name)
    const pick = pickFdcCandidate(name, candidates)
    if (pick) {
      await saveAlias(name, { fdcId: pick.fdcId, per100g: pick.per100g })
      return { per100g: pick.per100g, nutrientSource: 'fdc', fdcId: pick.fdcId }
    }
  } catch {
    // search unavailable — fall through to the LLM estimate
  }

  // (3) one-off LLM estimate (family C). Same prompt + runner as
  // draftCustomFood, but deliberately NO CustomFood row and NO alias: a
  // one-shot number tagged llm_estimate, never a reusable identity.
  try {
    const { output } = await runLlm<CustomFoodDraft>({
      runner: 'custom_food_draft',
      modelId: CONFIG.silver.modelId,
      subjectRef,
      system: CUSTOM_FOOD_DRAFT_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Draft a per-100g (as served) nutrient profile for: "${normalizeIngredientName(name)}". Return kcal, protein_g, carbs_g and fat_g per 100 g, reasoning that cites comparable foods, and your confidence.`,
        },
      ],
      schema: customFoodDraftSchema,
      mock: () => mockCustomFoodDraft(name),
    })
    return {
      per100g: customFoodDraftSchema.parse(output).per_100g,
      nutrientSource: 'llm_estimate',
    }
  } catch {
    // (4) zero row flagged for owner review — never invented numbers
    return { per100g: ZERO, nutrientSource: 'manual', needsReview: true }
  }
}

export async function runNutrientsForDecomposition(
  deco: Decomposition,
): Promise<{ nutrientCalcId: string }> {
  const existing = await db.nutrientCalc.findFirst({
    where: { decompositionId: deco.id },
  })
  if (existing) return { nutrientCalcId: existing.id } // idempotent

  const payload = deco.payload as DecompositionPayload
  const jobs: { path: string; ingredient: Ingredient }[] = []
  payload.dishes.forEach((dish, di) =>
    dish.ingredients.forEach((ingredient, ii) =>
      jobs.push({ path: `dishes[${di}].ingredients[${ii}]`, ingredient }),
    ),
  )
  ;(payload.condiments_and_uncertain ?? []).forEach((ingredient, ci) =>
    jobs.push({ path: `condiments[${ci}]`, ingredient }),
  )

  const mappings: FdcMapping[] = []
  for (const { path, ingredient } of jobs) {
    const grams = ingredient.grams ?? ingredient.grams_est ?? 0
    if (grams <= 0) continue // zero-gram: nothing to weigh, nothing to sum

    const resolved = await resolvePer100g(ingredient.name, `decomposition:${deco.id}|${path}`)
    mappings.push({
      ingredientPath: path,
      name: ingredient.name,
      grams,
      ...(resolved.fdcId != null ? { fdcId: resolved.fdcId } : {}),
      ...(resolved.customFoodId != null ? { customFoodId: resolved.customFoodId } : {}),
      nutrientSource: resolved.nutrientSource,
      per100g: resolved.per100g,
      kcal: r1((grams * resolved.per100g.kcal) / 100),
      protein_g: r1((grams * resolved.per100g.protein_g) / 100),
      carbs_g: r1((grams * resolved.per100g.carbs_g) / 100),
      fat_g: r1((grams * resolved.per100g.fat_g) / 100),
      ...(resolved.needsReview ? { needsReview: true } : {}),
    })
  }

  const created = await db.nutrientCalc.create({
    data: {
      decompositionId: deco.id,
      kcal: r1(mappings.reduce((s, m) => s + m.kcal, 0)),
      proteinG: r1(mappings.reduce((s, m) => s + m.protein_g, 0)),
      carbsG: r1(mappings.reduce((s, m) => s + m.carbs_g, 0)),
      fatG: r1(mappings.reduce((s, m) => s + m.fat_g, 0)),
      fdcMappings: mappings,
      dbVersion: CONFIG.fdc.dbVersion,
    },
  })
  return { nutrientCalcId: created.id }
}
