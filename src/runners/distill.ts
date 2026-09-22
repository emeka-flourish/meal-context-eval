/* Distillation runner (CORPUS.md §3, REBUILD-SPEC §4.3): non-excluded corpus
   meals → one ContextVersion with DishCards, a habit profile and a snapshot
   of the live dishware registry.

   Pipeline: load meals (+ dishes, ingredients, annotations) → apply the
   annotation trail (meal/dish exclusions, portion-class fixes, edited dish
   JSON) → drop drink dishes → entity resolution (lib/corpus/resolve.ts; in
   real mode every candidate merge is confirmed by the pinned model, in mock
   mode accepted deterministically) → card stats (lib/corpus/cards.ts) →
   habit profile (mock: template findings; real: pinned model over the
   card-level digest only) → write everything in one transaction.

   Mock mode = MOCK_LLM=1 or no provider key (lib/llm.ts willMock): no ledger
   rows are written for the merge confirms (there can be hundreds); the
   habit-profile call goes through runLlm as usual so its [MOCK] row exists. */
import { createHash } from 'crypto'
import { z } from 'zod'
import { db } from '@/lib/db'
import { runLlm, willMock } from '@/lib/llm'
import type { Prisma } from '@/generated/prisma/client'
import { CORPUS_CONFIG } from '@/lib/corpus/config'
import { buildCard, TIER_WEIGHT, type CardInstance, type DishCardData } from '@/lib/corpus/cards'
import { digestCards, mockHabitProfile } from '@/lib/corpus/habits'
import { resolveDishes, type NameGroup, type ResolveInstance } from '@/lib/corpus/resolve'
import type { PortionClass, Slot, Tier } from '@/lib/corpus/load'
import { isDrinkName } from './interpret'

export type DistillArgs = { label?: string }

export type DistillResult = {
  contextVersionId: string
  label: string
  mocked: boolean
  corpusHash: string
  mealCount: number
  dishInstances: number
  drinksSkipped: number
  groups: number
  mergeCandidates: number
  mergesAccepted: number
  cardCount: number
  dishwareSnapshotted: number
  topCards: { canonicalName: string; instanceCount: number; aliases: string[]; priorGrams: number | null }[]
  habitProfile: string
}

type EditedDish = { name?: string; portionClass?: PortionClass; ingredients?: { name: string; gramsEst?: number | null }[] }

const ymd = (d: Date) => d.toISOString().slice(0, 10)

/** Corpus meals + annotations → card instances (annotation trail applied). */
export async function loadCardInstances(): Promise<{ instances: CardInstance[]; mealCount: number; drinksSkipped: number; corpusHash: string }> {
  const meals = await db.corpusMeal.findMany({
    where: { excluded: false },
    include: {
      dishes: { orderBy: { order: 'asc' }, include: { ingredients: { orderBy: { order: 'asc' } } } },
      annotations: { orderBy: { at: 'asc' } },
    },
    orderBy: { localDate: 'asc' },
  })
  const hash = createHash('sha256')
  const instances: CardInstance[] = []
  let drinksSkipped = 0
  let mealCount = 0
  for (const m of meals) {
    hash.update(`${m.sourceMealId}|${m.tier}|${m.excluded}\n`)
    for (const a of m.annotations) hash.update(`a:${a.id}|${a.at.toISOString()}\n`)
    // latest annotation per scope wins (meal-level = dishId null)
    const mealAnn = [...m.annotations].reverse().find((a) => a.dishId == null)
    if (mealAnn?.excluded) continue
    mealCount++
    for (const d of m.dishes) {
      const dishAnn = [...m.annotations].reverse().find((a) => a.dishId === d.id)
      if (dishAnn?.excluded) continue
      const edited = (dishAnn?.editedJson ?? null) as EditedDish | null
      const name = edited?.name?.trim() || d.name
      if (isDrinkName(name)) {
        drinksSkipped++
        continue
      }
      const ingredients = edited?.ingredients
        ? edited.ingredients.map((g) => ({ name: g.name, gramsEst: typeof g.gramsEst === 'number' ? g.gramsEst : null }))
        : d.ingredients.map((g) => ({ name: g.name, gramsEst: g.gramsEst }))
      instances.push({
        dishId: d.id,
        mealId: m.id,
        name,
        localDate: ymd(m.localDate),
        slot: m.slot as Slot,
        tier: m.tier as Tier,
        portionClass: (dishAnn?.portionClass ?? mealAnn?.portionClass ?? edited?.portionClass ?? m.portionClassPrefill) as PortionClass,
        homeOrAway: null, // location was never logged in the export (CORPUS.md §0)
        ingredients,
      })
    }
  }
  return { instances, mealCount, drinksSkipped, corpusHash: hash.digest('hex') }
}

/** Locked prompts (prompts/PROMPTS.lock.json): change the text → bump the version string → re-lock. */
export const DISTILL_CONFIRM_VERSION = 'distill-confirm.v1'
export const DISTILL_CONFIRM_SYSTEM =
  'You decide whether two dish-name groups from one person\'s meal log refer to the SAME dish (the same recipe as usually eaten, allowing for portion words, plural/singular and ordering differences), or to DIFFERENT dishes (e.g. "Rice" vs "Fried Rice", "Chicken soup" vs "Chicken salad"). Answer with the JSON object only.'
export const HABIT_PROFILE_VERSION = 'habit-profile.v1'
export const HABIT_PROFILE_SYSTEM =
  'You write a short habit profile for a meal-decomposition assistant. Input is CARD-LEVEL statistics of one person\'s meal history (never raw meals). Output 5–8 numbered findings, one line each, factual and quantitative (shares, counts, typical portion class, recurring cooking fats, slot patterns, estimated-gram priors). No advice, no health commentary. Plain text only.'

