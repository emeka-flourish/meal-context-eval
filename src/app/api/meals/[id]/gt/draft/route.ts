import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { gtEntryAllowed } from '@/lib/gt'
import { draftGtFromAttestation } from '@/runners/gtAssist'

// POST — GT-assist: attestation prose (+ optional plate weight) → draft
// structured decomposition for owner confirm/edit.
// M2: family-C model (Gemini) drafts when GOOGLE_AI_API_KEY is present, using
// the meal's photos for context; every call writes an llm_call row. Without
// the key the runner falls back to the deterministic prose parser (M1).
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = await req.json()
  const attestation: string = body.attestation ?? ''

  const meal = await db.meal.findUnique({
    where: { id },
    include: { artifacts: true, decompositions: true },
  })
  if (!meal) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // Same gate as GT save: no drafting before pipeline lock either.
  const gate = gtEntryAllowed(meal.artifacts, meal.decompositions)
  if (!gate.allowed) {
    return NextResponse.json({ error: `GT locked: ${gate.reason}` }, { status: 409 })
  }

  const photoUrls = meal.artifacts
    .filter((a) => !a.isReference)
    .map((a) => a.blobUrl)
    .filter((u): u is string => Boolean(u))

  const { draft, plateTotalGrams, drafter } = await draftGtFromAttestation({
    mealId: meal.id,
    attestation,
    photoUrls,
  })
  return NextResponse.json({
    draft, // null => attestation had no structurable content; UI offers empty editor
    plateTotalGrams: body.plateTotalGrams ?? plateTotalGrams,
    drafter,
  })
}
