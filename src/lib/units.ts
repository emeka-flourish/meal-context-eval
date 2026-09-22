// Household-unit → gram table for the GT structurer (TAG-GUIDE rule 10:
// every core/secondary item needs a gram figure; estimated when not weighed).
//
// Sources (rounded to whole grams; the study-fixed values below take precedence where they differ):
//   * USDA FoodData Central / FNDDS 2021-2023 portion weights
//     (bread slice 28 g whole-wheat regular slice; nut butter 16 g/tbsp;
//     honey 21 g/tbsp; egg medium 44 g, large 50 g, small 38 g; oats dry
//     1/3 cup 27 g; oil 14 g/tbsp, 4.5 g/tsp; butter 14 g/tbsp; cooked rice
//     158 g/cup; cooked pasta 140 g/cup; milk 244 g/cup; yogurt 245 g/cup;
//     banana medium 118 g; apple medium 182 g; sweet potato medium 114 g;
//     potato medium 173 g; plantain medium 179 g; sardines 92 g drained
//     per 3.75 oz can; cheese slice 28 g; hummus 15 g/tbsp; jam 20 g/tbsp;
//     sugar 12.5 g/tbsp; ketchup 17 g/tbsp; mayonnaise 14 g/tbsp).
//   * Avocado: TAG-GUIDE fixes a medium avocado at 136 g flesh (half = 68 g);
//     FDC lists ≈150 g for a medium fruit without skin/seed — the guide wins.
//   * Cooked oats: TAG-GUIDE fixes 1/3 cup dry (27 g) → 175 g cooked with
//     water (yield ≈ 6.5×; FDC "oatmeal, cooked with water" 234 g/cup).
// Anything not in this table is estimated from DEFAULT_PORTION_G by food class
// and flagged as a question for the owner.

export type UnitKey =
  | 'slice'
  | 'tbsp'
  | 'tsp'
  | 'cup'
  | 'can'
  | 'piece'
  | 'medium'
  | 'small'
  | 'large'
  | 'scoop'
  | 'handful'
  | 'oz'
  | 'g'

/** Per-food gram weights for one household unit. Food keys are the canonical
    names produced by the lexicon (gt-tags.ts). `_default` covers foods with a
    unit weight that does not depend on the food (tbsp of oil ≈ 14 g). */
export const UNIT_GRAMS: Record<string, Partial<Record<UnitKey, number>>> = {
  bread: { slice: 28, piece: 28 },
  'wheat bread': { slice: 28, piece: 28 },
  toast: { slice: 28, piece: 28 },
  'almond butter': { tbsp: 16, tsp: 5 },
  'peanut butter': { tbsp: 16, tsp: 5 },
  'nut butter': { tbsp: 16, tsp: 5 },
  honey: { tbsp: 21, tsp: 7 },
  jam: { tbsp: 20, tsp: 7 },
  sugar: { tbsp: 12.5, tsp: 4 },
  egg: { medium: 44, large: 50, small: 38, piece: 44 },
  avocado: { medium: 136, large: 170, small: 100, piece: 136 },
  oats: { cup: 81 }, // DRY; see OATS_COOKED_PER_DRY for as-served
  oatmeal: { cup: 81 },
  oil: { tbsp: 14, tsp: 4.5 },
  'olive oil': { tbsp: 14, tsp: 4.5 },
  'avocado oil': { tbsp: 14, tsp: 4.5 },
  'palm oil': { tbsp: 14, tsp: 4.5 },
  'coconut oil': { tbsp: 14, tsp: 4.5 },
  'vegetable oil': { tbsp: 14, tsp: 4.5 },
  butter: { tbsp: 14, tsp: 5 },
  rice: { cup: 158 }, // cooked
  'jollof rice': { cup: 158 },
  pasta: { cup: 140 }, // cooked
  milk: { cup: 244, tbsp: 15 },
  yogurt: { cup: 245, tbsp: 15 },
  banana: { medium: 118, large: 136, small: 101, piece: 118 },
  apple: { medium: 182, large: 223, small: 149, piece: 182 },
  orange: { medium: 131, piece: 131 },
  'sweet potato': { medium: 114, large: 180, small: 60, piece: 114 },
  potato: { medium: 173, large: 299, small: 92, piece: 173 },
  plantain: { medium: 179, large: 218, small: 148, piece: 179 },
  sardines: { can: 92 },
  cheese: { slice: 28, tbsp: 7, oz: 28 },
  hummus: { tbsp: 15 },
  ketchup: { tbsp: 17, tsp: 6 },
  mayonnaise: { tbsp: 14 },
  'pepper sauce': { tbsp: 15, tsp: 5 },
  'hot sauce': { tbsp: 15, tsp: 5 },
  _default: { tbsp: 15, tsp: 5, oz: 28, g: 1 },
}

/** Dry oats → cooked-with-water as served (TAG-GUIDE: 27 g dry → 175 g). */
export const OATS_COOKED_PER_DRY = 175 / 27

/** Cooking fat with no stated quantity ("avocado oil fried"): a small pour,
    below a tablespoon → garnish per TAG-GUIDE rule 8, ~5 g estimated. */
export const UNSTATED_COOKING_FAT_G = 5

/** Fallback portions when a core/secondary item has no unit at all; every
    use emits a question for the owner (basis = estimated). */
export const DEFAULT_PORTION_G: Record<string, number> = {
  protein: 120,
  starch: 150,
  vegetable: 80,
  fruit: 100,
  spread: 16,
  fat: 14,
  composite: 200,
  dairy: 150,
  unknown: 100,
}

const UNIT_ALIASES: Record<string, UnitKey> = {
  slice: 'slice',
  slices: 'slice',
  tbsp: 'tbsp',
  tbsps: 'tbsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  tsp: 'tsp',
  tsps: 'tsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  cup: 'cup',
  cups: 'cup',
  can: 'can',
  cans: 'can',
  tin: 'can',
  tins: 'can',
  piece: 'piece',
  pieces: 'piece',
  pc: 'piece',
  pcs: 'piece',
  medium: 'medium',
  med: 'medium',
  small: 'small',
  large: 'large',
  big: 'large',
  scoop: 'scoop',
  scoops: 'scoop',
  handful: 'handful',
  handfuls: 'handful',
  oz: 'oz',
  ounce: 'oz',
  ounces: 'oz',
  g: 'g',
  gram: 'g',
  grams: 'g',
}

export function normalizeUnit(word: string): UnitKey | null {
  return UNIT_ALIASES[word.toLowerCase()] ?? null
}

export type UnitEstimate = { grams: number; source: string }

/** grams for `quantity × unit` of `food` (canonical name). Falls back to the
    food-independent `_default` weights for volume units; null when the unit is
    not known for the food (caller decides on DEFAULT_PORTION_G). */
export function estimateGrams(food: string, quantity: number, unit: UnitKey | null): UnitEstimate | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return null
  const key = food.toLowerCase()
  const u = unit ?? 'piece'
  const perUnit = UNIT_GRAMS[key]?.[u] ?? (u === 'tbsp' || u === 'tsp' || u === 'oz' || u === 'g' ? UNIT_GRAMS._default[u] : undefined)
  if (perUnit == null) return null
  const grams = Math.round(quantity * perUnit * 10) / 10
  return { grams, source: `${quantity} ${u} × ${perUnit} g (${UNIT_GRAMS[key]?.[u] != null ? key : 'default'})` }
}
