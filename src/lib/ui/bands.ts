/* Stoplight bands for the Results tables — the ONE place the thresholds live.
   These are reading aids chosen by the study owner, not protocol measurements
   (the protocol's trigger-score bands live in src/lib/bands.ts and are unrelated).
   Colour is never the only signal: every light also has a shape and a word,
   and the number it colours is always printed. */

export type Light = 'good' | 'watch' | 'poor'

export type BandKind = 'share' | 'agreement' | 'invented' | 'errorPct'

export const LIGHT_LABEL: Record<Light, string> = { good: 'Good', watch: 'Watch', poor: 'Poor' }
/** distinct shapes so the three lights differ without colour */
export const LIGHT_SHAPE: Record<Light, string> = { good: '●', watch: '▲', poor: '■' }

/** Scores from 0 to 1 where higher is better: net understanding, recognised, quantity. */
export const SHARE_BANDS = { good: 0.8, watch: 0.6 } as const
/** Share of photo scenes (0–100 %) where the model's decision agrees with the truth. */
export const AGREEMENT_BANDS = { good: 80, watch: 60 } as const
/** Invented food, 0 to 1 — lower is better. */
export const INVENTED_BANDS = { good: 0.1, watch: 0.25 } as const
/** Nutrient error in percent (share of the mean, or typical percent error) — lower is better. */
export const ERROR_PCT_BANDS = { good: 20, watch: 40 } as const

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)
/** compare at the precision the tables print, so 0.796 (shown as 0.80) is green like its label says */
const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits

export function shareLight(v: number | null | undefined): Light | null {
  if (!finite(v)) return null
  const x = round(v, 2)
  return x >= SHARE_BANDS.good ? 'good' : x >= SHARE_BANDS.watch ? 'watch' : 'poor'
}

export function agreementLight(agree: number, total: number): Light | null {
  if (!finite(agree) || !finite(total) || total <= 0) return null
  const pct = Math.round((agree / total) * 100)
  return pct >= AGREEMENT_BANDS.good ? 'good' : pct >= AGREEMENT_BANDS.watch ? 'watch' : 'poor'
}

export function inventedLight(v: number | null | undefined): Light | null {
  if (!finite(v)) return null
  const x = round(v, 2)
  return x <= INVENTED_BANDS.good ? 'good' : x <= INVENTED_BANDS.watch ? 'watch' : 'poor'
}

export function errorPctLight(v: number | null | undefined): Light | null {
  if (!finite(v)) return null
  const x = Math.round(Math.abs(v))
  return x <= ERROR_PCT_BANDS.good ? 'good' : x <= ERROR_PCT_BANDS.watch ? 'watch' : 'poor'
}

/** The legend text for one kind of number, in plain English. */
export const BAND_LEGEND: Record<BandKind, { title: string; good: string; watch: string; poor: string }> = {
  share: { title: 'Scores from 0 to 1 (higher is better)', good: '0.80 or more', watch: '0.60 to 0.79', poor: 'below 0.60' },
  agreement: { title: 'Share of photo scenes where the decision matches the truth', good: '80% or more', watch: '60% to 79%', poor: 'below 60%' },
  invented: { title: 'Invented food (lower is better)', good: '0.10 or less', watch: '0.11 to 0.25', poor: 'above 0.25' },
  errorPct: { title: 'Nutrient error in percent (lower is better)', good: '20% or less', watch: '21% to 40%', poor: 'above 40%' },
}
