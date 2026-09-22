/* Interpretation runner v2 (REBUILD-SPEC §4.1–4.3, METRICS rev 8.2).
   ONE call per (scene, vantage, condition, model) — the result cell. Replaces
   pipeline.ts for the run path (pipeline.ts stays compiling for the legacy
   routes). Blind by construction: the scene's GT never reaches the model;
   the text_note slot is always 'none' in the study.

   Prompt = prompts/interpret.v3.md parsed into blocks (lib/prompt-blocks.ts):
   blocks 1–3 system; block 4 = the one vantage line; blocks 5–6 from the
   ContextProvider for image_context / context_only, empty for image_only.
   Every sent block's sha256 is stamped on the row (promptBlockHashes).

   Output (plates → dishes → ingredients) is validated, then mapped to the
   scoring PredItem shape (toPredItems): deterministic ids, `inferred`,
   `confidence`, `state`, and `isDrink` by a keyword list — drinks are
   FLAGGED here, dropped by the matcher/scorer, never removed from the record.

   Mock mode (MOCK_LLM=1 or no key): a deterministic prediction derived from
   the scene's GT items (so an end-to-end mock run scores plausibly); the
   fixture meal when the scene has no GT. Mocked rows carry payload.mocked. */
import { readFileSync } from 'fs'
import { contextProviderForRun } from '@/lib/retrieval/factory'
import { join } from 'path'
import { z } from 'zod'
import { db } from '@/lib/db'
import { runLlm, willMock, type ContentPart } from '@/lib/llm'
import { CONFIG, loadPrompt } from '@/lib/config'
import {
  buildInterpretPrompt,
  parsePromptBlocks,
  type BlockKey,
  type Condition,
  type ContextFill,
  type PromptBlocks,
  type Situation,
  type Vantage,
} from '@/lib/prompt-blocks'
import { gtItemsToTruth } from '@/lib/truth-items'
import type { PredItem, TruthItem } from '@/lib/scoring/types'

/* ---- LLM-facing schema (all fields present, nullable where optional — the
   OpenAI strict-mode rule, DECISIONS: decomposition.ts) ----------------------- */
const llmState = z.enum(['cooked', 'raw', 'dry', 'as_served']).nullable()
const llmConfidence = z.enum(['low', 'medium', 'high']).nullable()

const llmIngredient = z.object({
  name: z.string(),
  grams_est: z.number().nullable(),
  state: llmState,
  preparation: z.string().nullable(),
  confidence: llmConfidence,
  inferred: z.boolean().nullable(),
})

export const interpretLlmSchema = z.object({
  plates: z.array(
    z.object({
      plate_index: z.number(),
      dishes: z.array(
        z.object({
          dish_name: z.string(),
          preparation: z.string().nullable(),
          ingredients: z.array(llmIngredient),
        }),
      ),
    }),
  ),
  uncertain: z.array(
    z.object({
      name: z.string(),
      grams_est: z.number().nullable(),
      confidence: llmConfidence,
      inferred: z.boolean().nullable(),
    }),
  ),
})
export type InterpretLlmOutput = z.infer<typeof interpretLlmSchema>

/** A predicted item as stored: the scoring PredItem plus provenance. */
export type InterpretedItem = PredItem & {
  plate: number
  preparation?: string
  /** came from the `uncertain` list (confidence low by construction) */
  uncertain?: boolean
}

/** Stored Decomposition.payload for v2 rows. */
export type DecompositionV2Payload = {
  version: 'interpret.v3'
  raw: InterpretLlmOutput
  predItems: InterpretedItem[]
  mocked: boolean
}

