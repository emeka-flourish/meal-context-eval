// Food lexicon + importance-tag rules for the deterministic GT structurer
// (TAG-GUIDE.md, applied in code). The LLM structurer (runners/gtStructure.ts)
// gets the guide as prose; this module is the offline/mock fallback and the
// thing the fixture test pins. Tags describe the item's ROLE on this plate.

export type FoodClass =
  | 'protein'
  | 'starch'
  | 'vegetable'
  | 'fruit'
  | 'fat'
  | 'spread'
  | 'sauce'
  | 'spice'
  | 'herb'
  | 'seed'
  | 'ignore'
  | 'beverage'
  | 'composite' // weighed-as-a-whole mixed dishes: roasted vegetables, salad, stew
  | 'dairy'
  | 'unknown'

export type GtTag = 'core' | 'secondary' | 'garnish' | 'spice' | 'ignore'

export type FoodMatch = { term: string; canonical: string; cls: FoodClass; index: number; length: number }

// [term, canonical, class]. Terms are matched case-insensitively as whole
// words with an optional plural (-s / -es); -y/-ies plurals listed explicitly.
// Longest term wins ("sweet potato" over "potato", "black pepper" over "pepper").
const LEXICON: [string, string, FoodClass][] = [
  // proteins
  ['salmon', 'salmon', 'protein'], ['sardine', 'sardines', 'protein'], ['tuna', 'tuna', 'protein'],
  ['tilapia', 'tilapia', 'protein'], ['fish', 'fish', 'protein'], ['shrimp', 'shrimp', 'protein'],
  ['prawn', 'prawns', 'protein'], ['chicken', 'chicken', 'protein'], ['turkey', 'turkey', 'protein'],
  ['beef', 'beef', 'protein'], ['goat', 'goat', 'protein'], ['goat meat', 'goat', 'protein'],
  ['lamb', 'lamb', 'protein'], ['pork', 'pork', 'protein'], ['steak', 'steak', 'protein'],
  ['egg', 'egg', 'protein'], ['tofu', 'tofu', 'protein'], ['bean', 'beans', 'protein'],
  ['black bean', 'black beans', 'protein'], ['lentil', 'lentils', 'protein'], ['chickpea', 'chickpeas', 'protein'],
  ['egusi', 'egusi', 'composite'], ['egusi soup', 'egusi soup', 'composite'],
  // starches
  ['wheat bread', 'wheat bread', 'starch'], ['whole wheat bread', 'wheat bread', 'starch'], ['bread', 'bread', 'starch'],
  ['toast', 'toast', 'starch'], ['rice', 'rice', 'starch'], ['jollof rice', 'jollof rice', 'starch'],
  ['fried rice', 'fried rice', 'starch'], ['pasta', 'pasta', 'starch'], ['spaghetti', 'spaghetti', 'starch'],
  ['noodle', 'noodles', 'starch'], ['oat', 'oats', 'starch'], ['oatmeal', 'oats', 'starch'],
  ['porridge', 'oats', 'starch'], ['sweet potato', 'sweet potato', 'starch'], ['potato', 'potato', 'starch'],
  ['plantain', 'plantain', 'starch'], ['yam', 'yam', 'starch'], ['poundo', 'poundo', 'starch'],
  ['pounded yam', 'poundo', 'starch'], ['fufu', 'fufu', 'starch'], ['eba', 'eba', 'starch'], ['garri', 'eba', 'starch'],
  ['quinoa', 'quinoa', 'starch'], ['couscous', 'couscous', 'starch'], ['tortilla', 'tortilla', 'starch'],
  ['bagel', 'bagel', 'starch'], ['cereal', 'cereal', 'starch'], ['granola', 'granola', 'starch'],
  // vegetables
  ['spinach', 'spinach', 'vegetable'], ['kale', 'kale', 'vegetable'], ['broccoli', 'broccoli', 'vegetable'],
  ['brussels sprout', 'brussels sprouts', 'vegetable'], ['brussel sprout', 'brussels sprouts', 'vegetable'],
  ['zucchini', 'zucchini', 'vegetable'], ['onion', 'onion', 'vegetable'], ['red onion', 'onion', 'vegetable'],
  ['tomato', 'tomato', 'vegetable'], ['tomatoes', 'tomato', 'vegetable'], ['cucumber', 'cucumber', 'vegetable'],
  ['lettuce', 'lettuce', 'vegetable'], ['bell pepper', 'bell pepper', 'vegetable'], ['peppers', 'bell pepper', 'vegetable'],
  ['carrot', 'carrot', 'vegetable'], ['mushroom', 'mushroom', 'vegetable'], ['cabbage', 'cabbage', 'vegetable'],
  ['okra', 'okra', 'vegetable'], ['asparagus', 'asparagus', 'vegetable'], ['green bean', 'green beans', 'vegetable'],
  ['cauliflower', 'cauliflower', 'vegetable'], ['eggplant', 'eggplant', 'vegetable'], ['celery', 'celery', 'vegetable'],
  ['corn', 'corn', 'vegetable'], ['pea', 'peas', 'vegetable'], ['garlic', 'garlic', 'garnish' as FoodClass],
  ['ginger', 'ginger', 'spice'],
  // composites
  ['vegetable', 'vegetables', 'composite'], ['veggie', 'vegetables', 'composite'], ['salad', 'salad', 'composite'],
  ['stew', 'stew', 'composite'], ['soup', 'soup', 'composite'], ['curry', 'curry', 'composite'],
  ['stir fry', 'stir fry', 'composite'], ['mixed vegetable', 'vegetables', 'composite'],
  // fruit
  ['blueberry', 'blueberry', 'fruit'], ['blueberries', 'blueberry', 'fruit'], ['strawberry', 'strawberry', 'fruit'],
  ['strawberries', 'strawberry', 'fruit'], ['raspberry', 'raspberry', 'fruit'], ['raspberries', 'raspberry', 'fruit'],
  ['berry', 'berries', 'fruit'], ['berries', 'berries', 'fruit'], ['banana', 'banana', 'fruit'],
  ['apple', 'apple', 'fruit'], ['orange', 'orange', 'fruit'], ['mango', 'mango', 'fruit'], ['grape', 'grapes', 'fruit'],
  ['pineapple', 'pineapple', 'fruit'], ['watermelon', 'watermelon', 'fruit'], ['pear', 'pear', 'fruit'],
  ['peach', 'peach', 'fruit'], ['kiwi', 'kiwi', 'fruit'], ['melon', 'melon', 'fruit'], ['date', 'dates', 'fruit'],
  // fats
  ['avocado oil', 'avocado oil', 'fat'], ['olive oil', 'olive oil', 'fat'], ['palm oil', 'palm oil', 'fat'],
  ['coconut oil', 'coconut oil', 'fat'], ['vegetable oil', 'vegetable oil', 'fat'], ['canola oil', 'canola oil', 'fat'],
  ['oil', 'oil', 'fat'], ['butter', 'butter', 'fat'], ['ghee', 'ghee', 'fat'], ['cooking spray', 'cooking spray', 'fat'],
  // spreads / toppings
  ['almond butter', 'almond butter', 'spread'], ['peanut butter', 'peanut butter', 'spread'],
  ['nut butter', 'nut butter', 'spread'], ['avocado', 'avocado', 'spread'], ['honey', 'honey', 'spread'],
  ['jam', 'jam', 'spread'], ['hummus', 'hummus', 'spread'], ['cheese', 'cheese', 'spread'],
  ['cream cheese', 'cream cheese', 'spread'], ['maple syrup', 'maple syrup', 'spread'],
  // dairy
  ['yogurt', 'yogurt', 'dairy'], ['yoghurt', 'yogurt', 'dairy'], ['greek yogurt', 'greek yogurt', 'dairy'],
  // sauces
  ['pepper sauce', 'pepper sauce', 'sauce'], ['hot sauce', 'hot sauce', 'sauce'], ['ketchup', 'ketchup', 'sauce'],
  ['mayonnaise', 'mayonnaise', 'sauce'], ['mayo', 'mayonnaise', 'sauce'], ['gravy', 'gravy', 'sauce'],
  ['sauce', 'sauce', 'sauce'], ['dressing', 'dressing', 'sauce'], ['salsa', 'salsa', 'sauce'],
  // spices
  ['curry powder', 'curry powder', 'spice'], ['chili', 'chili', 'spice'], ['chilli', 'chili', 'spice'],
  ['chili powder', 'chili powder', 'spice'], ['chili flake', 'chili flakes', 'spice'], ['cayenne', 'cayenne', 'spice'],
  ['paprika', 'paprika', 'spice'], ['cumin', 'cumin', 'spice'], ['turmeric', 'turmeric', 'spice'],
  ['garlic powder', 'garlic powder', 'spice'], ['onion powder', 'onion powder', 'spice'], ['cinnamon', 'cinnamon', 'spice'],
  ['nutmeg', 'nutmeg', 'spice'], ['thyme', 'thyme', 'spice'], ['oregano', 'oregano', 'spice'],
  ['seasoning', 'seasoning', 'spice'], ['all purpose seasoning', 'seasoning', 'spice'], ['bouillon', 'bouillon', 'spice'],
  ['maggi', 'bouillon', 'spice'], ['suya spice', 'suya spice', 'spice'], ['curry', 'curry powder', 'spice'],
  // herbs / small toppings
  ['parsley', 'parsley', 'herb'], ['cilantro', 'cilantro', 'herb'], ['coriander', 'cilantro', 'herb'],
  ['basil', 'basil', 'herb'], ['mint', 'mint', 'herb'], ['dill', 'dill', 'herb'], ['chive', 'chives', 'herb'],
  ['scallion', 'scallions', 'herb'], ['spring onion', 'scallions', 'herb'], ['green onion', 'scallions', 'herb'],
  ['lemon', 'lemon', 'herb'], ['lime', 'lime', 'herb'], ['lemon juice', 'lemon', 'herb'],
  ['chia seed', 'chia seeds', 'seed'], ['flax seed', 'flax seeds', 'seed'], ['flaxseed', 'flax seeds', 'seed'],
  ['sesame seed', 'sesame seeds', 'seed'], ['pumpkin seed', 'pumpkin seeds', 'seed'], ['seed', 'seeds', 'seed'],
  // ignore (dropped on both sides)
  ['salt', 'salt', 'ignore'], ['black pepper', 'black pepper', 'ignore'], ['pepper', 'pepper', 'ignore'],
  ['white pepper', 'white pepper', 'ignore'], ['water', 'water', 'ignore'], ['ice', 'ice', 'ignore'],
  // beverages (never items — dropped entirely)
  ['coffee', 'coffee', 'beverage'], ['tea', 'tea', 'beverage'], ['juice', 'juice', 'beverage'],
  ['orange juice', 'orange juice', 'beverage'], ['smoothie', 'smoothie', 'beverage'], ['latte', 'latte', 'beverage'],
  ['soda', 'soda', 'beverage'], ['coke', 'soda', 'beverage'], ['beer', 'beer', 'beverage'], ['wine', 'wine', 'beverage'],
  ['glass of milk', 'milk', 'beverage'], ['cup of milk', 'milk', 'beverage'], ['milk', 'milk', 'dairy'],
]

