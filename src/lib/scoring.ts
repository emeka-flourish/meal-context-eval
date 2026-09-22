import { createHash, randomBytes } from 'crypto'
import { db } from '@/lib/db'
import type { Arm, InputKind, Rater } from '@/generated/prisma/client'

/* Blind-scoring core — BUILD-SPEC §2 hygiene invariants, enforced SERVER-side:
   - Insight scoring: payloads are shuffled by shuffleKey and NEVER carry
     arm/inputKind until that rater's own score row has revealedAt set.
     Reveal state is per rater (self vs ext1 vs ext2 are independent rows).
   - Judge human-agreement mode: judge's numeric fields + rationale are
     withheld while humanOverall0100 is null. */

export type InsightRubric = { q1: number; q2: number; q3: number; comment?: string }

export type BlindInsight = {
  id: string
  date: string
  text: string
  profile: { code: string; name: string } | null
  scored: boolean
  rubric: InsightRubric | null
  revealed: { arm: Arm; inputKind: InputKind } | null
}

function isScore(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5
}

// Rubric = 3 items 1–5 + optional comment, stored as {q1,q2,q3,comment}.
export function parseRubric(input: unknown): InsightRubric | null {
  if (typeof input !== 'object' || input === null) return null
  const r = input as Record<string, unknown>
  if (!isScore(r.q1) || !isScore(r.q2) || !isScore(r.q3)) return null
  const comment = typeof r.comment === 'string' ? r.comment.trim() : ''
  return { q1: r.q1, q2: r.q2, q3: r.q3, ...(comment ? { comment } : {}) }
}

// Insights in [from, to], shuffled by shuffleKey. The returned objects are
// built field-by-field so arm/inputKind cannot leak: they appear ONLY inside
// `revealed`, and only when this rater's score row has revealedAt set.
export async function listInsightsForRater(opts: {
  rater: Rater
  from?: string
  to?: string
}): Promise<BlindInsight[]> {
  const insights = await db.insight.findMany({
    where:
      opts.from || opts.to
        ? {
            date: {
              ...(opts.from ? { gte: new Date(opts.from) } : {}),
              ...(opts.to ? { lte: new Date(opts.to) } : {}),
            },
          }
        : {},
    orderBy: { shuffleKey: 'asc' },
    include: {
      scores: { where: { rater: opts.rater } },
      // Persona is NOT a blinded variable (identifiable from the text itself);
      // arm/inputKind remain the blinded pair.
      profile: { select: { code: true, name: true } },
    },
  })
  return insights.map((i) => {
    const score = i.scores[0]
    return {
      id: i.id,
      date: i.date.toISOString().slice(0, 10),
      text: i.text,
      profile: i.profile ? { code: i.profile.code, name: i.profile.name } : null,
      scored: Boolean(score),
      rubric: score ? (score.rubric as unknown as InsightRubric) : null,
      revealed: score?.revealedAt ? { arm: i.arm, inputKind: i.inputKind } : null,
    }
  })
}

// Upsert this rater's score. scoredBlind is always true — the form is only
// ever shown blind. reveal=true (owner flow): submit IS the reveal, revealedAt
// stamped now and {arm, inputKind} returned for post-submit display.
// reveal=false (external raters): revealedAt stays null and is never
// overwritten; nothing is returned to display. Returns null if the insight
// does not exist.
export async function submitInsightScore(opts: {
  insightId: string
  rater: Rater
  rubric: InsightRubric
  reveal: boolean
}): Promise<{ revealed: { arm: Arm; inputKind: InputKind } | null } | null> {
  const insight = await db.insight.findUnique({ where: { id: opts.insightId } })
  if (!insight) return null
  const revealedAt = opts.reveal ? new Date() : null
  await db.insightScore.upsert({
    where: { insightId_rater: { insightId: opts.insightId, rater: opts.rater } },
    create: {
      insightId: opts.insightId,
      rater: opts.rater,
      rubric: opts.rubric,
      scoredBlind: true,
      revealedAt,
    },
    update: {
      rubric: opts.rubric,
      scoredBlind: true,
      // Never clear an existing reveal; only ever set it on a revealing submit.
      ...(opts.reveal ? { revealedAt } : {}),
    },
  })
  return { revealed: opts.reveal ? { arm: insight.arm, inputKind: insight.inputKind } : null }
}

