import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { bad, dayRange, isCalendarDate, loadCells, loadRun, resolveCondition, resolveModel, type CellRow } from '../_shared'
import { THRESHOLDS, type Decision, type Level3Result } from '@/lib/scoring/level3'
import { NUTRIENT_KEYS, ZERO_NUTRIENTS, type Nutrients } from '@/lib/scoring/types'
import { slotRank } from '@/lib/ui/format'
import { DECISIONS, LIGHT_LABEL, columnKeyOf, columnLabel, deltaPct, mealLabel, yesNo } from '@/lib/ui/results-format'
import type { Column, DayDecisionRow, DayNutritionRow, DayPayload, DaySceneInfo, DayUnderstandingRow, DecisionSide, DecisionKey } from '@/lib/ui/results-types'

// GET /api/results/day?run=&date=&condition=&model= — Day scope (REBUILD-SPEC
// §3.4). `date` defaults to the run's last day.
// (REBUILD-SPEC
// §3.4): per scene the six Level 3 decisions (truth vs each vantage, rule
// explanation + margin, "differs"), day nutrition totals for the five
// nutrients (truth vs each vantage, partial when any scene of the day is
// outside the common scored set), and the per-scene Level 1 summary.
// Columns = the three vantages, or the single "no photo" column for
// context_only.

export const dynamic = 'force-dynamic'

const r1 = (x: number) => Math.round(x * 10) / 10
const pct = (x: number) => `${Math.round(x * 100)}%`
const marginTxt = (m: number | null | undefined) => (typeof m === 'number' ? ` · margin ${m >= 0 ? '+' : ''}${Math.round(m * 100)}%` : '')

/** Explanation text per side from the stored decision + the side's nutrients. */
function sides(key: DecisionKey, l3: Level3Result, truthN: Nutrients, estN: Nutrients, slot: string | null): { truth: DecisionSide; est: DecisionSide } {
  const dec = l3[key] as Decision<boolean | string>
  const numericSide = (value: boolean | string, n: Nutrients, margin: number | undefined): DecisionSide => {
    switch (key) {
      case 'highFat': {
        const share = n.kcal > 0 ? (n.fat * 9) / n.kcal : 0
        return { value: yesNo(value === true), explain: `${r1(n.fat)} g · ${pct(share)} of ${Math.round(n.kcal)} kcal${marginTxt(margin)}`, margin: margin ?? null }
      }
      case 'largeKcal':
        return { value: yesNo(value === true), explain: `${Math.round(n.kcal)} kcal${marginTxt(margin)}`, margin: margin ?? null }
      case 'proteinAdequate': {
        const th = slot === 'snack' ? THRESHOLDS.proteinSnack : THRESHOLDS.proteinMain
        return { value: yesNo(value === true), explain: `${r1(n.protein)} g · target ${th} g${marginTxt(margin)}`, margin: margin ?? null }
      }
      case 'largeMass': {
        const mass = typeof margin === 'number' ? THRESHOLDS.largeMass * (1 + margin) : null
        return { value: yesNo(value === true), explain: `${mass !== null ? Math.round(mass) : '—'} g${marginTxt(margin)}`, margin: margin ?? null }
      }
      default:
        return { value: String(value), explain: '', margin: null }
    }
  }
  if (key === 'fodmapLight') {
    const f = l3.fodmapLight
    return {
      truth: { value: LIGHT_LABEL[f.truth] ?? f.truth, explain: f.reasonTruth ?? '', margin: null },
      est: { value: LIGHT_LABEL[f.est] ?? f.est, explain: f.reasonEst ?? '', margin: null },
    }
  }
  if (key === 'nauseaIrritant') {
    // explanation: "Nausea irritant: truth <why>; est <why>"
    const m = /truth (.+?); est (.+)$/.exec(dec.explanation ?? '')
    return {
      truth: { value: yesNo(dec.truth === true), explain: m?.[1] ?? '', margin: null },
      est: { value: yesNo(dec.est === true), explain: m?.[2] ?? '', margin: null },
    }
  }
  return { truth: numericSide(dec.truth, truthN, dec.marginTruth), est: numericSide(dec.est, estN, dec.marginEst) }
}

