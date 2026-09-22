/* Entity resolution for distillation (CORPUS.md §3): dish instances →
   clusters (one future DishCard each).
     1. group instances by normalized dish name
     2. candidate merge between two groups when their names share ≥ 2 content
        tokens OR their typical-ingredient sets overlap (Jaccard) ≥ 0.6
     3. greedy agglomeration by instance count: a group joins an existing
        cluster only when `confirm(group, cluster.head)` says "same dish" —
        the pinned model in real mode, `mockConfirm` in mock mode
        (deterministic: one name's content words contain the other's, or the
        names share a NON-generic word AND the typical-ingredient sets overlap
        ≥ 0.6). Confirming against the head, never transitively, is what keeps
        "Lentil soup" from chaining into "Minestrone soup" via "soup" (union-find
        over accept-all produced one 507-instance cluster on the real corpus).
     4. canonical name = the most frequent raw name in the cluster (ties →
        shortest); aliases = every other raw name variant, by frequency
   Pure and async only because of `confirm`. */
import { dishTokens, jaccard, normalizeDishName, normalizeIngredientName } from './normalize'

export type ResolveInstance = {
  id: string
  name: string
  /** raw ingredient names of this instance */
  ingredientNames: string[]
}

export type NameGroup = {
  key: string
  names: Map<string, number> // raw name → count
  tokens: Set<string>
  /** ingredients present in ≥ 50% of the group's instances (normalized) */
  typicalIngredients: Set<string>
  instanceIds: string[]
}

export type MergeCandidate = { a: NameGroup; b: NameGroup; reason: 'tokens' | 'ingredients'; score: number }

export type Cluster = {
  canonicalName: string
  aliases: string[]
  instanceIds: string[]
  groupKeys: string[]
}

export type ResolveOptions = {
  tokenShareMin?: number // default 2
  ingredientJaccardMin?: number // default 0.6
  /** "same dish?" — return true to merge. Omitted = `mockConfirm` (deterministic). */
  confirm?: (a: NameGroup, b: NameGroup, reason: MergeCandidate['reason']) => Promise<boolean>
}

/** Deterministic "same dish?" for mock mode. Same when one name's content
    tokens contain the other's (≥ 2 tokens on the smaller side: "Lentil Soup"
    ⊂ "Lentil Soup with Goat Meat"), or when the names share at least one
    token AND the typical-ingredient sets overlap (Jaccard ≥ 0.6: "Fresh
    Mango" / "Mango Slices"). "Rice" vs "Fried Rice" fails both. */
export function mockConfirm(a: NameGroup, b: NameGroup, ingredientJaccardMin = 0.6): boolean {
  let shared = 0
  let specific = 0
  for (const t of a.tokens) {
    if (!b.tokens.has(t)) continue
    shared++
    if (!GENERIC_TOKENS.has(t)) specific++
  }
  const minSize = Math.min(a.tokens.size, b.tokens.size)
  if (minSize >= 2 && shared === minSize) return true
  if (specific >= 1 && a.typicalIngredients.size > 0 && b.typicalIngredients.size > 0) {
    return jaccard(a.typicalIngredients, b.typicalIngredients) >= ingredientJaccardMin
  }
  return false
}

/** Category / cooking-method words that two DIFFERENT dishes routinely share. */
const GENERIC_TOKENS = new Set([
  'soup', 'stew', 'sauce', 'salad', 'toast', 'sandwich', 'wrap', 'fruit', 'mixed', 'fresh', 'plain', 'simple', 'cooked', 'raw',
  'fried', 'baked', 'boiled', 'grilled', 'roasted', 'steamed', 'sauteed', 'sautéed', 'scrambled', 'slice', 'cut', 'ripe', 'whole',
  'small', 'medium', 'large', 'mini', 'side', 'dish', 'meal', 'snack', 'breakfast', 'lunch', 'dinner', 'vegetable', 'meat', 'chunk',
])

export type ResolveResult = {
  clusters: Cluster[]
  groups: number
  candidates: MergeCandidate[]
  accepted: number
}

