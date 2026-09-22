import { z } from 'zod'

// §4 decomposition payload — pipeline variant uses grams_est; GT variant uses
// grams + grams_basis. One schema covers both; GT-specific fields optional.

export const gramsBasis = z.enum(['measured', 'estimated'])

export const ingredientSchema = z.object({
  name: z.string().min(1),
  grams_est: z.number().positive().optional(),
  grams: z.number().positive().optional(),
  grams_basis: gramsBasis.optional(),
  preparation: z.string().optional(),
  confidence: z.enum(['low', 'medium', 'high']).optional(),
})

export const dishSchema = z.object({
  dishName: z.string().min(1),
  portion: z
    .object({
      grams_est: z.number().positive().optional(),
      grams: z.number().positive().optional(),
      confidence: z.enum(['low', 'medium', 'high']).optional(),
    })
    .optional(),
  preparation: z.string().optional(),
  batch: z
    .object({
      batch_total_grams: z.number().positive(),
      portion_fraction: z.number().gt(0).lte(1),
    })
    .optional(),
  ingredients: z.array(ingredientSchema).min(1),
})

export const decompositionPayloadSchema = z.object({
  dishes: z.array(dishSchema).min(1),
  condiments_and_uncertain: z.array(ingredientSchema).default([]),
})

export type DecompositionPayload = z.infer<typeof decompositionPayloadSchema>
export type Dish = z.infer<typeof dishSchema>
export type Ingredient = z.infer<typeof ingredientSchema>

// ---- LLM-facing variant --------------------------------------------------
// OpenAI's strict structured-output mode requires EVERY property listed in
// `required` — optionality must be expressed as null, not absence. The
// pipeline model therefore emits this all-required/nullable shape; nulls are
// stripped before validating against the storage schema above.

const llmConfidence = z.enum(['low', 'medium', 'high']).nullable()

const llmIngredient = z.object({
  name: z.string(),
  grams_est: z.number().nullable(),
  preparation: z.string().nullable(),
  confidence: llmConfidence,
})

export const decompositionLlmSchema = z.object({
  dishes: z.array(
    z.object({
      dishName: z.string(),
      portion: z.object({ grams_est: z.number().nullable(), confidence: llmConfidence }),
      preparation: z.string().nullable(),
      ingredients: z.array(llmIngredient),
    }),
  ),
  condiments_and_uncertain: z.array(llmIngredient),
})
export type DecompositionLlmPayload = z.infer<typeof decompositionLlmSchema>

function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      if (v !== null) out[k] = stripNulls(v)
    }
    return out
  }
  return value
}

/** LLM output → validated storage payload.
    Nulls dropped; NON-POSITIVE gram estimates dropped (models legitimately
    emit grams_est: 0 for "present but unquantifiable" — QA P0: rejecting the
    whole paid output over one zero burned spend in a retry loop); empty
    portions/dishes pruned. Throws a clear error if nothing edible remains. */
export function fromLlmPayload(llm: DecompositionLlmPayload): DecompositionPayload {
  const stripped = stripNulls(llm) as Record<string, unknown>
  const dishes = (stripped.dishes as Record<string, unknown>[])
    .map((d) => {
      const portion = d.portion as Record<string, unknown> | undefined
      if (portion && (typeof portion.grams_est !== 'number' || portion.grams_est <= 0)) {
        delete portion.grams_est
      }
      if (portion && Object.keys(portion).filter((k) => k !== 'confidence').length === 0) {
        delete d.portion
      }
      d.ingredients = (d.ingredients as Record<string, unknown>[]).filter(
        (i) => typeof i.grams_est === 'number' && (i.grams_est as number) > 0,
      )
      return d
    })
    .filter((d) => (d.ingredients as unknown[]).length > 0)
  const condiments = ((stripped.condiments_and_uncertain as Record<string, unknown>[]) ?? []).filter(
    (i) => typeof i.grams_est === 'number' && (i.grams_est as number) > 0,
  )
  if (dishes.length === 0) {
    throw new Error(
      'model identified no quantifiable food in the capture (all dishes empty after pruning)',
    )
  }
  return decompositionPayloadSchema.parse({ dishes, condiments_and_uncertain: condiments })
}
