/* Routine flag end to end against the LOCAL db in mock mode (scorecell_routine):
   a NEW meal + scene + 3 GtItems + a run pinned to the existing ContextVersion,
   interpret → match → classify → score for ONE context_only cell via the
   runners, then the flag on the ScoreCell / the cells export / the study API.
   Everything created here is deleted at the end and the row counts are
   asserted identical — nothing pre-existing is touched (the 84 GtItems and
   the scenes with notes are never read for writing). Skipped when no
   DATABASE_URL is configured. */
import 'dotenv/config'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.hoisted(() => {
  process.env.MOCK_LLM = '1'
})

import { db } from '@/lib/db'
import { runInterpret } from './interpret'
import { runMatch } from './match'
import { runClassify } from './classify'
import { runScore } from './score'
import { routineForScene, resetCardIndexCache } from '@/lib/corpus/routine-flag'
import { buildCellRows } from '@/lib/flat'
import { GET as studyGet } from '@/app/api/results/study/route'
import { POST as backfillPost } from '@/app/api/results/routine-backfill/route'
import type { StudyPayload } from '@/lib/ui/results-types'

const TABLES = ['meal', 'photoScene', 'gtItem', 'run', 'scoreCell', 'decomposition', 'matchTable', 'classification', 'llmCall', 'runItemError'] as const
type Counts = Record<(typeof TABLES)[number], number>

async function counts(): Promise<Counts> {
  const out = {} as Counts
  for (const t of TABLES) out[t] = await (db[t] as unknown as { count: () => Promise<number> }).count()
  return out
}

const ids = { mealId: '', sceneId: '', runId: '', decoId: '', cellId: '' }
let before: Counts
let contextVersionId = ''

async function cleanup() {
  const { runId, sceneId, mealId, decoId } = ids
  if (runId) {
    await db.scoreCell.deleteMany({ where: { runId } })
    await db.classification.deleteMany({ where: { runId } })
    await db.matchTable.deleteMany({ where: { runId } })
    await db.runItemError.deleteMany({ where: { runId } })
    await db.decomposition.deleteMany({ where: { runId } })
    await db.llmCall.deleteMany({ where: { OR: [{ subjectRef: { contains: runId } }, ...(decoId ? [{ subjectRef: { contains: decoId } }] : []), ...(sceneId ? [{ subjectRef: { contains: sceneId } }] : [])] } })
    await db.run.deleteMany({ where: { id: runId } })
  }
  if (sceneId) {
    await db.gtItem.deleteMany({ where: { sceneId } })
    await db.photoScene.deleteMany({ where: { id: sceneId } })
  }
  if (mealId) await db.meal.deleteMany({ where: { id: mealId } })
}

