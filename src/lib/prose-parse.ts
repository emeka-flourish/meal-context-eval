// Deterministic prose → draft decomposition parser.
// Serves as the GT-assist mock until the family-C model is wired (M2), and as
// the offline fallback afterward. Parses weigh-log style prose like:
//   "plate total 640. lentil stew 350, olive oil ~25 est, lamb 2 pieces ~80; polenta 220"
// Rules: segments split on , ; . and newlines. A trailing number = grams.
// '~' or 'est'/'about'/'maybe'/'roughly' => grams_basis estimated, else measured.

import type { DecompositionPayload, Ingredient } from './decomposition'
import { findFoods, tagFor, type FoodClass, type GtTag, type TaggableItem } from './gt-tags'
import { estimateGrams, normalizeUnit, DEFAULT_PORTION_G, OATS_COOKED_PER_DRY, UNSTATED_COOKING_FAT_G, type UnitKey } from './units'

const EST_MARKERS = /(~|\best\b|\babout\b|\bmaybe\b|\broughly\b|\bapprox\w*\b)/i
const PLATE_TOTAL = /(?:plate|total|meal)\s*(?:total\s*)?[:\s]*~?(\d+(?:\.\d+)?)\s*g?\b/i

export function parseProseAttestation(text: string): {
  payload: DecompositionPayload | null
  plateTotalGrams: number | null
} {
  let plateTotalGrams: number | null = null
  const plateMatch = text.match(PLATE_TOTAL)
  let working = text
  if (plateMatch) {
    plateTotalGrams = parseFloat(plateMatch[1])
    working = working.replace(plateMatch[0], ' ')
  }

  const segments = working
    .split(/[,;.\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1)

  const ingredients: Ingredient[] = []
  for (const seg of segments) {
    const numMatch = seg.match(/~?(\d+(?:\.\d+)?)\s*(?:g|grams?)?\s*(?:est\.?)?$/i)
    if (!numMatch) continue
    const grams = parseFloat(numMatch[1])
    if (!Number.isFinite(grams) || grams <= 0) continue
    const name = seg
      .slice(0, numMatch.index)
      .replace(EST_MARKERS, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!name) continue
    const estimated = EST_MARKERS.test(seg)
    ingredients.push({
      name: name.replace(/^./, (c) => c.toUpperCase()),
      grams,
      grams_basis: estimated ? 'estimated' : 'measured',
    })
  }

  if (ingredients.length === 0) return { payload: null, plateTotalGrams }

  return {
    payload: {
      dishes: [
        {
          dishName: 'Meal (draft — name the dishes)',
          ingredients,
        },
      ],
      condiments_and_uncertain: [],
    },
    plateTotalGrams,
  }
}

// =============================================================================
// Intake v2 — deterministic structurer for the owner's Notes prose → GtItem drafts
// (TAG-GUIDE.md applied in code). This is the mock/offline path of
// runners/gtStructure.ts and the parser the TAG-GUIDE fixture test pins.
//
// Line grammar it understands:
//   Plate 1 - Chicken dinner:                      → plate scope for the tag rules
//   Potatoes baked - 150 g - salt, pepper parsley
//   Chicken - 180 g - salt, black pepper, sprinkle of paprika
//   Sheet pan vegetables - 210 g - carrots, cauliflower, mushrooms, …   (composite)
//   Two slices wheat bread, one half medium avocado, one tbsp hummus, 1/2 tuna can - 70 g
//   One egg large - 40g kale, sprinkle of tomatoes, olive oil fried
//   1/2 cup uncooked oatmeal with water and honey one tbsp
//   Raspberry 60 g, mango 80 g, kiwi 50 g
// =============================================================================

export type GtBasis = 'weighed' | 'estimated' | 'converted'
export type GtState = 'cooked' | 'dry' | 'raw'

export type GtItemDraft = {
  dish: string
  name: string
  grams: number | null
  basis: GtBasis | null
  tag: GtTag
  state: GtState | null
  componentsNote: string | null
  order: number
}

export type StructuredNotes = {
  items: GtItemDraft[]
  /** hidden-fat checks and estimates the owner must confirm — never auto-answered */
  questions: string[]
  /** beverages and other segments dropped (TAG-GUIDE rule 11) */
  dropped: string[]
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
}
const UNIT_WORDS = 'tbsp|tbsps|tablespoons?|tsp|tsps|teaspoons?|cups?|slices?|pieces?|pcs?|handfuls?|scoops?|cans?|tins?|medium|med|small|large|big|oz|ounces?'

/** number words, fractions and "and a half" → decimals, so "two and half
    slices" survives the later split on " and ". */
export function normalizeQuantities(text: string): string {
  let s = text.toLowerCase()
  s = s.replace(/\b(\d+)\s*\/\s*(\d+)\b/g, (_m, a, b) => String(Math.round((Number(a) / Number(b)) * 1000) / 1000))
  s = s.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+and\s+(?:a\s+)?half\b/g, (_m, w) => String(NUMBER_WORDS[w] + 0.5))
  s = s.replace(/\b(\d+(?:\.\d+)?)\s+and\s+(?:a\s+)?half\b/g, (_m, n) => String(parseFloat(n) + 0.5))
  s = s.replace(/\b(?:one|a)\s+half\s+(?:of\s+)?(?:a\s+|an\s+)?/g, '0.5 ')
  s = s.replace(/\bhalf\s+(?:of\s+)?(?:a\s+|an\s+)?/g, '0.5 ')
  s = s.replace(/\b(?:one|a)\s+quarter\s+(?:of\s+)?(?:a\s+|an\s+)?/g, '0.25 ')
  s = s.replace(/\b(?:one|a)\s+third\s+(?:of\s+)?(?:a\s+|an\s+)?/g, '0.333 ')
  s = s.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/g, (_m, w) => String(NUMBER_WORDS[w]))
  s = s.replace(new RegExp(`\\b(?:a|an)\\s+(?=(?:${UNIT_WORDS})\\b)`, 'g'), '1 ')
  return s
}

