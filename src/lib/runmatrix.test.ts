import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  runFindUnique: vi.fn(),
  runUpdate: vi.fn(),
  runCreate: vi.fn(),
  sceneFindMany: vi.fn(),
  decoFindMany: vi.fn(),
  matchFindMany: vi.fn(),
  classFindMany: vi.fn(),
  cellFindMany: vi.fn(),
  errFindMany: vi.fn(),
}))
vi.mock('./db', () => ({
  db: {
    run: { findUnique: m.runFindUnique, update: m.runUpdate, create: m.runCreate },
    photoScene: { findMany: m.sceneFindMany },
    decomposition: { findMany: m.decoFindMany },
    matchTable: { findMany: m.matchFindMany },
    classification: { findMany: m.classFindMany },
    scoreCell: { findMany: m.cellFindMany },
    runItemError: { findMany: m.errFindMany },
    contextVersion: {
      findFirst: async () => ({ id: 'cv1', label: 'corpus v1 (test)' }),
      findUnique: async ({ where }: { where: { id: string } }) => (where.id === 'cv1' ? { id: 'cv1', label: 'corpus v1 (test)' } : null),
    },
  },
}))

import { buildRunConfig, buildRunWorkList, cellKey, createRun, enumerateCells, CONDITIONS, VANTAGES } from './runmatrix'
import { BLOCK_KEYS } from './prompt-blocks'

const MODELS = [
  { id: 'gpt-5.1', family: 'openai', tier: 'frontier' },
  { id: 'claude-sonnet-5', family: 'anthropic', tier: 'frontier' },
]

describe('enumerateCells — scene × vantage × condition × model', () => {
  it('count = scenes × 3 vantages × 2 image conditions × models + scenes × models (context_only)', () => {
    const scenes = ['s1', 's2', 's3', 's4', 's5']
    const cells = enumerateCells(scenes, { conditions: CONDITIONS, models: MODELS })
    const S = scenes.length
    const M = MODELS.length
    expect(cells).toHaveLength(S * 3 * 2 * M + S * M)
    expect(cells.filter((c) => c.condition === 'context_only').every((c) => c.vantage === null)).toBe(true)
    expect(cells.filter((c) => c.condition !== 'context_only').every((c) => c.vantage !== null)).toBe(true)
    expect(new Set(cells.map((c) => c.key)).size).toBe(cells.length)
  })
  it('respects a reduced condition / model set', () => {
    const cells = enumerateCells(['s1'], { conditions: ['image_only'], models: [MODELS[0]] })
    expect(cells).toHaveLength(VANTAGES.length)
    expect(cells.map((c) => c.vantage)).toEqual(['phone', 'glasses', 'tripod'])
  })
  it('cellKey encodes context_only as none', () => {
    expect(cellKey({ sceneId: 's', vantage: null, condition: 'context_only', modelId: 'm' })).toBe('s|none|context_only|m')
  })
})

describe('buildRunConfig — snapshot stamps', () => {
  it('records the source block hashes of interpret.v4, the matcher/classifier pins and versions', () => {
    const cfg = buildRunConfig({ label: 'run-1', conditions: ['image_only', 'context_only'], models: MODELS }, ['s1', 's2'])
    expect(cfg.sceneIds).toEqual(['s1', 's2'])
    expect(cfg.conditions).toEqual(['image_only', 'context_only'])
    for (const k of BLOCK_KEYS) expect(cfg.promptBlockHashes[k]).toMatch(/^[0-9a-f]{64}$/)
    expect(cfg.promptVersion).toBe('interpret.v4')
    expect(cfg.matcher.promptVersion).toBe('match.v3')
    expect(cfg.classifier.promptVersion).toBe('classify.v1')
    expect(typeof cfg.corpusVersion).toBe('string')
    expect(typeof cfg.aliasVersion).toBe('string')
  })
  it('defaults to all conditions and the configured roster; rejects empty sets', () => {
    const cfg = buildRunConfig({ label: 'x' }, ['s1'])
    expect(cfg.conditions).toEqual(['image_only', 'image_context', 'context_only'])
    expect(cfg.models.length).toBeGreaterThan(0)
    expect(() => buildRunConfig({ label: 'x', conditions: [] }, ['s1'])).toThrow(/condition/)
    expect(() => buildRunConfig({ label: 'x', models: [] }, ['s1'])).toThrow(/model/)
  })
})