describe.skipIf(!process.env.DATABASE_URL)('routine flag: score → ScoreCell.routine → export → study API (local db, mock mode)', () => {
  beforeAll(async () => {
    expect(process.env.MOCK_LLM).toBe('1')
    before = await counts()
    const cv = await db.contextVersion.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true } })
    if (!cv) throw new Error('no ContextVersion in the db — build one (distill) before running this test')
    contextVersionId = cv.id
    resetCardIndexCache()

    const meal = await db.meal.create({ data: { eatenAt: new Date('2030-01-01T08:00:00Z'), mealType: 'breakfast', notes: '[scorecell_routine test meal — delete me]' } })
    ids.mealId = meal.id
    const scene = await db.photoScene.create({
      data: { mealId: meal.id, index: 1, valid: true, sameSceneConfirmed: true, notes: '[scorecell_routine test scene — delete me]' },
    })
    ids.sceneId = scene.id
    await db.gtItem.createMany({
      data: [
        { sceneId: scene.id, dish: 'Oatmeal', name: 'oatmeal', grams: 250, basis: 'weighed', tag: 'core', state: 'cooked', order: 0 },
        { sceneId: scene.id, dish: 'Oatmeal', name: 'banana', grams: 90, basis: 'weighed', tag: 'secondary', state: 'raw', order: 1 },
        { sceneId: scene.id, dish: 'Oatmeal', name: 'cinnamon', grams: null, basis: null, tag: 'spice', state: 'dry', order: 2 },
      ],
    })
    const run = await db.run.create({
      data: {
        label: '[scorecell_routine test run — delete me]',
        config: {
          label: 'scorecell_routine test',
          mealSet: 'custom',
          sceneIds: [scene.id],
          conditions: ['context_only'],
          models: [{ id: 'gpt-5.1', family: 'openai', tier: 'frontier' }],
          promptVersion: 'test',
          promptBlockHashes: {},
          matcher: { modelId: 'gpt-5.1', promptVersion: 'test' },
          classifier: { modelId: 'gpt-5.1', promptVersion: 'test' },
          corpusVersion: 'test',
          aliasVersion: 'test',
          contextVersionId,
        },
      },
    })
    ids.runId = run.id
  })

  afterAll(async () => {
    try {
      await cleanup()
    } finally {
      await db.$disconnect()
    }
  })

  const cell = { vantage: null, condition: 'context_only' as const, modelId: 'gpt-5.1' }

  it('persists a boolean routine flag on the scored cell, equal to the rule applied to the run context version', async () => {
    const { runId, sceneId } = ids
    const interp = await runInterpret({ runId, sceneId, ...cell })
    expect(interp.mocked).toBe(true)
    ids.decoId = interp.decompositionId
    const matched = await runMatch({ runId, decompositionId: interp.decompositionId })
    expect(matched.mocked).toBe(true)
    await runClassify({ runId, sceneId, side: 'truth' })
    await runClassify({ runId, sceneId, side: 'estimate', decompositionId: interp.decompositionId })
    const scored = await runScore({ runId, sceneId, ...cell })
    ids.cellId = scored.scoreCellId
    expect(scored.existed).toBe(false)
    expect(typeof scored.routine).toBe('boolean')

    const row = await db.scoreCell.findUniqueOrThrow({ where: { id: scored.scoreCellId }, select: { routine: true, runId: true, sceneId: true } })
    expect(typeof row.routine).toBe('boolean')
    expect(row.routine).toBe(scored.routine)
    expect(row.routine).toBe(await routineForScene(sceneId, contextVersionId))
    // a scene of oatmeal against this corpus (Oatmeal card, instanceCount ≥ 3) is routine
    expect(row.routine).toBe(true)
  })

  it('the cells export carries the flag in the routine column', async () => {
    const rows = await buildCellRows(ids.runId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ run: ids.runId, scene_id: ids.sceneId, condition: 'context_only', routine: true })
  })

  it('the study API reports routineAvailable and filters by split', async () => {
    const get = async (split: string) => {
      const res = await studyGet(new NextRequest(`http://localhost/api/results/study?run=${ids.runId}&split=${split}`))
      expect(res.status).toBe(200)
      return (await res.json()) as StudyPayload
    }
    const all = await get('all')
    expect(all.routineAvailable).toBe(true)
    expect(all.split).toBe('all')
    expect(all.scenes).toBe(1)
    const routine = await get('routine')
    expect(routine.split).toBe('routine')
    expect(routine.scenes).toBe(1)
    const novel = await get('novel')
    expect(novel.split).toBe('novel')
    expect(novel.scenes).toBe(0)
  })

  it('the backfill recomputes the flag for the run’s existing cells (and nulls it when the run has no context version)', async () => {
    await db.scoreCell.update({ where: { id: ids.cellId }, data: { routine: null } })
    const res = await backfillPost(new NextRequest(`http://localhost/api/results/routine-backfill?run=${ids.runId}`, { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ runId: ids.runId, contextVersionId, cells: 1, scenes: 1, routine: 1, novel: 0, unknown: 0 })
    expect((await db.scoreCell.findUniqueOrThrow({ where: { id: ids.cellId } })).routine).toBe(true)

    const run = await db.run.findUniqueOrThrow({ where: { id: ids.runId } })
    const { contextVersionId: _dropped, ...noCtx } = run.config as Record<string, unknown>
    void _dropped
    await db.run.update({ where: { id: ids.runId }, data: { config: noCtx as object } })
    const res2 = await backfillPost(new NextRequest(`http://localhost/api/results/routine-backfill?run=${ids.runId}`, { method: 'POST' }))
    expect(await res2.json()).toMatchObject({ contextVersionId: null, unknown: 1, routine: 0 })
    expect((await db.scoreCell.findUniqueOrThrow({ where: { id: ids.cellId } })).routine).toBeNull()
    const study = (await (await studyGet(new NextRequest(`http://localhost/api/results/study?run=${ids.runId}&split=routine`))).json()) as StudyPayload
    expect(study.routineAvailable).toBe(false)
    expect(study.split).toBe('all')
    const missing = await backfillPost(new NextRequest('http://localhost/api/results/routine-backfill?run=no-such-run', { method: 'POST' }))
    expect(missing.status).toBe(404)
  })

  it('deleting everything it created restores the exact row counts', async () => {
    await cleanup()
    expect(await counts()).toEqual(before)
  })
})