const PLATE_LINE = /^\s*(?:\d+[.)]\s*)?(?:plate|bowl|dish)\s*(\d+|one|two|three|four|five)?\s*[-–:]\s*(.*?)\s*:?\s*$/i  // accepts a list marker ("1. Plate 1 - …") and a spelled-out number ("Plate one:")
const SEGMENT_SPLIT = /(\s+[-–]\s+|\s*[,;]\s*|\s+with\s+|\s+and\s+|\s+plus\s+)/i
const GRAMS_ONLY = /^~?\s*(\d+(?:\.\d+)?)\s*(?:g|grams?)\s*(?:est\.?|estimated)?\s*$/i
const GRAMS_INLINE = /~?\s*(\d+(?:\.\d+)?)\s*(?:g|grams?)\b\.?/i
const HEDGE = /(~|\best\b|\bestimated\b|\babout\b|\bmaybe\b|\broughly\b|\bapprox\w*\b)/i
const SMALL_QUALIFIER = /\b(?:a\s+)?(?:sprinkle|sprinkles|dash|pinch|squeeze|drizzle|splash|touch|bit|spray)\s+(?:of\s+)?/i
const METHOD_WORDS: [RegExp, string][] = [
  [/\b(?:deep[- ]?fried|pan[- ]?fried|fried|fry)\b/i, 'fried'],
  [/\b(?:stir[- ]?fried|stir[- ]?fry|saut[ée]ed|sauteed)\b/i, 'sautéed'],
  [/\b(?:sheet[- ]?pan|roasted|roast)\b/i, 'roasted'],
  [/\bbaked\b/i, 'baked'],
  [/\bgrilled\b/i, 'grilled'],
  [/\bboiled\b/i, 'boiled'],
  [/\bsteamed\b/i, 'steamed'],
  [/\bscrambled\b/i, 'scrambled'],
  [/\bpoached\b/i, 'poached'],
]
const HIDDEN_FAT_METHODS = new Set(['fried', 'sautéed', 'roasted'])
const STATE_WORDS: [RegExp, GtState][] = [
  [/\b(?:uncooked|dry|dried)\b/i, 'dry'],
  [/\braw\b/i, 'raw'],
  [/\bcooked\b/i, 'cooked'],
]
const STOPWORDS = /\b(?:of|a|an|the|some|fresh|my|plain|regular|homemade|home made)\b/gi

type ParsedSegment = {
  raw: string
  name: string
  canonical: string
  cls: FoodClass
  grams: number | null
  basis: GtBasis | null
  quantity: number | null
  unit: UnitKey | null
  method: string | null
  stateWord: GtState | null
  smallQualifier: boolean
  /** extra foods found in the same segment (e.g. "pepper parsley") */
  siblings: ParsedSegment[]
}

function titleCase(s: string): string {
  return s.replace(/^./, (c) => c.toUpperCase())
}

