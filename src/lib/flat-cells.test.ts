import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  cellFindMany: vi.fn(),
  decoFindMany: vi.fn(),
  callFindMany: vi.fn(),
}))
vi.mock('@/lib/db', () => ({
  db: {
    scoreCell: { findMany: m.cellFindMany },
    decomposition: { findMany: m.decoFindMany },
    llmCall: { findMany: m.callFindMany },
  },
}))

import { buildCellRows, CELL_COLUMNS, DECISION_COLUMNS, METRICS_EXPORT_COLUMNS } from './flat'
import { scoreCellPure } from '@/runners/score'
import { mockClassify, toScoringClassification, ingredientLines } from '@/runners/classify'
import { CASES } from '@/lib/scoring/cases'
import { toCsv } from './csv'

const case1 = CASES.find((c) => c.n === 1)!
const lookup = () => ({ kcal: 100, protein: 5, fat: 3, carb: 12, fiber: 1, source: 'fdc' as const })

describe('CELL_COLUMNS — METRICS.md export columns', () => {
  it('contains every METRICS export column, in order, plus the six dec_* triples', () => {
    for (const c of METRICS_EXPORT_COLUMNS) expect(CELL_COLUMNS).toContain(c)
    const positions = METRICS_EXPORT_COLUMNS.map((c) => CELL_COLUMNS.indexOf(c))
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(DECISION_COLUMNS).toHaveLength(6)
    for (const d of DECISION_COLUMNS) for (const s of ['gt', 'est', 'margin']) expect(CELL_COLUMNS).toContain(`${d.col}_${s}`)
    expect(CELL_COLUMNS.filter((c) => c.startsWith('dec_'))).toHaveLength(18)
    expect(new Set(CELL_COLUMNS).size).toBe(CELL_COLUMNS.length)
  })
})

describe('buildCellRows — one row per ScoreCell', () => {
  const out = scoreCellPure({
    truth: case1.truth,
    preds: case1.preds,
    match: case1.match,
    lookup,
    truthClass: toScoringClassification(mockClassify(ingredientLines(case1.truth))),
    estClass: toScoringClassification(mockClassify(ingredientLines(case1.preds))),
    slot: 'lunch',
  })
  const config = {
    models: [{ id: 'gpt-5.1', family: 'openai', tier: 'frontier' }],
    aliasVersion: 'fdc-alias.v1',
    corpusVersion: 'none',
  }
  const hashes = { block1: 'a', block2: 'b', block3: 'c', block4: 'd', block5: null, block6: null }

  beforeEach(() => {
    vi.clearAllMocks()
    m.cellFindMany.mockResolvedValue([
      {
        id: 'cell1',
        runId: 'run1',
        sceneId: 's1',
        vantage: 'phone',
        condition: 'image_only',
        modelId: 'gpt-5.1',
        level1: { ...out.level1, weighedShare: 0.987, overrideN: 2 },
        level2: out.level2,
        level3: out.level3,
        routine: true,
        run: { label: 'run-1', config, createdAt: new Date() },
        scene: { index: 1, meal: { eatenAt: new Date('2026-08-14T13:00:00'), mealType: 'lunch' } },
      },
      {
        id: 'cell2',
        runId: 'run1',
        sceneId: 's1',
        vantage: null,
        condition: 'context_only',
        modelId: 'gpt-5.1',
        level1: out.level1,
        level2: out.level2,
        level3: out.level3,
        routine: null,
        run: { label: 'run-1', config, createdAt: new Date() },
        scene: { index: 1, meal: { eatenAt: new Date('2026-08-14T13:00:00'), mealType: 'lunch' } },
      },
    ])
    m.decoFindMany.mockResolvedValue([
      { id: 'd1', runId: 'run1', sceneId: 's1', vantage: 'phone', condition: 'image_only', modelId: 'gpt-5.1', contextUsed: { hit: false }, promptBlockHashes: hashes, llmCallId: 'call1' },
      { id: 'd2', runId: 'run1', sceneId: 's1', vantage: null, condition: 'context_only', modelId: 'gpt-5.1', contextUsed: { hit: true }, promptBlockHashes: hashes, llmCallId: 'call2' },
    ])
    m.callFindMany.mockResolvedValue([
      { id: 'call1', costUsdEst: 0.0123, latencyMs: 4200 },
      { id: 'call2', costUsdEst: 0.002, latencyMs: 900 },
    ])
  })

  it('fills every column (present keys) with the cell values and joins cost/latency from the ledger', async () => {
    const rows = await buildCellRows('run1')
    expect(rows).toHaveLength(2)
    for (const row of rows) for (const col of CELL_COLUMNS) expect(Object.prototype.hasOwnProperty.call(row, col)).toBe(true)
    const r = rows[0]
    expect(r).toMatchObject({
      run: 'run1',
      run_label: 'run-1',
      date: '2026-08-14',
      slot: 'lunch',
      photo: 1,
      vantage: 'phone',
      condition: 'image_only',
      model_family: 'openai',
      model_tier: 'frontier',
      model_id: 'gpt-5.1',
      routine: true,
      us: null,
      retrieval_hit: null,
      weighed_share: 0.987,
      override_n: 2,
      cost_usd: 0.0123,
      latency_s: 4.2,
      alias_version: 'fdc-alias.v1',
      corpus_version: 'none',
    })
    expect(r.found).toBeCloseTo(out.level1.recognized, 9)
    expect(r.net).toBeCloseTo(out.level1.net, 9)
    expect(r.quantity).toBeCloseTo(out.level1.quantity, 9)
    expect(r.f1_ing).toBeCloseTo(out.level1.f1.f1, 9)
    expect(r.kcal_gt).toBeCloseTo(out.level2.truth.kcal, 9)
    expect(r.fiber_est).toBeCloseTo(out.level2.est.fiber, 9)
    expect(typeof r.prompt_hash).toBe('string')
    expect(r.dec_ibs_fodmap_gt).toBe(out.level3.fodmapLight.truth)
    expect(r.dec_ibs_large_est).toBe(out.level3.largeKcal.est)
    expect(r.dec_glp1_mass_margin).toBeCloseTo(out.level3.largeMass.marginEst!, 9)
    expect(r.dec_glp1_irritant_margin).toBeNull()
    expect(r.dec_ibs_fodmap_margin).toBe(0)
  })
  it('context_only rows have no vantage and carry the retrieval hit', async () => {
    const rows = await buildCellRows('run1')
    expect(rows[1]).toMatchObject({ vantage: null, condition: 'context_only', retrieval_hit: true, override_n: 0, routine: null })
  })
  it('serialises to CSV with the CELL_COLUMNS header', async () => {
    const csv = toCsv(await buildCellRows(), CELL_COLUMNS)
    const [header, ...lines] = csv.trim().split('\r\n')
    expect(header.split(',')).toEqual(CELL_COLUMNS)
    expect(lines).toHaveLength(2)
  })
})
