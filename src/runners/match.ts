/* Blind matcher (METRICS.md "Match table per photo"). Input is ONLY
   {truthItems, predItems} — never camera, condition, model or run. Pinned
   model (MATCHER_MODEL_ID), temperature 0, prompt prompts/<MATCHER_PROMPT_VERSION>.md. The
   model's output is validated into the scoring MatchTable
   (src/lib/scoring/types.ts) and persisted; the owner's on-screen overrides are
   stored beside it and applied on READ (readMatchTable), so the model's
   table and the override rate stay auditable.

   Mock mode (MOCK_LLM=1 or no key) = mockMatch: deterministic
   name-normalized matching (normalizeIngredientName + token overlap):
     pass 1  exact normalized name → exact row
     pass 2  prediction's dish == a truth item's name, or prediction name is
             one of the truth item's components → joins that row (many-to-one)
     pass 3  token overlap (containment / Jaccard ≥ 0.5) → exact row
     rest    invented, tagged by a keyword guide; drinks dropped
   On the METRICS worked lunch case this reproduces the case-1 table. */
import { z } from 'zod'
import { db } from '@/lib/db'
import { runLlm } from '@/lib/llm'
import { CONFIG, loadPrompt, systemSection } from '@/lib/config'
import { normalizeIngredientName } from '@/lib/fdc'
import { gtItemsToTruth } from '@/lib/truth-items'
import { predItemsOf } from './interpret'
import type { Identity, InventedEntry, MatchRow, MatchTable, PredItem, Tag, TruthItem } from '@/lib/scoring/types'

export const MATCH_TABLE_VERSION = 'match-table.v1'

/* ---- LLM schema ------------------------------------------------------------ */
const identityWord = z.enum(['exact', 'substitute', 'wrong'])
const tagWord = z.enum(['core', 'secondary', 'garnish', 'spice', 'ignore'])

export const matchLlmSchema = z.object({
  rows: z.array(
    z.object({
      truth_ids: z.array(z.string()),
      pred_ids: z.array(z.string()),
      identity: identityWord,
      note: z.string().nullable(),
    }),
  ),
  invented: z.array(z.object({ pred_id: z.string(), tag: tagWord, note: z.string().nullable() })),
  dropped_drinks: z.array(z.string()),
})
export type MatchLlmOutput = z.infer<typeof matchLlmSchema>

const IDENTITY: Record<z.infer<typeof identityWord>, Identity> = { exact: 1, substitute: 0.5, wrong: 0 }

/** Validate model output against the known ids: unknown ids dropped, a
    prediction id used at most once (first use wins: rows, then invented, then
    drinks), every truth id in exactly one row (unpaired → empty row), every
    leftover prediction → invented (tag garnish, the level1 default). */
export function validateMatchOutput(raw: MatchLlmOutput, truth: TruthItem[], preds: PredItem[]): MatchTable {
  const truthIds = new Set(truth.map((t) => t.id))
  const predIds = new Set(preds.map((p) => p.id))
  const usedTruth = new Set<string>()
  const usedPred = new Set<string>()
  const rows: MatchRow[] = []
  for (const r of raw.rows) {
    const tIds = r.truth_ids.filter((id) => truthIds.has(id) && !usedTruth.has(id))
    if (tIds.length === 0) continue
    const pIds = r.pred_ids.filter((id) => predIds.has(id) && !usedPred.has(id))
    for (const id of tIds) usedTruth.add(id)
    for (const id of pIds) usedPred.add(id)
    rows.push({ truthIds: tIds, predIds: pIds, identity: pIds.length === 0 ? 0 : IDENTITY[r.identity] })
  }
  for (const t of truth) if (!usedTruth.has(t.id)) rows.push({ truthIds: [t.id], predIds: [], identity: 0 })

  const invented: InventedEntry[] = []
  for (const inv of raw.invented) {
    if (!predIds.has(inv.pred_id) || usedPred.has(inv.pred_id)) continue
    usedPred.add(inv.pred_id)
    invented.push({ predId: inv.pred_id, tag: inv.tag })
  }
  const droppedDrinks: string[] = []
  for (const id of raw.dropped_drinks) {
    if (!predIds.has(id) || usedPred.has(id)) continue
    usedPred.add(id)
    droppedDrinks.push(id)
  }
  for (const p of preds) {
    if (usedPred.has(p.id)) continue
    usedPred.add(p.id)
    if (p.isDrink) droppedDrinks.push(p.id)
    else invented.push({ predId: p.id, tag: 'garnish' })
  }
  return { rows, invented, droppedDrinks }
}