const COMPILED = LEXICON.map(([term, canonical, cls]) => ({
  term,
  canonical,
  cls,
  re: new RegExp(`(^|[^a-z])(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:e?s)?)(?=$|[^a-z])`, 'i'),
})).sort((a, b) => b.term.length - a.term.length)

/** All non-overlapping lexicon matches in `text`, longest terms first, in
    order of appearance. */
export function findFoods(text: string): FoodMatch[] {
  const lower = text.toLowerCase()
  const taken: boolean[] = new Array(lower.length).fill(false)
  const found: FoodMatch[] = []
  for (const entry of COMPILED) {
    let from = 0
    while (from < lower.length) {
      const m = entry.re.exec(lower.slice(from))
      if (!m) break
      const start = from + m.index + m[1].length
      const end = start + m[2].length
      const overlaps = taken.slice(start, end).some(Boolean)
      if (!overlaps) {
        for (let i = start; i < end; i++) taken[i] = true
        found.push({ term: m[2], canonical: entry.canonical, cls: entry.cls, index: start, length: end - start })
      }
      from = end
    }
  }
  return found.sort((a, b) => a.index - b.index)
}

// ---- tag rules (TAG-GUIDE.md "Rules of thumb", per plate) ---------------------

export type TaggableItem = {
  cls: FoodClass
  canonical: string
  grams: number | null
  /** household quantity in "slices" etc. when known (small-side bread rule) */
  quantity: number | null
  unit: string | null
  /** "sprinkle of", "dash of", "squeeze of" … → garnish-sized */
  smallQualifier: boolean
}

