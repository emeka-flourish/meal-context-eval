/* Custom-food draft runner (family C) — §5.2 support surface.
   For foods FDC can't identify (regional dishes, spice blends, ...) the silver
   model drafts a per-100g profile with visible reasoning; the owner approves
   or edits it via PATCH /api/custom-foods/[id] before it counts as reviewed.
   Rows are created UNAPPROVED (approvedAt null) — drafting is never approval. */
import { z } from 'zod'
import { db } from '@/lib/db'
import { runLlm } from '@/lib/llm'
import { CONFIG } from '@/lib/config'
import { normalizeIngredientName, saveAlias, type Per100g } from '@/lib/fdc'

export const customFoodDraftSchema = z.object({
  per_100g: z.object({
    kcal: z.number().min(0),
    protein_g: z.number().min(0),
    carbs_g: z.number().min(0),
    fat_g: z.number().min(0),
  }),
  reasoning: z.string().min(1),
  confidence: z.enum(['low', 'medium', 'high']),
})
export type CustomFoodDraft = z.infer<typeof customFoodDraftSchema>

// Shared by draftCustomFood AND the inline llm_estimate fallback in
// nutrients.ts — same prompt, same runner ('custom_food_draft'), so the two
// paths stay comparable in the llm_call ledger.
export const CUSTOM_FOOD_DRAFT_SYSTEM = `You are a nutrition-reference author specializing in regional and home-cooked foods that standard nutrient databases cover poorly, alongside global foods. Given a food name, draft its nutrient profile per 100 g AS SERVED (cooked/prepared as typically eaten, not dry weight unless the name says otherwise). In your reasoning, cite comparable reference foods you anchored on (e.g. "lentil soup ~ pumpkin-seed + palm-oil stew"). State an honest confidence: 'high' only for well-documented foods, 'low' when you are extrapolating. Output JSON only, matching the requested schema.`

/** Deterministic offline stand-in: same name → same profile. kcal lands in
    80–350; macro split derived from kcal so the numbers stay plausible. */
export function mockCustomFoodDraft(name: string): CustomFoodDraft {
  const normalized = normalizeIngredientName(name)
  let hash = 0
  for (const ch of normalized) hash = (hash * 31 + ch.charCodeAt(0)) % 100003
  const kcal = 80 + (hash % 271)
  const per_100g: Per100g = {
    kcal,
    protein_g: Math.round(kcal * 0.07 * 10) / 10,
    carbs_g: Math.round(kcal * 0.13 * 10) / 10,
    fat_g: Math.round(kcal * 0.05 * 10) / 10,
  }
  return {
    per_100g,
    reasoning: `[MOCK] Deterministic per-100g stand-in derived from the name "${normalized}" — not a real estimate.`,
    confidence: 'low',
  }
}

export async function draftCustomFood(
  name: string,
): Promise<{ customFoodId: string; mocked: boolean }> {
  const normalized = normalizeIngredientName(name)

  // Idempotent on normalized name: an existing food (by name or alias) wins.
  const existing = await db.customFood.findFirst({
    where: { OR: [{ name: normalized }, { aliases: { has: normalized } }] },
  })
  if (existing) return { customFoodId: existing.id, mocked: false }

  const { output, mocked } = await runLlm<CustomFoodDraft>({
    runner: 'custom_food_draft',
    modelId: CONFIG.silver.modelId,
    subjectRef: `custom_food:${normalized}`,
    system: CUSTOM_FOOD_DRAFT_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Draft a per-100g (as served) nutrient profile for: "${normalized}". Return kcal, protein_g, carbs_g and fat_g per 100 g, reasoning that cites comparable foods, and your confidence.`,
      },
    ],
    schema: customFoodDraftSchema,
    mock: () => mockCustomFoodDraft(normalized),
  })
  const validated = customFoodDraftSchema.parse(output)

  const created = await db.customFood.create({
    data: {
      name: normalized,
      aliases: [normalized],
      per100g: validated.per_100g,
      origin: 'llm_drafted',
      draftReasoning: `[confidence: ${validated.confidence}] ${validated.reasoning}`,
      // approvedAt stays null — owner approves via PATCH /api/custom-foods/[id]
    },
  })
  await saveAlias(name, { customFoodId: created.id, per100g: validated.per_100g })
  return { customFoodId: created.id, mocked }
}
