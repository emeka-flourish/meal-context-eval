/* Routine vs novel (CORPUS.md §5, METRICS "split by routine vs novel").
   A study scene is ROUTINE when any core GT item matches — through the same
   retrieval cascade, on the truth names (dish label, then item name) — a
   DishCard with instanceCount ≥ 3; else NOVEL. A property of the scene,
   identical across conditions; computed at analysis time from the truth.
   Pure; the db read + route live in src/app/api/corpus/routine. */
import { cascade, type CardIndex, type CascadeHit, type CascadeOptions } from '../retrieval/cascade'

export type RoutineItem = { dish: string; name: string; tag: string }
export type RoutineVerdict = {
  routine: boolean
  /** the truth name and card that decided it (first core hit), when routine */
  via: (CascadeHit & { query: string; instanceCount: number }) | null
  coreItems: number
}

export async function classifyRoutine(items: RoutineItem[], index: CardIndex, opts: CascadeOptions & { minInstances?: number } = {}): Promise<RoutineVerdict> {
  const min = opts.minInstances ?? 3
  const core = items.filter((i) => i.tag === 'core')
  const seen = new Set<string>()
  for (const it of core) {
    for (const query of [it.dish, it.name]) {
      const q = query.trim()
      if (!q || seen.has(q.toLowerCase())) continue
      seen.add(q.toLowerCase())
      const hit = await cascade(q, index, opts)
      if (!hit) continue
      const card = index.entries.find((e) => e.card.id === hit.cardId)!.card
      if (card.instanceCount >= min) return { routine: true, via: { ...hit, query: q, instanceCount: card.instanceCount }, coreItems: core.length }
    }
  }
  return { routine: false, via: null, coreItems: core.length }
}
