/* Wire types for the Corpus screen (REBUILD-SPEC §3.2, CORPUS.md §2–§3).
   Mirrors what the existing routes return — /api/corpus/queue, /versions,
   /dishware, /distill — plus the read-only UI routes under /api/corpus/ui. */

export type PortionClass = 'small' | 'usual' | 'large'
export const PORTION_CLASSES: PortionClass[] = ['small', 'usual', 'large']

export type CorpusTier = 'corrected' | 'confirmed' | 'unconfirmed'

export type QueueOrder = 'pilot' | 'frequency'

// ---- GET /api/corpus/queue ----------------------------------------------------

export type QueueIngredient = {
  id: string
  name: string
  amount: number | null
  unit: string | null
  notes: string | null
  gramsEst: number | null
  gramsSource: 'app_estimate' | 'unit_table' | 'none'
}

export type QueueDish = {
  id: string
  name: string
  description: string | null
  preparation: string | null
  servingSize: string | null
  ingredients: QueueIngredient[]
}

export type QueueMeal = {
  id: string
  sourceMealId: string
  localDate: string // YYYY-MM-DD
  localTime: string // HH:MM
  slot: 'breakfast' | 'lunch' | 'dinner' | 'snack'
  name: string
  description: string | null
  servingSize: string | null
  portionClassPrefill: PortionClass
  imageFile: string | null
  tier: CorpusTier
  pilotMatch: string | null
  frequency: number
  dishes: QueueDish[]
}

export type QueueResponse = {
  order: QueueOrder
  counts: { total: number; pending: number; annotated: number; pilot: number }
  offset: number
  limit: number
  meals: QueueMeal[]
}

// ---- POST /api/corpus/annotate -------------------------------------------------

export type EditedIngredient = { name: string; gramsEst?: number }
export type EditedDishJson = { name?: string; portionClass?: PortionClass; ingredients?: EditedIngredient[] }

export type AnnotationPayload = {
  mealId: string
  dishId?: string
  portionClass?: PortionClass
  agreed?: boolean
  excluded?: boolean
  editedJson?: EditedDishJson
}

export type AnnotateResponse = {
  ok: true
  annotation: { id: string; mealId: string; dishId: string | null; at: string }
  meal: { id: string; tier: CorpusTier; excluded: boolean }
}

// ---- context versions / dish cards ---------------------------------------------

export type VersionSummary = {
  id: string
  label: string
  createdAt: string
  cardCount: number
  corpusHash: string
}

export type CardIngredient = { name: string; inclusionRate: number; medianGramsEst: number | null }

export type DishCardDto = {
  id: string
  contextVersionId: string
  canonicalName: string
  aliases: string[]
  instanceCount: number
  lastSeen: string
  portionClassMix: Partial<Record<PortionClass, number>>
  priorGrams: number | null
  ingredients: CardIngredient[]
  features: { homeShare: number | null; slotMix: Partial<Record<'breakfast' | 'lunch' | 'dinner' | 'snack', number>> }
  tierMix: Partial<Record<CorpusTier, number>>
}

export type DishwareDto = {
  id: string
  contextVersionId: string | null
  name: string
  capacityMl: number | null
  capacityG: number | null
  usedFor: string | null
  photo: string | null
  createdAt: string
}

export type VersionDetail = VersionSummary & {
  habitProfile: string | null
  config: Record<string, unknown>
  cards: DishCardDto[]
  dishware: DishwareDto[]
}

// ---- /api/corpus/ui/* (read-only, this screen only) ----------------------------

export type CorpusStats = {
  total: number
  byTier: Record<CorpusTier, number>
  excluded: number
  /** meal-level annotation present and not excluded */
  annotated: number
  /** not excluded, no meal-level annotation — what the queue serves */
  inQueue: number
  withImage: number
  versions: VersionSummary[]
  latestVersion: VersionSummary | null
}

export type CardMatch = {
  query: string
  method: 'exact' | 'token' | 'embedding' | 'none'
  score: number
  card: DishCardDto | null
}

export type CardsResponse = {
  version: VersionSummary | null
  matches: CardMatch[]
}

// ---- POST /api/corpus/distill ---------------------------------------------------

export type DistillResponse = {
  ok: true
  contextVersionId: string
  label: string
  mocked: boolean
  cardCount: number
  mealCount: number
  dishwareSnapshotted: number
}
