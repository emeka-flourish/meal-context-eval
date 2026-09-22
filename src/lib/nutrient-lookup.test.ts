import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { extractPer100g, FdcSearchUnavailableError, normalizeIngredientName, type FdcApiFood, type FdcMatch } from './fdc'
import salmon from './__fixtures__/fdc-search/salmon.json'
import sweetPotato from './__fixtures__/fdc-search/sweet-potato.json'
import egg from './__fixtures__/fdc-search/egg.json'
import chickenDrumstick from './__fixtures__/fdc-search/chicken-drumstick.json'
import greenBeans from './__fixtures__/fdc-search/green-beans.json'
import oatmeal from './__fixtures__/fdc-search/oatmeal.json'
import honey from './__fixtures__/fdc-search/honey.json'
import onion from './__fixtures__/fdc-search/onion.json'
import blueberry from './__fixtures__/fdc-search/blueberry.json'
import friedRice from './__fixtures__/fdc-search/fried-rice.json'

const h = vi.hoisted(() => ({
  aliasFindUnique: vi.fn(),
  aliasUpsert: vi.fn(),
  customFindFirst: vi.fn(),
  cacheFindUnique: vi.fn(),
  cacheCreate: vi.fn(),
  estimateNutrients: vi.fn(),
  wouldMock: vi.fn(),
  mockForced: vi.fn(),
}))

vi.mock('./db', () => ({
  db: {
    fdcAlias: { findUnique: h.aliasFindUnique, upsert: h.aliasUpsert },
    customFood: { findFirst: h.customFindFirst },
    fdcSearchCache: { findUnique: h.cacheFindUnique, create: h.cacheCreate, upsert: (args: { create: unknown }) => h.cacheCreate({ data: args.create }) },
  },
}))
vi.mock('./llm', () => ({ mockForced: h.mockForced }))
vi.mock('../runners/nutrientEstimate', () => ({
  estimateNutrients: h.estimateNutrients,
  nutrientEstimateWouldMock: h.wouldMock,
  estimateFoodName: (name: string, state?: string) => {
    const n = name.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
    return state && !n.endsWith(` ${state}`) ? `${n} ${state}` : n
  },
}))

import {
  FDC_ACCEPT,
  aliasKey,
  buildNutrientLookup,
  fdcQueries,
  pickFdcCandidate,
  rankFdcCandidates,
  resolveLookupItem,
  scoreFdcCandidate,
} from './nutrient-lookup'

/** Fixture rows → the FdcMatch shape searchFdc returns (real per-100 g values). */
function matches(fixture: { foods: unknown[] }): FdcMatch[] {
  return (fixture.foods as FdcApiFood[]).map((f) => ({
    fdcId: f.fdcId,
    description: f.description,
    dataType: f.dataType,
    per100g: extractPer100g(f.foodNutrients ?? []),
  }))
}
const score = (q: Parameters<typeof scoreFdcCandidate>[0], fixture: { foods: unknown[] }, description: string) => {
  const c = matches(fixture).find((m) => m.description === description)
  if (!c) throw new Error(`fixture row not found: ${description}`)
  return scoreFdcCandidate(q, c)
}