/* ---- mock matcher ---------------------------------------------------------- */
const STOP = new Set(['and', 'or', 'with', 'of', 'in', 'the', 'a', 'fresh', 'roasted', 'baked', 'fried', 'grilled', 'steamed', 'boiled', 'cooked', 'raw', 'sliced', 'chopped', 'diced', 'mixed'])
const stem = (w: string) => w.replace(/(ies)$/, 'y').replace(/(oes|es|s)$/, (m) => (m === 'oes' ? 'o' : ''))
export function nameTokens(name: string): string[] {
  return normalizeIngredientName(name)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem)
}
const tokenKey = (name: string) => nameTokens(name).sort().join(' ')

function overlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const sa = new Set(a)
  const sb = new Set(b)
  let inter = 0
  for (const x of sa) if (sb.has(x)) inter++
  const contained = inter === sa.size || inter === sb.size
  const jaccard = inter / (sa.size + sb.size - inter)
  return contained ? Math.max(jaccard, 0.5) : jaccard
}

const IGNORE_RE = /^(salt|sea salt|black pepper|pepper|white pepper|water|ice|ice cubes?)$/
const SPICE_RE = /\b(garlic|curry|chili|chilli|cumin|paprika|turmeric|cinnamon|nutmeg|oregano|thyme|basil|rosemary|herbs?|seasoning|spice|ginger|cayenne|pepper flakes|powder)\b/
const GARNISH_RE = /\b(lemon|lime|parsley|cilantro|coriander|chives|scallion|spring onion|seeds?|sesame|oil|butter|ghee|dressing|ketchup|mayo|mayonnaise|mustard|hot sauce|sauce|zest|wedge|sprig)\b/

/** Tag an invented prediction by a keyword guide, then by grams (TAG-GUIDE roles). */
export function mockInventedTag(p: PredItem): Tag {
  const n = normalizeIngredientName(p.name)
  if (IGNORE_RE.test(n)) return 'ignore'
  if (SPICE_RE.test(n) && !/\bgarlic bread\b/.test(n)) return 'spice'
  if (GARNISH_RE.test(n)) return typeof p.grams === 'number' && p.grams >= 15 ? 'secondary' : 'garnish'
  if (typeof p.grams !== 'number') return 'garnish'
  if (p.grams >= 80) return 'core'
  if (p.grams >= 20) return 'secondary'
  return 'garnish'
}


/** TAG-GUIDE cap for INVENTED items, applied after the matcher (live or mock): a phantom's
    penalty must not exceed what its size warrants. Fats/oils/butter under a tablespoon
    (< 14 g) are garnish; anything under 10 g is at most garnish (spices stay spice);
    10–59 g is at most secondary; only ≥ 60 g may keep a `core` tag. */
export function capInventedTag(tag: Tag, p: PredItem): Tag {
  if (tag === 'ignore') return tag
  const n = normalizeIngredientName(p.name)
  const g = typeof p.grams === 'number' ? p.grams : null
  if (SPICE_RE.test(n) && !/\bgarlic bread\b/.test(n)) return 'spice'
  if (/\b(oil|butter|ghee|margarine|spray)\b/.test(n) && (g === null || g < 14)) return 'garnish'
  if (g === null) return tag === 'core' ? 'secondary' : tag
  if (g < 10) return tag === 'spice' ? 'spice' : 'garnish'
  if (g < 60 && tag === 'core') return 'secondary'
  return tag
}

