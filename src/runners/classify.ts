/* Level 3 classifier (METRICS.md Level 3, prompts/classify.v1.md). Pinned
   model (CLASSIFIER_MODEL_ID), temperature 0, BLIND: receives only the
   ingredient lines (name · grams · preparation · dish) and the meal slot —
   never camera, condition, model, or which side (truth / estimate) it is.
   Runs once on the truth of each scene and once on each estimate; the
   payload is persisted (Classification) and turned into the scoring
   `Classification` (level3.ts) at score time.

   Mock mode (MOCK_LLM=1 or no key) = keyword rules: onion / garlic / wheat /
   honey (+ the usual Monash families) → FODMAP hits, red on ≥ 2 hits or one
   hit ≥ 75 g, amber on one hit; fried / crispy on an item ≥ 30 g → fried;
   chili / hot sauce (any amount) → spicy.

   Self-consistency (--consistency): re-run the classifier on a seeded 20 %
   sample of the run's classifications and store agreement in Run.config. */
import { z } from 'zod'
import { db } from '@/lib/db'
import { runLlm } from '@/lib/llm'
import { CONFIG, loadPrompt, systemSection } from '@/lib/config'
import { normalizeIngredientName } from '@/lib/fdc'
import { makeRng } from '@/lib/scoring/aggregate'
import { decisionItems, type Classification as ScoringClassification, type DecisionItem, type MealSlot } from '@/lib/scoring/level3'
import { gtItemsToTruth } from '@/lib/truth-items'
import { predItemsOf, type InterpretedItem } from './interpret'
import type { ClassificationSide } from '@/generated/prisma/client'

/* ---- schema ---------------------------------------------------------------- */
export const classifyLlmSchema = z.object({
  fodmap: z.object({
    light: z.enum(['green', 'amber', 'red']),
    deciding: z.array(
      z.object({ ingredient: z.string(), grams: z.number().nullable(), family: z.string().nullable(), serve_applied: z.string().nullable() }),
    ),
    reason: z.string(),
  }),
  nausea: z.object({
    fried: z.boolean(),
    fried_items: z.array(z.string()),
    spicy: z.boolean(),
    spicy_inferred: z.boolean(),
    spicy_items: z.array(z.string()),
    reason: z.string(),
  }),
})
export type ClassifyPayload = z.infer<typeof classifyLlmSchema>

/** One classifier input line: what the model (and the mock) sees. */
export type IngredientLine = { name: string; grams?: number; preparation?: string; dish: string }

export function toScoringClassification(p: ClassifyPayload): ScoringClassification {
  return {
    light: p.fodmap.light,
    reason: p.fodmap.reason,
    deciding: p.fodmap.deciding.map((d) => d.ingredient),
    fried: p.nausea.fried,
    spicy: p.nausea.spicy,
  }
}

/* ---- lines ----------------------------------------------------------------- */
type LineSource = DecisionItem & { dish?: string; preparation?: string }

/** Drinks and ignore items never reach the classifier (decisionItems). */
export function ingredientLines(items: LineSource[]): IngredientLine[] {
  return decisionItems(items).map((it) => ({
    name: it.name,
    grams: typeof it.grams === 'number' ? it.grams : undefined,
    preparation: (it as LineSource).preparation,
    dish: (it as LineSource).dish ?? '',
  }))
}

export function linesText(lines: IngredientLine[]): string {
  return lines
    .map((l) => `${l.name} · ${l.grams !== undefined ? `${l.grams} g` : '—'} · ${l.preparation ?? '—'} · ${l.dish || '—'}`)
    .join('\n')
}

