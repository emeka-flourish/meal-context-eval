/* Score runner: one ScoreCell per (run, scene, vantage, condition, model).
   Level 1 = scoring/level1 over the truth items, the predicted items and the
   match table (overrides applied on read); Level 2 = scoring/level2 on both
   sides through one NutrientLookup (lib/nutrient-lookup.ts; injectable for
   tests); Level 3 = scoring/level3 with the STORED classifications (the
   classifier ran blind earlier — this step never calls a model). The scene's
   routine/novel flag (CORPUS.md §5) is computed here against the run's
   contextVersionId and stored on the cell (`routine`; null = no context
   version), so the study split and the cells export read it back.

   scoreCellPure is the whole computation with every input in hand; runScore
   loads the inputs from the db and persists. Prerequisites missing (no
   decomposition / match table / classification) throw, so the item shows as
   failed and re-runs once its inputs exist. */
import { db } from '@/lib/db'
import { level1 } from '@/lib/scoring/level1'
import { level2, nutrientErrors, type Level2Item, type Level2Result, type NutrientErrors, type NutrientLookup } from '@/lib/scoring/level2'
import { decisionItems, level3, type Classification as ScoringClassification, type Classifier, type Level3Result, type MealSlot } from '@/lib/scoring/level3'
import type { Level1Result, MatchTable, PredItem, TruthItem } from '@/lib/scoring/types'
import { buildNutrientLookup } from '@/lib/nutrient-lookup'
import { weighedShare } from '@/lib/truth-items'
import type { Condition, Vantage } from '@/lib/prompt-blocks'
import { predItemsOf } from './interpret'
import { readMatchTable, truthItemsForScene } from './match'
import { toScoringClassification, type ClassifyPayload } from './classify'
import { routineForCell } from '@/lib/corpus/routine-flag'

export type ScoreInputs = {
  truth: TruthItem[]
  preds: PredItem[]
  match: MatchTable
  lookup: NutrientLookup
  truthClass: ScoringClassification
  estClass: ScoringClassification
  slot: MealSlot
}

export type Level2Cell = { truth: Level2Result; est: Level2Result; errors: NutrientErrors }

export type ScoreOutput = { level1: Level1Result; level2: Level2Cell; level3: Level3Result }

/** A Classifier double that answers from the two stored classifications:
    level3 calls it on decisionItems(truth) and decisionItems(est); the truth
    call is recognised by value (same items → same JSON). */
export function storedClassifier(truth: TruthItem[], truthClass: ScoringClassification, estClass: ScoringClassification): Classifier {
  const truthKey = JSON.stringify(decisionItems(truth))
  return (items) => (JSON.stringify(items) === truthKey ? truthClass : estClass)
}

export function scoreCellPure(inp: ScoreInputs): ScoreOutput {
  const l1 = level1(inp.truth, inp.preds, inp.match)
  const truthL2Items: Level2Item[] = inp.truth.map((t) => ({ id: t.id, name: t.name, grams: t.grams, state: t.state, components: t.components, componentWeights: t.componentWeights, tag: t.tag }))
  const estL2Items: Level2Item[] = inp.preds.map((p) => ({ id: p.id, name: p.name, grams: p.grams, state: p.state, isDrink: p.isDrink }))
  const truthN = level2(truthL2Items, inp.lookup)
  const estN = level2(estL2Items, inp.lookup)
  const l3 = level3(inp.truth, truthN, inp.preds, estN, storedClassifier(inp.truth, inp.truthClass, inp.estClass), { mealSlot: inp.slot })
  // Identity-only scene (restaurant bowl with no weights): a core/secondary truth item has no
  // grams, so nutrient totals and threshold decisions are not comparable. Recognition still counts;
  // the study tables skip Level 2 / Level 3 for cells carrying this flag.
  const identityOnly = inp.truth.some((t) => (t.tag === 'core' || t.tag === 'secondary') && !(typeof t.grams === 'number' && Number.isFinite(t.grams)))
  return { level1: l1, level2: { truth: truthN, est: estN, errors: nutrientErrors(truthN, estN), ...(identityOnly ? { identityOnly: true } : {}) }, level3: l3 }
}

