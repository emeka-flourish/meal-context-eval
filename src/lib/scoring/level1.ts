/* Level 1 — Understanding (METRICS.md rev 8.1). Pure function over the truth
   items, the predicted items and the blind matcher's table.

   Rules implemented (and where each decision that the doc leaves open is made):
   - truth items tagged `ignore` are dropped; predictions flagged isDrink or
     listed in match.droppedDrinks are dropped (never invented).
   - identity per row applies to every truth item in the row.
   - wrong pairing = row with identity 0 AND ≥ 1 predId: the truth item(s) are
     missed and the prediction(s) become invented, tagged from the paired truth
     item — for a one-to-many wrong row the highest-weight paired tag is used.
   - invented = match.invented (tag default 'garnish') ∪ predictions in no row
     (also default 'garnish'), de-duplicated by predId; invented tagged
     `ignore` are dropped (rule: ignore is dropped on both sides).
   - Quantity: per row, e = Σ pred grams (undefined → 0), g = Σ truth grams over
     the row's gram-bearing truth items; grade = min/max; each gram-bearing
     truth item in the row takes the row grade (one-to-many), many-to-one sums
     the predictions. A matched truth item whose prediction carries no grams
     is graded 0 (its mass was not captured) — see report note.
   - F1: a row with identity 1 is one TP regardless of arity ("many-to-one
     counted once"); substitute rows are FP (each pred) + FN (each truth);
     wrong rows are FN (each truth) + FP (each pred); plain misses FN;
     invented FP.
   - massError / MSA / SSPB: over matched (identity ≥ 0.5) units whose
     gram-bearing truth items are all basis 'weighed' and whose prediction
     carries grams; unit = the row (one-to-many rows are one unit). */

import {
  INVENTED_PENALTY,
  TAG_WEIGHT,
  type Identity,
  type Level1Result,
  type MatchTable,
  type PredItem,
  type Tag,
  type TruthItem,
} from './types'

const hasGrams = (g: number | undefined): g is number => typeof g === 'number' && Number.isFinite(g)

