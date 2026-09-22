/* Shared helpers for the /api/intake/* read+edit routes (UI-owned, intake v2).
   Validity is always recomputed from the scene's own rows via
   lib/intake.sceneValidity — the UI never writes `valid` directly. */
import { db } from '@/lib/db'
import { sceneValidity, localDate, STUDY_VANTAGES } from '@/lib/intake'
import type { ArtifactDto, SceneDto, MealDto } from '@/lib/ui/intake-types'
import type { Vantage } from '@/lib/ui/format'

export function isCalendarDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const d = new Date(`${date}T00:00:00`)
  return !Number.isNaN(d.getTime()) && d.toLocaleDateString('en-CA') === date
}

export function dayRange(date: string): { gte: Date; lt: Date } {
  const start = new Date(`${date}T00:00:00`)
  return { gte: start, lt: new Date(start.getTime() + 86400_000) }
}

export function monthRange(month: string): { gte: Date; lt: Date } {
  const [y, m] = month.split('-').map(Number)
  return { gte: new Date(y, m - 1, 1), lt: new Date(y, m, 1) }
}

type ArtifactRow = {
  id: string
  mealId: string
  sceneId: string | null
  vantage: Vantage | null
  surface: Vantage
  vantageGuessed: boolean
  blobUrl: string | null
  exifTakenAt: Date | null
  excludeFromExport: boolean
  sourcePath: string | null
  isReference: boolean
}

export function artifactDto(a: ArtifactRow): ArtifactDto {
  return {
    id: a.id,
    mealId: a.mealId,
    sceneId: a.sceneId,
    vantage: a.vantage ?? a.surface ?? null,
    vantageGuessed: a.vantageGuessed,
    blobUrl: a.blobUrl,
    exifTakenAt: a.exifTakenAt ? a.exifTakenAt.toISOString() : null,
    excludeFromExport: a.excludeFromExport,
    sourcePath: a.sourcePath,
  }
}

export const sceneInclude = {
  artifacts: { orderBy: { exifTakenAt: 'asc' as const } },
  gtItems: { orderBy: { order: 'asc' as const } },
}

type SceneRow = {
  id: string
  mealId: string
  index: number
  valid: boolean
  exclusionReason: string | null
  sameSceneConfirmed: boolean
  notes: string | null
  artifacts: ArtifactRow[]
  gtItems: {
    id: string
    dish: string
    name: string
    grams: number | null
    basis: 'weighed' | 'estimated' | 'converted' | null
    tag: 'core' | 'secondary' | 'garnish' | 'spice' | 'ignore'
    state: string | null
    componentsNote: string | null
    order: number
  }[]
}

function validityInput(s: { artifacts: ArtifactRow[]; notes: string | null; sameSceneConfirmed: boolean; exclusionReason: string | null }) {
  return {
    artifacts: s.artifacts
      .filter((a) => !a.isReference)
      .map((a) => ({ vantage: (a.vantage ?? a.surface) as Vantage | null, excluded: a.excludeFromExport, guessed: a.vantageGuessed })),
    notes: s.notes,
    sameSceneConfirmed: s.sameSceneConfirmed,
    existingReason: s.exclusionReason,
  }
}

export function sceneDto(s: SceneRow): SceneDto {
  const have = new Set(s.artifacts.filter((a) => !a.isReference && !a.excludeFromExport).map((a) => a.vantage ?? a.surface))
  return {
    id: s.id,
    mealId: s.mealId,
    index: s.index,
    valid: s.valid,
    exclusionReason: s.exclusionReason,
    reasons: sceneValidity(validityInput(s)).reasons,
    missingCameras: STUDY_VANTAGES.filter((v) => !have.has(v)),
    sameSceneConfirmed: s.sameSceneConfirmed,
    notes: s.notes,
    artifacts: s.artifacts.filter((a) => !a.isReference).map(artifactDto),
    items: s.gtItems.map((g) => ({
      id: g.id,
      dish: g.dish,
      name: g.name,
      grams: g.grams,
      basis: g.basis,
      tag: g.tag,
      state: g.state,
      componentsNote: g.componentsNote,
      order: g.order,
    })),
  }
}

export function mealDto(m: {
  id: string
  eatenAt: Date
  mealType: string | null
  notes: string | null
  scenes: SceneRow[]
}): MealDto {
  return {
    id: m.id,
    eatenAt: m.eatenAt.toISOString(),
    mealType: m.mealType,
    notes: m.notes,
    scenes: [...m.scenes].sort((a, b) => a.index - b.index).map(sceneDto),
  }
}

/** Recompute `valid` / `exclusionReason` for one scene from its current rows
    and persist. `different_plates` (a UI verdict) is kept unless cleared. */
export async function recomputeScene(sceneId: string) {
  const s = await db.photoScene.findUnique({
    where: { id: sceneId },
    include: { artifacts: true },
  })
  if (!s) return null
  const v = sceneValidity(validityInput(s))
  return db.photoScene.update({
    where: { id: sceneId },
    data: { valid: v.valid, exclusionReason: v.exclusionReason },
  })
}

export { localDate }
