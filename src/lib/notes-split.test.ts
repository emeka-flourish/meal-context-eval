import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { splitNotes, parseDayHeader } from './notes-split'

const FIXTURE = readFileSync(join(process.cwd(), 'fixtures', 'notes-example.md'), 'utf-8')

describe('parseDayHeader', () => {
  it('accepts the header variants', () => {
    expect(parseDayHeader('Aug 14', 2026)).toBe('2026-08-14')
    expect(parseDayHeader('August 14', 2026)).toBe('2026-08-14')
    expect(parseDayHeader('2026-08-14', 2026)).toBe('2026-08-14')
    expect(parseDayHeader('# Thursday, Aug 14, 2026', 2026)).toBe('2026-08-14')
    expect(parseDayHeader('Sept 3rd', 2026)).toBe('2026-09-03')
  })
  it('rejects food lines that merely contain a month-like word', () => {
    expect(parseDayHeader('Chicken - 180 g', 2026)).toBeNull()
    expect(parseDayHeader('May be 2 slices', 2026)).toBeNull()
  })
})

describe('splitNotes — day / slot / photo blocks', () => {
  it('splits the example fixture into 4 photo blocks with verbatim prose', () => {
    const { blocks, warnings } = splitNotes(FIXTURE, { defaultYear: 2026 })
    expect(warnings).toEqual([])
    expect(blocks.map((b) => `${b.date} ${b.slot} ${b.photoIndex}`)).toEqual([
      '2026-03-03 breakfast 1',
      '2026-03-03 breakfast 2',
      '2026-03-03 lunch 1',
      '2026-03-03 dinner 1',
    ])
    expect(blocks[0].text).toBe(
      'Plate 1 - Toast and tuna:\nTwo slices wheat bread, one half medium avocado, one tbsp hummus, 1/2 tuna can - 70 g',
    )
    expect(blocks[3].text.split('\n')).toHaveLength(4)
    expect(blocks[3].text).toContain('Sheet pan vegetables - 210 g - carrots, cauliflower, mushrooms, zucchini, onions')
  })
  it('a slot without a Photo header is photo 1; "Photo 2: text" keeps the trailing text; days can be ISO', () => {
    const md = `2026-08-12\nLunch\nJollof rice 200 g\nDinner\nPhoto 1:\nMashed potato 220 g\nPhoto 2: lentil soup 350 g\nAug 13\nBreakfast:\nOats 175 g`
    const { blocks } = splitNotes(md, { defaultYear: 2026 })
    expect(blocks.map((b) => `${b.date} ${b.slot} ${b.photoIndex}|${b.text}`)).toEqual([
      '2026-08-12 lunch 1|Jollof rice 200 g',
      '2026-08-12 dinner 1|Mashed potato 220 g',
      '2026-08-12 dinner 2|lentil soup 350 g',
      '2026-08-13 breakfast 1|Oats 175 g',
    ])
  })
  it('warns on orphan text and merges duplicate blocks', () => {
    const md = `stray line\nAug 14\nLunch\nrice 100 g\nLunch\nbeans 50 g`
    const { blocks, warnings } = splitNotes(md, { defaultYear: 2026 })
    expect(warnings.some((w) => /orphan/.test(w))).toBe(true)
    expect(warnings.some((w) => /duplicate/.test(w))).toBe(true)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].text).toBe('rice 100 g\nbeans 50 g')
  })
})
