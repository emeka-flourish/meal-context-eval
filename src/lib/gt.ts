// Hygiene-invariant logic (BUILD-SPEC §2 + §4.1). Owner-approved rulings in
// DECISIONS.md #4 (reveal gate) and the protocol-owned tier derivation.
// Pure functions here; enforced at both API and UI layers, covered by tests.

import type { GtMethod, GtTier } from '@/generated/prisma/client'

type PipelineRowState = {
  source: string
  lockedAt: Date | null
  surface?: string | null
  engine?: string | null // exploratory rows never gate GT
}
type ArtifactState = { surface: string; isReference: boolean }

// Invariant 1 — GT lock: GT entry (UI + API) is disabled until every capture
// SURFACE on the meal has a locked pipeline decomposition. Locking is one-way.
//
// The unit of interpretation is the capture event per surface: ALL of a
// surface's photos feed ONE pipeline call (one decomposition per meal×surface,
// the study's comparison unit). Reference artifacts (menu photos) never count.
export function gtEntryAllowed(
  artifacts: ArtifactState[],
  decompositions: PipelineRowState[],
): { allowed: boolean; reason?: string } {
  const surfaces = [...new Set(artifacts.filter((a) => !a.isReference).map((a) => a.surface))]
  if (surfaces.length === 0) {
    return { allowed: false, reason: 'No capture artifacts on this meal yet.' }
  }
  const lockedSurfaces = new Set(
    decompositions
      // engine rows are exploratory extras — only the FROZEN pipeline gates GT
      .filter((d) => d.source === 'pipeline' && !d.engine && d.lockedAt !== null)
      .map((d) => d.surface)
      .filter(Boolean),
  )
  const pending = surfaces.filter((s) => !lockedSurfaces.has(s))
  if (pending.length > 0) {
    return {
      allowed: false,
      reason: `Pipeline pending: ${surfaces.length - pending.length}/${surfaces.length} surfaces interpreted (${pending.join(', ')} outstanding).`,
    }
  }
  return { allowed: true }
}

// Protocol-owned tier derivation (§4.1) — FIXED, never user-chosen:
//   weighed_components      → gold
//   weighed_meal_described  → silver (meal_weight_verified)
//   attested_description    → silver
export function tierForMethod(method: GtMethod): GtTier {
  switch (method) {
    case 'weighed_components':
      return 'gold'
    case 'weighed_meal_described':
    case 'attested_description':
      return 'silver'
  }
}

// DECISIONS.md #4 — anchoring reveal gate: pipeline outputs are hidden during
// GT entry; visible only once GT is saved (or when no GT will be entered).
export function pipelineOutputsVisible(gtSaved: boolean, gtTier: GtTier): boolean {
  if (gtSaved) return true
  // 'unrated' is a terminal owner decision (insufficient basis) — no GT is
  // coming, so there is nothing left to anchor.
  return gtTier === 'unrated'
}
