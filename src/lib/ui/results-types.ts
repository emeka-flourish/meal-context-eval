/* Wire types for /api/results/* (REBUILD-SPEC §3.4 — Study / Day / Meal).
   Shared by the routes and the client. Every number here is computed on the
   server from ScoreCell JSON (+ the match table for the Meal scope); the
   browser only formats. */

import type { Aggregate } from '@/lib/scoring/aggregate'
import type { Level3Result } from '@/lib/scoring/level3'
import type { Identity, NutrientKey, Tag } from '@/lib/scoring/types'
import type { Vantage } from './format'

export type Condition = 'image_only' | 'image_context' | 'context_only'
export type Scope = 'study' | 'day' | 'meal'
export type Split = 'all' | 'routine' | 'novel'
export type DecisionKey = keyof Omit<Level3Result, 'agreementRate'>

/** Column key for the vantage axis: a camera, or `none` for context_only. */
export type ColumnKey = Vantage | 'none'

export type RunModel = { id: string; family: string; tier: string }

export type RunInfo = {
  id: string
  label: string
  createdAt: string
  status: string
  conditions: Condition[]
  /** cameras this run asked per scene (runs from before 2026-09-19: phone, glasses, tripod) */
  vantages: Vantage[]
  models: RunModel[]
  /** the model the tables show by default (first of the roster) */
  headlineModel: string
  sceneCount: number
  cellCount: number
  scoredCount: number
  /** local dates (YYYY-MM-DD) of the run's scenes */
  dates: string[]
}

/* ---- Study ------------------------------------------------------------------ */

export type Gain = Aggregate & { diffs?: number[] }

export type Level1Bar = {
  vantage: Vantage
  condition: Condition
  n: number
  recognized: Aggregate
  invented: Aggregate
  net: Aggregate
  quantity: Aggregate
}

export type Level1Figure = {
  modelId: string
  bars: Level1Bar[]
  contextOnly: { n: number; net: Aggregate; quantity: Aggregate } | null
}

export type Level1Row = {
  vantage: Vantage | null
  condition: Condition
  n: number
  recognized: Aggregate
  invented: Aggregate
  net: Aggregate
  quantity: Aggregate
  f1: Aggregate
  massMae: Aggregate
  massMape: Aggregate
}

export type Level1Gain = {
  vantage: Vantage
  net: Gain
  quantity: Gain
  recognized: Gain
  invented: Gain
}

export type NutrientRow = {
  vantage: Vantage | null
  condition: Condition
  n: number
  mae: Aggregate
  pctOfMean: number | null
  mape: number | null
  medianApe: number | null
  signedBias: Aggregate
  within20: number
  within10: number
}

export type NutrientGain = {
  vantage: Vantage
  /** paired within-meal difference of absolute % error (negative = context helps) */
  ape: Gain
}

export type Level2Block = {
  rows: NutrientRow[]
  gain: NutrientGain[]
}

export type KcalBiasRow = {
  vantage: Vantage
  imageOnly: Aggregate | null
  withContext: Aggregate | null
}

export type DecisionCounts = {
  /** scenes scored for this (vantage, condition) */
  N: number
  agree: number
  falseAlarm: number
  miss: number
  /** FODMAP only: one light apart */
  withinOne: number
  /** median |margin| of the estimate side for numeric decisions */
  marginMedian: number | null
}

export type Level3Row = {
  key: DecisionKey
  label: string
  persona: 'IBS' | 'GLP-1'
  rule: string
  /** truth positives over all scenes of the model (any condition, first cell per scene) */
  baseRate: { positives: number; N: number }
  cells: Array<{ vantage: Vantage | null; condition: Condition } & DecisionCounts>
}

export type ModelTableRow = {
  modelId: string
  family: string
  tier: string
  headline: boolean
  byVantage: Record<
    Vantage,
    {
      net: { imageOnly: number | null; withContext: number | null; change: number | null }
      quantity: { imageOnly: number | null; withContext: number | null; change: number | null }
    }
  >
}

export type StudyPayload = {
  run: RunInfo
  model: string
  split: Split
  /** false = the routine flag was never recorded for this run (toggle disabled) */
  routineAvailable: boolean
  meals: number
  scenes: number
  level1: {
    figure: Level1Figure
    smallMultiples: Level1Figure[]
    table: Level1Row[]
    gain: Level1Gain[]
  }
  level2: Record<NutrientKey, Level2Block>
  kcalBias: KcalBiasRow[]
  level3: Level3Row[]
  models: ModelTableRow[]
}

