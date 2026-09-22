import { NextRequest, NextResponse } from 'next/server'
import { bad, loadCells, loadRun, resolveModel } from '../_shared'
import { groupMeals, kcalBias, level1Figure, level1Gain, level1Table, level2Blocks, level3Rows, modelTable } from '@/lib/ui/results-study'
import type { Split, StudyPayload } from '@/lib/ui/results-types'

// GET /api/results/study?run=&model=&split= — Study scope (REBUILD-SPEC §3.4).
// Every number is computed here from ScoreCell JSON via the scoring
// aggregate helpers (bootstrap 2000, fixed seed): the Level 1 figure + table
// + paired context gain, one Level 2 block per nutrient, the signed-kcal-bias
// rows, the Level 3 decision counts, and the per-model table. `model=all`
// keeps the headline model for the tables and returns small multiples for
// the figure. `split=routine|novel` keeps only the cells whose scene carries
// that ScoreCell.routine flag (CORPUS.md §5, written at score time); `all`
// keeps every cell. routineAvailable=false says the flag is recorded on no
// cell of this run (the toggle renders disabled; split falls back to all).

export const dynamic = 'force-dynamic'

const SPLITS = new Set<Split>(['all', 'routine', 'novel'])

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const runId = q.get('run')
  if (!runId) return bad('run required')
  const run = await loadRun(runId)
  if (!run) return bad('run not found', 404)
  const modelParam = resolveModel(run, q.get('model'), true)
  if (!modelParam) return bad(`model must be one of: ${run.info.models.map((m) => m.id).join(', ')} or all`)
  const splitRaw = (q.get('split') ?? 'all') as Split
  const split: Split = SPLITS.has(splitRaw) ? splitRaw : 'all'

  const allCells = await loadCells(run.id)
  const routineAvailable = allCells.some((c) => c.routine !== null)
  const cells = split === 'all' || !routineAvailable ? allCells : allCells.filter((c) => c.routine === (split === 'routine'))
  const model = modelParam === 'all' ? run.info.headlineModel : modelParam
  const conditions = run.info.conditions
  const groups = groupMeals(cells, model)
  const level2 = level2Blocks(groups, conditions)
  const mealIds = new Set(cells.filter((c) => c.modelId === model).map((c) => c.mealId))
  const sceneIds = new Set(cells.filter((c) => c.modelId === model).map((c) => c.sceneId))

  const payload: StudyPayload = {
    run: run.info,
    model: modelParam,
    split: routineAvailable ? split : 'all',
    routineAvailable,
    meals: mealIds.size,
    scenes: sceneIds.size,
    level1: {
      figure: level1Figure(groups, conditions, model),
      smallMultiples: run.info.models.map((m) => level1Figure(groupMeals(cells, m.id), conditions, m.id)),
      table: level1Table(groups, conditions),
      gain: level1Gain(groups),
    },
    level2,
    kcalBias: kcalBias(level2),
    level3: level3Rows(cells, model, conditions),
    models: modelTable(cells, run.info.models, run.info.headlineModel),
  }
  return NextResponse.json(payload)
}
