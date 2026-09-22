// PROTOCOL-OWNED measurement definitions (BUILD-SPEC protected area §2/§0).
// Bands: 1–3 low, 4–7 moderate, 8–10 high.
//
// DECISIONS.md #1: the production trigger prompt internally uses >6 = "High",
// which disagrees with the protocol at score 7. The raw 0–10 score is the
// measurement; bands are derived HERE and only here, using protocol boundaries.
// The prompt's own verdict words are non-load-bearing prose.
//
// Ingredient-level scores may be 0 ("no flag") — treated as low.

export type Band = 'low' | 'moderate' | 'high'

export function bandFor(score: number): Band {
  if (!Number.isFinite(score) || score < 0 || score > 10) {
    throw new Error(`trigger score out of range: ${score}`)
  }
  if (score <= 3) return 'low' // includes 0 = "no flag"
  if (score <= 7) return 'moderate' // score 7 is MODERATE (protocol), not High (prompt prose)
  return 'high'
}

// Primary RQ4 flip: the meal's overall trigger band differs between the
// GT-based and estimate-based scoring of the same meal, per profile.
export function isFlip(gtScore: number, estScore: number): boolean {
  return bandFor(gtScore) !== bandFor(estScore)
}