/* ---- Day -------------------------------------------------------------------- */

export type Column = { key: ColumnKey; label: string }

export type DecisionSide = {
  value: string
  explain: string
  margin: number | null
}

export type DayDecisionRow = {
  sceneId: string
  mealLabel: string
  key: DecisionKey
  label: string
  persona: 'IBS' | 'GLP-1'
  rule: string
  truth: DecisionSide
  byColumn: Record<string, (DecisionSide & { differs: boolean; direction: string }) | null>
}

export type DayNutritionRow = {
  nutrient: NutrientKey
  truth: number | null
  byColumn: Record<string, { est: number | null; deltaPct: number | null }>
}

export type DayUnderstandingRow = {
  sceneId: string
  mealId: string
  mealLabel: string
  byColumn: Record<string, { net: number; quantity: number; invented: string[] } | null>
}

export type DaySceneInfo = {
  sceneId: string
  mealId: string
  slot: string | null
  index: number
  valid: boolean
  exclusionReason: string | null
  inRun: boolean
  scoredColumns: string[]
}

export type DayPayload = {
  run: RunInfo
  date: string
  model: string
  condition: Condition
  columns: Column[]
  scenes: DaySceneInfo[]
  decisions: DayDecisionRow[]
  nutrition: {
    partial: boolean
    note: string | null
    rows: DayNutritionRow[]
  }
  understanding: DayUnderstandingRow[]
}

/* ---- Meal ------------------------------------------------------------------- */

export type TruthItemDto = {
  id: string
  dish: string
  name: string
  grams: number | null
  basis: string | null
  tag: Tag
  state: string | null
  components: string[] | null
}

export type PredDto = {
  id: string
  dish: string
  name: string
  grams: number | null
  inferred: boolean
  isDrink: boolean
  preparation: string | null
}

export type MatchedCell = {
  truthId: string
  predIds: string[]
  identity: Identity
  status: 'exact' | 'substitute' | 'missed' | 'wrong'
  /** grouped estimate (sum of the row's pred grams) */
  estimate: number | null
  grade: number | null
  deltaPct: number | null
  /** other truth items sharing the row (one-to-many) */
  sharedWith: string[]
}

export type InventedDto = {
  predId: string
  name: string
  tag: Tag
  grams: number | null
  origin: 'unpaired' | 'wrong_pairing'
}

export type MealColumn = {
  key: ColumnKey
  label: string
  state: 'scored' | 'not_interpreted' | 'not_matched'
  error: string | null
  decompositionId: string | null
  matchTableId: string | null
  mocked: boolean
  contextUsed: { hit?: boolean; cardsRetrieved?: string[] } | null
  preds: PredDto[]
  matches: MatchedCell[]
  invented: InventedDto[]
  droppedDrinks: string[]
  overrideN: number
  /** the ScoreCell predates the match table (a rescore failed) */
  cellStale: boolean
  summary: {
    net: number
    quantity: number
    recognized: number
    invented: number
    f1: number
    massMae: number | null
    massMape: number | null
    truthTotalG: number
    estTotalG: number
  } | null
}

export type MealPayload = {
  run: RunInfo
  model: string
  condition: Condition
  meal: { id: string; date: string; slot: string | null; eatenAt: string }
  scene: {
    id: string
    index: number
    valid: boolean
    exclusionReason: string | null
    notes: string | null
    inRun: boolean
    photos: Record<Vantage, { url: string; artifactId: string } | null>
  }
  /** the meal's scenes for the Photo tabs */
  scenes: Array<{ id: string; index: number; valid: boolean; inRun: boolean }>
  /** the day's meals for the meal switcher */
  dayMeals: Array<{ id: string; slot: string | null; eatenAt: string; scenes: Array<{ id: string; index: number; inRun: boolean }> }>
  truth: TruthItemDto[]
  columns: MealColumn[]
}

export type MatchOverrideRequest = {
  run: string
  decompositionId: string
  truthId: string
  predIds: string[]
  identity: Identity
  inventedTag?: Tag
  note?: string
}

export type MatchOverrideResponse = {
  ok: true
  overrideN: number
  rescored: boolean
  rescoreError: string | null
}
