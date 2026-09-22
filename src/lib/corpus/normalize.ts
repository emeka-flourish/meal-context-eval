/* Name normalization + set similarity shared by entity resolution
   (lib/corpus/resolve.ts), the retrieval cascade (lib/retrieval/cascade.ts)
   and the routine rule (lib/corpus/routine.ts). One definition so a card's
   alias and a query normalize identically. Pure. */
import { normalizeIngredientName } from '../fdc'

export { normalizeIngredientName }

/** Dish-name key: the ingredient normalizer (lowercase, parentheticals
    stripped) plus punctuation → space. "Lentil Soup (Half Portion)" → "lentil soup". */
export function normalizeDishName(name: string): string {
  return normalizeIngredientName(name)
    .replace(/[^a-z0-9À-ɏ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const STOPWORDS = new Set(['with', 'and', 'of', 'the', 'a', 'an', 'in', 'on', 'or', 'to', 'for', 'style', 'portion', 'half', 'bowl', 'plate'])

/** Light stemming: plural → singular, -ed → base for a few food adjectives. */
function stem(t: string): string {
  if (t.length > 3 && t.endsWith('ies')) return t.slice(0, -3) + 'y'
  if (t.length > 3 && t.endsWith('es') && /[sxz]es$|[cs]hes$/.test(t)) return t.slice(0, -2)
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1)
  if (t === 'sliced') return 'slice'
  return t
}

/** Content tokens of a dish name: normalized, stopwords dropped, stemmed, deduplicated. */
export function dishTokens(name: string): Set<string> {
  const out = new Set<string>()
  for (const t of normalizeDishName(name).split(' ')) {
    if (!t || STOPWORDS.has(t)) continue
    out.add(stem(t))
  }
  return out
}

export function intersectionSize<T>(a: Set<T>, b: Set<T>): number {
  let n = 0
  for (const x of a) if (b.has(x)) n++
  return n
}

/** |A∩B| / |A∪B|; 0 when both are empty. */
export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  const i = intersectionSize(a, b)
  const u = a.size + b.size - i
  return u === 0 ? 0 : i / u
}

/** |A∩B| / min(|A|,|B|) — the "token overlap" of the retrieval cascade; 0 when either is empty. */
export function overlapCoefficient<T>(a: Set<T>, b: Set<T>): number {
  const m = Math.min(a.size, b.size)
  return m === 0 ? 0 : intersectionSize(a, b) / m
}

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  if (v.length === 0) return null
  const mid = Math.floor(v.length / 2)
  return v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

export const round = (n: number, dp = 3): number => Math.round(n * 10 ** dp) / 10 ** dp