// --- Day context (memory aid for blind insight scoring) --------------------

export type DayContextMeal = {
  mealType: string | null
  eatenAtTime: string // HH:MM local
  photos: string[] // blobUrls — non-reference, non-excluded only
  gtDishes: { dishName: string; ingredients: string[] }[] | null
  attestation: string | null
}

export type DayContext = Record<string, { meals: DayContextMeal[] }>

type PayloadDish = {
  dishName?: unknown
  ingredients?: { name?: unknown; grams?: unknown; grams_est?: unknown }[]
}

function gtDishesFromPayload(payload: unknown): DayContextMeal['gtDishes'] {
  if (typeof payload !== 'object' || payload === null) return null
  const dishes = (payload as { dishes?: unknown }).dishes
  if (!Array.isArray(dishes)) return null
  return (dishes as PayloadDish[]).map((d) => ({
    dishName: typeof d.dishName === 'string' ? d.dishName : 'dish',
    ingredients: (Array.isArray(d.ingredients) ? d.ingredients : []).map((ing) => {
      const name = typeof ing.name === 'string' ? ing.name : 'ingredient'
      const grams =
        typeof ing.grams === 'number' ? ing.grams : typeof ing.grams_est === 'number' ? ing.grams_est : null
      return grams === null ? name : `${name} — ${Math.round(grams)}g`
    }),
  }))
}

// Day evidence for the blind insight cards: PHOTOS + GT ONLY (hygiene
// invariant 2 companion rule). The query never selects artifact.surface and
// never touches pipeline decompositions, so arm-identifying material cannot
// leak into the payload. GT/silver_assist is arm-neutral by construction.
export async function buildDayContext(dates: string[]): Promise<DayContext> {
  const unique = [...new Set(dates)].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
  const context: DayContext = {}
  if (unique.length === 0) return context
  const meals = await db.meal.findMany({
    where: {
      OR: unique.map((d) => ({
        eatenAt: {
          gte: new Date(`${d}T00:00:00`),
          lt: new Date(new Date(`${d}T00:00:00`).getTime() + 86400_000),
        },
      })),
    },
    orderBy: { eatenAt: 'asc' },
    select: {
      mealType: true,
      eatenAt: true,
      artifacts: {
        where: { isReference: false, excludeFromExport: false, blobUrl: { not: null } },
        orderBy: { uploadedAt: 'asc' },
        select: { blobUrl: true }, // deliberately NO surface
      },
      decompositions: {
        where: { source: { in: ['gt', 'silver_assist'] } },
        select: { source: true, payload: true, attestation: true },
      },
    },
  })
  for (const d of unique) context[d] = { meals: [] }
  for (const m of meals) {
    const day = m.eatenAt.toLocaleDateString('en-CA')
    if (!context[day]) continue
    const gtRow =
      m.decompositions.find((dec) => dec.source === 'gt') ??
      m.decompositions.find((dec) => dec.source === 'silver_assist')
    context[day].meals.push({
      mealType: m.mealType,
      eatenAtTime: m.eatenAt.toTimeString().slice(0, 5),
      photos: m.artifacts.map((a) => a.blobUrl).filter((u): u is string => Boolean(u)),
      gtDishes: gtRow ? gtDishesFromPayload(gtRow.payload) : null,
      attestation: gtRow?.attestation ?? null,
    })
  }
  return context
}

export type JudgeNumbers = {
  componentRecall: number
  componentPrecision: number
  quantityScore: number
  preparationScore: number
  overall0100: number
  rationale: string
}

