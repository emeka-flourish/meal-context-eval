import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parseLenient } from './llm'

const schema = z.object({
  plates: z.array(z.object({ dishes: z.array(z.object({ name: z.string(), ingredients: z.array(z.string()) })) })),
  uncertain: z.array(z.object({ name: z.string() })),
})

describe('parseLenient', () => {
  it('passes valid output through unchanged', () => {
    const raw = { plates: [], uncertain: [] }
    expect(parseLenient(schema, raw)).toEqual(raw)
  })
  it('fills a top-level array the model omitted (Haiku dropped `uncertain: []`)', () => {
    const out = parseLenient(schema, { plates: [{ dishes: [{ name: 'toast', ingredients: ['bread'] }] }] })
    expect(out.uncertain).toEqual([])
    expect(out.plates[0].dishes[0].ingredients).toEqual(['bread'])
  })
  it('fills a nested array', () => {
    const out = parseLenient(schema, { plates: [{ dishes: [{ name: 'toast' }] }], uncertain: [] })
    expect(out.plates[0].dishes[0].ingredients).toEqual([])
  })
  it('unwraps a single-key wrapper (Opus 5 wrote {"parameters": {...}} around the object)', () => {
    const inner = { plates: [{ dishes: [{ name: 'toast', ingredients: ['bread'] }] }], uncertain: [] }
    for (const key of ['parameters', 'paramaters', 'parameter_name']) expect(parseLenient(schema, { [key]: inner })).toEqual(inner)
  })
  it('unwraps and then fills a missing array inside the wrapper', () => {
    const out = parseLenient(schema, { parameters: { plates: [{ dishes: [{ name: 'toast', ingredients: ['bread'] }] }] } })
    expect(out.uncertain).toEqual([])
    expect(out.plates).toHaveLength(1)
  })
  it('never turns a wrapper or a foreign object into an empty decomposition', () => {
    expect(() => parseLenient(schema, { parameters: { foo: 1 } })).toThrow()
    expect(() => parseLenient(schema, { foo: 1 })).toThrow()
    expect(() => parseLenient(schema, {})).toThrow()
  })
  it('still throws when anything other than a missing array is wrong', () => {
    expect(() => parseLenient(schema, { plates: 'nope' })).toThrow()
    expect(() => parseLenient(schema, { plates: [{ dishes: [{ name: 3 }] }] })).toThrow()
  })
})