export function mockMatch(input: { truthItems: TruthItem[]; predItems: PredItem[] }): MatchTable {
  const truth = input.truthItems.filter((t) => t.tag !== 'ignore')
  const preds = input.predItems
  const rowByTruth = new Map<string, MatchRow>()
  for (const t of truth) rowByTruth.set(t.id, { truthIds: [t.id], predIds: [], identity: 0 })
  const droppedDrinks: string[] = []
  const pending: PredItem[] = []
  for (const p of preds) {
    if (p.isDrink) droppedDrinks.push(p.id)
    else pending.push(p)
  }
  const attach = (t: TruthItem, p: PredItem) => {
    const r = rowByTruth.get(t.id)!
    r.predIds.push(p.id)
    r.identity = 1
  }
  const truthKey = new Map(truth.map((t) => [t.id, tokenKey(t.name)]))
  const truthRaw = new Map(truth.map((t) => [t.id, normalizeIngredientName(t.name)]))

  // pass 1: the same normalized name (before stemming / stop words, so
  // "roasted sweet potato" does not take the plain "sweet potato" row)
  let rest: PredItem[] = []
  for (const p of pending) {
    const raw = normalizeIngredientName(p.name)
    const t = truth.find((tt) => truthRaw.get(tt.id) === raw)
    if (t) attach(t, p)
    else rest.push(p)
  }
  // pass 2a: the prediction's dish label names a truth item (a composite the
  // truth weighed as one: "roasted sweet potato" under dish "roasted
  // vegetables" joins that row, not the plain "sweet potato" row)
  let rest2: PredItem[] = []
  for (const p of rest) {
    const dishKey = tokenKey(p.dish)
    const pKey = tokenKey(p.name)
    const t = dishKey !== '' ? truth.find((tt) => truthKey.get(tt.id) === dishKey && pKey !== truthKey.get(tt.id)) : undefined
    if (t) attach(t, p)
    else rest2.push(p)
  }
  // pass 2b: same stemmed token set (plural / singular, word order)
  rest = []
  for (const p of rest2) {
    const key = tokenKey(p.name)
    const t = key !== '' ? truth.find((tt) => truthKey.get(tt.id) === key) : undefined
    if (t) attach(t, p)
    else rest.push(p)
  }
  // pass 2c: named component of a composite truth item
  rest2 = []
  for (const p of rest) {
    const pKey = tokenKey(p.name)
    const t = truth.find((tt) => (tt.components ?? []).some((c) => tokenKey(c) === pKey || overlap(nameTokens(c), nameTokens(p.name)) >= 0.5))
    if (t) attach(t, p)
    else rest2.push(p)
  }
  // pass 3: token overlap
  rest = []
  for (const p of rest2) {
    let best: TruthItem | null = null
    let bestScore = 0
    for (const t of truth) {
      const s = overlap(nameTokens(t.name), nameTokens(p.name))
      if (s > bestScore) {
        best = t
        bestScore = s
      }
    }
    if (best && bestScore >= 0.5) attach(best, p)
    else rest.push(p)
  }
  const invented: InventedEntry[] = rest.map((p) => ({ predId: p.id, tag: mockInventedTag(p) }))
  return { rows: [...rowByTruth.values()], invented, droppedDrinks }
}

/* ---- overrides ------------------------------------------------------------- */
/** One on-screen fix: the pairing for `truthId` becomes `predIds` with
    `identity` (empty predIds = unmatched). Predictions freed by the change
    become invented (`inventedTag`, default garnish); predictions taken from
    another row are removed there. */
export type MatchOverride = {
  truthId: string
  predIds: string[]
  identity: Identity
  inventedTag?: Tag
  note?: string
  at?: string
}