export type ScoreArgs = { runId: string; sceneId: string; vantage: Vantage | null; condition: Condition; modelId: string; force?: boolean }
export type ScoreDeps = {
  lookup?: NutrientLookup
  /** routine flag resolver (injectable for tests); default reads the run's context version */
  routine?: (runId: string, sceneId: string) => Promise<boolean | null>
}

const slotOf = (mealType: string | null): MealSlot => (mealType === 'breakfast' || mealType === 'lunch' || mealType === 'dinner' || mealType === 'snack' ? mealType : 'lunch')

export async function runScore(args: ScoreArgs, deps: ScoreDeps = {}): Promise<{ scoreCellId: string; existed: boolean; output: ScoreOutput | null; routine: boolean | null }> {
  const vantage = args.condition === 'context_only' ? null : args.vantage
  const existing = await db.scoreCell.findFirst({
    where: { runId: args.runId, sceneId: args.sceneId, vantage, condition: args.condition, modelId: args.modelId },
    select: { id: true },
  })
  if (existing && !args.force) return { scoreCellId: existing.id, existed: true, output: null, routine: null }

  const deco = await db.decomposition.findFirst({
    where: { runId: args.runId, sceneId: args.sceneId, vantage, condition: args.condition, modelId: args.modelId, source: 'pipeline' },
    select: { id: true, payload: true },
  })
  if (!deco) throw new Error('score: no decomposition for this cell yet (run interpret first)')
  const mt = await readMatchTable(deco.id)
  if (!mt) throw new Error('score: no match table for this cell yet (run match first)')
  const [truthRow, estRow] = await Promise.all([
    db.classification.findFirst({ where: { runId: args.runId, sceneId: args.sceneId, side: 'truth', decompositionId: null } }),
    db.classification.findFirst({ where: { runId: args.runId, sceneId: args.sceneId, side: 'estimate', decompositionId: deco.id } }),
  ])
  if (!truthRow) throw new Error('score: truth classification missing for this scene')
  if (!estRow) throw new Error('score: estimate classification missing for this cell')

  const scene = await db.photoScene.findUnique({ where: { id: args.sceneId }, include: { meal: { select: { mealType: true } } } })
  if (!scene) throw new Error(`scene ${args.sceneId} not found`)
  const truth = await truthItemsForScene(args.sceneId)
  const preds = predItemsOf(deco.payload)

  let lookup = deps.lookup
  if (!lookup) {
    const built = await buildNutrientLookup(
      [
        ...truth.filter((t) => t.tag !== 'ignore').map((t) => ({ name: t.name, state: t.state, components: t.components })),
        ...preds.filter((p) => !p.isDrink).map((p) => ({ name: p.name, state: p.state })),
      ],
      { estimate: true },
    )
    // A throttled/failed food-database search must never become a silent zero: fail the
    // score item so "Re-run failed" retries it once the search is available again.
    if (built.unavailable.length) throw new Error(`food-database search unavailable for: ${built.unavailable.join(', ')} — re-run this cell`)
    lookup = built.lookup
  }

  const output = scoreCellPure({
    truth,
    preds,
    match: mt.table,
    lookup,
    truthClass: toScoringClassification(truthRow.payload as ClassifyPayload),
    estClass: toScoringClassification(estRow.payload as ClassifyPayload),
    slot: slotOf(scene.meal.mealType),
  })

  const level1Json = {
    ...output.level1,
    weighedShare: weighedShare(truth),
    overrideN: mt.overrides.length,
    matchTableId: mt.id,
    decompositionId: deco.id,
    classificationIds: { truth: truthRow.id, estimate: estRow.id },
    scoredAt: new Date().toISOString(),
  }
  const routine = await (deps.routine ?? routineForCell)(args.runId, args.sceneId)
  const data = { level1: level1Json, level2: output.level2, level3: output.level3, routine }
  const saved = existing
    ? await db.scoreCell.update({ where: { id: existing.id }, data, select: { id: true } })
    : await db.scoreCell.create({
        data: { runId: args.runId, sceneId: args.sceneId, vantage, condition: args.condition, modelId: args.modelId, ...data },
        select: { id: true },
      })
  return { scoreCellId: saved.id, existed: false, output, routine }
}
