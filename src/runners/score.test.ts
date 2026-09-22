import { describe, it, expect, vi, beforeEach } from 'vitest'

// Prisma stub: every call the score runner makes is a vi.fn() so the
// persistence round trip can be asserted (what was written, what is read back).
const m = vi.hoisted(() => ({
  scoreCellFindFirst: vi.fn(),
  scoreCellCreate: vi.fn(),
  scoreCellUpdate: vi.fn(),
  decoFindFirst: vi.fn(),
  decoFindUnique: vi.fn(),
  matchFindUnique: vi.fn(),
  classFindFirst: vi.fn(),
  sceneFindUnique: vi.fn(),
  gtFindMany: vi.fn(),
}))
vi.mock('@/lib/db', () => ({
  db: {
    scoreCell: { findFirst: m.scoreCellFindFirst, create: m.scoreCellCreate, update: m.scoreCellUpdate },
    decomposition: { findFirst: m.decoFindFirst, findUnique: m.decoFindUnique },
    matchTable: { findUnique: m.matchFindUnique },
    classification: { findFirst: m.classFindFirst },
    photoScene: { findUnique: m.sceneFindUnique },
    gtItem: { findMany: m.gtFindMany },
  },
}))
vi.mock('@/lib/corpus/routine-flag', () => ({ routineForCell: async () => null }))
vi.mock('@/lib/llm', () => ({
  runLlm: async (args: { mock: () => unknown }) => ({ output: args.mock(), callId: 'mock-call', mocked: true, latencyMs: 0 }),
  willMock: () => true,
  mockForced: () => true,
}))

import { runScore, scoreCellPure, storedClassifier } from './score'
import { mockClassify, toScoringClassification, ingredientLines } from './classify'
import { CASES, scoreCase } from '@/lib/scoring/cases'
import type { NutrientLookup } from '@/lib/scoring/level2'
import type { Level1Result } from '@/lib/scoring/types'

const case2 = CASES.find((c) => c.n === 2)!

// per-100 g doubles: salmon 200 kcal / 20 g protein / 13 g fat; starches and veg lighter
const PER100: Record<string, { kcal: number; protein: number; fat: number; carb: number; fiber: number }> = {
  salmon: { kcal: 200, protein: 20, fat: 13, carb: 0, fiber: 0 },
  'sweet potato': { kcal: 90, protein: 2, fat: 0.1, carb: 21, fiber: 3 },
  'roasted vegetables': { kcal: 60, protein: 3, fat: 2, carb: 8, fiber: 3 },
  'brussels sprouts': { kcal: 40, protein: 3, fat: 0.5, carb: 8, fiber: 4 },
  broccoli: { kcal: 35, protein: 2.4, fat: 0.4, carb: 7, fiber: 3 },
  zucchini: { kcal: 17, protein: 1.2, fat: 0.3, carb: 3, fiber: 1 },
  onion: { kcal: 40, protein: 1, fat: 0.1, carb: 9, fiber: 2 },
  'olive oil': { kcal: 884, protein: 0, fat: 100, carb: 0, fiber: 0 },
  'curry powder': { kcal: 325, protein: 14, fat: 14, carb: 55, fiber: 53 },
  parsley: { kcal: 36, protein: 3, fat: 0.8, carb: 6, fiber: 3 },
}
const lookup: NutrientLookup = (name) => {
  const hit = PER100[name.toLowerCase()]
  return hit ? { ...hit, source: 'fdc' } : null
}

const truthClass = toScoringClassification(mockClassify(ingredientLines(case2.truth)))
const estClass = toScoringClassification(mockClassify(ingredientLines(case2.preds)))