export function applyOverrides(table: MatchTable, overrides: MatchOverride[], preds: PredItem[]): MatchTable {
  if (overrides.length === 0) return table
  const rows: MatchRow[] = table.rows.map((r) => ({ ...r, truthIds: [...r.truthIds], predIds: [...r.predIds] }))
  let invented: InventedEntry[] = table.invented.map((i) => ({ ...i }))
  const dropped = new Set(table.droppedDrinks)
  const predById = new Map(preds.map((p) => [p.id, p]))
  for (const ov of overrides) {
    const wanted = ov.predIds.filter((id) => predById.has(id) && !dropped.has(id))
    // free the wanted predictions wherever they sit
    for (const r of rows) r.predIds = r.predIds.filter((id) => !wanted.includes(id))
    invented = invented.filter((i) => !wanted.includes(i.predId))
    // find (or split out) the truth row
    let row = rows.find((r) => r.truthIds.includes(ov.truthId))
    if (!row) {
      row = { truthIds: [ov.truthId], predIds: [], identity: 0 }
      rows.push(row)
    } else if (row.truthIds.length > 1) {
      row.truthIds = row.truthIds.filter((id) => id !== ov.truthId)
      row = { truthIds: [ov.truthId], predIds: [], identity: 0 }
      rows.push(row)
    }
    const freed = row.predIds
    row.predIds = wanted
    row.identity = wanted.length === 0 ? 0 : ov.identity
    for (const id of freed) {
      if (!invented.some((i) => i.predId === id) && !rows.some((r) => r.predIds.includes(id))) {
        invented.push({ predId: id, tag: ov.inventedTag ?? 'garnish' })
      }
    }
  }
  // rows that lost every prediction keep identity 0 (missed)
  for (const r of rows) if (r.predIds.length === 0) r.identity = 0
  return { rows, invented, droppedDrinks: [...dropped] }
}

/* ---- prompt ---------------------------------------------------------------- */
const line = (parts: (string | number | undefined)[]) => parts.map((p) => (p === undefined || p === '' ? '—' : String(p))).join(' · ')

