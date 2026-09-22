import { describe, it, expect } from 'vitest'
import { bandFor, isFlip } from './bands'

describe('bandFor — protocol boundaries (1–3 low, 4–7 moderate, 8–10 high)', () => {
  it('maps the low band including ingredient-level 0', () => {
    expect(bandFor(0)).toBe('low')
    expect(bandFor(1)).toBe('low')
    expect(bandFor(3)).toBe('low')
  })
  it('boundary 3→4: crosses low→moderate', () => {
    expect(bandFor(3)).toBe('low')
    expect(bandFor(4)).toBe('moderate')
  })
  it('score 7 is MODERATE per protocol — NOT High per the production prompt prose', () => {
    expect(bandFor(7)).toBe('moderate')
  })
  it('boundary 7→8: crosses moderate→high', () => {
    expect(bandFor(7)).toBe('moderate')
    expect(bandFor(8)).toBe('high')
  })
  it('10 is high', () => {
    expect(bandFor(10)).toBe('high')
  })
  it('rejects out-of-range scores', () => {
    expect(() => bandFor(-1)).toThrow()
    expect(() => bandFor(11)).toThrow()
    expect(() => bandFor(NaN)).toThrow()
  })
})

describe('isFlip — primary RQ4 measure', () => {
  it('flips exactly when the band boundary is crossed', () => {
    expect(isFlip(3, 4)).toBe(true) // low → moderate
    expect(isFlip(7, 8)).toBe(true) // moderate → high
    expect(isFlip(6, 7)).toBe(false) // both moderate under protocol — the score-7 ruling
    expect(isFlip(4, 7)).toBe(false) // same band, large delta: not a flip
    expect(isFlip(1, 3)).toBe(false)
    expect(isFlip(3, 8)).toBe(true) // low → high
    expect(isFlip(5, 5)).toBe(false)
  })
})
