/* Wire types for /api/intake/* (shared by the routes and the client). */

import type { GtItemDto } from './gt'
import type { Vantage } from './format'

export type ArtifactDto = {
  id: string
  mealId: string
  sceneId: string | null
  vantage: Vantage | null
  vantageGuessed: boolean
  blobUrl: string | null
  exifTakenAt: string | null
  excludeFromExport: boolean
  sourcePath: string | null
}

export type SceneDto = {
  id: string
  mealId: string
  index: number
  valid: boolean
  exclusionReason: string | null
  /** every reason the scene is not valid yet (from lib/intake.sceneValidity); empty when valid */
  reasons: string[]
  /** study cameras that have no usable photo in this scene */
  missingCameras: Vantage[]
  sameSceneConfirmed: boolean
  notes: string | null
  artifacts: ArtifactDto[]
  items: GtItemDto[]
}

export type MealDto = {
  id: string
  eatenAt: string
  mealType: string | null
  notes: string | null
  scenes: SceneDto[]
}

export type DayPayload = {
  date: string
  meals: MealDto[]
  /** artifacts with no scene, across all days */
  unsorted: ArtifactDto[]
  /** the cameras the study compares (a scene needs one photo from each) */
  studyVantages: Vantage[]
}

export type DaySummary = {
  date: string
  mealCount: number
  sceneCount: number
  validScenes: number
  vantages: Record<Vantage, boolean>
  /** none | partial | confirmed — GT items present on every scene */
  gt: 'none' | 'partial' | 'confirmed'
  meals: { id: string; slot: string | null; eatenAt: string; scenes: number; gt: 'missing' | 'partial' | 'confirmed' }[]
}

export type DaysPayload = { month: string; days: DaySummary[] }

export type RedraftPayload = {
  items: GtItemDto[]
  questions: string[]
  dropped: string[]
  structurer: string
  mocked: boolean
}

export type SceneListRow = {
  id: string
  mealId: string
  date: string
  slot: string | null
  index: number
  valid: boolean
  exclusionReason: string | null
  vantages: Vantage[]
}

export type GtStatus = 'missing' | 'partial' | 'confirmed'

export function sceneGtStatus(s: { items: { id?: string }[] }): 'missing' | 'confirmed' {
  return s.items.length > 0 ? 'confirmed' : 'missing'
}

export function mealGtStatus(m: { scenes: { items: { id?: string }[] }[] }): GtStatus {
  if (m.scenes.length === 0) return 'missing'
  const n = m.scenes.filter((s) => s.items.length > 0).length
  if (n === 0) return 'missing'
  return n === m.scenes.length ? 'confirmed' : 'partial'
}