export function classifyUserText(slot: MealSlot, lines: IngredientLine[]): string {
  const template = loadPrompt(CONFIG.classifier.promptVersion).match(/## User template[^\n]*\n\s*```[^\n]*\n([\s\S]*?)```/)?.[1] ?? ''
  return template.replace('{{SLOT}}', slot).replace('{{INGREDIENT_LINES}}', linesText(lines) || '(none)').trim()
}

/* ---- mock ------------------------------------------------------------------ */
const FODMAP_RULES: Array<{ re: RegExp; family: string; serve: string }> = [
  { re: /\b(onion|shallot|leek|garlic|wheat|bread|pasta|noodle|couscous|barley|rye|artichoke|inulin)\b/, family: 'fructan', serve: 'Monash green ≈ 1 tbsp onion / 1 slice wheat bread' },
  { re: /\b(lentil|chickpea|beans?|soy ?beans?|cashew|pistachio)\b/, family: 'GOS', serve: 'Monash green ≈ 1/4 cup' },
  { re: /\b(milk|yogurt|yoghurt|ice cream|cream|custard|ricotta|cottage)\b/, family: 'lactose', serve: 'Monash green ≈ 1/4 cup milk' },
  { re: /\b(apple|pear|mango|watermelon|honey|high[- ]fructose|agave|asparagus)\b/, family: 'fructose', serve: 'Monash green ≈ 1 tsp honey' },
  { re: /\b(blackberr|plum|peach|apricot|cherr|nectarine)/, family: 'sorbitol', serve: 'Monash green ≈ small serve' },
  { re: /\b(mushroom|cauliflower|celery)\b/, family: 'mannitol', serve: 'Monash green ≈ small serve' },
]
const FRIED_RE = /\b(fried|deep[- ]fried|pan[- ]fried|crispy|battered|tempura|fritter|chips|fries|puff[- ]puff|akara)\b/
const SPICY_RE = /\b(chili|chilli|chile|cayenne|scotch bonnet|habanero|hot sauce|pepper[- ]soup|harissa|sriracha|gochujang|curry paste|jalape[nñ]o)\b/
const SPICY_DISH_RE = /\b(jollof|pepper[- ]soup|suya|curry)\b/

export function mockClassify(lines: IngredientLine[]): ClassifyPayload {
  const deciding: ClassifyPayload['fodmap']['deciding'] = []
  let big = false
  for (const l of lines) {
    const n = normalizeIngredientName(l.name)
    const rule = FODMAP_RULES.find((r) => r.re.test(n))
    if (!rule) continue
    if (/\bhard cheese|parmesan|cheddar|butter\b/.test(n)) continue
    deciding.push({ ingredient: l.name, grams: l.grams ?? null, family: rule.family, serve_applied: rule.serve })
    if ((l.grams ?? 0) >= 75) big = true
  }
  const light = big || deciding.length >= 2 ? 'red' : deciding.length === 1 ? 'amber' : 'green'
  const friedItems = lines.filter((l) => (l.grams ?? 0) >= 30 && FRIED_RE.test(`${l.name} ${l.preparation ?? ''} ${l.dish}`.toLowerCase())).map((l) => l.name)
  const spicyItems = lines.filter((l) => SPICY_RE.test(`${l.name} ${l.preparation ?? ''}`.toLowerCase())).map((l) => l.name)
  const spicyInferred = spicyItems.length === 0 && lines.some((l) => SPICY_DISH_RE.test(`${l.name} ${l.dish}`.toLowerCase()))
  return {
    fodmap: {
      light,
      deciding,
      reason: deciding.length ? `[MOCK] ${deciding.length} high-FODMAP ingredient(s): ${deciding.map((d) => d.ingredient).join(', ')}` : '[MOCK] no high-FODMAP ingredient',
    },
    nausea: {
      fried: friedItems.length > 0,
      fried_items: friedItems,
      spicy: spicyItems.length > 0 || spicyInferred,
      spicy_inferred: spicyInferred,
      spicy_items: spicyItems,
      reason: `[MOCK] fried=${friedItems.length > 0} spicy=${spicyItems.length > 0 || spicyInferred}`,
    },
  }
}

/* ---- one call -------------------------------------------------------------- */
export async function classifyLines(slot: MealSlot, lines: IngredientLine[], subjectRef: string): Promise<{ payload: ClassifyPayload; mocked: boolean }> {
  const { output, mocked } = await runLlm<ClassifyPayload>({
    runner: 'classifier',
    modelId: CONFIG.classifier.modelId,
    promptVersion: CONFIG.classifier.promptVersion,
    subjectRef,
    system: systemSection(loadPrompt(CONFIG.classifier.promptVersion)),
    messages: [{ role: 'user', content: classifyUserText(slot, lines) }],
    schema: classifyLlmSchema,
    temperature: 0,
    mock: () => mockClassify(lines),
  })
  return { payload: classifyLlmSchema.parse(output), mocked }
}

/* ---- runner ---------------------------------------------------------------- */
export type ClassifyArgs = { runId: string; sceneId: string; side: ClassificationSide; decompositionId?: string | null; force?: boolean }

const slotOf = (mealType: string | null): MealSlot => (mealType === 'breakfast' || mealType === 'lunch' || mealType === 'dinner' || mealType === 'snack' ? mealType : 'lunch')

/** The items a side classifies: truth = GtItems (ignore dropped), estimate =
    the decomposition's predItems (drinks dropped). Exported for score.ts. */
export async function classificationInputs(args: { sceneId: string; side: ClassificationSide; decompositionId?: string | null }) {
  const scene = await db.photoScene.findUnique({ where: { id: args.sceneId }, include: { meal: { select: { mealType: true } } } })
  if (!scene) throw new Error(`scene ${args.sceneId} not found`)
  const slot = slotOf(scene.meal.mealType)
  if (args.side === 'truth') {
    const rows = await db.gtItem.findMany({ where: { sceneId: args.sceneId }, orderBy: { order: 'asc' } })
    return { slot, lines: ingredientLines(gtItemsToTruth(rows)) }
  }
  if (!args.decompositionId) throw new Error('estimate classification needs a decompositionId')
  const deco = await db.decomposition.findUnique({ where: { id: args.decompositionId }, select: { payload: true, sceneId: true } })
  if (!deco) throw new Error(`decomposition ${args.decompositionId} not found`)
  if (deco.sceneId !== args.sceneId) throw new Error('decomposition belongs to another scene')
  const items: InterpretedItem[] = predItemsOf(deco.payload)
  return { slot, lines: ingredientLines(items) }
}

export async function runClassify(args: ClassifyArgs): Promise<{ classificationId: string; mocked: boolean; existed: boolean }> {
  const decompositionId = args.side === 'truth' ? null : (args.decompositionId ?? null)
  const existing = await db.classification.findFirst({
    where: { runId: args.runId, sceneId: args.sceneId, side: args.side, decompositionId },
    select: { id: true },
  })
  if (existing && !args.force) return { classificationId: existing.id, mocked: false, existed: true }

  const { slot, lines } = await classificationInputs({ sceneId: args.sceneId, side: args.side, decompositionId })
  // blind subject ref: no side, no vantage/condition/model
  const { payload, mocked } = await classifyLines(slot, lines, `classify:${decompositionId ?? args.sceneId}`)
  const data = { payload, classifierModelId: mocked ? `${CONFIG.classifier.modelId} [MOCK]` : CONFIG.classifier.modelId }
  const saved = existing
    ? await db.classification.update({ where: { id: existing.id }, data, select: { id: true } })
    : await db.classification.create({
        data: { runId: args.runId, sceneId: args.sceneId, side: args.side, decompositionId, ...data },
        select: { id: true },
      })
  return { classificationId: saved.id, mocked, existed: false }
}

/* ---- self-consistency ------------------------------------------------------ */
export type ConsistencyReport = {
  seed: number
  share: number
  population: number
  sampled: number
  agreeLight: number
  agreeFried: number
  agreeSpicy: number
  /** share of sampled classifications where light, fried and spicy all agree */
  agreement: number | null
  classifierModelId: string
  at: string
}

/** Re-run the classifier on a seeded 20 % sample of the run's classifications
    (truth and estimate sides alike) and store the agreement in Run.config. */
export async function runClassifyConsistency(runId: string, opts: { seed?: number; share?: number } = {}): Promise<ConsistencyReport> {
  const seed = opts.seed ?? 20260917
  const share = opts.share ?? 0.2
  const all = await db.classification.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } })
  const rng = makeRng(seed)
  const order = all.map((c, i) => ({ c, r: rng(), i })).sort((a, b) => a.r - b.r || a.i - b.i)
  const n = all.length === 0 ? 0 : Math.max(1, Math.ceil(all.length * share))
  const sample = order.slice(0, n).map((o) => o.c)
  let agreeLight = 0
  let agreeFried = 0
  let agreeSpicy = 0
  let modelId = CONFIG.classifier.modelId
  for (const c of sample) {
    const { slot, lines } = await classificationInputs({ sceneId: c.sceneId, side: c.side, decompositionId: c.decompositionId })
    const { payload, mocked } = await classifyLines(slot, lines, `classify-consistency:${c.id}`)
    if (mocked) modelId = `${CONFIG.classifier.modelId} [MOCK]`
    const first = c.payload as ClassifyPayload
    if (first.fodmap.light === payload.fodmap.light) agreeLight++
    if (first.nausea.fried === payload.nausea.fried) agreeFried++
    if (first.nausea.spicy === payload.nausea.spicy) agreeSpicy++
  }
  const report: ConsistencyReport = {
    seed,
    share,
    population: all.length,
    sampled: sample.length,
    agreeLight,
    agreeFried,
    agreeSpicy,
    agreement: sample.length ? Math.min(agreeLight, agreeFried, agreeSpicy) / sample.length : null,
    classifierModelId: modelId,
    at: new Date().toISOString(),
  }
  const run = await db.run.findUnique({ where: { id: runId }, select: { config: true } })
  if (!run) throw new Error(`run ${runId} not found`)
  const config = { ...(run.config as Record<string, unknown>), consistency: report }
  await db.run.update({ where: { id: runId }, data: { config } })
  return report
}
