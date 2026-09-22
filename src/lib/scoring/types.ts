/* Scoring types — METRICS.md rev 8.1 (Level 1 Understanding, Level 2 Nutrients,
   Level 3 Decisions). Pure data; no Prisma, no network. The matcher and the
   Level 3 classifier are injected (see level3.ts) so every function here is
   deterministic and unit-testable with doubles.

   NOTE: this folder is `src/lib/scoring/` and deliberately has no index.ts:
   `@/lib/scoring` already resolves to the blind-scoring module
   `src/lib/scoring.ts` (insight rubric), which is unrelated. Import the
   functions here by file: `@/lib/scoring/level1`, `@/lib/scoring/level2`, … */

export type Tag = 'core' | 'secondary' | 'garnish' | 'spice' | 'ignore'
export type Basis = 'weighed' | 'estimated' | 'converted'
export type Confidence = 'low' | 'medium' | 'high'

/** Importance weights per TAG-GUIDE.md. `ignore` items are dropped on both sides. */
export const TAG_WEIGHT: Record<Tag, number> = {
  core: 1,
  secondary: 0.5,
  garnish: 0.1,
  spice: 0.05,
  ignore: 0,
}

/** Mirror-penalty factor for invented items (METRICS rev 6): full for
    core/secondary, half for garnish/spice ("garnish-spice exception"). */
export const INVENTED_PENALTY: Record<Tag, number> = {
  core: 1,
  secondary: 1,
  garnish: 0.5,
  spice: 0.5,
  ignore: 0,
}

export type TruthItem = {
  id: string
  dish: string
  name: string
  /** as-served grams; required for core/secondary (TAG-GUIDE rule 10), optional for garnish/spice */
  grams?: number
  basis: Basis
  tag: Tag
  /** cooked / dry / raw … — carried into the Level 2 lookup */
  state?: string
  /** composite dish (TAG-GUIDE rule 2): one weight, named components, equal split in Level 2 */
  components?: string[]
  /** relative weights for `components` (same order); absent = equal split */
  componentWeights?: number[]
  /** cannot be seen in a photo of the served plate (hidden-ingredient recall, METRICS.md) */
  hidden?: boolean
}

export type PredItem = {
  id: string
  dish: string
  name: string
  grams?: number
  confidence?: Confidence
  /** model-flagged "inferred" — changes nothing in scoring (an inferred item absent from truth is invented) */
  inferred?: boolean
  /** drink predictions are dropped, never invented */
  isDrink?: boolean
  state?: string
}

/** identity: exact 1 · substitute 0.5 · wrong/missed 0 */
export type Identity = 1 | 0.5 | 0

/** One matcher row. truthIds.length > 1 = one-to-many (one prediction covers
    several truth items, each takes the group grade); predIds.length > 1 =
    many-to-one (several predictions summed against one truth item).
    identity 0 with a non-empty predIds = WRONG PAIRING (truth missed, the
    prediction becomes invented, tagged from the paired truth item).
    identity 0 with empty predIds = plain miss. */
export type MatchRow = {
  truthIds: string[]
  predIds: string[]
  identity: Identity
}

export type InventedEntry = {
  predId: string
  /** tag by TAG-GUIDE rules; defaults to 'garnish' when the matcher gave none */
  tag?: Tag
}

export type MatchTable = {
  rows: MatchRow[]
  invented: InventedEntry[]
  /** prediction ids the matcher dropped as beverages */
  droppedDrinks: string[]
}

export type Nutrients = {
  kcal: number
  protein: number
  fat: number
  carb: number
  fiber: number
}

export const NUTRIENT_KEYS = ['kcal', 'protein', 'fat', 'carb', 'fiber'] as const
export type NutrientKey = (typeof NUTRIENT_KEYS)[number]

export const ZERO_NUTRIENTS: Nutrients = { kcal: 0, protein: 0, fat: 0, carb: 0, fiber: 0 }

export type F1Result = {
  precision: number
  recall: number
  f1: number
  tp: number
  fp: number
  fn: number
}

export type MassError = {
  /** mean |e − g| in grams over matched weighed units */
  mae: number | null
  /** mean |e − g| / g × 100 over the same units */
  mape: number | null
  /** number of matched weighed units */
  n: number
  /** weighed gram-bearing truth items / all gram-bearing truth items (drops ignore) */
  coverage: number | null
}

export type Level1Result = {
  /** Σ w_i·id_i / Σ w_i */
  recognized: number
  /** Σ w_j / Σ w_i — can exceed 1 */
  invented: number
  /** [Σ w_i·id_i − Σ p_j·w_j] / Σ w_i, floored at 0 */
  net: number
  /** sensitivity line: Net with p = 1.0 everywhere */
  netP1: number
  /** Σ g_i·grade_i / (Σ g_i + Σ e_j) */
  quantity: number
  /** sensitivity line: Quantity with substitute rows excluded from both sums */
  quantityNoSubstitutes: number
  /** unweighted recall split by visibility: found = Σ identity (exact 1, substitute 0.5) over non-ignore truth items */
  visibility: { hidden: { n: number; found: number }; visible: { n: number; found: number } }
  f1: F1Result
  massError: MassError
  /** median symmetric accuracy, % (Morley 2018), over matched weighed units; null if none */
  msa: number | null
  /** symmetric signed percentage bias, % (Morley 2018); null if none */
  sspb: number | null
  /** the sums behind the ratios, for tables and debugging */
  sums: {
    sumW: number
    sumWId: number
    sumInventedW: number
    sumPenalisedInventedW: number
    sumG: number
    sumGGrade: number
    sumInventedE: number
  }
  /** per truth item: identity and grade as used */
  perItem: Array<{
    id: string
    name: string
    tag: Tag
    w: number
    identity: Identity
    grams?: number
    /** grouped estimate compared against this item (sum of the row's pred grams) */
    estimate?: number
    grade: number | null
    status: 'exact' | 'substitute' | 'missed' | 'wrong'
  }>
  /** invented predictions actually charged (drinks and ignore excluded) */
  inventedItems: Array<{ predId: string; name: string; tag: Tag; w: number; p: number; grams?: number; origin: 'unpaired' | 'wrong_pairing' }>
}
