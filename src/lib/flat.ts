// Analysis flat file: one row per meal×surface. Flip/MAPE are COMPUTED here
// at export time from raw stored scores (never stored — protocol rule), using
// protocol band boundaries via bandFor.
//
// Missing-surface rule: a missing value is an EMPTY cell, never zero.
// Hygiene invariant 4: excludeFromExport artifacts (and anything derived from
// them) never contribute a row or a value.

import { db } from '@/lib/db'
import { bandFor } from '@/lib/bands'
import { CONFIG, familyForModel } from '@/lib/config'
import { combinedPromptHash, type BlockKey } from '@/lib/prompt-blocks'
import type { Level1Result } from '@/lib/scoring/types'
import type { Level3Result } from '@/lib/scoring/level3'
import type { Level2Cell } from '@/runners/score'
import type { RunConfig } from '@/lib/runmatrix'

// Exploratory engine columns (secondary, labeled — never primary analysis)
const engSlug = (id: string) => id.replace(/[^a-zA-Z0-9]+/g, '_')

// Arm mapping (protocol glossary): B phone, C glasses, D tripod (was fixed).
// Arm A (manual) left the study with intake v2.
const ARM_BY_SURFACE: Record<string, string> = {
  phone: 'B',
  glasses: 'C',
  tripod: 'D',
}

const PROFILES = ['P1', 'P2', 'P3'] as const

export const FLAT_COLUMNS = [
  'meal_id',
  'date',
  'eaten_at',
  'meal_type',
  'location',
  'gt_tier',
  'gt_method',
  'suppression',
  'forgot',
  'surface',
  'arm',
  'pipeline_model',
  'prompt_version',
  'judge_overall',
  'judge_recall',
  'judge_precision',
  'judge_quantity',
  'judge_prep',
  'human_overall',
  'kcal_est',
  'kcal_gt',
  'protein_g_est',
  'protein_g_gt',
  'carbs_g_est',
  'carbs_g_gt',
  'fat_g_est',
  'fat_g_gt',
  'kcal_ape',
  ...PROFILES.flatMap((p) => [`trigger_score_est_${p}`, `trigger_score_gt_${p}`]),
  ...PROFILES.flatMap((p) => [`band_est_${p}`, `band_gt_${p}`]),
  ...PROFILES.map((p) => `flip_${p}`),
  'capture_time_sample_secs',
  'artifact_exif_present',
  // exploratory engines, clearly labeled and last
  ...CONFIG.exploratory.modelIds.flatMap((m) => [
    `eng_${engSlug(m)}_kcal`,
    `eng_${engSlug(m)}_judge_overall`,
  ]),
]

export type FlatRow = Record<string, string | number | boolean | null>

type TriggerLite = { overallScore: number; profile: { code: string }; createdAt: Date }

/** Latest trigger raw score per profile code for one decomposition. */
function scoresByProfile(triggers: TriggerLite[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of [...triggers].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    m.set(t.profile.code, t.overallScore)
  }
  return m
}

