import { describe, it, expect } from 'vitest'
import {
  suggestMethod,
  summarizeDraft,
  findDroppedSegments,
  cleanPayloadForSave,
  encodeDraftState,
  decodeDraftState,
  isEmptyDraftState,
  draftStorageKey,
  type DraftPayload,
  type GtDraftState,
} from './gt-draft'

const payload = (over: Partial<DraftPayload> = {}): DraftPayload => ({
  dishes: [
    {
      dishName: 'Lentil soup',
      preparation: 'simmered',
      ingredients: [
        { name: 'lentil', grams: 350, grams_basis: 'estimated' },
        { name: 'palm oil', grams: 25, grams_basis: 'estimated' },
      ],
    },
  ],
  condiments_and_uncertain: [],
  ...over,
})

describe('suggestMethod — content-derived, override handled by caller', () => {
  it('any measured ingredient → weighed_components (even with plate total)', () => {
    const p = payload()
    p.dishes[0].ingredients[0].grams_basis = 'measured'
    expect(suggestMethod(p, 640)).toBe('weighed_components')
    expect(suggestMethod(p)).toBe('weighed_components')
  })
  it('measured basis in condiments counts too', () => {
    const p = payload({
      condiments_and_uncertain: [{ name: 'salt', grams: 2, grams_basis: 'measured' }],
    })
    expect(suggestMethod(p)).toBe('weighed_components')
  })
  it('no measured grams but a plate total → weighed_meal_described', () => {
    expect(suggestMethod(payload(), 640)).toBe('weighed_meal_described')
  })
  it('neither → attested_description (null payload included)', () => {
    expect(suggestMethod(payload())).toBe('attested_description')
    expect(suggestMethod(payload(), 0)).toBe('attested_description')
    expect(suggestMethod(null)).toBe('attested_description')
  })
  it('is pure — repeated calls with same input never depend on prior choices', () => {
    const p = payload()
    expect(suggestMethod(p, 640)).toBe(suggestMethod(p, 640))
    expect(suggestMethod(p)).toBe('attested_description')
  })
})

describe('summarizeDraft — coverage line', () => {
  it('counts dishes, ingredients, weighed vs estimated (condiments included)', () => {
    const p = payload({
      condiments_and_uncertain: [{ name: 'salt', grams: 2, grams_basis: 'measured' }],
    })
    expect(summarizeDraft(p)).toBe('1 dish · 3 ingredients (1 weighed, 2 estimated)')
  })
})

describe('findDroppedSegments — heuristic drop detection', () => {
  it('keeps segments that share a word with a drafted name', () => {
    expect(findDroppedSegments('lentil 350, palm oil ~25', payload())).toEqual([])
  })
  it('flags segments sharing no word with any dish/ingredient name', () => {
    expect(findDroppedSegments('lentil 350, goat meat ~80', payload())).toEqual(['goat meat ~80'])
  })
  it('matches against dish names, not just ingredients', () => {
    expect(findDroppedSegments('lentil soup for dinner', payload())).toEqual([])
  })
  it('ignores pure-number segments', () => {
    expect(findDroppedSegments('640, lentil 350', payload())).toEqual([])
  })
  it('ignores segments under 3 chars and unit-only fragments', () => {
    expect(findDroppedSegments('ab, 5g, lentil 350', payload())).toEqual([])
  })
  it('is case-insensitive', () => {
    expect(findDroppedSegments('LENTIL 350', payload())).toEqual([])
  })
  it('splits on newlines too', () => {
    expect(findDroppedSegments('lentil 350\nponmo strips 40', payload())).toEqual([
      'ponmo strips 40',
    ])
  })
})

describe('cleanPayloadForSave — strips editor scaffolding', () => {
  it('drops nameless / zero-gram ingredients and then-empty dishes', () => {
    const p = payload()
    p.dishes[0].ingredients.push({ name: '', grams: 10 }, { name: 'ghost', grams: 0 })
    p.dishes.push({ dishName: 'Empty', ingredients: [{ name: '', grams: 0 }] })
    const clean = cleanPayloadForSave(p)
    expect(clean.dishes).toHaveLength(1)
    expect(clean.dishes[0].ingredients.map((i) => i.name)).toEqual(['lentil', 'palm oil'])
  })
  it('strips blank preparation strings and gramless portions', () => {
    const p = payload()
    p.dishes[0].preparation = '  '
    p.dishes[0].portion = { confidence: 'low' }
    p.dishes[0].ingredients[0].preparation = ''
    const clean = cleanPayloadForSave(p)
    expect(clean.dishes[0].preparation).toBeUndefined()
    expect(clean.dishes[0].portion).toBeUndefined()
    expect(clean.dishes[0].ingredients[0].preparation).toBeUndefined()
  })
  it('keeps real preparation and portion grams', () => {
    const p = payload()
    p.dishes[0].portion = { grams: 640 }
    p.dishes[0].ingredients[1].preparation = 'sautéed'
    const clean = cleanPayloadForSave(p)
    expect(clean.dishes[0].preparation).toBe('simmered')
    expect(clean.dishes[0].portion).toEqual({ grams: 640 })
    expect(clean.dishes[0].ingredients[1].preparation).toBe('sautéed')
  })
})

describe('draft state encode/decode — localStorage round trip', () => {
  const state: GtDraftState = {
    attestation: 'plate total 640, lentil 350',
    plateTotal: '640',
    method: 'weighed_meal_described',
    methodDirty: true,
    draft: payload(),
  }
  it('round-trips losslessly', () => {
    expect(decodeDraftState(encodeDraftState(state))).toEqual(state)
  })
  it('rejects garbage and missing input', () => {
    expect(decodeDraftState(null)).toBeNull()
    expect(decodeDraftState('not json')).toBeNull()
    expect(decodeDraftState('42')).toBeNull()
    expect(decodeDraftState('{"nope":true}')).toBeNull()
  })
  it('defaults unknown method and malformed draft safely', () => {
    const decoded = decodeDraftState(
      JSON.stringify({ attestation: 'x', method: 'hacked', draft: { dishes: 'no' } }),
    )
    expect(decoded).toEqual({
      attestation: 'x',
      plateTotal: '',
      method: 'attested_description',
      methodDirty: false,
      draft: null,
    })
  })
  it('isEmptyDraftState — empty only when nothing worth keeping', () => {
    expect(
      isEmptyDraftState({
        attestation: ' ',
        plateTotal: '',
        method: 'attested_description',
        methodDirty: false,
        draft: null,
      }),
    ).toBe(true)
    expect(isEmptyDraftState(state)).toBe(false)
  })
  it('keys drafts per meal', () => {
    expect(draftStorageKey('abc')).toBe('gt-draft-abc')
  })
})