describe('scoreCellPure — the three levels from one set of inputs', () => {
  const out = scoreCellPure({ truth: case2.truth, preds: case2.preds, match: case2.match, lookup, truthClass, estClass, slot: 'lunch' })

  it('level 1 equals the worked case 2', () => {
    const ref = scoreCase(case2)
    expect(out.level1.recognized).toBeCloseTo(ref.recognized, 9)
    expect(out.level1.quantity).toBeCloseTo(ref.quantity, 9)
    expect(out.level1.net).toBe(1)
  })
  it('level 2 converts both sides independently (composite split equally, oil counted)', () => {
    // truth veg 200 g split over 5 components; salmon 170 × 2 = 340 kcal
    expect(out.level2.truth.kcal).toBeGreaterThan(398)
    expect(out.level2.truth.unresolved).toEqual([])
    expect(out.level2.est.kcal).toBeGreaterThan(out.level2.truth.kcal) // est grams are slightly larger
    expect(out.level2.errors.kcal.mae).toBeCloseTo(Math.abs(out.level2.est.kcal - out.level2.truth.kcal), 9)
    expect(out.level2.errors.protein.signed).not.toBeNull()
  })
  it('level 3 uses the stored classifications and agrees on a routine plate', () => {
    expect(out.level3.fodmapLight.truth).toBe(truthClass.light)
    expect(out.level3.fodmapLight.est).toBe(estClass.light)
    expect(out.level3.largeMass.truth).toBe(true) // 527 g ≥ 500
    expect(out.level3.proteinAdequate.truth).toBe(true) // salmon 170 g → 37.4 g protein
    expect(out.level3.agreementRate).toBe(1)
  })
  it('storedClassifier answers the truth call by value and everything else with the estimate', () => {
    const t = { ...truthClass, reason: 'T' }
    const e = { ...estClass, reason: 'E' }
    const c = storedClassifier(case2.truth, t, e)
    expect(c(case2.truth.filter((x) => x.tag !== 'ignore')).reason).toBe('T')
    expect(c(case2.preds).reason).toBe('E')
  })
})

