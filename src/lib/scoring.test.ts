import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the Prisma singleton — scoring.ts imports '@/lib/db'.
const m = vi.hoisted(() => ({
  insightFindMany: vi.fn(),
  insightFindUnique: vi.fn(),
  scoreUpsert: vi.fn(),
  judgeFindMany: vi.fn(),
  judgeUpdate: vi.fn(),
  tokenFindUnique: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    insight: { findMany: m.insightFindMany, findUnique: m.insightFindUnique },
    insightScore: { upsert: m.scoreUpsert },
    judgeScore: { findMany: m.judgeFindMany, update: m.judgeUpdate },
    raterToken: { findUnique: m.tokenFindUnique },
  },
}))

import {
  parseRubric,
  listInsightsForRater,
  submitInsightScore,
  listJudgeScores,
  generateRaterToken,
  hashToken,
  validateRaterToken,
} from './scoring'

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset())
})

const insight = (over: Record<string, unknown> = {}) => ({
  id: 'i1',
  date: new Date('2026-08-05T00:00:00Z'),
  arm: 'A',
  inputKind: 'estimated',
  text: 'You ate late three nights running.',
  modelId: 'model-x',
  promptVersion: 'insights.v1',
  shuffleKey: 'aaa',
  scores: [],
  ...over,
})

describe('parseRubric', () => {
  it('accepts 3 integer 1–5 items and trims the comment', () => {
    expect(parseRubric({ q1: 1, q2: 5, q3: 3, comment: '  fine ' })).toEqual({
      q1: 1,
      q2: 5,
      q3: 3,
      comment: 'fine',
    })
  })
  it('omits an empty comment', () => {
    expect(parseRubric({ q1: 2, q2: 2, q3: 2, comment: '  ' })).toEqual({
      q1: 2,
      q2: 2,
      q3: 2,
    })
  })
  it('rejects out-of-range, missing, and non-integer values', () => {
    expect(parseRubric({ q1: 0, q2: 3, q3: 3 })).toBeNull()
    expect(parseRubric({ q1: 6, q2: 3, q3: 3 })).toBeNull()
    expect(parseRubric({ q1: 2.5, q2: 3, q3: 3 })).toBeNull()
    expect(parseRubric({ q1: 3, q2: 3 })).toBeNull()
    expect(parseRubric(null)).toBeNull()
    expect(parseRubric('q1=3')).toBeNull()
  })
})

describe('blind insight list — invariant 2', () => {
  it('never contains arm/inputKind pre-reveal, even for scored-but-unrevealed rows', async () => {
    m.insightFindMany.mockResolvedValue([
      insight(),
      insight({
        id: 'i2',
        shuffleKey: 'bbb',
        arm: 'D',
        inputKind: 'gt',
        scores: [
          { rater: 'ext1', rubric: { q1: 1, q2: 1, q3: 2 }, scoredBlind: true, revealedAt: null },
        ],
      }),
    ])
    const items = await listInsightsForRater({ rater: 'ext1' })
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({
      id: 'i1',
      date: '2026-08-05',
      text: 'You ate late three nights running.',
      profile: null, // persona is not blinded (identifiable from text anyway)
      scored: false,
      rubric: null,
      revealed: null,
    })
    expect(items[1].scored).toBe(true)
    expect(items[1].revealed).toBeNull()
    // Belt-and-braces: the serialized payload must not leak the fields at all.
    const json = JSON.stringify(items)
    expect(json).not.toContain('arm')
    expect(json).not.toContain('inputKind')
    expect(json).not.toContain('estimated')
  })

  it('orders by shuffleKey (never by date/arm)', async () => {
    m.insightFindMany.mockResolvedValue([])
    await listInsightsForRater({ rater: 'self', from: '2026-08-01', to: '2026-08-07' })
    expect(m.insightFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { shuffleKey: 'asc' } }),
    )
  })

  it('reveals arm/inputKind only when THIS rater has revealedAt set', async () => {
    m.insightFindMany.mockResolvedValue([
      insight({
        scores: [
          {
            rater: 'self',
            rubric: { q1: 4, q2: 2, q3: 5, comment: 'ok' },
            scoredBlind: true,
            revealedAt: new Date(),
          },
        ],
      }),
    ])
    const items = await listInsightsForRater({ rater: 'self' })
    expect(items[0].revealed).toEqual({ arm: 'A', inputKind: 'estimated' })
    expect(items[0].rubric).toEqual({ q1: 4, q2: 2, q3: 5, comment: 'ok' })
  })
})