export async function buildFlatRows(): Promise<FlatRow[]> {
  const meals = await db.meal.findMany({
    orderBy: { eatenAt: 'asc' },
    include: {
      artifacts: { where: { excludeFromExport: false, isReference: false } },
      decompositions: {
        include: {
          nutrientCalcs: { orderBy: { createdAt: 'desc' }, take: 1 },
          triggerResults: { include: { profile: { select: { code: true } } } },
          judgeScoresAsEval: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      },
    },
  })

  const rows: FlatRow[] = []
  for (const meal of meals) {
    const gtDeco = [...meal.decompositions]
      .filter((d) => d.source === 'gt' || d.source === 'silver_assist')
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
    const gtNc = gtDeco?.nutrientCalcs[0]
    const gtTriggers = gtDeco ? scoresByProfile(gtDeco.triggerResults) : new Map<string, number>()

    const surfaces = [...new Set(meal.artifacts.map((a) => a.surface))]
    for (const surface of surfaces) {
      const surfaceArtifacts = meal.artifacts.filter((a) => a.surface === surface)
      // One pipeline decomposition per (meal, surface) — the comparison unit.
      // Invariant 4: if EVERY artifact of this surface is excluded, its
      // decomposition doesn't export either (surfaceArtifacts already filtered
      // upstream to non-excluded artifacts).
      const pipeDeco =
        surfaceArtifacts.length === 0
          ? undefined
          : [...meal.decompositions]
              .filter((d) => d.source === 'pipeline' && d.surface === surface && !d.engine)
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
      // exploratory engine rows for this surface (labeled columns only)
      const engineCols: Record<string, number | null> = {}
      for (const m of CONFIG.exploratory.modelIds) {
        const ed =
          surfaceArtifacts.length === 0
            ? undefined
            : meal.decompositions.find(
                (d) => d.source === 'pipeline' && d.surface === surface && d.engine === m,
              )
        engineCols[`eng_${engSlug(m)}_kcal`] = ed?.nutrientCalcs[0]?.kcal ?? null
        engineCols[`eng_${engSlug(m)}_judge_overall`] = ed?.judgeScoresAsEval[0]?.overall0100 ?? null
      }
      const nc = pipeDeco?.nutrientCalcs[0]
      const judge = pipeDeco?.judgeScoresAsEval[0]
      const estTriggers = pipeDeco
        ? scoresByProfile(pipeDeco.triggerResults)
        : new Map<string, number>()

      const kcalApe =
        nc && gtNc && gtNc.kcal > 0 ? Math.abs(nc.kcal - gtNc.kcal) / gtNc.kcal : null

      const row: FlatRow = {
        meal_id: meal.id,
        date: meal.eatenAt.toLocaleDateString('en-CA'),
        eaten_at: meal.eatenAt.toISOString(),
        meal_type: meal.mealType,
        location: meal.locationType,
        gt_tier: meal.gtTier,
        gt_method: gtDeco?.gtMethod ?? null,
        suppression: meal.suppression,
        forgot: meal.forgot,
        surface,
        arm: ARM_BY_SURFACE[surface] ?? null,
        pipeline_model: pipeDeco?.modelId ?? null,
        prompt_version: pipeDeco?.promptVersion ?? null,
        judge_overall: judge?.overall0100 ?? null,
        judge_recall: judge?.componentRecall ?? null,
        judge_precision: judge?.componentPrecision ?? null,
        judge_quantity: judge?.quantityScore ?? null,
        judge_prep: judge?.preparationScore ?? null,
        human_overall: judge?.humanOverall0100 ?? null,
        kcal_est: nc?.kcal ?? null,
        kcal_gt: gtNc?.kcal ?? null,
        protein_g_est: nc?.proteinG ?? null,
        protein_g_gt: gtNc?.proteinG ?? null,
        carbs_g_est: nc?.carbsG ?? null,
        carbs_g_gt: gtNc?.carbsG ?? null,
        fat_g_est: nc?.fatG ?? null,
        fat_g_gt: gtNc?.fatG ?? null,
        kcal_ape: kcalApe,
        capture_time_sample_secs:
          surfaceArtifacts.find((a) => a.captureTimeSampleSecs !== null)?.captureTimeSampleSecs ??
          null,
        artifact_exif_present: surfaceArtifacts.some((a) => a.exifTakenAt !== null),
      }

      for (const p of PROFILES) {
        const est = estTriggers.get(p)
        const gt = gtTriggers.get(p)
        row[`trigger_score_est_${p}`] = est ?? null
        row[`trigger_score_gt_${p}`] = gt ?? null
        // Bands from RAW scores via protocol boundaries — never the prompt's.
        row[`band_est_${p}`] = est !== undefined ? bandFor(est) : null
        row[`band_gt_${p}`] = gt !== undefined ? bandFor(gt) : null
        row[`flip_${p}`] =
          est !== undefined && gt !== undefined ? bandFor(gt) !== bandFor(est) : null
      }

      rows.push({ ...row, ...engineCols })
    }
  }
  return rows
}

/* =============================================================================
   v2 cells export (METRICS.md "Export columns", runs_and_conditions 2026-09-17):
   one row per ScoreCell. Column notes where METRICS leaves a gap:
   - `found` = Level 1 Recognized (the doc's older name); `net` added beside it.
   - `us` (the retired combined score) is kept as an always-empty column so the
     header matches METRICS; nothing computes it any more (rev 6).
   - `routine` = ScoreCell.routine (CORPUS.md §5, written at score time);
     empty when the run had no context version.
   - dec_<persona>_<k>: _gt / _est are the decision values (booleans, or the
     Monash light for FODMAP); _margin is the ESTIMATE side's margin to the
     threshold for numeric decisions, the signed light-rank difference
     (est − truth) for FODMAP, empty for the irritant flag (no threshold).
   - cost_usd / latency_s come from the interpretation call's ledger row.
   ========================================================================== */

export const DECISION_COLUMNS: Array<{ col: string; key: keyof Omit<Level3Result, 'agreementRate'> }> = [
  { col: 'dec_ibs_fodmap', key: 'fodmapLight' },
  { col: 'dec_ibs_highfat', key: 'highFat' },
  { col: 'dec_ibs_large', key: 'largeKcal' },
  { col: 'dec_glp1_protein', key: 'proteinAdequate' },
  { col: 'dec_glp1_mass', key: 'largeMass' },
  { col: 'dec_glp1_irritant', key: 'nauseaIrritant' },
]

/** The METRICS.md export column list, verbatim order (+ `run_label`, `scene_id`, `net`). */
export const METRICS_EXPORT_COLUMNS = [
  'run', 'date', 'slot', 'photo', 'vantage', 'condition', 'model_family', 'model_tier', 'model_id', 'routine',
  'found', 'invented', 'quantity', 'us', 'f1_ing', 'mass_mae_g', 'mass_mape',
  'kcal_gt', 'kcal_est', 'prot_gt', 'prot_est', 'fat_gt', 'fat_est', 'carb_gt', 'carb_est', 'fiber_gt', 'fiber_est',
  'retrieval_hit', 'weighed_share', 'override_n', 'cost_usd', 'latency_s', 'prompt_hash', 'alias_version', 'corpus_version',
] as const

export const CELL_COLUMNS: string[] = [
  'run',
  'run_label',
  'scene_id',
  ...METRICS_EXPORT_COLUMNS.slice(1, 11),
  'net',
  ...METRICS_EXPORT_COLUMNS.slice(11),
  ...DECISION_COLUMNS.flatMap((d) => [`${d.col}_gt`, `${d.col}_est`, `${d.col}_margin`]),
]

const LIGHT_RANK: Record<string, number> = { green: 0, amber: 1, red: 2 }

type Level1Json = Level1Result & { weighedShare?: number | null; overrideN?: number; decompositionId?: string }

export async function buildCellRows(runId?: string): Promise<FlatRow[]> {
  const cells = await db.scoreCell.findMany({
    where: runId ? { runId } : {},
    include: {
      run: { select: { label: true, config: true, createdAt: true } },
      scene: { select: { index: true, meal: { select: { eatenAt: true, mealType: true } } } },
    },
    orderBy: [{ run: { createdAt: 'asc' } }, { scene: { meal: { eatenAt: 'asc' } } }, { scene: { index: 'asc' } }, { vantage: 'asc' }, { condition: 'asc' }, { modelId: 'asc' }],
  })
  const runIds = [...new Set(cells.map((c) => c.runId))]
  const decos = runIds.length
    ? await db.decomposition.findMany({
        where: { runId: { in: runIds }, source: 'pipeline' },
        select: { id: true, runId: true, sceneId: true, vantage: true, condition: true, modelId: true, contextUsed: true, promptBlockHashes: true, llmCallId: true },
      })
    : []
  const decoByKey = new Map(decos.map((d) => [`${d.runId}|${d.sceneId}|${d.vantage ?? 'none'}|${d.condition}|${d.modelId}`, d]))
  const callIds = decos.map((d) => d.llmCallId).filter((id): id is string => Boolean(id))
  const calls = callIds.length ? await db.llmCall.findMany({ where: { id: { in: callIds } }, select: { id: true, costUsdEst: true, latencyMs: true } }) : []
  const callById = new Map(calls.map((c) => [c.id, c]))

  const rows: FlatRow[] = []
  for (const cell of cells) {
    const config = cell.run.config as RunConfig
    const model = config.models?.find((m) => m.id === cell.modelId)
    const deco = decoByKey.get(`${cell.runId}|${cell.sceneId}|${cell.vantage ?? 'none'}|${cell.condition}|${cell.modelId}`)
    const call = deco?.llmCallId ? callById.get(deco.llmCallId) : undefined
    const l1 = cell.level1 as Level1Json
    const l2 = cell.level2 as Level2Cell
    const l3 = cell.level3 as Level3Result
    const ctx = (deco?.contextUsed ?? null) as { hit?: boolean } | null
    const hashes = (deco?.promptBlockHashes ?? null) as Record<BlockKey, string | null> | null

    const row: FlatRow = {
      run: cell.runId,
      run_label: cell.run.label,
      scene_id: cell.sceneId,
      date: cell.scene.meal.eatenAt.toLocaleDateString('en-CA'),
      slot: cell.scene.meal.mealType,
      photo: cell.scene.index,
      vantage: cell.vantage ?? null,
      condition: cell.condition,
      model_family: model?.family ?? familyForModel(cell.modelId),
      model_tier: model?.tier ?? null,
      model_id: cell.modelId,
      routine: cell.routine ?? null,
      found: l1.recognized,
      invented: l1.invented,
      net: l1.net,
      quantity: l1.quantity,
      us: null,
      f1_ing: l1.f1?.f1 ?? null,
      mass_mae_g: l1.massError?.mae ?? null,
      mass_mape: l1.massError?.mape ?? null,
      kcal_gt: l2.truth?.kcal ?? null,
      kcal_est: l2.est?.kcal ?? null,
      prot_gt: l2.truth?.protein ?? null,
      prot_est: l2.est?.protein ?? null,
      fat_gt: l2.truth?.fat ?? null,
      fat_est: l2.est?.fat ?? null,
      carb_gt: l2.truth?.carb ?? null,
      carb_est: l2.est?.carb ?? null,
      fiber_gt: l2.truth?.fiber ?? null,
      fiber_est: l2.est?.fiber ?? null,
      retrieval_hit: cell.condition === 'image_only' ? null : (ctx?.hit ?? null),
      weighed_share: l1.weighedShare ?? null,
      override_n: l1.overrideN ?? 0,
      cost_usd: call?.costUsdEst ?? null,
      latency_s: call?.latencyMs != null ? call.latencyMs / 1000 : null,
      prompt_hash: hashes ? combinedPromptHash(hashes) : null,
      alias_version: config.aliasVersion ?? null,
      corpus_version: config.corpusVersion ?? null,
    }
    for (const d of DECISION_COLUMNS) {
      const dec = l3?.[d.key]
      if (!dec) {
        row[`${d.col}_gt`] = null
        row[`${d.col}_est`] = null
        row[`${d.col}_margin`] = null
        continue
      }
      row[`${d.col}_gt`] = dec.truth as string | boolean
      row[`${d.col}_est`] = dec.est as string | boolean
      row[`${d.col}_margin`] =
        d.key === 'fodmapLight'
          ? (LIGHT_RANK[String(dec.est)] ?? 0) - (LIGHT_RANK[String(dec.truth)] ?? 0)
          : typeof dec.marginEst === 'number'
            ? dec.marginEst
            : null
    }
    rows.push(row)
  }
  return rows
}
