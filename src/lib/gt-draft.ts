// GT-entry helpers (UX-REVIEW Batch A). Pure functions + localStorage draft
// persistence for the ground-truth editor: draft survival (#3), gt_method
// auto-suggest (#9), draft-coverage feedback (#5), payload cleanup before save.
// No React, no zod — safe for the client bundle; pure parts covered by tests.

export type DraftIngredient = {
  name: string
  grams?: number
  grams_est?: number
  grams_basis?: 'measured' | 'estimated'
  preparation?: string
  confidence?: 'low' | 'medium' | 'high'
}
export type DraftDish = {
  dishName: string
  portion?: { grams?: number; grams_est?: number; confidence?: 'low' | 'medium' | 'high' }
  preparation?: string
  batch?: { batch_total_grams: number; portion_fraction: number }
  ingredients: DraftIngredient[]
}
export type DraftPayload = {
  dishes: DraftDish[]
  condiments_and_uncertain: DraftIngredient[]
}

export type GtMethodValue = 'weighed_components' | 'weighed_meal_described' | 'attested_description'

const GT_METHOD_VALUES: GtMethodValue[] = [
  'weighed_components',
  'weighed_meal_described',
  'attested_description',
]

function allIngredients(payload: DraftPayload): DraftIngredient[] {
  return [...payload.dishes.flatMap((d) => d.ingredients), ...(payload.condiments_and_uncertain ?? [])]
}

// ---- gt_method auto-suggest (#9) ----------------------------------------
// Proposes a method from content; the TIER stays protocol-owned and derived
// server-side (tierForMethod). Any measured ingredient → weighed_components;
// else a plate total → weighed_meal_described; else attested_description.
// Pure: never looks at what the user previously chose — the caller decides
// whether an override is in effect (methodDirty flag).
export function suggestMethod(
  payload: DraftPayload | null,
  plateTotalGrams?: number | null,
): GtMethodValue {
  if (payload && allIngredients(payload).some((i) => i.grams_basis === 'measured')) {
    return 'weighed_components'
  }
  if (plateTotalGrams != null && plateTotalGrams > 0) return 'weighed_meal_described'
  return 'attested_description'
}

// ---- draft-coverage summary (#5) ----------------------------------------
export function summarizeDraft(payload: DraftPayload): string {
  const ings = allIngredients(payload)
  const weighed = ings.filter((i) => i.grams_basis === 'measured').length
  const dishes = `${payload.dishes.length} ${payload.dishes.length === 1 ? 'dish' : 'dishes'}`
  const ingredients = `${ings.length} ${ings.length === 1 ? 'ingredient' : 'ingredients'}`
  return `${dishes} · ${ingredients} (${weighed} weighed, ${ings.length - weighed} estimated)`
}

// Heuristic drop detection (#5): attestation segments (comma/newline-separated)
// that share no word with any drafted dish/ingredient name are flagged so
// silent model drops are visible. Ignores pure-number segments, segments under
// 3 chars, and filler words. Deliberately simple — a nudge, not a validator.
const FILLER = new Set([
  'the', 'and', 'with', 'plus', 'about', 'around', 'roughly', 'some',
  'plate', 'total', 'grams', 'gram', 'weighed', 'est', 'estimated',
])

function nameWords(s: string): string[] {
  return (s.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length >= 3 && !FILLER.has(w))
}

export function findDroppedSegments(attestation: string, payload: DraftPayload): string[] {
  const kept = new Set<string>()
  for (const d of payload.dishes) for (const w of nameWords(d.dishName)) kept.add(w)
  for (const i of allIngredients(payload)) for (const w of nameWords(i.name)) kept.add(w)
  return attestation
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 3) // too short to name anything
    .filter((s) => /[a-z]/i.test(s)) // pure-number segments carry no food name
    .filter((s) => {
      const words = nameWords(s)
      return words.length > 0 && !words.some((w) => kept.has(w))
    })
}

// ---- payload cleanup before POST/PATCH ----------------------------------
// Drops editor scaffolding the schema rejects or that carries no signal:
// nameless/zero-gram ingredients, dishes left empty, blank preparation
// strings, portion objects without any grams.
export function cleanPayloadForSave(payload: DraftPayload): DraftPayload {
  const cleanIng = (i: DraftIngredient): DraftIngredient => {
    const out = { ...i }
    if (!out.preparation?.trim()) delete out.preparation
    return out
  }
  return {
    ...payload,
    dishes: payload.dishes
      .map((d) => {
        const out: DraftDish = {
          ...d,
          ingredients: d.ingredients
            .filter((i) => i.name.trim() && (i.grams ?? 0) > 0)
            .map(cleanIng),
        }
        if (!out.preparation?.trim()) delete out.preparation
        if (out.portion && !((out.portion.grams ?? 0) > 0 || (out.portion.grams_est ?? 0) > 0)) {
          delete out.portion
        }
        return out
      })
      .filter((d) => d.dishName.trim() && d.ingredients.length > 0),
    condiments_and_uncertain: (payload.condiments_and_uncertain ?? [])
      .filter((i) => i.name.trim())
      .map((i) => {
        const out = cleanIng(i)
        if (!((out.grams ?? 0) > 0)) delete out.grams
        if (!((out.grams_est ?? 0) > 0)) delete out.grams_est
        return out
      }),
  }
}

// ---- localStorage draft survival (#3) -----------------------------------
// Everything in-progress — attestation, plate total, structured draft, method
// + override flag — persists per meal so dinner-table dictations survive
// navigation. encode/decode are pure (tested); load/save/clear wrap storage.

export type GtDraftState = {
  attestation: string
  plateTotal: string
  method: GtMethodValue
  methodDirty: boolean
  draft: DraftPayload | null
}

export const draftStorageKey = (mealId: string) => `gt-draft-${mealId}`

export function isEmptyDraftState(s: GtDraftState): boolean {
  return !s.attestation.trim() && !s.plateTotal.trim() && s.draft === null
}

export function encodeDraftState(s: GtDraftState): string {
  return JSON.stringify(s)
}

export function decodeDraftState(raw: string | null): GtDraftState | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Record<string, unknown> | null
    if (!p || typeof p !== 'object') return null
    if (typeof p.attestation !== 'string') return null
    const draft = p.draft as DraftPayload | null | undefined
    return {
      attestation: p.attestation,
      plateTotal: typeof p.plateTotal === 'string' ? p.plateTotal : '',
      method: GT_METHOD_VALUES.includes(p.method as GtMethodValue)
        ? (p.method as GtMethodValue)
        : 'attested_description',
      methodDirty: Boolean(p.methodDirty),
      draft: draft && typeof draft === 'object' && Array.isArray(draft.dishes) ? draft : null,
    }
  } catch {
    return null
  }
}

export function loadDraftState(mealId: string): GtDraftState | null {
  if (typeof window === 'undefined') return null
  try {
    return decodeDraftState(window.localStorage.getItem(draftStorageKey(mealId)))
  } catch {
    return null
  }
}

export function saveDraftState(mealId: string, s: GtDraftState): void {
  if (typeof window === 'undefined') return
  try {
    if (isEmptyDraftState(s)) window.localStorage.removeItem(draftStorageKey(mealId))
    else window.localStorage.setItem(draftStorageKey(mealId), encodeDraftState(s))
  } catch {
    // quota / private mode — draft survival is best-effort
  }
}

export function clearDraftState(mealId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(draftStorageKey(mealId))
  } catch {
    // ignore
  }
}
