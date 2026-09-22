/* Shared loaders for /api/results/* (Results screens, REBUILD-SPEC §3.4).
   Read-only over Run / ScoreCell / PhotoScene; the pure maths lives in
   src/lib/ui/results-study.ts. */
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { enumerateCells, type RunConfig } from '@/lib/runmatrix'
import type { Level3Result } from '@/lib/scoring/level3'
import type { Level1Result } from '@/lib/scoring/types'
import { runVantages, type Vantage } from '@/lib/ui/format'
import type { CellLite, Level2Cell } from '@/lib/ui/results-study'
import type { Condition, RunInfo } from '@/lib/ui/results-types'

export const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status })

export const CONDITION_SET = new Set<Condition>(['image_only', 'image_context', 'context_only'])

export function localDate(d: Date): string {
  return d.toLocaleDateString('en-CA')
}

export function dayRange(date: string): { gte: Date; lt: Date } {
  const start = new Date(`${date}T00:00:00`)
  return { gte: start, lt: new Date(start.getTime() + 86400_000) }
}

export function isCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const d = new Date(`${date}T00:00:00`)
  return !Number.isNaN(d.getTime()) && localDate(d) === date
}

export type LoadedRun = { id: string; config: RunConfig; info: RunInfo }

/** The run, its config and the RunInfo header block; null when unknown. */
export async function loadRun(runId: string): Promise<LoadedRun | null> {
  const run = await db.run.findUnique({ where: { id: runId } })
  if (!run) return null
  const config = run.config as RunConfig
  const sceneIds = config.sceneIds ?? []
  const [scored, scenes] = await Promise.all([
    db.scoreCell.count({ where: { runId } }),
    sceneIds.length
      ? db.photoScene.findMany({ where: { id: { in: sceneIds } }, select: { meal: { select: { eatenAt: true } } } })
      : Promise.resolve([] as Array<{ meal: { eatenAt: Date } }>),
  ])
  const dates = [...new Set(scenes.map((s) => localDate(s.meal.eatenAt)))].sort()
  const models = config.models ?? []
  const headline = models.find((m) => m.tier === 'frontier')?.id ?? models[0]?.id ?? ''
  return {
    id: run.id,
    config,
    info: {
      id: run.id,
      label: run.label,
      createdAt: run.createdAt.toISOString(),
      status: run.status,
      conditions: config.conditions ?? [],
      vantages: runVantages(config),
      models,
      headlineModel: headline,
      sceneCount: sceneIds.length,
      cellCount: enumerateCells(sceneIds, config).length,
      scoredCount: scored,
      dates,
    },
  }
}

/** `model` query param → a model id of the run (`all` allowed when the caller says so). */
export function resolveModel(run: LoadedRun, raw: string | null, allowAll = false): string | null {
  if (!raw) return run.info.headlineModel || null
  if (raw === 'all') return allowAll ? 'all' : run.info.headlineModel || null
  return run.info.models.some((m) => m.id === raw) ? raw : null
}

/** `condition` query param → a condition of the run (default: image_context when present). */
export function resolveCondition(run: LoadedRun, raw: string | null): Condition | null {
  const conds = run.info.conditions
  if (raw) return CONDITION_SET.has(raw as Condition) && conds.includes(raw as Condition) ? (raw as Condition) : null
  if (conds.includes('image_context')) return 'image_context'
  return conds[0] ?? null
}

export type CellRow = CellLite & { id: string; updatedAt: string; routine: boolean | null }

/** All scored cells of a run (optionally one model / one scene set) as CellLite. */
export async function loadCells(runId: string, where: { modelId?: string; sceneIds?: string[] } = {}): Promise<CellRow[]> {
  const rows = await db.scoreCell.findMany({
    where: { runId, ...(where.modelId ? { modelId: where.modelId } : {}), ...(where.sceneIds ? { sceneId: { in: where.sceneIds } } : {}) },
    include: { scene: { select: { mealId: true } } },
    orderBy: [{ sceneId: 'asc' }, { vantage: 'asc' }, { condition: 'asc' }, { modelId: 'asc' }],
  })
  return rows.map((r) => ({
    id: r.id,
    updatedAt: r.updatedAt.toISOString(),
    sceneId: r.sceneId,
    mealId: r.scene.mealId,
    vantage: (r.vantage as Vantage | null) ?? null,
    condition: r.condition as Condition,
    modelId: r.modelId,
    routine: r.routine ?? null,
    level1: r.level1 as unknown as Level1Result,
    level2: r.level2 as unknown as Level2Cell,
    level3: r.level3 as unknown as Level3Result,
  }))
}