function parseSegment(raw: string): ParsedSegment | null {
  let s = raw.trim()
  if (!s) return null
  const hedged = HEDGE.test(s)
  let grams: number | null = null
  const gm = s.match(GRAMS_INLINE)
  if (gm) {
    grams = parseFloat(gm[1])
    s = s.replace(gm[0], ' ')
  }
  s = s.replace(HEDGE, ' ')
  let method: string | null = null
  for (const [re, name] of METHOD_WORDS) {
    if (re.test(s)) {
      method = name
      s = s.replace(re, ' ')
      break
    }
  }
  let stateWord: GtState | null = null
  for (const [re, st] of STATE_WORDS) {
    if (re.test(s)) {
      stateWord = st
      s = s.replace(re, ' ')
      break
    }
  }
  const smallQualifier = SMALL_QUALIFIER.test(s)
  s = s.replace(SMALL_QUALIFIER, ' ')
  let quantity: number | null = null
  let unit: UnitKey | null = null
  const qm = s.match(/(\d+(?:\.\d+)?)/)
  if (qm) {
    quantity = parseFloat(qm[1])
    s = s.replace(qm[0], ' ')
  }
  const um = s.match(new RegExp(`\\b(${UNIT_WORDS})\\b`, 'i'))
  if (um) {
    unit = normalizeUnit(um[1])
    s = s.replace(um[0], ' ')
  }
  if (quantity != null && unit == null) unit = 'piece'
  s = s.replace(STOPWORDS, ' ').replace(/\s+/g, ' ').trim()
  const foods = findFoods(s)
  if (foods.length === 0) {
    const name = s.replace(/[^a-z0-9 '-]/gi, '').trim()
    if (!name) return null
    return {
      raw, name: titleCase(name), canonical: name, cls: 'unknown', grams, basis: grams != null ? (hedged ? 'estimated' : 'weighed') : null,
      quantity, unit, method, stateWord, smallQualifier, siblings: [],
    }
  }
  const primary = foods[foods.length - 1]
  const hasQuantity = grams != null || quantity != null
  const base: ParsedSegment = {
    raw,
    name: primary.canonical,
    canonical: primary.canonical,
    cls: primary.cls,
    grams,
    basis: grams != null ? (hedged ? 'estimated' : 'weighed') : null,
    quantity,
    unit,
    method,
    stateWord,
    smallQualifier,
    siblings: [],
  }
  if (foods.length > 1 && hasQuantity) {
    // one quantified item named by the whole phrase ("peanut butter toast 60 g")
    base.name = s
  } else if (foods.length > 1) {
    // "pepper parsley", "salt pepper" — separate gram-less items
    base.name = foods[0].canonical
    base.canonical = foods[0].canonical
    base.cls = foods[0].cls
    base.siblings = foods.slice(1).map((f) => ({
      ...base, name: f.canonical, canonical: f.canonical, cls: f.cls, siblings: [],
    }))
  }
  return base
}

const COMPOSITE_HEAD = /vegetables|salad|stew|soup|curry|stir fry|egusi/

function isBeverage(seg: ParsedSegment): boolean {
  return seg.cls === 'beverage'
}

/** Notes prose for ONE photo scene → tagged item drafts + questions. */
export function parseNotesToGtItems(text: string): StructuredNotes {
  const questions: string[] = []
  const dropped: string[] = []
  type PlateItem = ParsedSegment & { dish: string; components: string[] | null; converted: string | null }
  type Plate = { label: string | null; items: PlateItem[]; methods: Set<string> }
  const plates: Plate[] = []
  let plate: Plate = { label: null, items: [], methods: new Set() }
  plates.push(plate)

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const pl = line.match(PLATE_LINE)
    if (pl) {
      plate = { label: pl[2].trim() || `Plate ${pl[1] ?? plates.length + 1}`, items: [], methods: new Set() }
      plates.push(plate)
      continue
    }
    // split keeps the delimiters so "coffee with milk" can drop the milk too
    const pieces = normalizeQuantities(line).split(SEGMENT_SPLIT)
    const segments: { text: string; joinedWith: string }[] = []
    for (let i = 0; i < pieces.length; i += 2) {
      const text = pieces[i].trim()
      if (text) segments.push({ text, joinedWith: (pieces[i - 1] ?? '').trim().toLowerCase() })
    }
    const lineItems: PlateItem[] = []
    let lastDropped = false
    for (const { text: seg, joinedWith } of segments) {
      const g = seg.match(GRAMS_ONLY)
      if (g) {
        const prev = lineItems[lineItems.length - 1]
        if (prev) {
          prev.grams = parseFloat(g[1])
          prev.basis = /est/i.test(seg) || seg.includes('~') ? 'estimated' : 'weighed'
        }
        continue
      }
      const parsed = parseSegment(seg)
      if (!parsed) continue
      // "coffee with milk" / "tea and sugar": the add-in goes with the drink
      const addIn = lastDropped && joinedWith === 'with' && (parsed.cls === 'dairy' || parsed.cls === 'spread' || parsed.canonical === 'sugar')
      lastDropped = false
      for (const p of [parsed, ...parsed.siblings]) {
        if (isBeverage(p) || addIn) {
          dropped.push(p.raw)
          lastDropped = true
          continue
        }
        if (p.method) plate.methods.add(p.method)
        lineItems.push({ ...p, dish: '', components: null, converted: null })
      }
    }
    if (lineItems.length === 0) continue
    const head = lineItems[0]
    // composite head ("Sheet pan vegetables - 186 g - Brussels sprouts, …"):
    // gram-less food segments after it are components, not items
    if (head.cls === 'composite' && COMPOSITE_HEAD.test(head.canonical) && head.grams != null) {
      const comps: string[] = []
      const kept: PlateItem[] = [head]
      for (const it of lineItems.slice(1)) {
        const isComponent = it.grams == null && it.quantity == null && ['vegetable', 'fruit', 'protein', 'starch', 'unknown', 'composite'].includes(it.cls)
        if (isComponent) comps.push(it.raw.replace(/\s+/g, ' ').trim())
        else kept.push(it)
      }
      if (comps.length) head.components = comps
      if (head.method) head.name = `${head.method} ${head.canonical}`
      lineItems.splice(0, lineItems.length, ...kept)
    }
    const dish = plate.label ?? titleCase(head.name)
    for (const it of lineItems) it.dish = dish
    // a cooking method on any segment of the line applies to the line's head
    const lineMethod = lineItems.map((i) => i.method).find(Boolean) ?? null
    if (lineMethod && !head.method) head.method = lineMethod
    plate.items.push(...lineItems)
  }

  const items: GtItemDraft[] = []
  let order = 0
  for (const p of plates) {
    if (p.items.length === 0) continue
    const taggable: TaggableItem[] = p.items.map((i) => ({
      cls: i.cls, canonical: i.canonical, grams: i.grams, quantity: i.quantity, unit: i.unit, smallQualifier: i.smallQualifier,
    }))
    const seenIgnore = new Set<string>()
    const explicitFats = p.items.filter((i) => i.cls === 'fat')
    for (let k = 0; k < p.items.length; k++) {
      const it = p.items[k]
      const tag = tagFor(taggable[k], taggable)
      if (tag === 'ignore') {
        if (seenIgnore.has(it.canonical)) continue
        seenIgnore.add(it.canonical)
        items.push({ dish: it.dish, name: it.name, grams: null, basis: null, tag, state: null, componentsNote: null, order: order++ })
        continue
      }
      let grams = it.grams
      let basis = it.basis
      let state: GtState | null = it.method ? 'cooked' : it.stateWord === 'raw' ? 'raw' : it.stateWord
      let componentsNote = it.components ? it.components.join(', ') : null
      if (grams == null) {
        if (/^oats$/.test(it.canonical) && (it.stateWord === 'dry' || it.unit === 'cup') && it.quantity != null) {
          // dry oats → cooked as served (TAG-GUIDE example: 1/3 cup dry 27 g → 175 g)
          const dry = estimateGrams('oats', it.quantity, it.unit ?? 'cup')
          if (dry) {
            grams = Math.round(dry.grams * OATS_COOKED_PER_DRY)
            basis = 'converted'
            state = 'cooked'
            componentsNote = `from ${dry.grams} g dry oats`
          }
        } else if (it.cls === 'fat' && (p.methods.size > 0 || it.method) && it.quantity == null) {
          grams = UNSTATED_COOKING_FAT_G
          basis = 'estimated'
          questions.push(`Hidden fat: ${it.name} for "${it.dish}" has no amount — estimated ${UNSTATED_COOKING_FAT_G} g (garnish); confirm or give tbsp/tsp.`)
        } else if (it.quantity != null) {
          const est = estimateGrams(it.canonical, it.quantity, it.unit)
          if (est) {
            grams = est.grams
            basis = 'estimated'
          }
        }
        if (grams == null && (tag === 'core' || tag === 'secondary')) {
          const fallback = DEFAULT_PORTION_G[it.cls] ?? DEFAULT_PORTION_G.unknown
          grams = fallback
          basis = 'estimated'
          questions.push(`No quantity for ${it.name} ("${it.dish}") — defaulted to ${fallback} g ${it.cls} portion; confirm.`)
        }
      }
      if (grams != null && basis == null) basis = 'weighed'
      items.push({ dish: it.dish, name: it.name, grams, basis, tag, state, componentsNote, order: order++ })
    }
    // hidden-fat check on every roasted / fried / sautéed dish (METRICS.md)
    const fatMethods = [...p.methods].filter((m) => HIDDEN_FAT_METHODS.has(m))
    if (fatMethods.length && explicitFats.length === 0) {
      const named = [...new Set(p.items.filter((i) => i.method && HIDDEN_FAT_METHODS.has(i.method)).map((i) => i.name))]
      const target = named.length ? named.join(', ') : p.label ?? 'this plate'
      questions.push(`Hidden fat: was oil used for ${target} (${fatMethods.join('/')})? Add it as an item with grams (1 tbsp ≈ 14 g).`)
    }
  }
  return { items, questions, dropped }
}