const confirmSchema = z.object({ same_dish: z.boolean(), reason: z.string().nullable() })

/** Pinned-model "same dish?" for one candidate merge (real mode only). */
function makeConfirm(modelId: string) {
  return async (a: NameGroup, b: NameGroup, reason: 'tokens' | 'ingredients'): Promise<boolean> => {
    const fmt = (g: NameGroup) => `"${[...g.names.keys()].join('" / "')}" — typical ingredients: ${[...g.typicalIngredients].join(', ') || '(none)'}`
    const { output } = await runLlm({
      runner: 'distill',
      modelId,
      promptVersion: DISTILL_CONFIRM_VERSION,
      subjectRef: `merge:${a.key}|${b.key}`,
      system: DISTILL_CONFIRM_SYSTEM,
      messages: [{ role: 'user', content: `Group A: ${fmt(a)}\nGroup B: ${fmt(b)}\nCandidate reason: ${reason === 'tokens' ? 'names share ≥ 2 words' : 'ingredient sets overlap ≥ 60%'}\nReturn {"same_dish": true|false, "reason": "short"}.` }],
      schema: confirmSchema,
      temperature: 0,
      mock: () => ({ same_dish: true, reason: 'mock' }),
    })
    return output.same_dish
  }
}

async function writeHabitProfile(cards: DishCardData[], modelId: string, mocked: boolean): Promise<string> {
  const digest = digestCards(cards, 12)
  const { output } = await runLlm<string>({
    runner: 'distill',
    modelId,
    promptVersion: HABIT_PROFILE_VERSION,
    subjectRef: `habit-profile:${cards.length} cards`,
    system: HABIT_PROFILE_SYSTEM,
    messages: [{ role: 'user', content: JSON.stringify(digest, null, 1) }],
    mock: () => mockHabitProfile(digest),
  })
  return mocked ? mockHabitProfile(digest) : output.trim()
}

export async function runDistill(args: DistillArgs = {}): Promise<DistillResult> {
  const modelId = CORPUS_CONFIG.distillModelId
  const mocked = willMock(modelId)
  const { instances, mealCount, drinksSkipped, corpusHash } = await loadCardInstances()
  if (instances.length === 0) throw new Error('distill: no non-excluded corpus dishes — run scripts/load-corpus.ts first')

  const byId = new Map(instances.map((i) => [i.dishId, i]))
  const resolveInput: ResolveInstance[] = instances.map((i) => ({ id: i.dishId, name: i.name, ingredientNames: i.ingredients.map((g) => g.name) }))
  const resolved = await resolveDishes(resolveInput, mocked ? {} : { confirm: makeConfirm(modelId) })

  const cards: DishCardData[] = resolved.clusters.map((c) =>
    buildCard(
      { canonicalName: c.canonicalName, aliases: c.aliases },
      c.instanceIds.map((id) => byId.get(id)!),
    ),
  )
  const habitProfile = await writeHabitProfile(cards, modelId, mocked)

  const label = args.label?.trim() || `corpus ${new Date().toISOString().slice(0, 16).replace('T', ' ')}${mocked ? ' [mock]' : ''}`
  const config = {
    mode: mocked ? 'mock' : 'real',
    distillModelId: modelId,
    embedModelId: CORPUS_CONFIG.embedModelId,
    routerModelId: CORPUS_CONFIG.routerModelId,
    tierWeights: TIER_WEIGHT,
    resolution: { tokenShareMin: 2, ingredientJaccardMin: 0.6, groups: resolved.groups, candidates: resolved.candidates.length, accepted: resolved.accepted },
    mealCount,
    dishInstances: instances.length,
    drinksSkipped,
    builtAt: new Date().toISOString(),
  }

  const liveDishware = await db.dishware.findMany({ where: { contextVersionId: null }, orderBy: { createdAt: 'asc' } })
  const version = await db.$transaction(async (tx) => {
    const v = await tx.contextVersion.create({
      data: { label, corpusHash, cardCount: cards.length, habitProfile, config: config as Prisma.InputJsonObject },
      select: { id: true },
    })
    await tx.dishCard.createMany({
      data: cards.map((c) => ({
        contextVersionId: v.id,
        canonicalName: c.canonicalName,
        aliases: c.aliases,
        instanceCount: c.instanceCount,
        lastSeen: new Date(`${c.lastSeen}T00:00:00.000Z`),
        portionClassMix: c.portionClassMix,
        priorGrams: c.priorGrams,
        ingredients: c.ingredients as unknown as Prisma.InputJsonArray,
        features: c.features,
        tierMix: c.tierMix,
      })),
    })
    if (liveDishware.length) {
      await tx.dishware.createMany({
        data: liveDishware.map((d) => ({ contextVersionId: v.id, name: d.name, capacityMl: d.capacityMl, capacityG: d.capacityG, usedFor: d.usedFor, photo: d.photo })),
      })
    }
    return v
  })

  return {
    contextVersionId: version.id,
    label,
    mocked,
    corpusHash,
    mealCount,
    dishInstances: instances.length,
    drinksSkipped,
    groups: resolved.groups,
    mergeCandidates: resolved.candidates.length,
    mergesAccepted: resolved.accepted,
    cardCount: cards.length,
    dishwareSnapshotted: liveDishware.length,
    topCards: cards.slice(0, 10).map((c) => ({ canonicalName: c.canonicalName, instanceCount: c.instanceCount, aliases: c.aliases, priorGrams: c.priorGrams })),
    habitProfile,
  }
}
