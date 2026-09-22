import { describe, it, expect } from 'vitest'
import { parseProseAttestation } from './prose-parse'

describe('parseProseAttestation — weigh-log prose to draft GT', () => {
  it('parses the canonical owner example', () => {
    const { payload, plateTotalGrams } = parseProseAttestation(
      'plate total 640. lentil 350, palm oil ~25 est, goat 2 pieces ~80; polenta 220',
    )
    expect(plateTotalGrams).toBe(640)
    const ings = payload!.dishes[0].ingredients
    expect(ings).toHaveLength(4)
    expect(ings[0]).toMatchObject({ name: 'Lentil', grams: 350, grams_basis: 'measured' })
    expect(ings[1]).toMatchObject({ name: 'Palm oil', grams: 25, grams_basis: 'estimated' })
    expect(ings[2].grams_basis).toBe('estimated') // "~80"
    expect(ings[3]).toMatchObject({ name: 'Polenta', grams: 220, grams_basis: 'measured' })
  })
  it('marks about/maybe/roughly as estimated', () => {
    const { payload } = parseProseAttestation('rice about 200, beans maybe 150, stew roughly 100')
    for (const i of payload!.dishes[0].ingredients) expect(i.grams_basis).toBe('estimated')
  })
  it('returns null payload for prose with no weights (attestation-only path)', () => {
    const { payload } = parseProseAttestation('had jollof rice and grilled chicken at the buka')
    expect(payload).toBeNull()
  })
  it('handles grams units written out', () => {
    const { payload } = parseProseAttestation('yam flour 85 g, water 155 grams')
    expect(payload!.dishes[0].ingredients.map((i) => i.grams)).toEqual([85, 155])
  })
})
