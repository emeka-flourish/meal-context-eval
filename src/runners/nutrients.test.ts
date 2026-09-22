import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Per100g } from '@/lib/fdc'
import type { DecompositionPayload } from '@/lib/decomposition'
import type { Decomposition } from '@/generated/prisma/client'

// Pure unit tests: db, fdc resolution and the LLM runner are all stubbed so
// the fallback chain + math run with no network, no database, no keys.
const h = vi.hoisted(() => ({
  nutrientCalcFindFirst: vi.fn(),
  nutrientCalcCreate: vi.fn(),
  resolveIngredient: vi.fn(),
  searchFdc: vi.fn(),
  saveAlias: vi.fn(),
  runLlm: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    nutrientCalc: { findFirst: h.nutrientCalcFindFirst, create: h.nutrientCalcCreate },
  },
}))
vi.mock('@/lib/fdc', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/fdc')>()
  return {
    ...actual, // keep normalizeIngredientName (pure) real
    resolveIngredient: h.resolveIngredient,
    searchFdc: h.searchFdc,
    saveAlias: h.saveAlias,
  }
})
vi.mock('@/lib/llm', () => ({ runLlm: h.runLlm }))

import { runNutrientsForDecomposition, type FdcMapping } from './nutrients'
import { mockCustomFoodDraft } from './customFood'

const P100: Per100g = { kcal: 200, protein_g: 10, carbs_g: 20, fat_g: 5 }

function deco(payload: DecompositionPayload): Decomposition {
  return { id: 'deco-1', payload } as unknown as Decomposition
}

function oneDish(
  ingredients: { name: string; grams?: number; grams_est?: number }[],
  condiments: { name: string; grams?: number; grams_est?: number }[] = [],
): Decomposition {
  return deco({
    dishes: [{ dishName: 'Test dish', ingredients }],
    condiments_and_uncertain: condiments,
  })
}

function createdMappings(): FdcMapping[] {
  return h.nutrientCalcCreate.mock.calls[0][0].data.fdcMappings as FdcMapping[]
}

beforeEach(() => {
  h.nutrientCalcFindFirst.mockReset().mockResolvedValue(null)
  h.nutrientCalcCreate
    .mockReset()
    .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'nc-1',
      ...data,
    }))
  h.resolveIngredient.mockReset().mockResolvedValue(null)
  h.searchFdc.mockReset().mockResolvedValue([])
  h.saveAlias.mockReset().mockResolvedValue(undefined)
  // Default: behave like mock mode — run the caller's deterministic mock()
  h.runLlm
    .mockReset()
    .mockImplementation(async (args: { mock: () => unknown }) => ({
      output: args.mock(),
      callId: 'call-1',
      mocked: true,
      latencyMs: 0,
    }))
})

describe('runNutrientsForDecomposition — idempotency', () => {
  it('returns the existing NutrientCalc without recomputing', async () => {
    h.nutrientCalcFindFirst.mockResolvedValue({ id: 'nc-existing' })
    const res = await runNutrientsForDecomposition(oneDish([{ name: 'Rice', grams: 150 }]))
    expect(res).toEqual({ nutrientCalcId: 'nc-existing' })
    expect(h.nutrientCalcCreate).not.toHaveBeenCalled()
    expect(h.resolveIngredient).not.toHaveBeenCalled()
  })
})

