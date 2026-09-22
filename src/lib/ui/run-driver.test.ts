import { describe, it, expect } from 'vitest'
import {
  driveRun,
  driveRunToEnd,
  dependenciesOf,
  failedKeys,
  onlyKeys,
  itemId,
  truthKey,
  postResultFromResponse,
  formatElapsed,
  type DriverItem,
  type PostResult,
} from './run-driver'

/* A work list shaped exactly like buildRunWorkList: truth classify once per
   scene, then per cell interpret → match → classify(estimate) → score. */
function workList(scenes: string[], cellsPerScene: number, done: Set<string> = new Set(), failed: Map<string, string> = new Map()): DriverItem[] {
  const items: DriverItem[] = []
  const mk = (kind: DriverItem['kind'], key: string, sceneId: string): DriverItem => ({
    kind,
    key,
    sceneId,
    ref: JSON.stringify({ kind, key }),
    done: done.has(`${kind}|${key}`),
    failed: failed.get(`${kind}|${key}`) ?? null,
  })
  for (const s of scenes) items.push(mk('classify', truthKey(s), s))
  for (const s of scenes) {
    for (let i = 0; i < cellsPerScene; i++) {
      const key = `${s}|phone|image_only|m${i}`
      items.push(mk('interpret', key, s), mk('match', key, s), mk('classify', key, s), mk('score', key, s))
    }
  }
  return items
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

/** fake post: records order + concurrency; fails/fatals per configured ids */
function fakePost(opts: { fail?: Set<string>; fatal?: Set<string>; delayMs?: (item: DriverItem) => number } = {}) {
  const calls: string[] = []
  let inFlight = 0
  let maxInFlight = 0
  const post = async (item: DriverItem): Promise<PostResult> => {
    const id = itemId(item)
    calls.push(id)
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    await new Promise((r) => setTimeout(r, opts.delayMs ? opts.delayMs(item) : 1))
    inFlight--
    if (opts.fatal?.has(id)) return { ok: false, error: 'unauthorized', status: 401 }
    if (opts.fail?.has(id)) return { ok: false, error: `boom ${id}` }
    return { ok: true }
  }
  return { post, calls, maxInFlight: () => maxInFlight }
}

describe('dependenciesOf', () => {
  it('chains interpret → match → classify → score, score also waits for the scene truth', () => {
    const key = 's1|phone|image_only|m0'
    expect(dependenciesOf({ kind: 'interpret', key, sceneId: 's1', ref: '', done: false })).toEqual([])
    expect(dependenciesOf({ kind: 'match', key, sceneId: 's1', ref: '', done: false })).toEqual([`interpret|${key}`])
    expect(dependenciesOf({ kind: 'classify', key, sceneId: 's1', ref: '', done: false })).toEqual([`match|${key}`])
    expect(dependenciesOf({ kind: 'classify', key: truthKey('s1'), sceneId: 's1', ref: '', done: false })).toEqual([])
    expect(dependenciesOf({ kind: 'score', key, sceneId: 's1', ref: '', done: false })).toEqual([`classify|${key}`, `classify|s1|truth`])
  })
})

describe('driveRun — ordering', () => {
  it('runs every item once, in dependency order per cell, truth before score', async () => {
    const items = workList(['s1', 's2'], 2)
    const f = fakePost()
    const summary = await driveRunToEnd(items, { post: f.post, concurrency: 3 })
    expect(summary.stopped).toBe('finished')
    expect(summary.done).toBe(items.length)
    expect(summary.failed).toBe(0)
    expect(new Set(f.calls).size).toBe(items.length)
    const pos = (id: string) => f.calls.indexOf(id)
    for (const it of items) {
      for (const dep of dependenciesOf(it)) expect(pos(dep)).toBeLessThan(pos(itemId(it)))
    }
  })

  it('with concurrency 1 the order is exactly the work-list order (a cell completes before the next starts)', async () => {
    const items = workList(['s1'], 3)
    const f = fakePost()
    await driveRunToEnd(items, { post: f.post, concurrency: 1 })
    expect(f.calls).toEqual(items.map(itemId))
    expect(f.maxInFlight()).toBe(1)
  })
})

describe('driveRun — concurrency bound', () => {
  it('never exceeds the configured pool size and does use it', async () => {
    const items = workList(['s1', 's2', 's3', 's4'], 3)
    const f = fakePost({ delayMs: () => 3 })
    const summary = await driveRunToEnd(items, { post: f.post, concurrency: 4 })
    expect(summary.done).toBe(items.length)
    expect(f.maxInFlight()).toBeLessThanOrEqual(4)
    expect(f.maxInFlight()).toBeGreaterThan(1)
  })

  it('defaults to 4', async () => {
    const items = workList(['s1', 's2', 's3', 's4', 's5', 's6'], 2)
    const f = fakePost({ delayMs: () => 3 })
    await driveRunToEnd(items, { post: f.post })
    expect(f.maxInFlight()).toBeLessThanOrEqual(4)
    expect(f.maxInFlight()).toBe(4)
  })
})

describe('driveRun — failure isolation', () => {
  it('a failed interpret blocks only its own cell; every other cell completes', async () => {
    const items = workList(['s1', 's2'], 2)
    const badKey = 's1|phone|image_only|m0'
    const f = fakePost({ fail: new Set([`interpret|${badKey}`]) })
    const summary = await driveRunToEnd(items, { post: f.post, concurrency: 2 })
    expect(summary.stopped).toBe('finished')
    expect(summary.failed).toBe(1)
    expect(summary.blocked).toBe(3) // match, classify(estimate), score of the bad cell
    expect(summary.done).toBe(items.length - 4)
    // the blocked items were never posted
    for (const k of ['match', 'classify', 'score']) expect(f.calls).not.toContain(`${k}|${badKey}`)
    const blocked = summary.outcomes.filter((o) => o.state === 'blocked')
    expect(blocked.map((o) => o.item.kind).sort()).toEqual(['classify', 'match', 'score'])
    expect(blocked[0].error).toMatch(/^blocked: interpret failed — boom/)
  })

  it('a failed truth classification blocks every score of that scene, nothing else', async () => {
    const items = workList(['s1', 's2'], 2)
    const f = fakePost({ fail: new Set([`classify|${truthKey('s1')}`]) })
    const summary = await driveRunToEnd(items, { post: f.post, concurrency: 4 })
    expect(summary.failed).toBe(1)
    expect(summary.blocked).toBe(2)
    const blocked = summary.outcomes.filter((o) => o.state === 'blocked').map((o) => o.item)
    expect(blocked.every((i) => i.kind === 'score' && i.sceneId === 's1')).toBe(true)
    expect(summary.done).toBe(items.length - 3)
  })

  it('a throwing post is a per-item failure, not a crash', async () => {
    const items = workList(['s1'], 1)
    const post = async (item: DriverItem): Promise<PostResult> => {
      if (item.kind === 'match') throw new Error('network down')
      return { ok: true }
    }
    const summary = await driveRunToEnd(items, { post })
    expect(summary.failed).toBe(1)
    expect(summary.outcomes.find((o) => o.state === 'failed')?.error).toBe('network down')
    expect(summary.stopped).toBe('finished')
  })
})

describe('driveRun — stop on fatal', () => {
  it('a 401 stops dispatching; in-flight items finish; the rest stay queued', async () => {
    const items = workList(['s1', 's2', 's3'], 2)
    const f = fakePost({ fatal: new Set([`interpret|s1|phone|image_only|m0`]), delayMs: () => 2 })
    const summary = await driveRunToEnd(items, { post: f.post, concurrency: 1 })
    expect(summary.stopped).toBe('fatal')
    expect(summary.fatal).toBe('unauthorized')
    expect(f.calls.length).toBeLessThan(items.length)
    expect(summary.queued).toBeGreaterThan(0)
    expect(summary.running).toBe(0)
  })

  it('isFatal is injectable', async () => {
    const items = workList(['s1'], 2)
    const f = fakePost({ fail: new Set([`interpret|s1|phone|image_only|m0`]) })
    const summary = await driveRunToEnd(items, { post: f.post, concurrency: 1, isFatal: (r) => /boom/.test(r.error) })
    expect(summary.stopped).toBe('fatal')
  })
})

describe('driveRun — resume', () => {
  it('skips items already done on the work list and posts only the rest, deps satisfied by done items', async () => {
    const done = new Set<string>([
      `classify|${truthKey('s1')}`,
      'interpret|s1|phone|image_only|m0',
      'match|s1|phone|image_only|m0',
      'classify|s1|phone|image_only|m0',
      'score|s1|phone|image_only|m0',
      'interpret|s1|phone|image_only|m1',
    ])
    const items = workList(['s1'], 2, done)
    const f = fakePost()
    const summary = await driveRunToEnd(items, { post: f.post, concurrency: 2 })
    expect(summary.skipped).toBe(done.size)
    expect(summary.done).toBe(items.length - done.size)
    expect(f.calls).toEqual(['match|s1|phone|image_only|m1', 'classify|s1|phone|image_only|m1', 'score|s1|phone|image_only|m1'])
  })

  it('a fully done work list finishes immediately without posting', async () => {
    const items = workList(['s1'], 1)
    for (const it of items) it.done = true
    const f = fakePost()
    const summary = await driveRunToEnd(items, { post: f.post })
    expect(f.calls).toEqual([])
    expect(summary.stopped).toBe('finished')
    expect(summary.skipped).toBe(items.length)
  })

  it('`only` restricts the attempt set: re-run one failed cell, its truth already done', async () => {
    const failed = new Map([['interpret|s1|phone|image_only|m1', 'old error']])
    const done = new Set([`classify|${truthKey('s1')}`, 'interpret|s1|phone|image_only|m0', 'match|s1|phone|image_only|m0'])
    const items = workList(['s1'], 2, done, failed)
    expect([...failedKeys(items)]).toEqual(['s1|phone|image_only|m1'])
    const f = fakePost()
    const summary = await driveRunToEnd(items, { post: f.post, only: onlyKeys(failedKeys(items), items) })
    expect(f.calls).toEqual(['interpret|s1|phone|image_only|m1', 'match|s1|phone|image_only|m1', 'classify|s1|phone|image_only|m1', 'score|s1|phone|image_only|m1'])
    expect(summary.done).toBe(4)
    // cell m0's pending items were out of scope → skipped, not attempted
    expect(f.calls).not.toContain('classify|s1|phone|image_only|m0')
  })

  it('`only` with a failed truth widens to the scene (its scores were blocked, not failed)', async () => {
    const failed = new Map([[`classify|${truthKey('s1')}`, 'old error']])
    const done = new Set(['interpret|s1|phone|image_only|m0', 'match|s1|phone|image_only|m0', 'classify|s1|phone|image_only|m0'])
    const items = workList(['s1', 's2'], 1, done, failed)
    const f = fakePost()
    await driveRunToEnd(items, { post: f.post, only: onlyKeys(failedKeys(items), items), concurrency: 1 })
    expect(f.calls).toEqual([`classify|${truthKey('s1')}`, 'score|s1|phone|image_only|m0'])
  })
})

describe('driveRun — pause / resume / abort / progress', () => {
  it('pause stops dispatching, resume continues, and progress callbacks fire', async () => {
    const items = workList(['s1', 's2'], 2)
    const f = fakePost({ delayMs: () => 2 })
    const progress: number[] = []
    const h = driveRun(items, { post: f.post, concurrency: 1, onProgress: (p) => progress.push(p.done) })
    await tick()
    h.pause()
    const atPause = f.calls.length
    await new Promise((r) => setTimeout(r, 20))
    expect(f.calls.length).toBeLessThanOrEqual(atPause + 1) // at most the in-flight item finished
    expect(h.progress().paused).toBe(true)
    h.resume()
    const summary = await h.done
    expect(summary.done).toBe(items.length)
    expect(progress.at(-1)).toBe(items.length)
  })

  it('abort finishes with stopped=aborted and posts nothing more', async () => {
    const items = workList(['s1', 's2', 's3'], 2)
    const f = fakePost({ delayMs: () => 2 })
    const h = driveRun(items, { post: f.post, concurrency: 1 })
    await tick()
    h.abort()
    const summary = await h.done
    expect(summary.stopped).toBe('aborted')
    expect(f.calls.length).toBeLessThanOrEqual(1)
    expect(summary.queued).toBe(items.length - f.calls.length)
  })

  it('onItem fires running + settled per attempted item, and once per blocked item', async () => {
    const items = workList(['s1'], 2)
    const seen: string[] = []
    const f = fakePost({ fail: new Set(['match|s1|phone|image_only|m0']) })
    await driveRunToEnd(items, { post: f.post, onItem: (o) => seen.push(`${o.state}:${itemId(o.item)}`) })
    expect(seen.filter((s) => s.startsWith('failed:'))).toEqual(['failed:match|s1|phone|image_only|m0'])
    expect(seen.filter((s) => s.startsWith('blocked:')).sort()).toEqual(['blocked:classify|s1|phone|image_only|m0', 'blocked:score|s1|phone|image_only|m0'])
    expect(seen.filter((s) => s.startsWith('done:')).length).toBe(items.length - 3)
    expect(seen.filter((s) => s.startsWith('running:')).length).toBe(items.length - 2) // every posted item
  })
})

describe('helpers', () => {
  it('postResultFromResponse maps 2xx ok / errors / 401 fatal', () => {
    expect(postResultFromResponse(200, { ok: true })).toEqual({ ok: true })
    expect(postResultFromResponse(500, { error: 'x' })).toEqual({ ok: false, error: 'x', status: 500, fatal: false })
    expect(postResultFromResponse(401, { error: 'unauthorized' })).toMatchObject({ ok: false, fatal: true })
    expect(postResultFromResponse(502, null)).toMatchObject({ ok: false, error: 'HTTP 502' })
  })
  it('formatElapsed', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(65_000)).toBe('1:05')
    expect(formatElapsed(3_725_000)).toBe('1:02:05')
  })
})