describe('pickFdcCandidate — real 25-result lists (captured 2026-09-17)', () => {
  it('salmon (cooked) → a plain "Fish, salmon, …" row, never a dish', () => {
    const pick = pickFdcCandidate({ name: 'salmon', state: 'cooked' }, matches(salmon))!
    expect(pick).toBeTruthy()
    expect(['Fish, salmon, NFS', 'Fish, salmon, grilled', 'Fish, salmon, baked or broiled', 'Fish, salmon, steamed']).toContain(pick.description)
    expect(pick.per100g.kcal).toBeGreaterThan(200)
    for (const d of ['Lomi salmon', 'Salmon salad', 'Fish oil, salmon', 'Salmon cake sandwich', 'Sushi roll, salmon', 'Sushi, topped with salmon', 'Fish, salmon cake or patty']) {
      expect(score({ name: 'salmon', state: 'cooked' }, salmon, d), d).toBeLessThan(FDC_ACCEPT)
    }
    // raw / smoked / fried contradict "cooked" and rank below the pick
    const top = scoreFdcCandidate({ name: 'salmon', state: 'cooked' }, pick)
    expect(score({ name: 'salmon', state: 'cooked' }, salmon, 'Fish, salmon, raw')).toBeLessThan(top)
    expect(score({ name: 'salmon', state: 'cooked' }, salmon, 'Fish, salmon, smoked')).toBeLessThan(top)
    expect(score({ name: 'salmon', state: 'cooked' }, salmon, 'Fish, salmon, fried')).toBeLessThan(top)
  })

  it('salmon (raw) → a raw salmon row', () => {
    const pick = pickFdcCandidate({ name: 'salmon', state: 'raw' }, matches(salmon))!
    expect(pick.description).toMatch(/^Fish, salmon.*raw/)
  })

  it('sweet potato (cooked) → "Sweet potato, …" plain row; tots/bread/pie/chips/fries/babyfood rejected', () => {
    const pick = pickFdcCandidate({ name: 'sweet potato', state: 'cooked' }, matches(sweetPotato))!
    expect(['Sweet potato, NFS', 'Sweet potato, baked, no added fat', 'Sweet potato, baked, fat added', 'Sweet potato, cooked, as ingredient']).toContain(pick.description)
    for (const d of ['Sweet potato tots', 'Bread, sweet potato', 'Pie, sweet potato', 'Sweet potato chips', 'Sweet potato fries, NFS', 'Sweet potato tots, school', 'Sweet potato, casserole or mashed', 'Babyfood, vegetables, sweet potatoes strained', 'Sweet Potato puffs, frozen, unprepared', 'Sweet potato paste']) {
      expect(score({ name: 'sweet potato', state: 'cooked' }, sweetPotato, d), d).toBe(0)
    }
    expect(score({ name: 'sweet potato', state: 'cooked' }, sweetPotato, 'Sweet potato leaves, raw')).toBeLessThan(FDC_ACCEPT)
    expect(score({ name: 'sweet potato', state: 'cooked' }, sweetPotato, 'Sweet potato, candied')).toBeLessThan(scoreFdcCandidate({ name: 'sweet potato', state: 'cooked' }, pick))
  })

  it('egg (cooked) → whole egg (Foundation), not white/yolk/omelet/benedict/bagel', () => {
    const pick = pickFdcCandidate({ name: 'egg', state: 'cooked' }, matches(egg))!
    expect(pick).toMatchObject({ fdcId: 748967, description: 'Eggs, Grade A, Large, egg whole', dataType: 'Foundation' })
    expect(pick.per100g.kcal).toBe(148)
    const q = { name: 'egg', state: 'cooked' }
    expect(score(q, egg, 'Eggs, Grade A, Large, egg white')).toBeLessThan(score(q, egg, 'Eggs, Grade A, Large, egg whole'))
    expect(score(q, egg, 'Eggs, Grade A, Large, egg yolk')).toBeLessThan(score(q, egg, 'Eggs, Grade A, Large, egg whole'))
    for (const d of ['Egg, Benedict', 'Bagels, egg', 'Bread, egg', 'Egg burrito', 'Quesadilla, egg', 'Sushi, topped with egg', 'Egg omelet or scrambled egg, made with butter', 'Congee, with egg']) {
      expect(score(q, egg, d), d).toBe(0)
    }
  })

  it('chicken drumstick (cooked) → a "Chicken drumstick, …, skin eaten" row; leg+thigh and skin-only rows rejected', () => {
    const pick = pickFdcCandidate({ name: 'chicken drumstick', state: 'cooked' }, matches(chickenDrumstick))!
    expect(pick.description).toMatch(/^Chicken drumstick, /)
    expect(pick.description).toMatch(/, skin eaten$/)
    expect(pick.description).not.toMatch(/coated|sauce/)
    const q = { name: 'chicken drumstick', state: 'cooked' }
    expect(score(q, chickenDrumstick, 'Chicken leg, drumstick and thigh, rotisserie, skin eaten')).toBeLessThan(FDC_ACCEPT)
    expect(score(q, chickenDrumstick, 'Chicken, skin (drumsticks and thighs), cooked, roasted')).toBe(0)
    expect(score(q, chickenDrumstick, 'Chicken, drumstick, meat and skin, raw')).toBeLessThan(scoreFdcCandidate(q, pick))
  })

  it('green beans (cooked) → a plain cooked "Green beans, …" row; casserole/fried/pickled/salad/babyfood rejected', () => {
    const pick = pickFdcCandidate({ name: 'green beans', state: 'cooked' }, matches(greenBeans))!
    expect(pick.description).toMatch(/^Green beans, .*cooked/)
    expect(pick.description).not.toMatch(/Szechuan|restaurant|oil|butter/)
    const q = { name: 'green beans', state: 'cooked' }
    for (const d of ['Green bean casserole', 'Bean salad, yellow and/or green string beans', 'Babyfood, green beans and turkey, strained']) {
      expect(score(q, greenBeans, d), d).toBe(0)
    }
    expect(score(q, greenBeans, 'Fried green beans')).toBeLessThan(FDC_ACCEPT)
    expect(score(q, greenBeans, 'Green beans, pickled')).toBeLessThan(FDC_ACCEPT)
    expect(score(q, greenBeans, 'Green beans, raw')).toBeLessThan(scoreFdcCandidate(q, pick))
    // singular query resolves the same
    expect(pickFdcCandidate({ name: 'green bean', state: 'cooked' }, matches(greenBeans))!.description).toBe(pick.description)
  })

  it('green beans (raw) → prefers the Foundation raw row (Atwater kcal, not zero)', () => {
    const pick = pickFdcCandidate({ name: 'green beans', state: 'raw' }, matches(greenBeans))!
    expect(pick.description).toMatch(/raw$/)
    expect(pick.per100g.kcal).toBeGreaterThan(0)
  })

  it('oatmeal (cooked) → "Oatmeal, NFS"; bread/cookie/muffin/pie/roll/bar rejected', () => {
    const pick = pickFdcCandidate({ name: 'oatmeal', state: 'cooked' }, matches(oatmeal))!
    expect(pick).toMatchObject({ fdcId: 2708380, description: 'Oatmeal, NFS' })
    const q = { name: 'oatmeal', state: 'cooked' }
    for (const d of ['Bread, oatmeal', 'Cookie, oatmeal', 'Muffin, oatmeal', 'Pie, oatmeal', 'Roll, oatmeal', 'Snack bar, oatmeal', 'Crackers, oatmeal', 'Oatmeal, fast food, plain']) {
      expect(score(q, oatmeal, d), d).toBe(0)
    }
  })

  it('honey → "Honey" (SR Legacy preferred over the identical Survey row)', () => {
    const pick = pickFdcCandidate({ name: 'honey' }, matches(honey))!
    expect(pick).toMatchObject({ fdcId: 169640, description: 'Honey', dataType: 'SR Legacy' })
    const q = { name: 'honey' }
    for (const d of ['Honey butter', 'Honey mustard dressing', 'Honey mustard dip', 'Cereal, other, honey', 'Honey roll sausage, beef', 'Ham, honey, smoked, cooked']) {
      expect(score(q, honey, d), d).toBe(0)
    }
    expect(score(q, honey, 'Almonds, honey roasted')).toBeLessThan(FDC_ACCEPT)
    expect(score(q, honey, 'Rice, sweet, cooked with honey')).toBeLessThan(FDC_ACCEPT)
  })

  it('onion → raw: SR Legacy "Onions, raw"; cooked: a plain cooked onion row; bread/dip/rings/soup/powder rejected', () => {
    const raw = pickFdcCandidate({ name: 'onion', state: 'raw' }, matches(onion))!
    expect(raw).toMatchObject({ fdcId: 170000, description: 'Onions, raw', dataType: 'SR Legacy' })
    const cooked = pickFdcCandidate({ name: 'onion', state: 'cooked' }, matches(onion))!
    expect(['Onions, cooked, as ingredient', 'Onions, cooked, fat added']).toContain(cooked.description)
    const q = { name: 'onion', state: 'cooked' }
    for (const d of ['Bread, onion', 'Onion dip, regular', "DENNY'S, onion rings", 'Fried onion rings', 'Soup, French onion', 'Spices, onion powder']) {
      expect(score(q, onion, d), d).toBe(0)
    }
    expect(score(q, onion, 'Onions, green, cooked')).toBeLessThan(scoreFdcCandidate(q, cooked))
    expect(score(q, onion, 'Onions, dehydrated flakes')).toBeLessThan(FDC_ACCEPT)
  })

  it('blueberry (raw) → SR Legacy "Blueberries, raw" (the Foundation row has Atwater kcal but no fiber value)', () => {
    const pick = pickFdcCandidate({ name: 'blueberry', state: 'raw' }, matches(blueberry))!
    expect(pick).toMatchObject({ fdcId: 171711, description: 'Blueberries, raw', dataType: 'SR Legacy' })
    expect(pick.per100g).toMatchObject({ kcal: 57, fiber_g: 2.4 })
    // the Foundation row is still a valid (extracted) candidate, just outranked by 0.03
    const foundation = matches(blueberry).find((m) => m.fdcId === 2346411)!
    expect(foundation.per100g.kcal).toBeCloseTo(57.4)
    expect(scoreFdcCandidate({ name: 'blueberry', state: 'raw' }, foundation)).toBeGreaterThanOrEqual(FDC_ACCEPT)
    const q = { name: 'blueberry', state: 'raw' }
    for (const d of ['Blueberry juice', 'Blueberry syrup', 'Pie, blueberry', 'Blueberry pie filling', 'Muffins, blueberry, dry mix', 'SILK Blueberry soy yogurt', 'Babyfood, fruit, apple and blueberry, junior']) {
      expect(score(q, blueberry, d), d).toBe(0)
    }
    expect(score(q, blueberry, 'Blueberries, dried, sweetened')).toBeLessThan(FDC_ACCEPT)
    expect(score(q, blueberry, 'Blueberries, frozen')).toBeLessThan(scoreFdcCandidate(q, pick))
  })

  it('fried rice (cooked) → "Rice, fried, NFS"; other fried foods and rolls rejected', () => {
    const pick = pickFdcCandidate({ name: 'fried rice', state: 'cooked' }, matches(friedRice))!
    expect(pick).toMatchObject({ fdcId: 2708952, description: 'Rice, fried, NFS' })
    const q = { name: 'fried rice', state: 'cooked' }
    for (const d of ['Fried broccoli', 'Shrimp, fried', 'Tofu, fried', 'Yuca fries']) {
      expect(score(q, friedRice, d), d).toBe(0)
    }
    expect(score(q, friedRice, 'Rice, fried, with beef')).toBeLessThan(scoreFdcCandidate(q, pick))
    expect(score(q, friedRice, 'Roll with meat and/or shrimp, vegetables and rice paper, not fried')).toBe(0)
  })

  it('a prep word ("fried") lifts the matching row above the generic one', () => {
    const q = { name: 'salmon', state: 'cooked', prep: 'fried' }
    expect(score(q, salmon, 'Fish, salmon, fried')).toBeGreaterThan(score(q, salmon, 'Fish, salmon, NFS'))
  })

  // Lists below are the real cached results of the 2026-09-17 verify run (FdcSearchCache), trimmed.
  const S = 'Survey (FNDDS)', SR = 'SR Legacy', F = 'Foundation'
  const row = (fdcId: number, description: string, dataType: string, kcal: number, fiber_g?: number) => ({
    fdcId, description, dataType, per100g: { kcal, protein_g: 1, fat_g: 1, carbs_g: 1, ...(fiber_g === undefined ? {} : { fiber_g }) },
  })

  it('wheat bread (cooked) → "Bread, wheat", not the toasted variant (query "wheat bread cooked")', () => {
    const list = [
      row(172686, 'Bread, wheat', SR, 274, 4), row(2707720, 'Bread, wheat or cracked wheat', S, 274, 4),
      row(169744, 'Wheat, khorasan, cooked', SR, 132, 4.3), row(2707721, 'Bread, wheat or cracked wheat, toasted', S, 301, 4.4),
      row(172687, 'Bread, wheat, toasted', SR, 313, 4.7), row(2707709, 'Bread, whole wheat', S, 254, 6),
      row(2707567, 'Nutella sandwich on wheat bread', S, 359, 5.4), row(2708442, 'Whole wheat cereal, cooked', S, 47, 1.3),
      row(2710786, 'Wheat bread as ingredient in sandwiches', S, 264, 5.4),
    ]
    expect(pickFdcCandidate({ name: 'wheat bread', state: 'cooked' }, list)!.fdcId).toBe(172686)
  })

  it('lemon pepper → nothing (every pepper row is missing "lemon"); falls through to the estimate', () => {
    const list = [
      row(174612, 'Turkey, breast, smoked, lemon pepper flavor, 97% fat-free', SR, 95, 0), row(2709168, 'Lemon, raw', S, 29, 2.8),
      row(2709802, 'Peppers, banana, raw', S, 27, 3.4), row(169394, 'Pepper, banana, raw', SR, 27, 3.4),
      row(2709798, 'Peppers, hot, raw', S, 34, 2.2), row(2710253, 'Pepper, for use on a sandwich', S, 27, 1), row(2710093, 'Hot pepper sauce', S, 12, 0.6),
    ]
    expect(pickFdcCandidate({ name: 'lemon pepper' }, list)).toBeNull()
  })

  it('no state given → "as commonly eaten": wild rice / chickpea pick cooked or NFS rows, never dry weight', () => {
    const wildRice = [
      row(168897, 'Wild rice, cooked', SR, 101, 1.8), row(169726, 'Wild rice, raw', SR, 357, 6.2),
      row(2709081, 'Flavored rice, brown and wild', S, 106, 1.1), row(2710821, 'Wild rice, dry, raw', F, 359, 4.26),
      row(2708424, 'Rice, wild, 100%, cooked, no added fat', S, 100, 1.8), row(2708426, 'Rice, white and wild, cooked, no added fat', S, 79, 0.5),
      row(2705927, 'Wild pig', S, 159, 0), row(2708162, 'Rice cake', S, 392, 4.2),
    ]
    expect(pickFdcCandidate({ name: 'wild rice' }, wildRice)!.fdcId).toBe(168897)
    expect(pickFdcCandidate({ name: 'wild rice', state: 'dry' }, wildRice)!.description).toMatch(/dry|raw/)
    const chickpea = [
      row(2707414, 'Chickpeas, NFS', S, 211, 7.1), row(174288, 'Chickpea flour (besan)', SR, 387, 10.8),
      row(2707418, 'Chickpeas, from canned, no added fat', S, 146, 7.3), row(2644282, 'Chickpeas, (garbanzo beans, bengal gram), dry', F, 372),
      row(173756, 'Chickpeas (garbanzo beans, bengal gram), mature seeds, raw', SR, 378, 12.2),
      row(173757, 'Chickpeas (garbanzo beans, bengal gram), mature seeds, cooked, boiled, without salt', SR, 164, 7.6),
      row(2707402, 'Hummus, plain', S, 243, 5.4), row(2707428, 'Bean chips', S, 448, 9.7),
    ]
    const pick = pickFdcCandidate({ name: 'chickpea' }, chickpea)!
    expect([2707414, 173757]).toContain(pick.fdcId)
    expect(pick.per100g.kcal).toBeLessThan(250)
  })

  it('a cooking word inside the name is a prep hint: "grilled chicken" → a grilled chicken row ("without sauce" is not a sauce)', () => {
    const list = [
      row(2706090, 'Chicken fillet, grilled', S, 151, 0), row(2706063, 'Chicken wing, grilled with sauce', S, 250, 0.2),
      row(170724, "WENDY'S, Ultimate Chicken Grill Sandwich", SR, 179, 1.1), row(2705969, 'Chicken breast, grilled with sauce, skin eaten', S, 202, 0.2),
      row(2707014, 'Chicken fillet sandwich, grilled, on wheat bun', S, 210, 2.1), row(173312, "McDONALD'S, Bacon Ranch Salad with Grilled Chicken", SR, 81, 1),
      row(2705967, 'Chicken breast, grilled without sauce, skin eaten', S, 206, 0), row(2705945, 'Chicken, NS as to part, grilled with sauce, skin eaten', S, 211, 0.2),
    ]
    const pick = pickFdcCandidate({ name: 'grilled chicken' }, list)!
    expect([2706090, 2705967]).toContain(pick.fdcId)
    expect(scoreFdcCandidate({ name: 'grilled chicken' }, list[3])).toBe(0) // "with sauce" is a sauce
    expect(scoreFdcCandidate({ name: 'grilled chicken' }, list[6])).toBeGreaterThanOrEqual(FDC_ACCEPT) // "without sauce" is not
  })

  it('chicken wing (cooked, prep fried) → the plain fried wing row, not coated/battered/brand rows', () => {
    const list = [
      row(2706065, 'Chicken wing, fried, coated, from raw', S, 289, 0.2), row(2706068, 'Chicken wing, fried, coated, from restaurant', S, 323, 0.3),
      row(172391, 'Chicken, broilers or fryers, wing, meat only, cooked, fried', SR, 211, 0),
      row(170360, 'Fast Foods, Fried Chicken, Wing, meat and skin and breading', SR, 310, 0.1),
      row(170751, 'POPEYES, Fried Chicken, Mild, Wing, meat and skin with breading', SR, 338, 0.6),
      row(173628, 'Chicken, broilers or fryers, wing, meat and skin, cooked, fried, batter', SR, 324, 0.3),
      row(2706061, 'Chicken wing, stewed', S, 247, 0), row(2706056, 'Chicken wing, NS as to cooking method', S, 257, 0),
      row(2727568, 'Chicken, wing, meat and skin, raw', F, 173),
    ]
    const pick = pickFdcCandidate({ name: 'chicken wing', state: 'cooked', prep: 'fried' }, list)!
    expect(pick.fdcId).toBe(172391)
  })

  it('a composite name whose words are mostly absent falls through (cafe harvest salad → components)', () => {
    expect(pickFdcCandidate({ name: 'cafe harvest salad' }, [
      { description: 'Salad dressing, NFS, for salads', dataType: 'Survey (FNDDS)' },
      { description: 'Beef salad', dataType: 'Survey (FNDDS)' },
      { description: 'Pea salad', dataType: 'Survey (FNDDS)' },
    ])).toBeNull()
  })

  it('a data-less row (all zeros) never wins over a row with nutrients', () => {
    const zero = { fdcId: 1, description: 'Spinach, baby', dataType: 'Foundation', per100g: { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 } }
    const real = { fdcId: 2, description: 'Spinach, raw', dataType: 'Survey (FNDDS)', per100g: { kcal: 27, protein_g: 2.9, fat_g: 0.6, carbs_g: 2.4 } }
    expect(pickFdcCandidate({ name: 'spinach', state: 'raw' }, [zero, real])!.fdcId).toBe(2)
    expect(scoreFdcCandidate({ name: 'spinach', state: 'raw' }, zero)).toBeLessThan(FDC_ACCEPT)
    // salt legitimately has zero macros
    expect(scoreFdcCandidate({ name: 'salt' }, { description: 'Salt, table', dataType: 'SR Legacy', per100g: { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0 } })).toBeGreaterThanOrEqual(FDC_ACCEPT)
  })

  it('is deterministic: the same list in a different order gives the same pick', () => {
    const list = matches(salmon)
    const a = pickFdcCandidate({ name: 'salmon', state: 'cooked' }, list)!
    const b = pickFdcCandidate({ name: 'salmon', state: 'cooked' }, [...list].reverse())!
    expect(b.fdcId).toBe(a.fdcId)
    expect(rankFdcCandidates({ name: 'salmon', state: 'cooked' }, list)[0].candidate.fdcId).toBe(a.fdcId)
  })
})

