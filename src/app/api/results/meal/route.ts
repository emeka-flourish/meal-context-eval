import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { bad, dayRange, loadRun, localDate, resolveCondition, resolveModel } from '../_shared'
import { level1 } from '@/lib/scoring/level1'
import { VANTAGES, slotRank, type Vantage } from '@/lib/ui/format'
import { columnLabel, deltaPct } from '@/lib/ui/results-format'
import type { ColumnKey, MatchedCell, MealColumn, MealPayload, PredDto, TruthItemDto } from '@/lib/ui/results-types'
import { readMatchTable, truthItemsForScene } from '@/runners/match'
import { predItemsOf } from '@/runners/interpret'
import type { DecompositionV2Payload } from '@/runners/interpret'

// GET /api/results/meal?run=&scene=&condition=&model= — Meal scope
// (REBUILD-SPEC §3.4): one photo scene, the GT column, and one column per
// vantage for the selected condition. Every Level 1 number is recomputed
// here from the match table with overrides applied (pure level1), so the
// screen reflects an override even before / without a successful rescore;
// cellStale flags a ScoreCell older than its match table.

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const runId = q.get('run')
  const sceneParam = q.get('scene')
  if (!runId) return bad('run required')
  const run = await loadRun(runId)
  if (!run) return bad('run not found', 404)
  // no scene → the first run scene of `date` (or of the run); the client syncs the URL
  let sceneId = sceneParam
  if (!sceneId) {
    const dateParam = q.get('date')
    const ids = run.config.sceneIds ?? []
    if (dateParam && ids.length) {
      const first = await db.photoScene.findFirst({
        where: { id: { in: ids }, meal: { eatenAt: dayRange(dateParam) } },
        orderBy: [{ meal: { eatenAt: 'asc' } }, { index: 'asc' }],
        select: { id: true },
      })
      sceneId = first?.id ?? null
    }
    sceneId = sceneId ?? ids[0] ?? null
  }
  if (!sceneId) return bad('run has no scenes', 404)
  const model = resolveModel(run, q.get('model'))
  if (!model) return bad(`model must be one of: ${run.info.models.map((m) => m.id).join(', ')}`)
  const condition = resolveCondition(run, q.get('condition'))
  if (!condition) return bad(`condition must be one of: ${run.info.conditions.join(', ')}`)

  const scene = await db.photoScene.findUnique({
    where: { id: sceneId },
    include: {
      meal: { include: { scenes: { orderBy: { index: 'asc' }, select: { id: true, index: true, valid: true } } } },
      artifacts: { orderBy: { uploadedAt: 'asc' } },
    },
  })
  if (!scene) return bad('scene not found', 404)
  const inRun = new Set(run.config.sceneIds ?? [])
  const date = localDate(scene.meal.eatenAt)

  const dayMealsRaw = await db.meal.findMany({
    where: { eatenAt: dayRange(date) },
    orderBy: { eatenAt: 'asc' },
    include: { scenes: { orderBy: { index: 'asc' }, select: { id: true, index: true } } },
  })
  dayMealsRaw.sort((a, b) => slotRank(a.mealType) - slotRank(b.mealType) || a.eatenAt.getTime() - b.eatenAt.getTime())

  const photos = {} as MealPayload['scene']['photos']
  for (const v of VANTAGES) {
    const a = scene.artifacts.find((x) => (x.vantage ?? x.surface) === v && !x.excludeFromExport && !x.isReference && x.blobUrl)
    photos[v] = a?.blobUrl ? { url: a.blobUrl, artifactId: a.id } : null
  }

  const truthItems = await truthItemsForScene(scene.id)
  const truth: TruthItemDto[] = truthItems.map((t) => ({
    id: t.id,
    dish: t.dish,
    name: t.name,
    grams: t.grams ?? null,
    basis: t.basis ?? null,
    tag: t.tag,
    state: t.state ?? null,
    components: t.components ?? null,
  }))

  const vantages: Array<Vantage | null> = condition === 'context_only' ? [null] : [...run.info.vantages]
  const [decos, cells, errors] = await Promise.all([
    db.decomposition.findMany({
      where: { runId: run.id, sceneId: scene.id, condition, modelId: model, source: 'pipeline' },
      select: { id: true, vantage: true, payload: true, contextUsed: true },
    }),
    db.scoreCell.findMany({ where: { runId: run.id, sceneId: scene.id, condition, modelId: model }, select: { id: true, vantage: true, updatedAt: true } }),
    db.runItemError.findMany({ where: { runId: run.id, key: { startsWith: `${scene.id}|` } }, select: { kind: true, key: true, error: true } }),
  ])

  const columns: MealColumn[] = []
  for (const v of vantages) {
    const key: ColumnKey = v ?? 'none'
    const cellKeyStr = `${scene.id}|${v ?? 'none'}|${condition}|${model}`
    const err = errors.find((e) => e.key === cellKeyStr)
    const deco = decos.find((d) => (d.vantage ?? null) === v)
    const base = { key, label: columnLabel(key), error: err ? `${err.kind}: ${err.error}` : null, mocked: false, contextUsed: null, preds: [], matches: [], invented: [], droppedDrinks: [], overrideN: 0, cellStale: false, summary: null }
    if (!deco) {
      columns.push({ ...base, state: 'not_interpreted', decompositionId: null, matchTableId: null })
      continue
    }
    const payload = deco.payload as DecompositionV2Payload
    const predItems = predItemsOf(deco.payload)
    const preds: PredDto[] = predItems.map((p) => ({
      id: p.id,
      dish: p.dish,
      name: p.name,
      grams: p.grams ?? null,
      inferred: Boolean(p.inferred),
      isDrink: Boolean(p.isDrink),
      preparation: p.preparation ?? null,
    }))
    const mt = await readMatchTable(deco.id)
    const ctx = (deco.contextUsed ?? null) as MealColumn['contextUsed']
    if (!mt) {
      columns.push({ ...base, state: 'not_matched', decompositionId: deco.id, matchTableId: null, mocked: Boolean(payload.mocked), contextUsed: ctx, preds })
      continue
    }
    const l1 = level1(truthItems, predItems, mt.table)
    const predById = new Map(predItems.map((p) => [p.id, p]))
    const matches: MatchedCell[] = l1.perItem.map((it) => {
      const row = mt.table.rows.find((r) => r.truthIds.includes(it.id))
      const estimate = it.estimate ?? null
      return {
        truthId: it.id,
        predIds: row?.predIds ?? [],
        identity: it.identity,
        status: it.status,
        estimate,
        grade: it.grade,
        deltaPct: deltaPct(estimate, it.grams ?? null),
        sharedWith: (row?.truthIds ?? []).filter((id) => id !== it.id),
      }
    })
    const invented = l1.inventedItems.map((i) => ({
      predId: i.predId,
      name: i.name,
      tag: i.tag,
      grams: predById.get(i.predId)?.grams ?? i.grams ?? null,
      origin: i.origin,
    }))
    const mtRow = await db.matchTable.findUnique({ where: { id: mt.id }, select: { updatedAt: true } })
    const cell = cells.find((c) => (c.vantage ?? null) === v)
    const truthTotalG = truthItems.reduce((s, t) => s + (t.tag !== 'ignore' && typeof t.grams === 'number' ? t.grams : 0), 0)
    const estTotalG = predItems.reduce((s, p) => s + (!p.isDrink && typeof p.grams === 'number' ? p.grams : 0), 0)
    columns.push({
      ...base,
      state: 'scored',
      decompositionId: deco.id,
      matchTableId: mt.id,
      mocked: Boolean(payload.mocked),
      contextUsed: ctx,
      preds,
      matches,
      invented,
      droppedDrinks: mt.table.droppedDrinks,
      overrideN: mt.overrides.length,
      cellStale: !cell || (mtRow ? cell.updatedAt < mtRow.updatedAt : false),
      summary: {
        net: l1.net,
        quantity: l1.quantity,
        recognized: l1.recognized,
        invented: l1.invented,
        f1: l1.f1.f1,
        massMae: l1.massError.mae,
        massMape: l1.massError.mape,
        truthTotalG,
        estTotalG,
      },
    })
  }

  const payload: MealPayload = {
    run: run.info,
    model,
    condition,
    meal: { id: scene.meal.id, date, slot: scene.meal.mealType, eatenAt: scene.meal.eatenAt.toISOString() },
    scene: {
      id: scene.id,
      index: scene.index,
      valid: scene.valid,
      exclusionReason: scene.exclusionReason,
      notes: scene.notes,
      inRun: inRun.has(scene.id),
      photos,
    },
    scenes: scene.meal.scenes.map((s) => ({ id: s.id, index: s.index, valid: s.valid, inRun: inRun.has(s.id) })),
    dayMeals: dayMealsRaw.map((m) => ({
      id: m.id,
      slot: m.mealType,
      eatenAt: m.eatenAt.toISOString(),
      scenes: m.scenes.map((s) => ({ id: s.id, index: s.index, inRun: inRun.has(s.id) })),
    })),
    truth,
    columns,
  }
  return NextResponse.json(payload)
}
