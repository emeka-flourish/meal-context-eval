/* Level 2 step 4 — LLM per-100 g estimate for a food name that nothing else
   could resolve (src/lib/nutrient-lookup.ts). Pinned model
   (NUTRIENT_ESTIMATE_MODEL_ID, default gpt-5.1), temperature 0, prompt
   prompts/nutrient-estimate.v1.md, JSON only.

   Every estimate is persisted as a CustomFood row with approvedAt = null:
   drafting is never approval — the owner approves via PATCH /api/custom-foods/[id].
   The alias `<name> <state>` (or `<name>`) is saved so the name resolves to
   the SAME row on every later run (study stability), and Level 2 reports it
   with source `estimate`, which feeds the published custom/estimate share.

   origin: the CustomFoodOrigin enum has llm_drafted | manual only; the
   estimate uses `llm_drafted` (closest) and stamps the prompt version + model
   into draftReasoning so the two LLM paths stay distinguishable.

   Real mode only: MOCK_LLM=1 (or a missing provider key) never reaches this
   runner — the lookup chain returns mockPer100 first. The `mock` handed to
   runLlm exists only because the runner signature requires one. */
import { z } from 'zod'
import { db } from '@/lib/db'
import { runLlm, willMock } from '@/lib/llm'
import { loadPrompt, systemSection } from '@/lib/config'
import { normalizeIngredientName, saveAlias, type Per100gWithFiber } from '@/lib/fdc'

export const NUTRIENT_ESTIMATE_PROMPT_VERSION = 'nutrient-estimate.v1'
export const NUTRIENT_ESTIMATE_MODEL_ID = process.env.NUTRIENT_ESTIMATE_MODEL_ID ?? 'gpt-5.1'

export const nutrientEstimateSchema = z.object({
  per_100g: z.object({
    kcal: z.number().min(0).max(950),
    protein_g: z.number().min(0).max(100),
    fat_g: z.number().min(0).max(100),
    carbs_g: z.number().min(0).max(100),
    fiber_g: z.number().min(0).max(100),
  }),
  basis: z.string().min(1).max(300),
})
export type NutrientEstimate = z.infer<typeof nutrientEstimateSchema>

export type NutrientEstimateResult = {
  customFoodId: string
  per100g: Per100gWithFiber
  basis: string
  mocked: boolean
  /** true when an existing CustomFood row was reused instead of calling the model */
  reused: boolean
}

/** The stored name for an estimate: the normalized food name plus its state,
    so "sweet potato cooked" and "sweet potato raw" are separate rows. */
export function estimateFoodName(name: string, state?: string): string {
  const n = normalizeIngredientName(name)
  const s = state ? normalizeIngredientName(state) : ''
  return s && !n.endsWith(` ${s}`) ? `${n} ${s}` : n
}

export function estimateUserText(name: string, state?: string): string {
  const template =
    loadPrompt(NUTRIENT_ESTIMATE_PROMPT_VERSION).match(/## User template[^\n]*\n\s*```[^\n]*\n([\s\S]*?)```/)?.[1] ??
    'Food: {{NAME}}\nState: {{STATE}}\n\nReturn the JSON object only.\n'
  return template
    .replace('{{NAME}}', normalizeIngredientName(name))
    .replace('{{STATE}}', state ? normalizeIngredientName(state) : 'as commonly eaten')
    .trim()
}

/** Deterministic stand-in handed to runLlm (never used in practice — see header). */
export function mockNutrientEstimate(name: string): NutrientEstimate {
  let seed = 0
  for (const ch of normalizeIngredientName(name)) seed = (seed * 31 + ch.charCodeAt(0)) % 997
  const kcal = 60 + (seed % 240)
  return {
    per_100g: {
      kcal,
      protein_g: Math.round(kcal * 0.08 * 10) / 10,
      fat_g: Math.round(kcal * 0.04 * 10) / 10,
      carbs_g: Math.round(kcal * 0.12 * 10) / 10,
      fiber_g: Math.round(kcal * 0.012 * 10) / 10,
    },
    basis: '[MOCK] deterministic stand-in',
  }
}

/** Would this call be a mock (MOCK_LLM=1 or no key for the pinned model)? */
export function nutrientEstimateWouldMock(): boolean {
  return willMock(NUTRIENT_ESTIMATE_MODEL_ID)
}

function toPer100g(e: NutrientEstimate): Per100gWithFiber {
  return {
    kcal: e.per_100g.kcal,
    protein_g: e.per_100g.protein_g,
    carbs_g: e.per_100g.carbs_g,
    fat_g: e.per_100g.fat_g,
    fiber_g: e.per_100g.fiber_g,
  }
}

function per100gOf(raw: unknown): Per100gWithFiber | null {
  if (typeof raw !== 'object' || raw === null) return null
  const v = raw as Record<string, unknown>
  const num = (k: string) => (typeof v[k] === 'number' && Number.isFinite(v[k]) ? (v[k] as number) : null)
  const kcal = num('kcal'), protein_g = num('protein_g'), carbs_g = num('carbs_g'), fat_g = num('fat_g')
  if (kcal === null || protein_g === null || carbs_g === null || fat_g === null) return null
  const fiber = num('fiber_g')
  return { kcal, protein_g, carbs_g, fat_g, ...(fiber !== null ? { fiber_g: fiber } : {}) }
}

/** Estimate per-100 g for `name` in `state`; persist as an unapproved
    CustomFood (version 1) + alias; idempotent on the stored name. */
export async function estimateNutrients(name: string, state?: string): Promise<NutrientEstimateResult> {
  const storedName = estimateFoodName(name, state)

  const existing = await db.customFood.findFirst({
    where: { OR: [{ name: storedName }, { aliases: { has: storedName } }] },
    orderBy: [{ approvedAt: { sort: 'desc', nulls: 'last' } }, { version: 'desc' }],
  })
  if (existing) {
    const p = per100gOf(existing.per100g)
    if (p) {
      return { customFoodId: existing.id, per100g: p, basis: existing.draftReasoning ?? '', mocked: false, reused: true }
    }
  }

  const { output, mocked } = await runLlm<NutrientEstimate>({
    runner: 'custom_food_draft',
    modelId: NUTRIENT_ESTIMATE_MODEL_ID,
    promptVersion: NUTRIENT_ESTIMATE_PROMPT_VERSION,
    subjectRef: `nutrient_estimate:${storedName}`,
    system: systemSection(loadPrompt(NUTRIENT_ESTIMATE_PROMPT_VERSION)),
    messages: [{ role: 'user', content: estimateUserText(name, state) }],
    schema: nutrientEstimateSchema,
    temperature: 0,
    mock: () => mockNutrientEstimate(storedName),
  })
  const validated = nutrientEstimateSchema.parse(output)
  const per100g = toPer100g(validated)

  const created = await db.customFood.create({
    data: {
      name: storedName,
      aliases: [storedName],
      per100g,
      origin: 'llm_drafted',
      draftReasoning: `[${NUTRIENT_ESTIMATE_PROMPT_VERSION} · ${mocked ? `${NUTRIENT_ESTIMATE_MODEL_ID} [MOCK]` : NUTRIENT_ESTIMATE_MODEL_ID} · state: ${state ?? 'unspecified'}] basis: ${validated.basis}`,
      version: 1,
      // approvedAt stays null — pending the owner's approval via PATCH /api/custom-foods/[id]
    },
  })
  await saveAlias(storedName, { customFoodId: created.id, per100g })
  return { customFoodId: created.id, per100g, basis: validated.basis, mocked, reused: false }
}