export function matchUserText(truth: TruthItem[], preds: PredItem[]): string {
  const template = loadPrompt(CONFIG.matcher.promptVersion).match(/## User template[^\n]*\n\s*```[^\n]*\n([\s\S]*?)```/)?.[1] ?? ''
  const truthLines = truth
    .filter((t) => t.tag !== 'ignore')
    .map((t) => line([t.id, t.dish, t.name, t.grams !== undefined ? `${t.grams} g` : undefined, t.state, t.components?.join(', ')]))
    .join('\n')
  const predLines = preds
    .map((p) => line([p.id, p.dish, p.name, p.grams !== undefined ? `${p.grams} g` : undefined, p.state]))
    .join('\n')
  return template.replace('{{TRUTH_LINES}}', truthLines || '(none)').replace('{{PRED_LINES}}', predLines || '(none)').trim()
}

function toLlmShape(table: MatchTable): MatchLlmOutput {
  const word = (id: Identity): 'exact' | 'substitute' | 'wrong' => (id === 1 ? 'exact' : id === 0.5 ? 'substitute' : 'wrong')
  return {
    rows: table.rows.map((r) => ({ truth_ids: r.truthIds, pred_ids: r.predIds, identity: word(r.identity), note: null })),
    invented: table.invented.map((i) => ({ pred_id: i.predId, tag: i.tag ?? 'garnish', note: null })),
    dropped_drinks: table.droppedDrinks,
  }
}

/* ---- runner ---------------------------------------------------------------- */
export async function truthItemsForScene(sceneId: string): Promise<TruthItem[]> {
  const rows = await db.gtItem.findMany({ where: { sceneId }, orderBy: { order: 'asc' } })
  return gtItemsToTruth(rows)
}

export type MatchArgs = { runId: string; decompositionId: string; force?: boolean }

export async function runMatch(args: MatchArgs): Promise<{ matchTableId: string; mocked: boolean; existed: boolean }> {
  const existing = await db.matchTable.findUnique({ where: { decompositionId: args.decompositionId }, select: { id: true } })
  if (existing && !args.force) return { matchTableId: existing.id, mocked: false, existed: true }

  const deco = await db.decomposition.findUnique({ where: { id: args.decompositionId } })
  if (!deco) throw new Error(`decomposition ${args.decompositionId} not found`)
  if (!deco.sceneId || deco.runId !== args.runId) throw new Error('decomposition is not a result cell of this run')

  const truthItems = await truthItemsForScene(deco.sceneId)
  const predItems = predItemsOf(deco.payload)
  if (truthItems.length === 0) throw new Error(`scene ${deco.sceneId} has no ground-truth items`)

  const { output, mocked } = await runLlm<MatchLlmOutput>({
    runner: 'matcher',
    modelId: CONFIG.matcher.modelId,
    promptVersion: CONFIG.matcher.promptVersion,
    // blind: the subject ref names the decomposition only; no vantage/condition/model
    subjectRef: `match:${deco.id}`,
    system: systemSection(loadPrompt(CONFIG.matcher.promptVersion)),
    messages: [{ role: 'user', content: matchUserText(truthItems, predItems) }],
    schema: matchLlmSchema,
    temperature: 0,
    mock: () => toLlmShape(mockMatch({ truthItems, predItems })),
  })
  const table = validateMatchOutput(matchLlmSchema.parse(output), truthItems, predItems)
  // enforce the tag guide on phantoms regardless of what the matcher wrote
  {
    const byId = new Map(predItems.map((p) => [p.id, p]))
    table.invented = table.invented.map((i) => { const p = byId.get(i.predId); return p ? { ...i, tag: capInventedTag(i.tag ?? 'garnish', p) } : i })
  }

  const data = {
    runId: args.runId,
    sceneId: deco.sceneId,
    decompositionId: deco.id,
    rows: table.rows,
    invented: table.invented,
    droppedDrinks: table.droppedDrinks,
    matcherModelId: mocked ? `${CONFIG.matcher.modelId} [MOCK]` : CONFIG.matcher.modelId,
    version: MATCH_TABLE_VERSION,
  }
  const saved = existing
    ? await db.matchTable.update({ where: { id: existing.id }, data, select: { id: true } })
    : await db.matchTable.create({ data: { ...data, overrides: [] }, select: { id: true } })
  return { matchTableId: saved.id, mocked, existed: false }
}

/** The match table for a decomposition with overrides APPLIED; null when unmatched yet. */
export async function readMatchTable(decompositionId: string): Promise<{ table: MatchTable; overrides: MatchOverride[]; id: string } | null> {
  const mt = await db.matchTable.findUnique({ where: { decompositionId } })
  if (!mt) return null
  const deco = await db.decomposition.findUnique({ where: { id: decompositionId }, select: { payload: true } })
  const preds = deco ? predItemsOf(deco.payload) : []
  const stored: MatchTable = { rows: mt.rows as MatchRow[], invented: mt.invented as InventedEntry[], droppedDrinks: mt.droppedDrinks as string[] }
  const overrides = (mt.overrides as MatchOverride[] | null) ?? []
  return { id: mt.id, overrides, table: applyOverrides(stored, overrides, preds) }
}

/** Record an on-screen fix (appended; the model's rows are never rewritten). */
export async function addMatchOverride(decompositionId: string, override: MatchOverride): Promise<void> {
  const mt = await db.matchTable.findUnique({ where: { decompositionId }, select: { id: true, overrides: true } })
  if (!mt) throw new Error('no match table for this decomposition')
  const overrides = ((mt.overrides as MatchOverride[] | null) ?? []).filter((o) => o.truthId !== override.truthId)
  overrides.push({ ...override, at: override.at ?? new Date().toISOString() })
  await db.matchTable.update({ where: { id: mt.id }, data: { overrides } })
}