export function plateHasCoreCarrier(items: TaggableItem[]): boolean {
  return items.some(
    (i) => i.cls === 'protein' || i.cls === 'starch' || (i.cls === 'composite' && /stew|soup|curry|egusi/.test(i.canonical)),
  )
}

const TBSP_G = 14

export function tagFor(item: TaggableItem, plate: TaggableItem[]): GtTag {
  const carrier = plateHasCoreCarrier(plate)
  switch (item.cls) {
    case 'ignore':
      return 'ignore'
    case 'spice':
      return 'spice'
    case 'herb':
    case 'seed':
      return 'garnish'
    case 'fat':
      // rule 8: a tablespoon or more → secondary; a spray / teaspoon / unstated pour → garnish
      if (item.grams != null && item.grams >= TBSP_G) return 'secondary'
      if (item.grams == null && item.unit === 'tbsp' && (item.quantity ?? 1) >= 1) return 'secondary'
      return 'garnish'
    case 'spread':
      return 'secondary' // rule 7
    case 'sauce':
      // rule 9: a real quantity → secondary; a dab → garnish
      if (item.smallQualifier) return 'garnish'
      if (item.grams != null) return item.grams >= 15 ? 'secondary' : 'garnish'
      return item.unit === 'tbsp' || item.unit === 'cup' ? 'secondary' : 'garnish'
    case 'protein': {
      // rule 6: one egg beside a main protein is secondary
      if (item.canonical === 'egg' && plate.some((p) => p.cls === 'protein' && p.canonical !== 'egg')) {
        return (item.quantity ?? 1) <= 1 ? 'secondary' : 'core'
      }
      return 'core'
    }
    case 'starch': {
      // rule 5: a single slice of bread beside eggs/protein is a small side
      const isBread = /bread|toast|tortilla/.test(item.canonical)
      const single = item.unit === 'slice' ? (item.quantity ?? 1) <= 1 : item.grams != null && item.grams <= 30
      if (isBread && single && plate.some((p) => p.cls === 'protein')) return 'secondary'
      return 'core'
    }
    case 'composite':
      if (/stew|soup|curry|egusi/.test(item.canonical)) return 'core' // rule 3, weighed as one bowl
      return carrier ? 'secondary' : 'core' // rule 4: salad beside a protein vs. salad as the dish
    case 'vegetable':
    case 'fruit':
      if (item.smallQualifier) return 'garnish'
      return carrier ? 'secondary' : 'core' // rule 4
    case 'dairy':
      return carrier ? 'secondary' : 'core'
    case 'beverage':
      return 'ignore' // never emitted — the parser drops these before tagging
    case 'unknown':
    default:
      return carrier ? 'secondary' : 'core'
  }
}
