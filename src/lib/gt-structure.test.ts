// TAG-GUIDE.md "Examples" as a fixture: the deterministic
// structurer (mock path of runners/gtStructure.ts) must reproduce every row.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { splitNotes } from './notes-split'
import { parseNotesToGtItems, normalizeQuantities, type GtItemDraft } from './prose-parse'
import { findFoods, tagFor } from './gt-tags'

const FIXTURE = readFileSync(join(process.cwd(), 'fixtures', 'notes-example.md'), 'utf-8')
const blocks = splitNotes(FIXTURE, { defaultYear: 2026 }).blocks
const byRef = Object.fromEntries(blocks.map((b) => [`${b.slot} ${b.photoIndex}`, parseNotesToGtItems(b.text)]))

const find = (items: GtItemDraft[], re: RegExp) => {
  const hit = items.find((i) => re.test(i.name))
  if (!hit) throw new Error(`no item matching ${re} in ${items.map((i) => i.name).join(', ')}`)
  return hit
}

describe('normalizeQuantities', () => {
  it('turns number words and fractions into decimals before the " and " split', () => {
    expect(normalizeQuantities('Two and half slices wheat bread')).toBe('2.5 slices wheat bread')
    expect(normalizeQuantities('one half medium avocado')).toBe('0.5 medium avocado')
    expect(normalizeQuantities('2/3 tuna can')).toBe('0.667 tuna can')
    expect(normalizeQuantities('1/3 cup uncooked oatmeal')).toBe('0.333 cup uncooked oatmeal')
    expect(normalizeQuantities('a tbsp of honey')).toBe('1 tbsp of honey')
  })
})

describe('findFoods — longest match, plurals, ignore vs vegetable pepper', () => {
  it('finds sweet potato over potato and black pepper over pepper', () => {
    expect(findFoods('sweet potatoes baked').map((f) => f.canonical)).toEqual(['sweet potato'])
    expect(findFoods('salt, black pepper').map((f) => f.cls)).toEqual(['ignore', 'ignore'])
    expect(findFoods('pepper parsley').map((f) => `${f.canonical}:${f.cls}`)).toEqual(['pepper:ignore', 'parsley:herb'])
    expect(findFoods('bell peppers').map((f) => f.cls)).toEqual(['vegetable'])
  })
})

describe('TAG-GUIDE examples → items and tags (deterministic structurer)', () => {
  it('"Potatoes baked - 150 g - salt, pepper parsley" → potato core 150 weighed; parsley garnish; salt/pepper ignore', () => {
    const { items } = byRef['dinner 1']
    expect(find(items, /^potato$/)).toMatchObject({ tag: 'core', grams: 150, basis: 'weighed', state: 'cooked' })
    expect(find(items, /^parsley$/)).toMatchObject({ tag: 'garnish', grams: null })
    expect(find(items, /^salt$/).tag).toBe('ignore')
    expect(find(items, /^pepper$/).tag).toBe('ignore')
  })
  it('"Chicken - 180 g - salt, black pepper, sprinkle of paprika" → chicken core 180 weighed; paprika spice', () => {
    const { items } = byRef['dinner 1']
    expect(find(items, /^chicken$/)).toMatchObject({ tag: 'core', grams: 180, basis: 'weighed' })
    expect(find(items, /^paprika$/)).toMatchObject({ tag: 'spice', grams: null })
    expect(find(items, /^black pepper$/).tag).toBe('ignore')
  })
  it('"Sheet pan vegetables - 210 g - carrots, …" → roasted vegetables secondary 210 weighed, components recorded, hidden-fat question', () => {
    const { items, questions } = byRef['dinner 1']
    const veg = find(items, /^roasted vegetables$/)
    expect(veg).toMatchObject({ tag: 'secondary', grams: 210, basis: 'weighed', state: 'cooked' })
    expect(veg.componentsNote).toMatch(/carrots, cauliflower, mushrooms, zucchini, onions/i)
    expect(items.filter((i) => /carrot|zucchini|cauliflower/.test(i.name))).toEqual([]) // components are not items
    expect(questions.some((q) => /hidden fat/i.test(q) && /roasted vegetables/.test(q))).toBe(true)
    expect(items.filter((i) => i.tag === 'ignore').map((i) => i.name).sort()).toEqual(['black pepper', 'pepper', 'salt']) // deduped per plate
  })
  it('"Two slices wheat bread, one half medium avocado, one tbsp hummus, 1/2 tuna can - 70 g" → bread core 56 est; avocado secondary 68 est; hummus secondary 15 est; tuna core 70 weighed', () => {
    const { items, questions } = byRef['breakfast 1']
    expect(find(items, /bread/)).toMatchObject({ tag: 'core', grams: 56, basis: 'estimated' })
    expect(find(items, /^avocado$/)).toMatchObject({ tag: 'secondary', grams: 68, basis: 'estimated' })
    expect(find(items, /^hummus$/)).toMatchObject({ tag: 'secondary', grams: 15, basis: 'estimated' })
    expect(find(items, /^tuna$/)).toMatchObject({ tag: 'core', grams: 70, basis: 'weighed' })
    expect(items).toHaveLength(4)
    expect(items.every((i) => i.dish === 'Toast and tuna')).toBe(true)
    expect(questions).toEqual([])
  })
  it('"One egg large - 40g kale, sprinkle of tomatoes, olive oil fried" → egg core 50 est; kale secondary 40 weighed; tomato garnish; olive oil garnish ~5 g est', () => {
    const { items, questions } = byRef['breakfast 2']
    expect(find(items, /^egg$/)).toMatchObject({ tag: 'core', grams: 50, basis: 'estimated', state: 'cooked' })
    expect(find(items, /^kale$/)).toMatchObject({ tag: 'secondary', grams: 40, basis: 'weighed' })
    expect(find(items, /^tomato$/)).toMatchObject({ tag: 'garnish', grams: null })
    expect(find(items, /^olive oil$/)).toMatchObject({ tag: 'garnish', grams: 5, basis: 'estimated' })
    expect(questions.some((q) => /hidden fat/i.test(q) && /olive oil/.test(q))).toBe(true) // amount not auto-answered
  })
  it('"1/2 cup uncooked oatmeal with water and honey one tbsp" → oatmeal core 263 converted (40.5 g dry); honey secondary 21 est; water ignore', () => {
    const { items } = byRef['lunch 1']
    const oats = find(items, /^oats$/)
    expect(oats).toMatchObject({ tag: 'core', grams: 263, basis: 'converted', state: 'cooked', dish: 'Porridge' })
    expect(oats.componentsNote).toMatch(/40\.5 g dry/)
    expect(find(items, /^honey$/)).toMatchObject({ tag: 'secondary', grams: 21, basis: 'estimated' })
    expect(find(items, /^water$/).tag).toBe('ignore')
  })
  it('"Raspberry 60 g, mango 80 g, kiwi 50 g" (fruit bowl) → each core, weighed', () => {
    const { items } = byRef['lunch 1']
    const bowl = items.filter((i) => i.dish === 'Fruit bowl')
    expect(bowl.map((i) => [i.name, i.grams, i.tag, i.basis])).toEqual([
      ['raspberry', 60, 'core', 'weighed'],
      ['mango', 80, 'core', 'weighed'],
      ['kiwi', 50, 'core', 'weighed'],
    ])
  })
  it('every core/secondary item has grams (rule 10); garnish/spice may not', () => {
    for (const r of Object.values(byRef)) {
      for (const i of r.items) {
        if (i.tag === 'core' || i.tag === 'secondary') expect(i.grams, i.name).toBeGreaterThan(0)
        if (i.grams != null) expect(i.basis).not.toBeNull()
      }
    }
  })
})

