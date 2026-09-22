/* GT-assist drafter (family C) — §4.1. Converts the eater's own weigh-log
   prose (+ meal photos for context) into a draft §4 GT decomposition for
   owner confirm/edit. The attestation is ground truth being structured — the
   model must NEVER contradict it; photos only fill gaps. Offline/mock path is
   the deterministic prose parser (permanent fallback).
   NOTE: imports use relative paths (not '@/lib/...') so vitest can run the
   mock-path test without path-alias config (same pattern as fdc.ts). */
import { readFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import { runLlm, type ContentPart } from '../lib/llm'
import { CONFIG } from '../lib/config'
import { decompositionPayloadSchema, type DecompositionPayload } from '../lib/decomposition'
import { parseProseAttestation } from '../lib/prose-parse'

const SYSTEM = `You convert an eater's own weigh-log prose (their attestation) into a structured ground-truth meal decomposition, using the attached meal photos only for context.

Rules:
1. The attestation is ground truth being structured — NEVER contradict it. The photos only fill gaps.
2. Preserve stated gram weights verbatim with grams_basis "measured". If a stated weight is hedged (~, est, about, maybe, roughly), keep the number but use grams_basis "estimated".
3. For components visible in the photos or clearly implied but not weighed, estimate grams with grams_basis "estimated".
4. Name dishes properly (e.g. "Lentil soup with polenta"), grouping ingredients into their dishes.
5. Put marginal items (sauces, garnishes, uncertain extras) in condiments_and_uncertain.
6. If the attestation states a plate/meal total weight, return it as plate_total_grams; otherwise null.
7. If the attestation contains nothing structurable, return payload null.`

const gtAssistOutputSchema = z.object({
  payload: decompositionPayloadSchema.nullable(),
  plate_total_grams: z.number().nullable(),
})
type GtAssistOutput = z.infer<typeof gtAssistOutputSchema>

/** Local-dev media URLs (/api/media/...) aren't fetchable by providers — load
    bytes from disk. Public http(s) blob URLs pass through; anything else is
    skipped rather than failing the draft. */
function imageInput(blobUrl: string): URL | Buffer | null {
  if (blobUrl.startsWith('/api/media/')) {
    return readFileSync(join(process.cwd(), '.data/media', blobUrl.replace('/api/media/', '')))
  }
  if (blobUrl.startsWith('http')) return new URL(blobUrl)
  return null
}

export async function draftGtFromAttestation(args: {
  mealId: string
  attestation: string
  photoUrls: string[]
}): Promise<{
  draft: DecompositionPayload | null
  plateTotalGrams: number | null
  drafter: string
}> {
  const content: ContentPart[] = []
  for (const url of args.photoUrls) {
    const image = imageInput(url)
    if (image) content.push({ type: 'image', image })
  }
  content.push({
    type: 'text',
    text: `Structure this attestation into the GT decomposition.\n<attestation>\n${args.attestation}\n</attestation>\nOutput the JSON object only.`,
  })

  const { output, mocked } = await runLlm<GtAssistOutput>({
    runner: 'gt_assist',
    modelId: CONFIG.silver.modelId,
    subjectRef: `meal:${args.mealId}`,
    system: SYSTEM,
    messages: [{ role: 'user', content }],
    schema: gtAssistOutputSchema,
    mock: () => {
      // Deterministic offline fallback — same parser the UI shipped with (M1).
      const { payload, plateTotalGrams } = parseProseAttestation(args.attestation)
      return { payload, plate_total_grams: plateTotalGrams }
    },
  })

  const draft = output.payload ? decompositionPayloadSchema.parse(output.payload) : null
  return {
    draft,
    plateTotalGrams: output.plate_total_grams,
    drafter: mocked ? 'prose-parser-v1' : CONFIG.silver.modelId,
  }
}
