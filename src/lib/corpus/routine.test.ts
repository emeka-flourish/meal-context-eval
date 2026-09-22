import { describe, it, expect, vi } from 'vitest'

vi.mock('../db', () => ({ db: {} }))

import { classifyRoutine } from './routine'
import { indexCards } from '../retrieval/cascade'

const index = indexCards([
  { id: 'oat', canonicalName: 'Oatmeal', aliases: ['Plain Oatmeal'], instanceCount: 113 },
  { id: 'salmon', canonicalName: 'Baked Salmon', aliases: [], instanceCount: 2 },
  { id: 'sp', canonicalName: 'Baked Sweet Potato', aliases: [], instanceCount: 10 },
  { id: 'toast', canonicalName: 'Avocado Tuna Toast', aliases: ['Tuna Toast'], instanceCount: 31 },
])

describe('routine vs novel (CORPUS.md §5)', () => {
  it('routine when a core item resolves to a card with instanceCount ≥ 3', async () => {
    const v = await classifyRoutine(
      [
        { dish: 'Salmon plate', name: 'salmon', tag: 'core' },
        { dish: 'Salmon plate', name: 'sweet potato', tag: 'core' },
        { dish: 'Salmon plate', name: 'parsley', tag: 'garnish' },
      ],
      index,
    )
    expect(v.routine).toBe(true)
    expect(v.via).toMatchObject({ cardId: 'sp', query: 'sweet potato', instanceCount: 10 })
    expect(v.coreItems).toBe(2)
  })
  it('novel when the only match is a card seen < 3 times', async () => {
    const v = await classifyRoutine([{ dish: 'Baked Salmon', name: 'salmon', tag: 'core' }], index)
    expect(v.routine).toBe(false)
    expect(v.via).toBeNull()
  })
  it('non-core items never decide: a secondary sweet potato does not make the scene routine', async () => {
    const v = await classifyRoutine(
      [
        { dish: 'Steak', name: 'ribeye', tag: 'core' },
        { dish: 'Steak', name: 'sweet potato', tag: 'secondary' },
      ],
      index,
    )
    expect(v.routine).toBe(false)
  })
  it('the dish label counts as well as the item name; a threshold override is honoured', async () => {
    const items = [{ dish: 'Tuna toast', name: 'wheat bread', tag: 'core' }]
    expect((await classifyRoutine(items, index)).via).toMatchObject({ cardId: 'toast', query: 'Tuna toast' })
    expect((await classifyRoutine([{ dish: 'Baked Salmon', name: 'salmon', tag: 'core' }], index, { minInstances: 2 })).routine).toBe(true)
  })
  it('a scene without core items is novel', async () => {
    expect((await classifyRoutine([{ dish: 'x', name: 'parsley', tag: 'garnish' }], index)).routine).toBe(false)
    expect((await classifyRoutine([], index)).coreItems).toBe(0)
  })
})
