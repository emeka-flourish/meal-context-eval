/* Study-level aggregation (METRICS.md "Units"): mean over meals with a 95 %
   percentile-bootstrap CI; condition differences are PAIRED within meal.
   Deterministic: the RNG is seeded (mulberry32), so a given seed reproduces a
   CI exactly. Pure. */

export type AggregateOptions = { bootstrap?: number; seed?: number; level?: number }

export type Aggregate = {
  n: number
  mean: number | null
  ci: [number, number] | null
  /** standard deviation of the bootstrap means */
  se: number | null
}

/** mulberry32 — small, fast, deterministic 32-bit PRNG. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const finite = (xs: Array<number | null | undefined>): number[] =>
  xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x))

const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

/** Linear-interpolated quantile on a sorted array. */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/** Percentile bootstrap of `statistic` (default: mean) over `values`. */
export function bootstrapCI(
  valuesIn: Array<number | null | undefined>,
  opts: AggregateOptions = {},
  statistic: (xs: number[]) => number = meanOf,
): Aggregate {
  const values = finite(valuesIn)
  const n = values.length
  if (n === 0) return { n: 0, mean: null, ci: null, se: null }
  const point = statistic(values)
  if (n === 1) return { n, mean: point, ci: [point, point], se: 0 }
  const B = opts.bootstrap ?? 2000
  const level = opts.level ?? 0.95
  const rng = makeRng(opts.seed ?? 20260916)
  const stats = new Array<number>(B)
  const sample = new Array<number>(n)
  for (let b = 0; b < B; b++) {
    for (let i = 0; i < n; i++) sample[i] = values[Math.floor(rng() * n)]
    stats[b] = statistic(sample)
  }
  stats.sort((a, b) => a - b)
  const alpha = (1 - level) / 2
  const m = meanOf(stats)
  const se = Math.sqrt(stats.reduce((s, x) => s + (x - m) * (x - m), 0) / (B - 1))
  return { n, mean: point, ci: [quantile(stats, alpha), quantile(stats, 1 - alpha)], se }
}

/** Mean over meals + 95 % bootstrap CI. Nulls (excluded scenes) are dropped. */
export function aggregate(rows: Array<number | null | undefined>, opts: AggregateOptions = {}): Aggregate {
  return bootstrapCI(rows, opts)
}

/** Paired within-meal gain: rowsB[i] − rowsA[i] over meals where both are present
    (e.g. A = image only, B = with context). Positive = B higher. */
export function pairedGain(
  rowsA: Array<number | null | undefined>,
  rowsB: Array<number | null | undefined>,
  opts: AggregateOptions = {},
): Aggregate & { diffs: number[] } {
  if (rowsA.length !== rowsB.length) throw new Error(`pairedGain: length mismatch ${rowsA.length} vs ${rowsB.length}`)
  const diffs: number[] = []
  for (let i = 0; i < rowsA.length; i++) {
    const a = rowsA[i]
    const b = rowsB[i]
    if (typeof a === 'number' && Number.isFinite(a) && typeof b === 'number' && Number.isFinite(b)) diffs.push(b - a)
  }
  return { ...bootstrapCI(diffs, opts), diffs }
}
