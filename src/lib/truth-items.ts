/* GtItem rows → scoring TruthItem[] (src/lib/scoring/types.ts). Pure; the
   db read lives in the runners. Resolves one METRICS/schema gap:
   GtItem.componentsNote is free text ("Brussels sprouts, sweet potatoes,
   broccoli, zucchini, onions" for a composite; "27 g dry" for a converted
   item). Only a comma-separated list of ≥ 2 digit-free names is treated as
   a components list (Level 2 equal split); anything else is a note. */
import type { Basis, Tag, TruthItem } from './scoring/types'

export type GtItemLike = {
  id: string
  dish: string
  name: string
  grams: number | null
  basis: Basis | null
  tag: Tag
  state: string | null
  componentsNote: string | null
  hidden?: boolean | null
  order?: number
}

// Words that never appear in a plain food name but do in a free-text note:
// prepositions/conjunctions ("fried in avocado oil with spinach"), verbs
// ("used for frying", "defaulted to"), quantities ("one tbsp", "half medium").
const NOTE_WORDS =
  /\b(with|for|in|of|from|as|per|to|no|not|used|use|using|default|defaulted|stated|given|differs|note|amount|one|two|three|four|half|quarter|tbsp|tsp|cup|cups|slice|slices|medium|small|large|sprinkle|table|rule|cooking|frying|about|approx|standard|only|some|extra|liquid|water|unit|household|weight|dry|served|serving)\b/i

/** True when `part` reads as a short food name: 1–3 words, letters only
    (hyphen/apostrophe allowed), no digits, no note words. */
export function isShortFoodName(part: string): boolean {
  const p = part.trim()
  if (p.length === 0 || /\d/.test(p)) return false
  if (!/^[\p{L}][\p{L}' -]*$/u.test(p)) return false
  const words = p.split(/\s+/)
  if (words.length > 3) return false
  return !NOTE_WORDS.test(p)
}

/** "a, b, c" (also `·` `/` `;` `|` or " and ") → ['a','b','c'] when EVERY
    part is a short food name and there are ≥ 2 of them; anything else — a
    conversion note ("27 g dry"), a preparation note ("sautéed with avocado
    oil, salt, pepper"), a quantity note ("One tbsp honey") — is a note, not
    a components list, and yields undefined. */
export function parseComponents(note: string | null | undefined): string[] | undefined {
  if (!note) return undefined
  const parts = note
    .split(/[,;·|/]|\band\b/)
    .map((p) => p.trim().replace(/\.$/, '').trim())
    .filter((p) => p.length > 0)
  if (parts.length < 2) return undefined
  if (!parts.every(isShortFoodName)) return undefined
  return parts.map((p) => p.toLowerCase())
}

/** "romaine 90 g, wild rice 110 g, grilled chicken 70 g" → names + relative
    weights (Level 2 splits the item's one weight in these proportions instead
    of equally). Only when EVERY part is `<short food name> <number> g`. */
export function parseWeightedComponents(note: string | null | undefined): { names: string[]; weights: number[] } | undefined {
  if (!note) return undefined
  const parts = note
    .split(/[,;·|]/)
    .map((p) => p.trim().replace(/\.$/, '').trim())
    .filter((p) => p.length > 0)
  if (parts.length < 2) return undefined
  const names: string[] = []
  const weights: number[] = []
  for (const part of parts) {
    const m = part.match(/^(.+?)\s*\(?\s*(\d+(?:\.\d+)?)\s*g\s*\)?$/i)
    if (!m || !isShortFoodName(m[1])) return undefined
    const w = Number(m[2])
    if (!(w > 0)) return undefined
    names.push(m[1].trim().toLowerCase())
    weights.push(w)
  }
  return { names, weights }
}

export function gtItemToTruth(row: GtItemLike): TruthItem {
  const t: TruthItem = {
    id: row.id,
    dish: row.dish,
    name: row.name,
    basis: row.basis ?? 'estimated',
    tag: row.tag,
  }
  if (typeof row.grams === 'number' && Number.isFinite(row.grams)) t.grams = row.grams
  if (row.state) t.state = row.state
  if (row.hidden) t.hidden = true
  const weighted = parseWeightedComponents(row.componentsNote)
  if (weighted) {
    t.components = weighted.names
    t.componentWeights = weighted.weights
  } else {
    const comps = parseComponents(row.componentsNote)
    if (comps) t.components = comps
  }
  return t
}

export function gtItemsToTruth(rows: GtItemLike[]): TruthItem[] {
  return [...rows].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(gtItemToTruth)
}

/** weighed grams / all gram-bearing grams over non-ignore truth items (export `weighed_share`). */
export function weighedShare(items: TruthItem[]): number | null {
  let all = 0
  let weighed = 0
  for (const t of items) {
    if (t.tag === 'ignore' || typeof t.grams !== 'number') continue
    all += t.grams
    if (t.basis === 'weighed') weighed += t.grams
  }
  return all > 0 ? weighed / all : null
}