const addN = (a: Nutrients, b: Nutrients | undefined): Nutrients => {
  const out = { ...a }
  if (!b) return out
  for (const k of NUTRIENT_KEYS) out[k] += typeof b[k] === 'number' ? b[k] : 0
  return out
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const runId = q.get('run')
  const dateParam = q.get('date')
  if (!runId) return bad('run required')
  if (dateParam && !isCalendarDate(dateParam)) return bad('date=YYYY-MM-DD required')
  const run = await loadRun(runId)
  if (!run) return bad('run not found', 404)
  // no date → the run's last day (the client syncs the URL to `date` in the payload)
  const date = dateParam ?? run.info.dates[run.info.dates.length - 1]
  if (!date) return bad('run has no scenes', 404)
  const model = resolveModel(run, q.get('model'))
  if (!model) return bad(`model must be one of: ${run.info.models.map((m) => m.id).join(', ')}`)
  const condition = resolveCondition(run, q.get('condition'))
  if (!condition) return bad(`condition must be one of: ${run.info.conditions.join(', ')}`)

  const meals = await db.meal.findMany({
    where: { eatenAt: dayRange(date) },
    orderBy: { eatenAt: 'asc' },
    include: { scenes: { orderBy: { index: 'asc' }, select: { id: true, index: true, valid: true, exclusionReason: true } } },
  })
  meals.sort((a, b) => slotRank(a.mealType) - slotRank(b.mealType) || a.eatenAt.getTime() - b.eatenAt.getTime())
  const inRun = new Set(run.config.sceneIds ?? [])
  const sceneIds = meals.flatMap((m) => m.scenes.map((s) => s.id))
  const cells = sceneIds.length ? (await loadCells(run.id, { modelId: model, sceneIds })).filter((c) => c.condition === condition) : []

  const columns: Column[] =
    condition === 'context_only' ? [{ key: 'none', label: columnLabel('none') }] : run.info.vantages.map((v) => ({ key: v, label: columnLabel(v) }))
  const cellOf = new Map<string, CellRow>()
  for (const c of cells) cellOf.set(`${c.sceneId}|${columnKeyOf(c.vantage)}`, c)

  const scenes: DaySceneInfo[] = []
  const decisions: DayDecisionRow[] = []
  const understanding: DayUnderstandingRow[] = []
  // scenes scored in every column: the identical set both sides of the day sums
  const common: string[] = []
  let truthN: Nutrients = { ...ZERO_NUTRIENTS }
  const estN: Record<string, Nutrients> = {}
  for (const col of columns) estN[col.key] = { ...ZERO_NUTRIENTS }

  for (const m of meals) {
    for (const s of m.scenes) {
      const scored = columns.filter((col) => cellOf.has(`${s.id}|${col.key}`)).map((col) => col.key)
      scenes.push({ sceneId: s.id, mealId: m.id, slot: m.mealType, index: s.index, valid: s.valid, exclusionReason: s.exclusionReason, inRun: inRun.has(s.id), scoredColumns: scored })
      if (scored.length === 0) continue
      const label = mealLabel(m.mealType, s.index, m.scenes.length)
      const any = cellOf.get(`${s.id}|${scored[0]}`)!
      const allScored = scored.length === columns.length
      if (allScored) {
        common.push(s.id)
        truthN = addN(truthN, any.level2?.truth)
        for (const col of columns) estN[col.key] = addN(estN[col.key], cellOf.get(`${s.id}|${col.key}`)!.level2?.est)
      }
      for (const d of DECISIONS) {
        const truthSide = sides(d.key, any.level3, any.level2.truth, any.level2.est, m.mealType).truth
        const byColumn: DayDecisionRow['byColumn'] = {}
        for (const col of columns) {
          const c = cellOf.get(`${s.id}|${col.key}`)
          if (!c || !c.level3?.[d.key]) {
            byColumn[col.key] = null
            continue
          }
          const est = sides(d.key, c.level3, c.level2.truth, c.level2.est, m.mealType).est
          const dec = c.level3[d.key]
          byColumn[col.key] = { ...est, differs: !dec.agree, direction: dec.direction }
        }
        decisions.push({ sceneId: s.id, mealLabel: label, key: d.key, label: d.label, persona: d.persona, rule: d.rule, truth: truthSide, byColumn })
      }
      const u: DayUnderstandingRow = { sceneId: s.id, mealId: m.id, mealLabel: label, byColumn: {} }
      for (const col of columns) {
        const c = cellOf.get(`${s.id}|${col.key}`)
        u.byColumn[col.key] = c
          ? { net: c.level1.net, quantity: c.level1.quantity, invented: (c.level1.inventedItems ?? []).map((i) => i.name) }
          : null
      }
      understanding.push(u)
    }
  }

  const excluded = scenes.filter((s) => !common.includes(s.sceneId))
  const note =
    excluded.length === 0
      ? null
      : `${excluded
          .map((s) => `${mealLabel(s.slot, s.index, meals.find((m) => m.id === s.mealId)?.scenes.length ?? 1)} ${!s.valid ? `excluded (${s.exclusionReason ?? 'invalid'})` : !s.inRun ? 'not in this run' : 'not scored in every column'}`)
          .join(' · ')} — day totals are partial for all cameras.`
  const rows: DayNutritionRow[] = NUTRIENT_KEYS.map((k) => ({
    nutrient: k,
    truth: common.length ? truthN[k] : null,
    byColumn: Object.fromEntries(
      columns.map((col) => [col.key, { est: common.length ? estN[col.key][k] : null, deltaPct: common.length ? deltaPct(estN[col.key][k], truthN[k]) : null }]),
    ),
  }))

  const payload: DayPayload = {
    run: run.info,
    date,
    model,
    condition,
    columns,
    scenes,
    decisions,
    nutrition: { partial: excluded.length > 0, note, rows },
    understanding,
  }
  return NextResponse.json(payload)
}