describe('fallback chain order', () => {
  it('(1) alias hit wins: no search, no LLM, source=fdc', async () => {
    h.resolveIngredient.mockResolvedValue({ kind: 'fdc', fdcId: 111, per100g: P100 })
    await runNutrientsForDecomposition(oneDish([{ name: 'Rice', grams: 150 }]))
    expect(h.searchFdc).not.toHaveBeenCalled()
    expect(h.runLlm).not.toHaveBeenCalled()
    const [m] = createdMappings()
    expect(m).toMatchObject({
      ingredientPath: 'dishes[0].ingredients[0]',
      name: 'Rice',
      grams: 150,
      fdcId: 111,
      nutrientSource: 'fdc',
      per100g: P100,
    })
  })

  it('(1) custom_food alias carries customFoodId and source=custom_food', async () => {
    h.resolveIngredient.mockResolvedValue({
      kind: 'custom_food',
      customFoodId: 'cf-9',
      per100g: P100,
    })
    await runNutrientsForDecomposition(oneDish([{ name: 'Lentil soup', grams: 100 }]))
    const [m] = createdMappings()
    expect(m.nutrientSource).toBe('custom_food')
    expect(m.customFoodId).toBe('cf-9')
    expect(m.fdcId).toBeUndefined()
  })

  it('(2) search auto-accepts a substring match, saves the alias, source=fdc', async () => {
    h.searchFdc.mockResolvedValue([
      { fdcId: 555, description: 'Plantain, raw', dataType: 'SR Legacy', per100g: P100 },
    ])
    await runNutrientsForDecomposition(oneDish([{ name: 'Plantain', grams: 100 }]))
    expect(h.saveAlias).toHaveBeenCalledWith('Plantain', { fdcId: 555, per100g: P100 })
    expect(h.runLlm).not.toHaveBeenCalled()
    const [m] = createdMappings()
    expect(m).toMatchObject({ fdcId: 555, nutrientSource: 'fdc' })
  })

  it('(2→3) non-matching top description is NOT auto-accepted → llm_estimate', async () => {
    h.searchFdc.mockResolvedValue([
      { fdcId: 777, description: 'Butter, salted', dataType: 'SR Legacy', per100g: P100 },
    ])
    await runNutrientsForDecomposition(oneDish([{ name: 'Lentil', grams: 50 }]))
    expect(h.saveAlias).not.toHaveBeenCalled()
    expect(h.runLlm).toHaveBeenCalledTimes(1)
    expect(h.runLlm.mock.calls[0][0].runner).toBe('custom_food_draft')
    const [m] = createdMappings()
    expect(m.nutrientSource).toBe('llm_estimate')
    expect(m.fdcId).toBeUndefined()
    // deterministic mock: entry values follow the hash-derived per-100g
    const expected = mockCustomFoodDraft('Lentil').per_100g
    expect(m.per100g).toEqual(expected)
    expect(m.kcal).toBe(Math.round(((50 * expected.kcal) / 100) * 10) / 10)
  })

  it('(3→4) LLM failure → zero manual row flagged needsReview', async () => {
    h.runLlm.mockRejectedValue(new Error('provider down'))
    await runNutrientsForDecomposition(oneDish([{ name: 'Mystery item', grams: 80 }]))
    const [m] = createdMappings()
    expect(m).toMatchObject({
      nutrientSource: 'manual',
      needsReview: true,
      per100g: { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
      kcal: 0,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
    })
  })
})

describe('math and iteration', () => {
  it('150 g of a 200 kcal/100g food → 300 kcal (and macros scale the same)', async () => {
    h.resolveIngredient.mockResolvedValue({ kind: 'fdc', fdcId: 111, per100g: P100 })
    await runNutrientsForDecomposition(oneDish([{ name: 'Rice', grams: 150 }]))
    const data = h.nutrientCalcCreate.mock.calls[0][0].data
    expect(data.kcal).toBe(300)
    expect(data.proteinG).toBe(15)
    expect(data.carbsG).toBe(30)
    expect(data.fatG).toBe(7.5)
    expect(data.dbVersion).toBe('FDC-2026')
  })

  it('skips zero-gram ingredients entirely', async () => {
    h.resolveIngredient.mockResolvedValue({ kind: 'fdc', fdcId: 111, per100g: P100 })
    await runNutrientsForDecomposition(
      oneDish([{ name: 'Water' }, { name: 'Rice', grams: 100 }]),
    )
    expect(h.resolveIngredient).toHaveBeenCalledTimes(1)
    expect(h.resolveIngredient).toHaveBeenCalledWith('Rice')
    const mappings = createdMappings()
    expect(mappings).toHaveLength(1)
    expect(mappings[0].ingredientPath).toBe('dishes[0].ingredients[1]')
  })

  it('covers condiments (grams_est fallback) and preserves per-ingredient sources', async () => {
    h.resolveIngredient.mockImplementation(async (name: string) => {
      if (name === 'Rice') return { kind: 'fdc', fdcId: 111, per100g: P100 }
      if (name === 'Suya spice') return { kind: 'custom_food', customFoodId: 'cf-1', per100g: P100 }
      return null // 'Mystery sauce' → search miss → llm_estimate
    })
    await runNutrientsForDecomposition(
      oneDish(
        [{ name: 'Rice', grams: 100 }],
        [
          { name: 'Suya spice', grams_est: 10 },
          { name: 'Mystery sauce', grams_est: 20 },
        ],
      ),
    )
    const mappings = createdMappings()
    expect(mappings.map((m) => m.ingredientPath)).toEqual([
      'dishes[0].ingredients[0]',
      'condiments[0]',
      'condiments[1]',
    ])
    expect(mappings.map((m) => m.nutrientSource)).toEqual([
      'fdc',
      'custom_food',
      'llm_estimate',
    ])
    // totals still sum across sources — provenance lives on the entries
    const data = h.nutrientCalcCreate.mock.calls[0][0].data
    expect(data.kcal).toBe(mappings.reduce((s, m) => s + m.kcal, 0))
  })
})