/* ---- drinks ---------------------------------------------------------------- */
const DRINK_WORDS = [
  'water', 'coffee', 'espresso', 'latte', 'cappuccino', 'tea', 'juice', 'soda', 'cola', 'coke',
  'beer', 'wine', 'lager', 'ale', 'whisky', 'whiskey', 'vodka', 'gin', 'rum', 'cocktail',
  'smoothie', 'milkshake', 'lemonade', 'kombucha', 'drink', 'beverage', 'sparkling',
]
const DRINK_RE = new RegExp(`\\b(${DRINK_WORDS.join('|')})\\b`, 'i')
/** "milk" is a drink only when it stands alone (a glass), not "coconut milk" / "milk powder". */
export function isDrinkName(name: string): boolean {
  const n = name.trim().toLowerCase()
  if (/^(a |one |glass of |cup of |mug of )?(whole |skim |oat |almond |soy )?milk$/.test(n)) return true
  if (/\bmilk\b/.test(n) && /\b(glass|cup|mug)\b/.test(n)) return true
  return DRINK_RE.test(n)
}

const num = (v: number | null): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined)

/** LLM output → PredItem[] (plates → dishes → ingredients; uncertain appended). */
export function toPredItems(out: InterpretLlmOutput): InterpretedItem[] {
  const items: InterpretedItem[] = []
  out.plates.forEach((plate, pi) => {
    plate.dishes.forEach((dish, di) => {
      dish.ingredients.forEach((ing, ii) => {
        const it: InterpretedItem = {
          id: `p${pi + 1}-d${di + 1}-i${ii + 1}`,
          plate: plate.plate_index,
          dish: dish.dish_name,
          name: ing.name,
        }
        const g = num(ing.grams_est)
        if (g !== undefined) it.grams = g
        if (ing.confidence) it.confidence = ing.confidence
        if (ing.inferred) it.inferred = true
        if (ing.state) it.state = ing.state
        const prep = ing.preparation?.trim() || dish.preparation?.trim()
        if (prep) it.preparation = prep
        // A drink word is a DRINK only when it stands alone (its own dish, or a dish named as a drink).
        // "Water" listed beside oats, yam flour or rice is cooking water: part of the food's served mass
        // (dropping it would score a bowl of cooked oatmeal as its dry weight).
        if (isDrinkName(ing.name) && (dish.ingredients.length === 1 || isDrinkName(dish.dish_name))) it.isDrink = true
        items.push(it)
      })
    })
  })
  out.uncertain.forEach((u, ui) => {
    const it: InterpretedItem = { id: `u-${ui + 1}`, plate: 0, dish: 'uncertain', name: u.name, uncertain: true }
    const g = num(u.grams_est)
    if (g !== undefined) it.grams = g
    it.confidence = u.confidence ?? 'low'
    if (u.inferred) it.inferred = true
    if (isDrinkName(u.name)) it.isDrink = true
    items.push(it)
  })
  return items
}

/* ---- context provider ------------------------------------------------------ */
export type ContextResult = ContextFill & { hit: boolean; cardsRetrieved: string[] }

export interface ContextProvider {
  getContext(scene: { id: string; mealId: string; index: number }, vantage: Vantage | null): Promise<ContextResult>
}

/** No context layer yet (REBUILD-SPEC §4.3 retrieval comes later): blocks 5/6
    are still SENT for image_context / context_only, with empty slots, so the
    prompt bytes for those conditions are what the real provider will fill. */
export class NullContextProvider implements ContextProvider {
  async getContext(): Promise<ContextResult> {
    return { dishCards: '', habitProfile: '', dishware: '', hit: false, cardsRetrieved: [] }
  }
}

/* ---- prompt file ----------------------------------------------------------- */
let blocksCache: { version: string; blocks: PromptBlocks } | null = null
export function interpretBlocks(version = CONFIG.interpret.promptVersion): PromptBlocks {
  if (blocksCache && blocksCache.version === version) return blocksCache.blocks
  const blocks = parsePromptBlocks(loadPrompt(version))
  blocksCache = { version, blocks }
  return blocks
}

/* ---- mock ------------------------------------------------------------------ */
function seedOf(s: string): number {
  let h = 2166136261
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
  return h
}

/** Deterministic mock prediction from the truth items: grams scaled by a
    seeded factor (context conditions tighter), spice items dropped without
    context, one invented garnish under image_only. Dish/plate kept. */
