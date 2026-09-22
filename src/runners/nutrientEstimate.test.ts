import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  customFindFirst: vi.fn(),
  customCreate: vi.fn(),
  runLlm: vi.fn(),
  willMock: vi.fn(),
  saveAlias: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: { customFood: { findFirst: h.customFindFirst, create: h.customCreate } },
}))
vi.mock('@/lib/llm', () => ({ runLlm: h.runLlm, willMock: h.willMock }))
vi.mock('@/lib/fdc', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/fdc')>()
  return { ...actual, saveAlias: h.saveAlias }
})

import {
  NUTRIENT_ESTIMATE_MODEL_ID,
  NUTRIENT_ESTIMATE_PROMPT_VERSION,
  estimateFoodName,
  estimateNutrients,
  estimateUserText,
  mockNutrientEstimate,
  nutrientEstimateSchema,
  nutrientEstimateWouldMock,
} from './nutrientEstimate'
import { loadPrompt, systemSection } from '@/lib/config'

const REAL = {
  per_100g: { kcal: 206, protein_g: 22, fat_g: 12.4, carbs_g: 0, fiber_g: 0 },
  basis: 'USDA Fish, salmon, Atlantic, farmed, cooked, dry heat',
}

beforeEach(() => {
  h.customFindFirst.mockReset().mockResolvedValue(null)
  h.customCreate.mockReset().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'cf-new', ...data }))
  h.runLlm.mockReset().mockResolvedValue({ output: REAL, callId: 'call-1', mocked: false, latencyMs: 1 })
  h.willMock.mockReset().mockReturnValue(false)
  h.saveAlias.mockReset().mockResolvedValue(undefined)
})

describe('prompt + naming', () => {
  it('pins gpt-5.1 by default and reads prompts/nutrient-estimate.v1.md', () => {
    expect(NUTRIENT_ESTIMATE_MODEL_ID).toBe(process.env.NUTRIENT_ESTIMATE_MODEL_ID ?? 'gpt-5.1')
    expect(NUTRIENT_ESTIMATE_PROMPT_VERSION).toBe('nutrient-estimate.v1')
    const system = systemSection(loadPrompt(NUTRIENT_ESTIMATE_PROMPT_VERSION))
    expect(system).toContain('per 100 g')
    expect(system).toContain('fiber_g')
    expect(system).toContain('basis')
  })
  it('user text carries the normalized name and state', () => {
    expect(estimateUserText('Sweet Potato (baked)', 'cooked')).toBe('Food: sweet potato\nState: cooked\n\nReturn the JSON object only.')
    expect(estimateUserText('honey')).toContain('State: as commonly eaten')
  })
  it('stored name = normalized name + state (no duplication)', () => {
    expect(estimateFoodName('Salmon', 'cooked')).toBe('salmon cooked')
    expect(estimateFoodName('salmon cooked', 'cooked')).toBe('salmon cooked')
    expect(estimateFoodName('Honey')).toBe('honey')
  })
  it('schema rejects a missing fiber field and out-of-range energy', () => {
    expect(nutrientEstimateSchema.safeParse({ per_100g: { kcal: 1, protein_g: 0, fat_g: 0, carbs_g: 0 }, basis: 'x' }).success).toBe(false)
    expect(nutrientEstimateSchema.safeParse({ per_100g: { kcal: 2000, protein_g: 0, fat_g: 0, carbs_g: 0, fiber_g: 0 }, basis: 'x' }).success).toBe(false)
    expect(nutrientEstimateSchema.safeParse(REAL).success).toBe(true)
  })
  it('mock stand-in is deterministic and schema-valid', () => {
    expect(mockNutrientEstimate('zucchini')).toEqual(mockNutrientEstimate('Zucchini'))
    expect(nutrientEstimateSchema.safeParse(mockNutrientEstimate('zucchini')).success).toBe(true)
  })
  it('nutrientEstimateWouldMock mirrors willMock(model)', () => {
    h.willMock.mockReturnValue(true)
    expect(nutrientEstimateWouldMock()).toBe(true)
    expect(h.willMock).toHaveBeenCalledWith(NUTRIENT_ESTIMATE_MODEL_ID)
  })
})

describe('estimateNutrients', () => {
  it('calls the pinned model at temperature 0 with the versioned prompt, saves an UNAPPROVED CustomFood v1 with fiber, aliases it, returns the per-100 g', async () => {
    const res = await estimateNutrients('Salmon', 'cooked')
    expect(h.runLlm).toHaveBeenCalledTimes(1)
    const args = h.runLlm.mock.calls[0][0]
    expect(args).toMatchObject({
      runner: 'custom_food_draft',
      modelId: NUTRIENT_ESTIMATE_MODEL_ID,
      promptVersion: 'nutrient-estimate.v1',
      subjectRef: 'nutrient_estimate:salmon cooked',
      temperature: 0,
    })
    expect(args.messages[0].content).toContain('Food: salmon')
    expect(args.messages[0].content).toContain('State: cooked')

    expect(h.customCreate).toHaveBeenCalledTimes(1)
    const data = h.customCreate.mock.calls[0][0].data
    expect(data).toMatchObject({
      name: 'salmon cooked',
      aliases: ['salmon cooked'],
      origin: 'llm_drafted',
      version: 1,
      per100g: { kcal: 206, protein_g: 22, fat_g: 12.4, carbs_g: 0, fiber_g: 0 },
    })
    expect(data.approvedAt).toBeUndefined()
    expect(data.draftReasoning).toContain('nutrient-estimate.v1')
    expect(data.draftReasoning).toContain('USDA Fish, salmon')

    expect(h.saveAlias).toHaveBeenCalledWith('salmon cooked', { customFoodId: 'cf-new', per100g: data.per100g })
    expect(res).toEqual({ customFoodId: 'cf-new', per100g: data.per100g, basis: REAL.basis, mocked: false, reused: false })
  })

  it('reuses an existing CustomFood row for the same stored name (no model call)', async () => {
    h.customFindFirst.mockResolvedValue({ id: 'cf-old', name: 'salmon cooked', per100g: { kcal: 200, protein_g: 20, fat_g: 12, carbs_g: 0, fiber_g: 0 }, draftReasoning: 'earlier' })
    const res = await estimateNutrients('salmon', 'cooked')
    expect(h.runLlm).not.toHaveBeenCalled()
    expect(h.customCreate).not.toHaveBeenCalled()
    expect(res).toMatchObject({ customFoodId: 'cf-old', reused: true, per100g: { kcal: 200, fiber_g: 0 } })
  })

  it('rejects an out-of-schema model output instead of saving it', async () => {
    h.runLlm.mockResolvedValue({ output: { per_100g: { kcal: -5 }, basis: '' }, callId: 'c', mocked: false, latencyMs: 1 })
    await expect(estimateNutrients('mystery')).rejects.toThrow()
    expect(h.customCreate).not.toHaveBeenCalled()
    expect(h.saveAlias).not.toHaveBeenCalled()
  })

  it('stamps [MOCK] into the reasoning when the runner mocked (never expected in practice)', async () => {
    h.runLlm.mockResolvedValue({ output: mockNutrientEstimate('zucchini'), callId: 'c', mocked: true, latencyMs: 0 })
    const res = await estimateNutrients('zucchini', 'cooked')
    expect(res.mocked).toBe(true)
    expect(h.customCreate.mock.calls[0][0].data.draftReasoning).toContain('[MOCK]')
  })
})