/** grade = min(e, g) / max(e, g); 0 when either side is 0 (missed mass). */
export function grade(estimate: number, truth: number): number {
  if (!(estimate > 0) || !(truth > 0)) return 0
  return Math.min(estimate, truth) / Math.max(estimate, truth)
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Morley 2018: MSA = 100·(exp(median|ln r|) − 1), SSPB = 100·sign(M)·(exp|M| − 1), M = median ln r. */
export function msaSspb(ratios: number[]): { msa: number | null; sspb: number | null } {
  const logs = ratios.filter((r) => r > 0 && Number.isFinite(r)).map((r) => Math.log(r))
  if (logs.length === 0) return { msa: null, sspb: null }
  const medAbs = median(logs.map(Math.abs)) as number
  const m = median(logs) as number
  return {
    msa: 100 * (Math.exp(medAbs) - 1),
    sspb: 100 * Math.sign(m) * (Math.exp(Math.abs(m)) - 1),
  }
}

const safeDiv = (num: number, den: number): number => (den > 0 ? num / den : 0)

export function level1(truthIn: TruthItem[], predsIn: PredItem[], match: MatchTable): Level1Result {
  // --- drop ignore truth, drinks ---------------------------------------------------------
  const truth = truthIn.filter((t) => t.tag !== 'ignore')
  const truthById = new Map(truth.map((t) => [t.id, t]))
  const dropped = new Set(match.droppedDrinks)
  const preds = predsIn.filter((p) => !p.isDrink && !dropped.has(p.id))
  const predById = new Map(preds.map((p) => [p.id, p]))

  // --- normalise rows: keep only known truth ids and kept pred ids --------------------------
  type Row = { truthIds: string[]; predIds: string[]; identity: Identity }
  const rows: Row[] = match.rows
    .map((r) => ({
      truthIds: r.truthIds.filter((id) => truthById.has(id)),
      predIds: r.predIds.filter((id) => predById.has(id)),
      identity: r.identity,
    }))
    .filter((r) => r.truthIds.length > 0)

  const rowOfTruth = new Map<string, Row>()
  const pairedPreds = new Set<string>()
  for (const r of rows) {
    for (const id of r.truthIds) if (!rowOfTruth.has(id)) rowOfTruth.set(id, r)
    for (const id of r.predIds) pairedPreds.add(id)
  }

  // --- invented set ------------------------------------------------------------------------
  const inventedItems: Level1Result['inventedItems'] = []
  const inventedSeen = new Set<string>()
  const addInvented = (predId: string, tag: Tag, origin: 'unpaired' | 'wrong_pairing') => {
    if (inventedSeen.has(predId)) return
    const p = predById.get(predId)
    if (!p) return
    inventedSeen.add(predId)
    if (tag === 'ignore') return
    inventedItems.push({ predId, name: p.name, tag, w: TAG_WEIGHT[tag], p: INVENTED_PENALTY[tag], grams: p.grams, origin })
  }
  // wrong pairings first: their tag comes from the paired truth item
  for (const r of rows) {
    if (r.identity === 0 && r.predIds.length > 0) {
      const tag = r.truthIds
        .map((id) => truthById.get(id)!.tag)
        .reduce((best, t) => (TAG_WEIGHT[t] > TAG_WEIGHT[best] ? t : best), 'spice' as Tag)
      for (const pid of r.predIds) addInvented(pid, tag, 'wrong_pairing')
    }
  }
  for (const inv of match.invented) addInvented(inv.predId, inv.tag ?? 'garnish', 'unpaired')
  for (const p of preds) if (!pairedPreds.has(p.id)) addInvented(p.id, 'garnish', 'unpaired')

  // --- per truth item: identity, grade -------------------------------------------------------
  const rowEstimate = (r: Row): number =>
    r.predIds.reduce((s, id) => s + (hasGrams(predById.get(id)?.grams) ? (predById.get(id)!.grams as number) : 0), 0)
  const rowTruthGrams = (r: Row): number =>
    r.truthIds.reduce((s, id) => s + (hasGrams(truthById.get(id)?.grams) ? (truthById.get(id)!.grams as number) : 0), 0)

  const perItem: Level1Result['perItem'] = []
  const visibility = { hidden: { n: 0, found: 0 }, visible: { n: 0, found: 0 } }
  let sumW = 0
  let sumWId = 0
  let sumG = 0
  let sumGGrade = 0
  let sumGNoSub = 0
  let sumGGradeNoSub = 0
  for (const t of truth) {
    const w = TAG_WEIGHT[t.tag]
    sumW += w
    const r = rowOfTruth.get(t.id)
    const wrong = !!r && r.identity === 0 && r.predIds.length > 0
    const identity: Identity = r && r.predIds.length > 0 ? r.identity : 0
    const status = !r || r.predIds.length === 0 ? 'missed' : wrong ? 'wrong' : identity === 1 ? 'exact' : 'substitute'
    sumWId += w * identity

    let g: number | null = null
    let est: number | undefined
    if (hasGrams(t.grams)) {
      if (r && identity > 0) {
        est = rowEstimate(r)
        g = grade(est, rowTruthGrams(r))
      } else {
        g = 0
      }
      sumG += t.grams
      sumGGrade += t.grams * g
      if (identity !== 0.5) {
        sumGNoSub += t.grams
        sumGGradeNoSub += t.grams * g
      }
    }
    const bucket = t.hidden ? visibility.hidden : visibility.visible
    bucket.n += 1
    bucket.found += identity
    perItem.push({ id: t.id, name: t.name, tag: t.tag, w, identity, grams: t.grams, estimate: est, grade: g, status, ...(t.hidden ? { hidden: true } : {}) })
  }

  const sumInventedW = inventedItems.reduce((s, i) => s + i.w, 0)
  const sumPenalisedInventedW = inventedItems.reduce((s, i) => s + i.p * i.w, 0)
  const sumInventedE = inventedItems.reduce((s, i) => s + (hasGrams(i.grams) ? i.grams : 0), 0)
  // substitutes-excluded sensitivity: invented mass still counts (it is not a substitute)
  const recognized = safeDiv(sumWId, sumW)
  const invented = safeDiv(sumInventedW, sumW)
  const net = Math.max(0, safeDiv(sumWId - sumPenalisedInventedW, sumW))
  const netP1 = Math.max(0, safeDiv(sumWId - sumInventedW, sumW))
  const quantity = safeDiv(sumGGrade, sumG + sumInventedE)
  const quantityNoSubstitutes = safeDiv(sumGGradeNoSub, sumGNoSub + sumInventedE)

  // --- F1 ---------------------------------------------------------------------------------
  let tp = 0
  let fp = 0
  let fn = 0
  for (const r of rows) {
    if (r.identity === 1 && r.predIds.length > 0) tp += 1
    else if (r.identity === 0.5) {
      fp += r.predIds.length
      fn += r.truthIds.length
    } else {
      fn += r.truthIds.length // plain miss or wrong pairing
    }
  }
  for (const t of truth) if (!rowOfTruth.has(t.id)) fn += 1
  fp += inventedItems.length // includes wrong-pairing predictions
  const precision = safeDiv(tp, tp + fp)
  const recall = safeDiv(tp, tp + fn)
  const f1 = safeDiv(2 * precision * recall, precision + recall)

  // --- mass error over matched weighed units ------------------------------------------------
  const absErr: number[] = []
  const pctErr: number[] = []
  const ratios: number[] = []
  const seenRows = new Set<Row>()
  for (const r of rows) {
    if (seenRows.has(r)) continue
    seenRows.add(r)
    if (r.identity === 0 || r.predIds.length === 0) continue
    const gramItems = r.truthIds.map((id) => truthById.get(id)!).filter((t) => hasGrams(t.grams))
    if (gramItems.length === 0 || !gramItems.every((t) => t.basis === 'weighed')) continue
    if (!r.predIds.some((id) => hasGrams(predById.get(id)?.grams))) continue
    const e = rowEstimate(r)
    const g = rowTruthGrams(r)
    if (!(g > 0)) continue
    absErr.push(Math.abs(e - g))
    pctErr.push((Math.abs(e - g) / g) * 100)
    ratios.push(e / g)
  }
  const gramBearing = truth.filter((t) => hasGrams(t.grams))
  const weighed = gramBearing.filter((t) => t.basis === 'weighed')
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  const { msa, sspb } = msaSspb(ratios)

  return {
    recognized,
    invented,
    net,
    netP1,
    quantity,
    quantityNoSubstitutes,
    visibility,
    f1: { precision, recall, f1, tp, fp, fn },
    massError: {
      mae: mean(absErr),
      mape: mean(pctErr),
      n: absErr.length,
      coverage: gramBearing.length ? weighed.length / gramBearing.length : null,
    },
    msa,
    sspb,
    sums: { sumW, sumWId, sumInventedW, sumPenalisedInventedW, sumG, sumGGrade, sumInventedE },
    perItem,
    inventedItems,
  }
}