describe('structurer rules beyond the fixture', () => {
  it('drinks are dropped, including their add-ins; ignore items stay listed', () => {
    const r = parseNotesToGtItems('a cup of coffee with milk, jollof rice 200 g, water')
    expect(r.items.map((i) => `${i.name}:${i.tag}`)).toEqual(['jollof rice:core', 'water:ignore'])
    expect(r.dropped).toEqual(['1 cup of coffee', 'milk'])
  })
  it('a core item without any quantity gets a defaulted portion AND a question', () => {
    const r = parseNotesToGtItems('chicken with rice 150 g')
    expect(find(r.items, /^chicken$/)).toMatchObject({ tag: 'core', grams: 120, basis: 'estimated' })
    expect(r.questions.some((q) => /chicken/.test(q) && /confirm/.test(q))).toBe(true)
  })
  it('fruit beside a protein/starch is secondary; alone it is core (rule 4)', () => {
    expect(find(parseNotesToGtItems('banana 75 g').items, /banana/).tag).toBe('core')
    expect(find(parseNotesToGtItems('Plate 1 - oats:\noats 175 g, banana 75 g').items, /banana/).tag).toBe('secondary')
  })
  it('a single slice of bread beside eggs is a small side (rule 5); a tablespoon of oil is secondary (rule 8)', () => {
    const r = parseNotesToGtItems('2 eggs scrambled, 1 slice bread, 1 tbsp olive oil')
    expect(find(r.items, /bread/)).toMatchObject({ tag: 'secondary', grams: 28 })
    expect(find(r.items, /olive oil/)).toMatchObject({ tag: 'secondary', grams: 14 })
    expect(find(r.items, /^egg$/)).toMatchObject({ tag: 'core', grams: 88 })
  })
  it('hedged weights are estimated, not weighed', () => {
    expect(find(parseNotesToGtItems('palm oil ~25 g').items, /palm oil/)).toMatchObject({ basis: 'estimated', tag: 'secondary' })
  })
  it('tagFor: a stew weighed as one bowl is core; one egg beside a main protein is secondary', () => {
    const stew = { cls: 'composite' as const, canonical: 'stew', grams: 350, quantity: null, unit: null, smallQualifier: false }
    expect(tagFor(stew, [stew])).toBe('core')
    const egg = { cls: 'protein' as const, canonical: 'egg', grams: 44, quantity: 1, unit: 'medium', smallQualifier: false }
    const salmon = { cls: 'protein' as const, canonical: 'salmon', grams: 199, quantity: null, unit: null, smallQualifier: false }
    expect(tagFor(egg, [egg, salmon])).toBe('secondary')
    expect(tagFor(egg, [egg])).toBe('core')
  })
})