export function mockInterpret(truth: TruthItem[], key: { vantage: Vantage | null; condition: Condition; modelId: string }): InterpretLlmOutput {
  const seed = seedOf(`${key.vantage ?? 'none'}|${key.condition}|${key.modelId}`)
  const withContext = key.condition !== 'image_only'
  const byDish = new Map<string, InterpretLlmOutput['plates'][number]['dishes'][number]>()
  truth.forEach((t, i) => {
    if (t.tag === 'ignore') return
    if (t.tag === 'spice' && !withContext) return
    const f = withContext ? 0.95 + ((seed + i * 7) % 11) / 100 : 0.85 + ((seed + i * 13) % 31) / 100
    const dish = byDish.get(t.dish) ?? { dish_name: t.dish, preparation: null, ingredients: [] }
    dish.ingredients.push({
      name: t.name,
      grams_est: typeof t.grams === 'number' ? Math.round(t.grams * f) : null,
      state: (t.state as 'cooked' | 'raw' | 'dry' | null) ?? null,
      preparation: null,
      confidence: t.tag === 'core' ? 'high' : t.tag === 'secondary' ? 'medium' : 'low',
      inferred: /oil|butter/i.test(t.name),
    })
    byDish.set(t.dish, dish)
  })
  const plates: InterpretLlmOutput['plates'] = [{ plate_index: 1, dishes: [...byDish.values()] }]
  const uncertain: InterpretLlmOutput['uncertain'] = []
  if (!withContext && plates[0].dishes.length > 0) {
    uncertain.push({ name: 'lemon wedge', grams_est: 8, confidence: 'low', inferred: false })
  }
  return { plates, uncertain }
}

const FIXTURE_MOCK = (): InterpretLlmOutput => {
  const fx = JSON.parse(readFileSync(join(process.cwd(), 'fixtures', 'fixture-meal.json'), 'utf-8'))
    .pipeline_decomposition as { dishes: { dishName: string; preparation?: string; ingredients: { name: string; grams_est?: number }[] }[] }
  return {
    plates: [
      {
        plate_index: 1,
        dishes: fx.dishes.map((d) => ({
          dish_name: d.dishName,
          preparation: d.preparation ?? null,
          ingredients: d.ingredients.map((i) => ({
            name: i.name,
            grams_est: i.grams_est ?? null,
            state: null,
            preparation: null,
            confidence: 'medium' as const,
            inferred: false,
          })),
        })),
      },
    ],
    uncertain: [],
  }
}

/* ---- media ----------------------------------------------------------------- */
/** Local-dev media URLs (/api/media/...) aren't fetchable by providers — load
    bytes from disk. Public blob URLs pass through. (Same rule as pipeline.ts.) */
