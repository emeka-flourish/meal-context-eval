import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import salmonFixture from './__fixtures__/fdc-search/salmon.json'
import blueberryFixture from './__fixtures__/fdc-search/blueberry.json'

// Light manual stub of the Prisma singleton — fdc.ts imports './db' so no
// path-alias config is needed here.
const { findUnique, create } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  create: vi.fn(),
}))

vi.mock('./db', () => ({
  db: {
    fdcSearchCache: { findUnique, create, upsert: (args: { create: unknown }) => create({ data: args.create }) },
  },
}))

import {
  FDC_PAGE_SIZE,
  FdcSearchUnavailableError,
  extractPer100g,
  fdcSearchText,
  fetchFromFdc,
  normalizeIngredientName,
  searchFdc,
  singularize,
  type FdcApiFood,
} from './fdc'

describe('normalizeIngredientName', () => {
  it('lowercases and trims', () => {
    expect(normalizeIngredientName('  Lentil ')).toBe('lentil')
  })
  it('collapses internal whitespace', () => {
    expect(normalizeIngredientName('brown   basmati\trice')).toBe('brown basmati rice')
  })
  it('strips parentheticals', () => {
    expect(normalizeIngredientName('Egg (large, boiled)')).toBe('egg')
    expect(normalizeIngredientName('Rice (white) with stew (tomato)')).toBe('rice with stew')
  })
  it('is idempotent', () => {
    const once = normalizeIngredientName('Ground Flaxseed (Linseed)')
    expect(normalizeIngredientName(once)).toBe(once)
  })
})

describe('singularize (comparison helper, never an alias key)', () => {
  it('handles common food plurals', () => {
    expect(singularize('blueberries')).toBe('blueberry')
    expect(singularize('potatoes')).toBe('potato')
    expect(singularize('beans')).toBe('bean')
    expect(singularize('eggs')).toBe('egg')
    expect(singularize('carrots')).toBe('carrot')
    expect(singularize('drumsticks')).toBe('drumstick')
  })
  it('leaves singulars and -ss/-us/-is words alone', () => {
    expect(singularize('salmon')).toBe('salmon')
    expect(singularize('hummus')).toBe('hummus')
    expect(singularize('cress')).toBe('cress')
    expect(singularize('nfs')).toBe('nfs')
  })
})

