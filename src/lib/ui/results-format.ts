/* Pure formatting + labels for the Results screens. No DB, no I/O. */

import type { Aggregate } from '@/lib/scoring/aggregate'
import type { NutrientKey } from '@/lib/scoring/types'
import type { Condition, ColumnKey, DecisionKey } from './results-types'
import type { Vantage } from './format'

export const CONDITIONS: Condition[] = ['image_only', 'image_context', 'context_only']

export const CONDITION_LABEL: Record<Condition, string> = {
  image_only: 'image only',
  image_context: 'image + context',
  context_only: 'context only',
}

export const CONDITION_SHORT: Record<Condition, string> = {
  image_only: 'image',
  image_context: '+ctx',
  context_only: 'ctx only',
}

/** CSS colour token per condition (globals.css --cond-1/2/3). */
export const CONDITION_COLOR: Record<Condition, string> = {
  image_only: 'var(--cond-1)',
  image_context: 'var(--cond-2)',
  context_only: 'var(--cond-3)',
}

export const NUTRIENT_LABEL: Record<NutrientKey, string> = {
  kcal: 'kcal',
  protein: 'protein g',
  fat: 'fat g',
  carb: 'carb g',
  fiber: 'fiber g',
}

export const NUTRIENT_UNIT: Record<NutrientKey, string> = {
  kcal: 'kcal',
  protein: 'g',
  fat: 'g',
  carb: 'g',
  fiber: 'g',
}

export const DECISIONS: Array<{ key: DecisionKey; label: string; persona: 'IBS' | 'GLP-1'; rule: string; numeric: boolean }> = [
  { key: 'fodmapLight', label: 'FODMAP load', persona: 'IBS', rule: 'classifier · low / moderate / high', numeric: false },
  { key: 'highFat', label: 'High-fat', persona: 'IBS', rule: 'fat ≥ 40% kcal and ≥ 15 g', numeric: true },
  { key: 'largeKcal', label: 'Large meal, kcal', persona: 'IBS', rule: '≥ 750 kcal', numeric: true },
  { key: 'proteinAdequate', label: 'Protein adequate', persona: 'GLP-1', rule: '≥ 25 g main meal · ≥ 10 g snack', numeric: true },
  { key: 'largeMass', label: 'Large by mass', persona: 'GLP-1', rule: '≥ 500 g', numeric: true },
  { key: 'nauseaIrritant', label: 'Nausea irritant', persona: 'GLP-1', rule: 'fried ≥ 30 g or spicy', numeric: false },
]

export const LIGHT_LABEL: Record<string, string> = { green: 'low', amber: 'moderate', red: 'high' }

export const ANCHORS = 'Anchors: Nutrition5k dish-level kcal MAE ≈ 16–26% of mean · 2025 LLM image-only studies ≈ 30–40% MAPE.'

export function columnKeyOf(vantage: Vantage | null): ColumnKey {
  return vantage ?? 'none'
}

export function columnLabel(key: ColumnKey): string {
  return key === 'none' ? 'no photo' : key
}

/** 0.913 → "0.91"; null → "—" */
export function fmt2(x: number | null | undefined): string {
  return typeof x === 'number' && Number.isFinite(x) ? x.toFixed(2) : '—'
}

export function fmt1(x: number | null | undefined): string {
  return typeof x === 'number' && Number.isFinite(x) ? x.toFixed(1) : '—'
}

export function fmt0(x: number | null | undefined): string {
  return typeof x === 'number' && Number.isFinite(x) ? String(Math.round(x)) : '—'
}

/** 23.4 → "23%"; signed adds "+" */
export function fmtPct(x: number | null | undefined, signed = false): string {
  if (typeof x !== 'number' || !Number.isFinite(x)) return '—'
  const r = Math.round(x)
  return `${signed && r > 0 ? '+' : ''}${r}%`
}

/** difference of two 0–1 metrics → "+0.06" */
export function fmtDelta2(x: number | null | undefined): string {
  if (typeof x !== 'number' || !Number.isFinite(x)) return '—'
  return `${x > 0 ? '+' : ''}${x.toFixed(2)}`
}

/** "0.91 [0.86, 0.95]" */
export function fmtCI(a: Aggregate | null | undefined, digits = 2): string {
  if (!a || a.mean === null) return '—'
  if (!a.ci || a.n < 2) return a.mean.toFixed(digits)
  return `${a.mean.toFixed(digits)} [${a.ci[0].toFixed(digits)}, ${a.ci[1].toFixed(digits)}]`
}

export function fmtCount(n: number, N: number): string {
  return `${n} of ${N}`
}

/** est vs truth → percent change; null when truth is 0 */
export function deltaPct(est: number | null | undefined, truth: number | null | undefined): number | null {
  if (typeof est !== 'number' || typeof truth !== 'number' || !(truth > 0)) return null
  return ((est - truth) / truth) * 100
}

export type DeltaTone = 'over' | 'under' | 'near'

/** ±10 % is "near" (the mockup's grey chip); beyond that over / under. */
export function deltaTone(pct: number | null | undefined): DeltaTone {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return 'near'
  if (pct > 10) return 'over'
  if (pct < -10) return 'under'
  return 'near'
}

export const DELTA_CLASS: Record<DeltaTone, string> = {
  over: 'bg-over-bg text-over-ink',
  under: 'bg-under-bg text-under-ink',
  near: 'bg-tint text-ink-muted',
}

export function yesNo(v: boolean): string {
  return v ? 'yes' : 'no'
}

export function mealLabel(slot: string | null | undefined, index: number, sceneCount: number): string {
  const s = slot ? slot[0].toUpperCase() + slot.slice(1) : 'Meal'
  return sceneCount > 1 ? `${s} · photo ${index}` : s
}