describe('fdcQueries / aliasKey', () => {
  it('ladders prep, state, plain', () => {
    expect(fdcQueries({ name: 'Chicken', state: 'cooked', prep: 'fried' })).toEqual(['chicken fried', 'chicken cooked', 'chicken'])
    expect(fdcQueries({ name: 'salmon', state: 'cooked' })).toEqual(['salmon cooked', 'salmon'])
    expect(fdcQueries({ name: 'oats', state: 'dry' })).toEqual(['oats dry', 'oats'])
    expect(fdcQueries({ name: 'honey' })).toEqual(['honey'])
    expect(fdcQueries({ name: 'fried rice', state: 'cooked', prep: 'fried' })).toEqual(['fried rice cooked', 'fried rice'])
  })
  it('alias key carries the state', () => {
    expect(aliasKey('Sweet potato', 'cooked')).toBe('sweet potato cooked')
    expect(aliasKey('honey')).toBe('honey')
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('resolveLookupItem / buildNutrientLookup — chain', () => {
  const savedKey = process.env.FDC_API_KEY
  let fetchSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    process.env.FDC_API_KEY = 'test-key'
    process.env.FDC_RETRY_DELAYS_MS = '0,0'
    h.aliasFindUnique.mockReset().mockResolvedValue(null)
    h.aliasUpsert.mockReset().mockResolvedValue(undefined)
    h.customFindFirst.mockReset().mockResolvedValue(null)
    h.cacheFindUnique.mockReset().mockResolvedValue(null)
    h.cacheCreate.mockReset().mockResolvedValue(undefined)
    h.estimateNutrients.mockReset()
    h.wouldMock.mockReset().mockReturnValue(false)
    h.mockForced.mockReset().mockReturnValue(false)
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })
  afterEach(() => {
    fetchSpy.mockRestore()
    if (savedKey === undefined) delete process.env.FDC_API_KEY
    else process.env.FDC_API_KEY = savedKey
    delete process.env.FDC_RETRY_DELAYS_MS
  })

  it('(1) alias memory: the state-matched key wins and no search happens', async () => {
    h.aliasFindUnique.mockImplementation(async ({ where }: { where: { normalizedName: string } }) =>
      where.normalizedName === 'salmon cooked' ? { normalizedName: 'salmon cooked', fdcId: 2706285, customFoodId: null, per100gCache: { kcal: 274, protein_g: 25.4, carbs_g: 0.01, fat_g: 18.4, fiber_g: 0 } } : null,
    )
    const out = await resolveLookupItem({ name: 'Salmon', state: 'cooked' })
    expect(out.status).toBe('resolved')
    if (out.status !== 'resolved') return
    expect(out.step).toBe('alias')
    expect(out.entry).toMatchObject({ kcal: 274, protein: 25.4, fat: 18.4, carb: 0.01, fiber: 0, source: 'fdc', ref: 'fdc:2706285' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('(3) search ladder: "<name> <state>" first, pick saved under the state key, description returned', async () => {
    fetchSpy.mockImplementation(async () => jsonResponse(salmon))
    const out = await resolveLookupItem({ name: 'Salmon', state: 'cooked' })
    expect(out.status).toBe('resolved')
    if (out.status !== 'resolved') return
    expect(out.step).toBe('fdc')
    expect(out.query).toBe('salmon cooked')
    expect(out.entry.source).toBe('fdc')
    expect(out.entry.description).toMatch(/^Fish, salmon/)
    expect(out.entry.kcal).toBeGreaterThan(0)
    expect(h.aliasUpsert).toHaveBeenCalledTimes(1)
    expect(h.aliasUpsert.mock.calls[0][0].where.normalizedName).toBe('salmon cooked')
    expect(h.estimateNutrients).not.toHaveBeenCalled()
  })

  it('(3) falls to the plain query when the state query has no acceptable row', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ foods: [] })).mockResolvedValueOnce(jsonResponse(honey))
    const out = await resolveLookupItem({ name: 'honey', state: 'raw' })
    expect(out.status).toBe('resolved')
    if (out.status !== 'resolved') return
    expect(out.query).toBe('honey')
    expect(out.entry.description).toBe('Honey')
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('(4) nothing matches → LLM estimate, saved as custom, reported as `estimate`', async () => {
    fetchSpy.mockImplementation(async () => jsonResponse({ foods: [] }))
    h.estimateNutrients.mockResolvedValue({ customFoodId: 'cf-1', per100g: { kcal: 120, protein_g: 3, carbs_g: 20, fat_g: 4, fiber_g: 2.5 }, basis: 'x', mocked: false, reused: false })
    const out = await resolveLookupItem({ name: 'lentil soup', state: 'cooked' })
    expect(out.status).toBe('resolved')
    if (out.status !== 'resolved') return
    expect(out.step).toBe('estimate')
    expect(h.estimateNutrients).toHaveBeenCalledWith('lentil soup', 'cooked')
    expect(out.entry).toMatchObject({ kcal: 120, fiber: 2.5, source: 'estimate', ref: 'custom:cf-1' })
    expect(h.aliasUpsert).not.toHaveBeenCalled() // the runner saves its own alias
  })

  it('(4) is skipped when the estimate would be a mock (no key) → unresolved', async () => {
    fetchSpy.mockImplementation(async () => jsonResponse({ foods: [] }))
    h.wouldMock.mockReturnValue(true)
    const out = await resolveLookupItem({ name: 'lentil soup', state: 'cooked' })
    expect(out.status).toBe('unresolved')
    expect(h.estimateNutrients).not.toHaveBeenCalled()
  })

  it('(4) is skipped with { estimate: false }', async () => {
    fetchSpy.mockImplementation(async () => jsonResponse({ foods: [] }))
    const out = await resolveLookupItem({ name: 'lentil soup' }, { estimate: false })
    expect(out.status).toBe('unresolved')
    if (out.status === 'unresolved') expect(out.queries).toEqual(['lentil soup'])
    expect(h.estimateNutrients).not.toHaveBeenCalled()
  })

  it('search unavailable (throttled) → `unavailable`, never estimated, never aliased', async () => {
    fetchSpy.mockImplementation(async () => new Response('<html>429</html>', { status: 429 }))
    const out = await resolveLookupItem({ name: 'egg', state: 'cooked' })
    expect(out.status).toBe('unavailable')
    if (out.status === 'unavailable') expect(out.error).toBeInstanceOf(FdcSearchUnavailableError)
    expect(h.estimateNutrients).not.toHaveBeenCalled()
    expect(h.aliasUpsert).not.toHaveBeenCalled()

    const build = await buildNutrientLookup([{ name: 'egg', state: 'cooked' }])
    expect(build.unavailable).toEqual(['egg'])
    expect(build.unresolved).toEqual([])
    expect(build.lookup('egg', 'cooked')).toBeNull()
  })

  it('MOCK_LLM=1 → deterministic mock, no network', async () => {
    h.mockForced.mockReturnValue(true)
    const out = await resolveLookupItem({ name: 'salmon', state: 'cooked' })
    expect(out.status).toBe('resolved')
    if (out.status === 'resolved') expect(out.entry).toMatchObject({ source: 'estimate', ref: '[MOCK]' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('(2) custom entry by state-specific name, approved first', async () => {
    h.customFindFirst.mockResolvedValue({ id: 'cf-9', name: 'lentil soup cooked', per100g: { kcal: 200, protein_g: 8, carbs_g: 6, fat_g: 16, fiber_g: 3 }, approvedAt: new Date() })
    const out = await resolveLookupItem({ name: 'Lentil soup', state: 'cooked' })
    expect(out.status).toBe('resolved')
    if (out.status !== 'resolved') return
    expect(out.step).toBe('custom')
    expect(out.entry).toMatchObject({ kcal: 200, fiber: 3, source: 'custom', ref: 'custom:cf-9', description: 'lentil soup cooked' })
    const where = h.customFindFirst.mock.calls[0][0].where
    expect(JSON.stringify(where)).toContain('lentil soup cooked')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('buildNutrientLookup resolves components under the dish state (prep not inherited) and keys by normalized name', async () => {
    fetchSpy.mockImplementation(async (_url: string | URL | Request, init?: RequestInit) => {
      const q = (JSON.parse(String(init?.body ?? '{}')) as { query?: string }).query ?? null
      if (q?.startsWith('onion')) return jsonResponse(onion)
      if (q?.startsWith('sweet potato')) return jsonResponse(sweetPotato)
      return jsonResponse({ foods: [] })
    })
    h.estimateNutrients.mockResolvedValue({ customFoodId: 'cf-z', per100g: { kcal: 17, protein_g: 1.2, carbs_g: 3.1, fat_g: 0.3, fiber_g: 1 }, basis: 'x', mocked: false, reused: false })
    const build = await buildNutrientLookup([
      { name: 'Roasted vegetables', state: 'cooked', prep: 'roasted', components: ['Sweet potato', 'onion', 'zucchini'] },
    ])
    expect(build.unresolved).toEqual([])
    expect(build.lookup('sweet potato', 'cooked')?.source).toBe('fdc')
    expect(build.lookup('Onion', 'cooked')?.source).toBe('fdc')
    expect(build.lookup('zucchini', 'cooked')?.source).toBe('estimate')
    // the component queries carry the dish state but NOT its prep word
    const queries = fetchSpy.mock.calls.map((c: unknown[]) => (JSON.parse(String((c[1] as RequestInit)?.body ?? '{}')) as { query?: string }).query ?? null)
    expect(queries).toContain('sweet potato cooked')
    expect(queries.some((q: string | null) => q?.includes('roasted'))).toBe(false)
    expect(normalizeIngredientName('Sweet potato')).toBe('sweet potato')
  })
})