describe('extractPer100g', () => {
  it('keys on nutrientId and nutrientNumber and drops the kJ energy row', () => {
    const p = extractPer100g([
      { nutrientId: 1008, nutrientNumber: '208', unitName: 'KCAL', value: 274 },
      { nutrientId: 1062, nutrientNumber: '268', unitName: 'kJ', value: 1146 },
      { nutrientNumber: '203', value: 25.4 },
      { nutrientId: 1004, value: 18.4 },
      { nutrientId: 1005, value: 0.01 },
      { nutrientId: 1079, value: 0 },
    ])
    expect(p).toEqual({ kcal: 274, protein_g: 25.4, fat_g: 18.4, carbs_g: 0.01, fiber_g: 0 })
  })
  it('uses Atwater energy (2048, then 2047) when a Foundation row has no nutrient 1008', () => {
    const foundation = (blueberryFixture.foods as FdcApiFood[]).find((f) => f.dataType === 'Foundation')!
    const p = extractPer100g(foundation.foodNutrients ?? [])
    expect(p.kcal).toBeCloseTo(57.4)
    expect(p.protein_g).toBeCloseTo(0.703)
    expect(p.carbs_g).toBeCloseTo(14.6)
    expect(extractPer100g([{ nutrientId: 2047, unitName: 'KCAL', value: 63.9 }]).kcal).toBeCloseTo(63.9)
  })
  it('prefers 1008 over Atwater when both are present', () => {
    expect(
      extractPer100g([
        { nutrientId: 2048, unitName: 'KCAL', value: 50 },
        { nutrientId: 1008, unitName: 'KCAL', value: 60 },
      ]).kcal,
    ).toBe(60)
  })
  it('extracts every fixture row of the real salmon search with a positive kcal', () => {
    for (const f of salmonFixture.foods as FdcApiFood[]) {
      expect(extractPer100g(f.foodNutrients ?? []).kcal, f.description).toBeGreaterThan(0)
    }
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('fetchFromFdc — retry + typed failure', () => {
  const savedKey = process.env.FDC_API_KEY
  const savedDelays = process.env.FDC_RETRY_DELAYS_MS
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    process.env.FDC_API_KEY = 'test-key'
    process.env.FDC_RETRY_DELAYS_MS = '0,0'
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })
  afterEach(() => {
    fetchSpy.mockRestore()
    if (savedKey === undefined) delete process.env.FDC_API_KEY
    else process.env.FDC_API_KEY = savedKey
    if (savedDelays === undefined) delete process.env.FDC_RETRY_DELAYS_MS
    else process.env.FDC_RETRY_DELAYS_MS = savedDelays
  })

  it('scrubs FDC search operators from the wire text but not the cache key', async () => {
    fetchSpy.mockImplementation(async () => jsonResponse({ foods: [] }))
    await fetchFromFdc('turmeric/curry seasoning blend dry')
    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body)) as { query: string }
    expect(body.query).toBe('turmeric curry seasoning blend dry')
    expect(fdcSearchText('bread (whole grain) + "butter" a/b')).toBe('bread whole grain butter a b')
  })

  it('asks for 25 rows across the three data types', async () => {
    fetchSpy.mockImplementation(async () => jsonResponse({ foods: [] }))
    await fetchFromFdc('salmon')
    const url = new URL(String(fetchSpy.mock.calls[0][0]))
    const init = fetchSpy.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(init.body)) as { query: string; pageSize: number; dataType: string[] }
    expect(FDC_PAGE_SIZE).toBe(25)
    expect(init.method).toBe('POST') // GET + "Survey (FNDDS)" in the query string drew nginx 400s (2026-09-17)
    expect(url.searchParams.has('api_key')).toBe(true)
    expect(url.searchParams.has('query')).toBe(false)
    expect(body.pageSize).toBe(25)
    expect(body.dataType).toEqual(['Foundation', 'SR Legacy', 'Survey (FNDDS)'])
    expect(body.query).toBe('salmon')
  })

  it('maps the real salmon fixture into FdcMatch rows with per-100 g values', async () => {
    fetchSpy.mockImplementation(async () => jsonResponse(salmonFixture))
    const matches = await fetchFromFdc('salmon')
    expect(matches).toHaveLength(25)
    const nfs = matches.find((m) => m.description === 'Fish, salmon, NFS')!
    expect(nfs).toMatchObject({ fdcId: 2706285, dataType: 'Survey (FNDDS)' })
    expect(nfs.per100g).toEqual({ kcal: 274, protein_g: 25.4, fat_g: 18.4, carbs_g: 0.01, fiber_g: 0 })
  })

  it('retries a 429 and then succeeds', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse({ error: 'OVER_RATE_LIMIT' }, 429))
      .mockResolvedValueOnce(jsonResponse({ foods: [] }))
    await expect(fetchFromFdc('egg')).resolves.toEqual([])
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('retries a non-JSON body (the nginx "400 Bad Request" page) and a 5xx', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('<html><body>400 Bad Request</body></html>', { status: 400 }))
      .mockResolvedValueOnce(new Response('upstream', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ foods: [] }))
    await expect(fetchFromFdc('green beans')).resolves.toEqual([])
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })

  it('throws FdcSearchUnavailableError (never null/[]) after three failed attempts', async () => {
    fetchSpy.mockImplementation(async () => new Response('<html>throttled</html>', { status: 429 }))
    const err = await fetchFromFdc('egg').catch((e) => e)
    expect(err).toBeInstanceOf(FdcSearchUnavailableError)
    expect(err.attempts).toBe(3)
    expect(err.status).toBe(429)
    expect(fetchSpy).toHaveBeenCalledTimes(3)
  })

  it('does not retry a JSON 4xx (bad key / bad params)', async () => {
    fetchSpy.mockImplementation(async () => jsonResponse({ error: { code: 'API_KEY_INVALID' } }, 403))
    const err = await fetchFromFdc('egg').catch((e) => e)
    expect(err).toBeInstanceOf(FdcSearchUnavailableError)
    expect(err.attempts).toBe(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('treats a network error as retryable', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce(jsonResponse({ foods: [] }))
    await expect(fetchFromFdc('egg')).resolves.toEqual([])
  })
})