describe('createRun / buildRunWorkList — db-backed', () => {
  const scenes = [
    { id: 's1', index: 1, meal: { eatenAt: new Date('2026-08-14T13:00:00'), mealType: 'lunch' } },
    { id: 's2', index: 2, meal: { eatenAt: new Date('2026-08-14T13:00:00'), mealType: 'lunch' } },
  ]
  beforeEach(() => {
    vi.clearAllMocks()
    m.sceneFindMany.mockResolvedValue(scenes)
    m.runCreate.mockImplementation(async ({ data }: { data: { label: string; config: unknown } }) => ({ id: 'run1', ...data }))
    m.decoFindMany.mockResolvedValue([])
    m.matchFindMany.mockResolvedValue([])
    m.classFindMany.mockResolvedValue([])
    m.cellFindMany.mockResolvedValue([])
    m.errFindMany.mockResolvedValue([])
    m.runUpdate.mockResolvedValue({})
  })

  it('createRun freezes the valid scene ids and reports the cell count', async () => {
    const r = await createRun({ label: 'run-1', mealSet: { kind: 'dates', dates: ['2026-08-14'] }, models: MODELS })
    expect(r.id).toBe('run1')
    expect(r.config.sceneIds).toEqual(['s1', 's2'])
    expect(r.config.contextVersionId).toBe('cv1') // context conditions default to the latest ContextVersion
    expect(r.config.vantages).toEqual(['phone', 'glasses'])
    expect(r.cellCount).toBe(2 * 2 * 2 * 2 + 2 * 2) // 2 scenes × 2 study vantages × 2 image conditions × 2 models + context_only
    expect(m.sceneFindMany.mock.calls[0][0].where).toMatchObject({ valid: true })
  })

  it('lists interpret → match → classify → score per cell plus one truth classification per scene, with done/failed states', async () => {
    const config = buildRunConfig({ label: 'run-1', models: MODELS }, ['s1', 's2'])
    m.runFindUnique.mockResolvedValue({ id: 'run1', status: 'created', config })
    // s1 phone image_only gpt-5.1 has been interpreted + matched; its score failed once
    m.decoFindMany.mockResolvedValue([{ id: 'd1', sceneId: 's1', vantage: 'phone', condition: 'image_only', modelId: 'gpt-5.1' }])
    m.matchFindMany.mockResolvedValue([{ decompositionId: 'd1' }])
    m.classFindMany.mockResolvedValue([{ sceneId: 's1', side: 'truth', decompositionId: null }])
    m.errFindMany.mockResolvedValue([{ kind: 'score', key: 's1|phone|image_only|gpt-5.1', error: 'boom' }])

    const { items, progress } = await buildRunWorkList('run1')
    const cells = 2 * 2 * 2 * 2 + 2 * 2
    expect(items).toHaveLength(cells * 4 + 2)
    expect(progress.cells).toHaveLength(cells)
    expect(progress.byKind.interpret).toEqual({ total: cells, done: 1, failed: 0 })
    expect(progress.byKind.match).toEqual({ total: cells, done: 1, failed: 0 })
    expect(progress.byKind.classify).toEqual({ total: cells + 2, done: 1, failed: 0 })
    expect(progress.byKind.score).toEqual({ total: cells, done: 0, failed: 1 })
    const cell = progress.cells.find((c) => c.key === 's1|phone|image_only|gpt-5.1')!
    expect(cell.state).toBe('failed')
    expect(cell.error).toBe('boom')
    expect(progress.counts.queued).toBe(cells - 1)
    const truth = items.filter((i) => i.kind === 'classify' && i.key.endsWith('|truth'))
    expect(truth).toHaveLength(2)
    expect(JSON.parse(truth[0].ref)).toEqual({ runId: 'run1', sceneId: 's1', side: 'truth' })
    expect(truth[0].done).toBe(true)
    const ctx = items.find((i) => i.kind === 'interpret' && i.key.includes('|none|context_only|'))!
    expect(JSON.parse(ctx.ref)).toMatchObject({ vantage: null, condition: 'context_only' })
    // status flips to running once something is done
    expect(progress.status).toBe('running')
    expect(m.runUpdate).toHaveBeenCalledWith({ where: { id: 'run1' }, data: { status: 'running' } })
  })

  it('throws for an unknown run', async () => {
    m.runFindUnique.mockResolvedValue(null)
    await expect(buildRunWorkList('nope')).rejects.toThrow(/not found/)
  })
})