export function groupByName(instances: ResolveInstance[]): NameGroup[] {
  const by = new Map<string, NameGroup>()
  const ingrCounts = new Map<string, Map<string, number>>()
  for (const inst of instances) {
    const key = normalizeDishName(inst.name) || '(unnamed)'
    let g = by.get(key)
    if (!g) {
      g = { key, names: new Map(), tokens: dishTokens(inst.name), typicalIngredients: new Set(), instanceIds: [] }
      by.set(key, g)
      ingrCounts.set(key, new Map())
    }
    g.names.set(inst.name, (g.names.get(inst.name) ?? 0) + 1)
    g.instanceIds.push(inst.id)
    const ic = ingrCounts.get(key)!
    for (const n of new Set(inst.ingredientNames.map(normalizeIngredientName))) ic.set(n, (ic.get(n) ?? 0) + 1)
  }
  for (const g of by.values()) {
    const ic = ingrCounts.get(g.key)!
    const n = g.instanceIds.length
    for (const [name, c] of ic) if (c / n >= 0.5) g.typicalIngredients.add(name)
  }
  return [...by.values()]
}

export function findCandidates(groups: NameGroup[], opts: ResolveOptions = {}): MergeCandidate[] {
  const tokenMin = opts.tokenShareMin ?? 2
  const jacMin = opts.ingredientJaccardMin ?? 0.6
  const out: MergeCandidate[] = []
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      const c = candidateOf(groups[i], groups[j], tokenMin, jacMin)
      if (c) out.push(c)
    }
  }
  return out
}

export function canonicalOf(names: Map<string, number>): { canonicalName: string; aliases: string[] } {
  const sorted = [...names.entries()].sort((x, y) => y[1] - x[1] || x[0].length - y[0].length || x[0].localeCompare(y[0]))
  return { canonicalName: sorted[0][0], aliases: sorted.slice(1).map(([n]) => n) }
}

export async function resolveDishes(instances: ResolveInstance[], opts: ResolveOptions = {}): Promise<ResolveResult> {
  const tokenMin = opts.tokenShareMin ?? 2
  const jacMin = opts.ingredientJaccardMin ?? 0.6
  const groups = groupByName(instances).sort((a, b) => b.instanceIds.length - a.instanceIds.length || a.key.localeCompare(b.key))
  const candidates: MergeCandidate[] = []
  const heads: { head: NameGroup; members: NameGroup[] }[] = []
  let accepted = 0
  for (const g of groups) {
    const cands: MergeCandidate[] = []
    for (const cl of heads) {
      const c = candidateOf(g, cl.head, tokenMin, jacMin)
      if (c) cands.push(c)
    }
    cands.sort((x, y) => (x.reason === y.reason ? y.score - x.score : x.reason === 'tokens' ? -1 : 1))
    candidates.push(...cands)
    let joined = false
    for (const c of cands) {
      const ok = opts.confirm ? await opts.confirm(c.a, c.b, c.reason) : mockConfirm(c.a, c.b, jacMin)
      if (!ok) continue
      accepted++
      heads.find((h) => h.head === c.b)!.members.push(g)
      joined = true
      break
    }
    if (!joined) heads.push({ head: g, members: [g] })
  }
  const clusters: Cluster[] = heads.map(({ members }) => {
    const names = new Map<string, number>()
    const instanceIds: string[] = []
    for (const g of members) {
      for (const [n, c] of g.names) names.set(n, (names.get(n) ?? 0) + c)
      instanceIds.push(...g.instanceIds)
    }
    return { ...canonicalOf(names), instanceIds, groupKeys: members.map((g) => g.key) }
  })
  clusters.sort((x, y) => y.instanceIds.length - x.instanceIds.length || x.canonicalName.localeCompare(y.canonicalName))
  return { clusters, groups: groups.length, candidates, accepted }
}

/** The candidate rule for one (group, head) pair; null when neither test fires. */
function candidateOf(a: NameGroup, b: NameGroup, tokenMin: number, jacMin: number): MergeCandidate | null {
  let shared = 0
  for (const t of a.tokens) if (b.tokens.has(t)) shared++
  if (shared >= tokenMin) return { a, b, reason: 'tokens', score: shared }
  if (a.typicalIngredients.size > 0 && b.typicalIngredients.size > 0) {
    const jac = jaccard(a.typicalIngredients, b.typicalIngredients)
    if (jac >= jacMin) return { a, b, reason: 'ingredients', score: jac }
  }
  return null
}