describe('submitInsightScore', () => {
  const rubric = { q1: 2, q2: 3, q3: 4 }

  it('self submit: records the reveal (revealedAt=now) and returns arm/inputKind', async () => {
    m.insightFindUnique.mockResolvedValue(insight({ arm: 'C', inputKind: 'gt' }))
    m.scoreUpsert.mockResolvedValue({})
    const res = await submitInsightScore({ insightId: 'i1', rater: 'self', rubric, reveal: true })
    expect(res).toEqual({ revealed: { arm: 'C', inputKind: 'gt' } })
    const arg = m.scoreUpsert.mock.calls[0][0]
    expect(arg.where).toEqual({ insightId_rater: { insightId: 'i1', rater: 'self' } })
    expect(arg.create.scoredBlind).toBe(true)
    expect(arg.create.revealedAt).toBeInstanceOf(Date)
    expect(arg.update.revealedAt).toBeInstanceOf(Date)
  })

  it('external submit: stays blind — revealedAt null, nothing revealed', async () => {
    m.insightFindUnique.mockResolvedValue(insight())
    m.scoreUpsert.mockResolvedValue({})
    const res = await submitInsightScore({ insightId: 'i1', rater: 'ext2', rubric, reveal: false })
    expect(res).toEqual({ revealed: null })
    const arg = m.scoreUpsert.mock.calls[0][0]
    expect(arg.create.revealedAt).toBeNull()
    expect(arg.create.scoredBlind).toBe(true)
    // Re-submits must never touch revealedAt on the blind path.
    expect('revealedAt' in arg.update).toBe(false)
  })

  it('returns null for an unknown insight without writing', async () => {
    m.insightFindUnique.mockResolvedValue(null)
    const res = await submitInsightScore({ insightId: 'nope', rater: 'self', rubric, reveal: true })
    expect(res).toBeNull()
    expect(m.scoreUpsert).not.toHaveBeenCalled()
  })
})

describe('judge human-agreement mode — invariant 3', () => {
  const judgeRow = (over: Record<string, unknown> = {}) => ({
    id: 'j1',
    guidelineVersion: 'judge-guidelines.v1',
    judgeModelId: 'family-b',
    componentRecall: 0.8,
    componentPrecision: 0.9,
    quantityScore: 70,
    preparationScore: 60,
    overall0100: 76,
    rationale: 'Matched lentil; missed the plantain.',
    humanOverall0100: null,
    humanNotes: null,
    gtDecomposition: {
      payload: { dishes: ['gt'] },
      mealId: 'm1',
      meal: { eatenAt: new Date('2026-08-03T19:00:00Z') },
    },
    evalDecomposition: { payload: { dishes: ['eval'] } },
    ...over,
  })

  it('withholds judge numbers AND rationale until humanOverall is set, but ships payloads', async () => {
    m.judgeFindMany.mockResolvedValue([
      judgeRow(),
      judgeRow({ id: 'j2', humanOverall0100: 65, humanNotes: 'close' }),
    ])
    const rows = await listJudgeScores({ humanMode: true })
    expect(rows[0].judge).toBeNull()
    expect(JSON.stringify(rows[0])).not.toContain('rationale')
    expect(rows[0].payloads).toEqual({ gt: { dishes: ['gt'] }, eval: { dishes: ['eval'] } })
    expect(rows[0].human).toBeNull()
    // Human-scored pair: fully revealed.
    expect(rows[1].judge?.overall0100).toBe(76)
    expect(rows[1].judge?.rationale).toContain('plantain')
    expect(rows[1].human).toEqual({ overall0100: 65, notes: 'close' })
  })

  it('full mode (analysis) returns all fields regardless of human state', async () => {
    m.judgeFindMany.mockResolvedValue([judgeRow()])
    const rows = await listJudgeScores({ humanMode: false })
    expect(rows[0].judge?.componentRecall).toBe(0.8)
    expect(rows[0].judge?.rationale).toBeTruthy()
    expect(rows[0].payloads).toBeUndefined()
  })
})

describe('rater tokens', () => {
  it('generates unique, URL-safe, 32-byte tokens and stores only the hash form', () => {
    const a = generateRaterToken()
    const b = generateRaterToken()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/) // 32 bytes base64url
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashToken(a)).toBe(hashToken(a)) // deterministic lookup key
  })

  it('valid token → rater from the DB row', async () => {
    const token = generateRaterToken()
    m.tokenFindUnique.mockResolvedValue({
      tokenHash: hashToken(token),
      rater: 'ext1',
      expiresAt: new Date(Date.now() + 86400_000),
    })
    expect(await validateRaterToken(token)).toEqual({ rater: 'ext1' })
    expect(m.tokenFindUnique).toHaveBeenCalledWith({
      where: { tokenHash: hashToken(token) },
    })
  })

  it('expired token → null', async () => {
    m.tokenFindUnique.mockResolvedValue({
      rater: 'ext2',
      expiresAt: new Date(Date.now() - 1000),
    })
    expect(await validateRaterToken(generateRaterToken())).toBeNull()
  })

  it('garbage/unknown token → null, short token never hits the DB', async () => {
    m.tokenFindUnique.mockResolvedValue(null)
    expect(await validateRaterToken(generateRaterToken())).toBeNull()
    expect(await validateRaterToken('short')).toBeNull()
    expect(m.tokenFindUnique).toHaveBeenCalledTimes(1)
  })
})