describe('runScore — persistence round trip', () => {
  const args = { runId: 'run1', sceneId: 'scene1', vantage: 'phone' as const, condition: 'image_context' as const, modelId: 'gpt-5.1' }
  const gtRows = case2.truth.map((t, order) => ({
    id: t.id,
    sceneId: 'scene1',
    dish: t.dish,
    name: t.name,
    grams: t.grams ?? null,
    basis: t.basis,
    tag: t.tag,
    state: t.state ?? null,
    componentsNote: t.components ? t.components.join(', ') : null,
    order,
  }))

  beforeEach(() => {
    vi.clearAllMocks()
    m.scoreCellFindFirst.mockResolvedValue(null)
    m.decoFindFirst.mockResolvedValue({ id: 'deco1', payload: { version: 'interpret.v3', predItems: case2.preds, mocked: true } })
    m.decoFindUnique.mockResolvedValue({ payload: { version: 'interpret.v3', predItems: case2.preds, mocked: true } })
    m.matchFindUnique.mockResolvedValue({
      id: 'mt1',
      rows: case2.match.rows,
      invented: case2.match.invented,
      droppedDrinks: case2.match.droppedDrinks,
      overrides: [{ truthId: 't-parsley', predIds: ['p-parsley'], identity: 1 }],
    })
    m.classFindFirst.mockImplementation(async ({ where }: { where: { side: string } }) =>
      where.side === 'truth' ? { id: 'c-truth', payload: mockClassify(ingredientLines(case2.truth)) } : { id: 'c-est', payload: mockClassify(ingredientLines(case2.preds)) },
    )
    m.sceneFindUnique.mockResolvedValue({ id: 'scene1', meal: { mealType: 'lunch' } })
    m.gtFindMany.mockResolvedValue(gtRows)
    m.scoreCellCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'cell1', ...data }))
  })

  it('reads decomposition, match table (overrides applied), classifications and truth; writes one ScoreCell', async () => {
    const res = await runScore(args, { lookup })
    expect(res).toMatchObject({ scoreCellId: 'cell1', existed: false })
    expect(m.scoreCellCreate).toHaveBeenCalledTimes(1)
    const data = m.scoreCellCreate.mock.calls[0][0].data as Record<string, unknown>
    expect(data).toMatchObject({ runId: 'run1', sceneId: 'scene1', vantage: 'phone', condition: 'image_context', modelId: 'gpt-5.1' })
    const l1 = data.level1 as Level1Result & { overrideN: number; matchTableId: string; weighedShare: number; decompositionId: string }
    expect(l1.recognized).toBeCloseTo(scoreCase(case2).recognized, 9)
    expect(l1.overrideN).toBe(1)
    expect(l1.matchTableId).toBe('mt1')
    expect(l1.decompositionId).toBe('deco1')
    expect(l1.weighedShare).toBeCloseTo((170 + 150 + 200) / (170 + 150 + 200 + 5 + 1 + 1), 9)
    expect((data.level2 as { truth: { kcal: number } }).truth.kcal).toBeGreaterThan(0)
    expect((data.level3 as { agreementRate: number }).agreementRate).toBe(1)
    // the lookup was called for the truth composite's components, not the composite name
    expect(res.output?.level2.truth.perItem.map((p) => p.name)).toContain('brussels sprouts')
  })
  it('writes the routine flag from the resolver (CORPUS.md §5) and returns it; null when the run has no context version', async () => {
    const routine = vi.fn(async () => true)
    const res = await runScore(args, { lookup, routine })
    expect(routine).toHaveBeenCalledWith('run1', 'scene1')
    expect(res.routine).toBe(true)
    expect(m.scoreCellCreate.mock.calls[0][0].data).toMatchObject({ routine: true })
    const res2 = await runScore(args, { lookup, routine: async () => null })
    expect(res2.routine).toBeNull()
    expect(m.scoreCellCreate.mock.calls[1][0].data).toMatchObject({ routine: null })
  })
  it('context_only forces vantage null in both the lookup and the write', async () => {
    await runScore({ ...args, vantage: 'phone', condition: 'context_only' }, { lookup })
    expect(m.decoFindFirst.mock.calls[0][0].where).toMatchObject({ vantage: null, condition: 'context_only' })
    expect(m.scoreCellCreate.mock.calls[0][0].data).toMatchObject({ vantage: null })
  })
  it('is idempotent: an existing cell is returned without recomputation', async () => {
    m.scoreCellFindFirst.mockResolvedValue({ id: 'cell-existing' })
    const res = await runScore(args, { lookup })
    expect(res).toEqual({ scoreCellId: 'cell-existing', existed: true, output: null, routine: null })
    expect(m.scoreCellCreate).not.toHaveBeenCalled()
    expect(m.decoFindFirst).not.toHaveBeenCalled()
  })
  it('force re-scores in place (update, not create)', async () => {
    m.scoreCellFindFirst.mockResolvedValue({ id: 'cell-existing' })
    m.scoreCellUpdate.mockResolvedValue({ id: 'cell-existing' })
    const res = await runScore({ ...args, force: true }, { lookup })
    expect(res.scoreCellId).toBe('cell-existing')
    expect(m.scoreCellUpdate).toHaveBeenCalledTimes(1)
    expect(m.scoreCellCreate).not.toHaveBeenCalled()
  })
  it('fails visibly when a prerequisite is missing', async () => {
    m.matchFindUnique.mockResolvedValue(null)
    await expect(runScore(args, { lookup })).rejects.toThrow(/no match table/)
    m.matchFindUnique.mockResolvedValue({ id: 'mt1', rows: [], invented: [], droppedDrinks: [], overrides: [] })
    m.classFindFirst.mockResolvedValue(null)
    await expect(runScore(args, { lookup })).rejects.toThrow(/truth classification missing/)
    m.decoFindFirst.mockResolvedValue(null)
    await expect(runScore(args, { lookup })).rejects.toThrow(/no decomposition/)
  })
})