function imageInput(blobUrl: string): URL | Buffer {
  if (blobUrl.startsWith('/api/media/')) {
    return readFileSync(join(process.cwd(), '.data/media', blobUrl.replace('/api/media/', '')))
  }
  return new URL(blobUrl)
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export function situationFor(meal: { eatenAt: Date; locationType: string }): Situation {
  const d = meal.eatenAt
  return {
    weekday: WEEKDAYS[d.getDay()],
    localTime: d.toTimeString().slice(0, 5),
    homeOrAway: meal.locationType === 'home' ? 'home' : 'away',
  }
}

/* ---- runner ---------------------------------------------------------------- */
export type InterpretArgs = {
  runId: string
  sceneId: string
  vantage: Vantage | null // null only for context_only
  condition: Condition
  modelId: string
  contextProvider?: ContextProvider
}

export type InterpretResult = {
  decompositionId: string
  mocked: boolean
  existed: boolean
  promptBlockHashes: Record<BlockKey, string | null>
}

export async function runInterpret(args: InterpretArgs): Promise<InterpretResult> {
  const { runId, sceneId, condition, modelId } = args
  const vantage = condition === 'context_only' ? null : args.vantage
  if (condition !== 'context_only' && !vantage) throw new Error(`${condition} needs a vantage`)

  // idempotent by the unique key (findFirst: the compound key has nullable columns)
  const existing = await db.decomposition.findFirst({
    where: { runId, sceneId, vantage, condition, modelId, source: 'pipeline' },
    select: { id: true, promptBlockHashes: true, payload: true },
  })
  if (existing) {
    return {
      decompositionId: existing.id,
      mocked: Boolean((existing.payload as DecompositionV2Payload | null)?.mocked),
      existed: true,
      promptBlockHashes: existing.promptBlockHashes as Record<BlockKey, string | null>,
    }
  }

  const scene = await db.photoScene.findUnique({
    where: { id: sceneId },
    include: { meal: { select: { id: true, eatenAt: true, locationType: true } } },
  })
  if (!scene) throw new Error(`scene ${sceneId} not found`)
  if (!scene.valid) throw new Error(`scene ${sceneId} is not valid (${scene.exclusionReason ?? 'unknown reason'})`)

  const content: ContentPart[] = []
  if (vantage) {
    const artifact = await db.artifact.findFirst({
      where: {
        sceneId,
        OR: [{ vantage }, { vantage: null, surface: vantage }],
        isReference: false,
        excludeFromExport: false,
        blobUrl: { not: null },
      },
      orderBy: { uploadedAt: 'asc' },
    })
    if (!artifact?.blobUrl) throw new Error(`no ${vantage} capture for scene ${sceneId}`)
    content.push({ type: 'image', image: imageInput(artifact.blobUrl) })
  }

  const provider = args.contextProvider ?? (await contextProviderForRun(runId))
  const ctx = condition === 'image_only' ? null : await provider.getContext({ id: scene.id, mealId: scene.mealId, index: scene.index }, vantage)

  const built = buildInterpretPrompt({
    blocks: interpretBlocks(),
    condition,
    vantage,
    situation: situationFor(scene.meal),
    context: ctx ?? undefined,
    textNote: 'none',
  })
  content.push({ type: 'text', text: built.user })

  // The mock reads GT — only ever inside mock(); the real path never loads it.
  const mocked = willMock(modelId)
  const mock = mocked
    ? async () => {
        const rows = await db.gtItem.findMany({ where: { sceneId }, orderBy: { order: 'asc' } })
        return rows.length > 0 ? mockInterpret(gtItemsToTruth(rows), { vantage, condition, modelId }) : FIXTURE_MOCK()
      }
    : null
  const mockOutput = mock ? await mock() : null

  const { output, callId, mocked: wasMocked } = await runLlm<InterpretLlmOutput>({
    runner: 'interpret',
    modelId,
    promptVersion: CONFIG.interpret.promptVersion,
    subjectRef: `run:${runId}|scene:${sceneId}|vantage:${vantage ?? 'none'}|condition:${condition}`,
    system: built.system,
    messages: [{ role: 'user', content }],
    schema: interpretLlmSchema,
    mock: () => mockOutput ?? FIXTURE_MOCK(),
  })

  const raw = interpretLlmSchema.parse(output)
  const payload: DecompositionV2Payload = { version: 'interpret.v3', raw, predItems: toPredItems(raw), mocked: wasMocked }

  const created = await db.decomposition.create({
    data: {
      mealId: scene.mealId,
      sceneId,
      runId,
      vantage,
      condition,
      source: 'pipeline',
      modelId,
      promptVersion: CONFIG.interpret.promptVersion,
      promptBlockHashes: built.hashes,
      contextUsed: {
        condition,
        vantageSent: built.vantageSent,
        hit: ctx?.hit ?? false,
        cardsRetrieved: ctx?.cardsRetrieved ?? [],
        includesImage: built.includesImage,
      },
      llmCallId: callId,
      payload,
      lockedAt: new Date(),
    },
    select: { id: true },
  })
  return { decompositionId: created.id, mocked: wasMocked, existed: false, promptBlockHashes: built.hashes }
}

/** Read the predicted items of a v2 decomposition row. */
export function predItemsOf(payload: unknown): InterpretedItem[] {
  const p = payload as Partial<DecompositionV2Payload> | null
  if (!p || !Array.isArray(p.predItems)) throw new Error('decomposition is not an interpret.v3 row (no predItems)')
  // recompute from the stored raw output so rule changes (drink detection) apply to rows interpreted earlier
  return p.raw ? toPredItems(p.raw) : p.predItems
}