export type JudgeRow = {
  id: string
  mealId: string
  mealDate: string
  guidelineVersion: string
  judgeModelId: string
  // Withheld (null) in human mode until humanOverall0100 is recorded.
  judge: JudgeNumbers | null
  human: { overall0100: number; notes: string | null } | null
  payloads?: { gt: unknown; eval: unknown }
}

function toJudgeRow(
  r: {
    id: string
    guidelineVersion: string
    judgeModelId: string
    componentRecall: number
    componentPrecision: number
    quantityScore: number
    preparationScore: number
    overall0100: number
    rationale: string
    humanOverall0100: number | null
    humanNotes: string | null
    gtDecomposition: { payload: unknown; mealId: string; meal: { eatenAt: Date } }
    evalDecomposition: { payload: unknown }
  },
  humanMode: boolean,
): JudgeRow {
  const human =
    r.humanOverall0100 === null
      ? null
      : { overall0100: r.humanOverall0100, notes: r.humanNotes }
  const withheld = humanMode && human === null
  return {
    id: r.id,
    mealId: r.gtDecomposition.mealId,
    mealDate: r.gtDecomposition.meal.eatenAt.toISOString(),
    guidelineVersion: r.guidelineVersion,
    judgeModelId: r.judgeModelId,
    judge: withheld
      ? null
      : {
          componentRecall: r.componentRecall,
          componentPrecision: r.componentPrecision,
          quantityScore: r.quantityScore,
          preparationScore: r.preparationScore,
          overall0100: r.overall0100,
          rationale: r.rationale,
        },
    human,
    ...(humanMode
      ? { payloads: { gt: r.gtDecomposition.payload, eval: r.evalDecomposition.payload } }
      : {}),
  }
}

// humanMode=true → rows still lacking a human score get the (GT, evaluated)
// payload pair but NO judge numbers and NO rationale. humanMode=false is the
// analysis/full view (payloads omitted, all fields present).
export async function listJudgeScores(opts: { humanMode: boolean }): Promise<JudgeRow[]> {
  const rows = await db.judgeScore.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      gtDecomposition: {
        select: { payload: true, mealId: true, meal: { select: { eatenAt: true } } },
      },
      evalDecomposition: { select: { payload: true } },
    },
  })
  return rows.map((r) => toJudgeRow(r, opts.humanMode))
}

// Record the human score; the returned row carries the judge's numbers —
// this return IS the reveal. Throws Prisma's not-found on a bad id.
export async function submitHumanJudgeScore(opts: {
  judgeScoreId: string
  humanOverall0100: number
  humanNotes?: string
}): Promise<JudgeRow> {
  const row = await db.judgeScore.update({
    where: { id: opts.judgeScoreId },
    data: {
      humanOverall0100: opts.humanOverall0100,
      humanNotes: opts.humanNotes?.trim() || null,
    },
    include: {
      gtDecomposition: {
        select: { payload: true, mealId: true, meal: { select: { eatenAt: true } } },
      },
      evalDecomposition: { select: { payload: true } },
    },
  })
  return toJudgeRow(row, false)
}

// --- Rater tokens (external blind raters) ---------------------------------

// 32 random bytes, URL-safe. Only the SHA-256 hash is ever stored.
export function generateRaterToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export type ExternalRater = Exclude<Rater, 'self'>

// Hash lookup + expiry check. The rater identity comes FROM the token —
// callers never get to choose it.
export async function validateRaterToken(
  token: string,
): Promise<{ rater: ExternalRater } | null> {
  if (typeof token !== 'string' || token.length < 16) return null
  const row = await db.raterToken.findUnique({ where: { tokenHash: hashToken(token) } })
  if (!row) return null
  if (row.expiresAt.getTime() <= Date.now()) return null
  if (row.rater === 'self') return null // tokens are external-only
  return { rater: row.rater }
}