describe('searchFdc — real mode caching', () => {
  const savedKey = process.env.FDC_API_KEY
  let fetchSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    process.env.FDC_API_KEY = 'test-key'
    process.env.FDC_RETRY_DELAYS_MS = '0,0'
    findUnique.mockReset().mockResolvedValue(null)
    create.mockReset().mockResolvedValue(undefined)
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })
  afterEach(() => {
    fetchSpy.mockRestore()
    if (savedKey === undefined) delete process.env.FDC_API_KEY
    else process.env.FDC_API_KEY = savedKey
    delete process.env.FDC_RETRY_DELAYS_MS
  })

  it('caches a successful search under the normalized query', async () => {
    fetchSpy.mockImplementation(async () => jsonResponse(salmonFixture))
    const matches = await searchFdc('  Salmon ')
    expect(matches).toHaveLength(25)
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0].data.query).toBe('salmon')
  })

  it('propagates the typed error and caches nothing when the search is unavailable', async () => {
    fetchSpy.mockImplementation(async () => new Response('<html>throttled</html>', { status: 429 }))
    await expect(searchFdc('egg')).rejects.toBeInstanceOf(FdcSearchUnavailableError)
    expect(create).not.toHaveBeenCalled()
  })
})

describe('searchFdc — mock mode (FDC_API_KEY empty)', () => {
  const savedKey = process.env.FDC_API_KEY
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    delete process.env.FDC_API_KEY
    findUnique.mockReset().mockResolvedValue(null)
    create.mockReset()
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
    if (savedKey === undefined) delete process.env.FDC_API_KEY
    else process.env.FDC_API_KEY = savedKey
  })

  it('returns 3 clearly-labeled mock matches with negative fdcIds', async () => {
    const matches = await searchFdc('Lentil')
    expect(matches).toHaveLength(3)
    for (const m of matches) {
      expect(m.fdcId).toBeLessThan(0)
      expect(m.description).toContain('[MOCK]')
      expect(m.description).toContain('lentil')
      expect(typeof m.dataType).toBe('string')
      expect(m.per100g.kcal).toBeGreaterThan(0)
      expect(m.per100g.protein_g).toBeGreaterThanOrEqual(0)
      expect(m.per100g.carbs_g).toBeGreaterThanOrEqual(0)
      expect(m.per100g.fat_g).toBeGreaterThanOrEqual(0)
    }
    expect(matches.map((m) => m.fdcId)).toEqual([-1, -2, -3])
  })

  it('is deterministic for the same (normalized) query', async () => {
    const a = await searchFdc('Jollof Rice')
    const b = await searchFdc('  jollof   rice ')
    expect(b).toEqual(a)
  })

  it('never hits the network and never writes the cache in mock mode', async () => {
    await searchFdc('plantain')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('serves from FdcSearchCache when present', async () => {
    const cachedMatches = [
      {
        fdcId: 12345,
        description: 'Plantain, raw',
        dataType: 'SR Legacy',
        per100g: { kcal: 122, protein_g: 1.3, carbs_g: 31.9, fat_g: 0.4 },
      },
    ]
    findUnique.mockResolvedValue({ query: 'plantain', results: cachedMatches })
    const matches = await searchFdc('Plantain')
    expect(matches).toEqual(cachedMatches)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
