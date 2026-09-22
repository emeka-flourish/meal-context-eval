import { describe, it, expect } from 'vitest'
import { gtEntryAllowed, tierForMethod, pipelineOutputsVisible } from './gt'

const art = (surface: string, isReference = false) => ({ surface, isReference })
const locked = (surface: string) => ({ source: 'pipeline', lockedAt: new Date(), surface })
const unlocked = (surface: string) => ({ source: 'pipeline', lockedAt: null, surface })
const gtRow = { source: 'gt', lockedAt: null, surface: null }

describe('gtEntryAllowed — invariant 1 (GT lock, per capture surface)', () => {
  it('blocks when no artifacts exist', () => {
    expect(gtEntryAllowed([], []).allowed).toBe(false)
  })
  it('blocks when some surface lacks a locked pipeline row', () => {
    const r = gtEntryAllowed([art('phone'), art('glasses')], [locked('phone')])
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/1\/2/)
    expect(r.reason).toMatch(/glasses/)
  })
  it('blocks when a surface pipeline row exists but is unlocked', () => {
    const r = gtEntryAllowed([art('phone'), art('glasses')], [locked('phone'), unlocked('glasses')])
    expect(r.allowed).toBe(false)
  })
  it('allows when every surface has a locked pipeline row', () => {
    expect(
      gtEntryAllowed([art('phone'), art('glasses')], [locked('phone'), locked('glasses')]).allowed,
    ).toBe(true)
  })
  it('multiple photos on one surface need only ONE locked row (per-surface unit)', () => {
    const r = gtEntryAllowed([art('phone'), art('phone'), art('phone')], [locked('phone')])
    expect(r.allowed).toBe(true)
  })
  it('ignores reference artifacts (menu photos) — they never need pipeline rows', () => {
    const r = gtEntryAllowed([art('phone'), art('glasses', true)], [locked('phone')])
    expect(r.allowed).toBe(true)
  })
  it('ignores GT rows when counting pipeline coverage', () => {
    const r = gtEntryAllowed([art('phone')], [gtRow])
    expect(r.allowed).toBe(false)
  })
  it('the tripod surface requires a pipeline row too', () => {
    const r = gtEntryAllowed([art('phone'), art('tripod')], [locked('phone')])
    expect(r.allowed).toBe(false)
  })
})

describe('tierForMethod — protocol-owned mapping, never user-chosen', () => {
  it('weighed_components → gold', () => {
    expect(tierForMethod('weighed_components')).toBe('gold')
  })
  it('weighed_meal_described → silver', () => {
    expect(tierForMethod('weighed_meal_described')).toBe('silver')
  })
  it('attested_description → silver', () => {
    expect(tierForMethod('attested_description')).toBe('silver')
  })
})

describe('pipelineOutputsVisible — anchoring reveal gate (DECISIONS.md #4)', () => {
  it('hidden before GT is saved (pending/gold/silver paths)', () => {
    expect(pipelineOutputsVisible(false, 'pending')).toBe(false)
    expect(pipelineOutputsVisible(false, 'gold')).toBe(false)
    expect(pipelineOutputsVisible(false, 'silver')).toBe(false)
  })
  it('visible after GT saved', () => {
    expect(pipelineOutputsVisible(true, 'gold')).toBe(true)
    expect(pipelineOutputsVisible(true, 'silver')).toBe(true)
  })
  it('visible when meal is marked unrated (no GT coming, nothing to anchor)', () => {
    expect(pipelineOutputsVisible(false, 'unrated')).toBe(true)
  })
})
