/* Client-side ground-truth item model + validation (TAG-GUIDE rule 10:
   core and secondary must carry grams; garnish and spice may not).
   Pure — mirrors the server-side checks in /api/intake/scenes/[id]/items. */

export type GtTag = 'core' | 'secondary' | 'garnish' | 'spice' | 'ignore'
export type GtBasis = 'weighed' | 'estimated' | 'converted'
export type GtState = 'cooked' | 'dry' | 'raw'

export const GT_TAGS: GtTag[] = ['core', 'secondary', 'garnish', 'spice', 'ignore']
export const GT_BASES: GtBasis[] = ['weighed', 'estimated', 'converted']
export const GT_STATES: GtState[] = ['cooked', 'dry', 'raw']

export const TAG_WEIGHT: Record<GtTag, number> = {
  core: 1,
  secondary: 0.5,
  garnish: 0.1,
  spice: 0.05,
  ignore: 0,
}

export type GtRow = {
  /** client key; DB id when persisted */
  key: string
  id?: string
  dish: string
  name: string
  grams: number | null
  basis: GtBasis | null
  tag: GtTag
  state: GtState | null
  componentsNote: string | null
}

export function newKey(): string {
  return Math.random().toString(36).slice(2, 10)
}

export function gramsRequired(tag: GtTag): boolean {
  return tag === 'core' || tag === 'secondary'
}

export function rowError(r: GtRow): string | null {
  if (!r.name.trim()) return 'name required'
  if (!r.dish.trim()) return 'dish required'
  if (gramsRequired(r.tag)) {
    if (r.grams == null || !(r.grams > 0)) return `${r.tag} needs grams`
    if (!r.basis) return 'basis required'
  }
  if (r.tag === 'ignore' && r.grams != null) return 'ignore items carry no grams'
  if (r.grams != null && r.grams > 0 && !r.basis) return 'basis required'
  return null
}

export function rowsValid(rows: GtRow[]): boolean {
  return rows.every((r) => rowError(r) === null)
}

/** Group rows by dish, preserving first-appearance order. */
export function groupByDish(rows: GtRow[]): { dish: string; rows: GtRow[] }[] {
  const order: string[] = []
  const map = new Map<string, GtRow[]>()
  for (const r of rows) {
    if (!map.has(r.dish)) {
      map.set(r.dish, [])
      order.push(r.dish)
    }
    map.get(r.dish)!.push(r)
  }
  return order.map((dish) => ({ dish, rows: map.get(dish)! }))
}

export function totalGrams(rows: GtRow[]): number {
  return rows.reduce((s, r) => s + (r.tag !== 'ignore' && r.grams ? r.grams : 0), 0)
}

/** Serialize for PUT /api/intake/scenes/[id]/items */
export function toPayload(rows: GtRow[]) {
  return rows.map((r, order) => ({
    dish: r.dish.trim(),
    name: r.name.trim(),
    grams: r.grams,
    basis: r.grams != null ? r.basis : null,
    tag: r.tag,
    state: r.state,
    componentsNote: r.componentsNote?.trim() ? r.componentsNote.trim() : null,
    order,
  }))
}

export type GtItemDto = {
  id?: string
  dish: string
  name: string
  grams: number | null
  basis: GtBasis | null
  tag: GtTag
  state: string | null
  componentsNote: string | null
  order: number
}

export function fromDto(items: GtItemDto[]): GtRow[] {
  return [...items]
    .sort((a, b) => a.order - b.order)
    .map((i) => ({
      key: i.id ?? newKey(),
      id: i.id,
      dish: i.dish,
      name: i.name,
      grams: i.grams,
      basis: i.basis,
      tag: i.tag,
      state: (GT_STATES as string[]).includes(i.state ?? '') ? (i.state as GtState) : null,
      componentsNote: i.componentsNote,
    }))
}

/** Hidden-fat question → the dish it targets (best effort on the structurer's
    phrasing: `Hidden fat: was oil used for <dish> (...)?` or
    `Hidden fat: <name> for "<dish>" has no amount`). */
export function dishFromQuestion(q: string, dishes: string[]): string | null {
  const quoted = q.match(/"([^"]+)"/)
  if (quoted && dishes.includes(quoted[1])) return quoted[1]
  const forM = q.match(/used for (.+?) \(/)
  if (forM) {
    const hit = dishes.find((d) => d.toLowerCase() === forM[1].toLowerCase())
    if (hit) return hit
  }
  const lower = q.toLowerCase()
  return dishes.find((d) => lower.includes(d.toLowerCase())) ?? null
}

export function isHiddenFatQuestion(q: string): boolean {
  return /hidden fat|oil/i.test(q)
}

/** Draft stash so a re-draft survives a reload until Confirm persists it. */
export const draftKey = (sceneId: string) => `vantage.gt-draft.${sceneId}`

export type SceneDraft = { rows: GtRow[]; questions: string[]; dropped: string[]; structurer: string; at: string }

export function loadDraft(sceneId: string): SceneDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(sceneId))
    return raw ? (JSON.parse(raw) as SceneDraft) : null
  } catch {
    return null
  }
}
export function saveDraft(sceneId: string, d: SceneDraft | null) {
  try {
    if (d) window.localStorage.setItem(draftKey(sceneId), JSON.stringify(d))
    else window.localStorage.removeItem(draftKey(sceneId))
  } catch {
    /* storage unavailable — draft lives in memory only */
  }
}
