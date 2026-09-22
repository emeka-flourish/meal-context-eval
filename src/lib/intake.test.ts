import { describe, it, expect } from 'vitest'
import {
  parseCaptureFilename,
  vantageFromFolder,
  vantageFromToken,
  detectVantage,
  slotFromTime,
  groupScenes,
  planImport,
  sceneValidity,
  type ScannedFile,
  type ExistingArtifact,
} from './intake'

const at = (iso: string) => new Date(iso) // local time when no zone suffix

describe('parseCaptureFilename — slot + photo index + device token', () => {
  it('reads slot, imgN index and device from the real naming', () => {
    expect(parseCaptureFilename('breakfast-img2-glasses-aug14.HEIC')).toEqual({ slot: 'breakfast', index: 2, vantageToken: 'glasses' })
    expect(parseCaptureFilename('dinner-img1-fixed-aug12.HEIC')).toEqual({ slot: 'dinner', index: 1, vantageToken: 'tripod' })
    expect(parseCaptureFilename('lunch-img1-phone-aug13.HEIC')).toEqual({ slot: 'lunch', index: 1, vantageToken: 'phone' })
  })
  it('accepts the short fallback names from data/README (breakfast-1.HEIC) and no index at all', () => {
    expect(parseCaptureFilename('breakfast-1.HEIC')).toMatchObject({ slot: 'breakfast', index: 1 })
    expect(parseCaptureFilename('snack-3.jpg')).toMatchObject({ slot: 'snack', index: 3 })
    expect(parseCaptureFilename('lunch-glasses-aug10.HEIC')).toMatchObject({ slot: 'lunch', index: 1, vantageToken: 'glasses' })
    expect(parseCaptureFilename('breakfast-1-glasses-aug10.HEIC')).toMatchObject({ slot: 'breakfast', index: 1, vantageToken: 'glasses' })
  })
  it('returns null slot for unrelated names', () => {
    expect(parseCaptureFilename('IMG_4021.HEIC').slot).toBeNull()
    expect(parseCaptureFilename('lunchbox.HEIC').slot).toBeNull()
  })
})

describe('vantage folders / tokens', () => {
  it('trusts exact folder names and maps fixed → tripod', () => {
    expect(vantageFromFolder('phone')).toBe('phone')
    expect(vantageFromFolder('Glasses')).toBe('glasses')
    expect(vantageFromFolder('tripod')).toBe('tripod')
    expect(vantageFromFolder('fixed')).toBe('tripod')
    expect(vantageFromFolder('_excluded')).toBeNull()
  })
  it('token fallback', () => {
    expect(vantageFromToken('x-rayban-y')).toBe('glasses')
    expect(vantageFromToken('x-iphone-y')).toBe('phone')
    expect(vantageFromToken('nothing')).toBeNull()
  })
})

describe('detectVantage — camera model + resolution', () => {
  it('Ray-Ban Meta model → glasses, confident', () => {
    const g = detectVantage({ make: 'Meta AI', model: 'Ray-Ban Meta Smart Glasses', width: 4032, height: 3024 })
    expect(g).toMatchObject({ vantage: 'glasses', guessed: false })
  })
  it('≈2570×3430 portrait with no model → glasses, confident', () => {
    expect(detectVantage({ width: 2570, height: 3425 })).toMatchObject({ vantage: 'glasses', guessed: false })
    expect(detectVantage({ width: 2608, height: 3477 })).toMatchObject({ vantage: 'glasses', guessed: false })
  })
  it('iPhone 24 MP / 12 MP landscape → phone, GUESSED (phone or tripod)', () => {
    expect(detectVantage({ make: 'Apple', model: 'iPhone 17 Pro Max', width: 5712, height: 4284 })).toMatchObject({ vantage: 'phone', guessed: true })
    expect(detectVantage({ width: 4032, height: 3024 })).toMatchObject({ vantage: 'phone', guessed: true })
  })
  it('nothing known → phone guessed with a reason', () => {
    const g = detectVantage({})
    expect(g.guessed).toBe(true)
    expect(g.reason).toMatch(/unknown/)
  })
})

describe('slotFromTime — local-time slot guess', () => {
  it('matches typical capture hours', () => {
    expect(slotFromTime(at('2026-08-14T09:05:00'))).toBe('breakfast')
    expect(slotFromTime(at('2026-08-12T13:00:00'))).toBe('lunch')
    expect(slotFromTime(at('2026-08-14T17:00:00'))).toBe('lunch')
    expect(slotFromTime(at('2026-08-13T19:45:00'))).toBe('dinner')
  })
})

describe('groupScenes — 10-minute rolling window', () => {
  const f = (id: string, iso: string) => ({ id, takenAt: at(iso) })
  it('phone, glasses and tripod shots 30 s apart are one scene', () => {
    const g = groupScenes([f('p', '2026-08-14T10:53:10'), f('g', '2026-08-14T10:53:25'), f('t', '2026-08-14T10:53:45')])
    expect(g.map((s) => s.map((x) => x.id))).toEqual([['p', 'g', 't']])
  })
  it('a second photo 12 minutes later is a second scene (Aug 14 breakfast img1/img2)', () => {
    const g = groupScenes([f('a', '2026-08-14T10:53:10'), f('b', '2026-08-14T11:05:09')])
    expect(g).toHaveLength(2)
  })
  it('9 minutes apart stays together; the window rolls along a chain', () => {
    expect(groupScenes([f('a', '2026-08-14T10:00:00'), f('b', '2026-08-14T10:09:00'), f('c', '2026-08-14T10:18:00')])).toHaveLength(1)
  })
  it('no timestamp → own group', () => {
    expect(groupScenes([f('a', '2026-08-14T10:00:00'), { id: 'x', takenAt: null }])).toHaveLength(2)
  })
})

const file = (relPath: string, extra: Partial<ScannedFile> = {}): ScannedFile => ({
  relPath,
  sha256: `sha-${relPath}`,
  takenAt: null,
  camera: {},
  ...extra,
})

describe('planImport — trusted folders', () => {
  it('places date/vantage/slot-imgN files into scenes; _excluded imports as excluded', () => {
    const plan = planImport([
      file('2026-08-14/phone/breakfast-img1-phone-aug14.HEIC'),
      file('2026-08-14/glasses/breakfast-img1-glasses-aug14.HEIC'),
      file('2026-08-14/tripod/breakfast-img1-fixed-aug14.HEIC'),
      file('2026-08-14/tripod/breakfast-img2-fixed-aug14.HEIC'),
      file('2026-08-10/_excluded/glasses/lunch-glasses-aug10.HEIC'),
      file('2026-08-10/_excluded/phone/lunch-phone-aug10.HEIC'),
    ])
    expect(plan.unplaced).toEqual([])
    expect(plan.scenes.map((s) => `${s.date} ${s.slot} ${s.index} ${s.source}`)).toEqual([
      '2026-08-10 lunch 1 trusted',
      '2026-08-14 breakfast 1 trusted',
      '2026-08-14 breakfast 2 trusted',
    ])
    const b1 = plan.scenes[1]
    expect(b1.files.map((f) => f.vantage).sort()).toEqual(['glasses', 'phone', 'tripod'])
    expect(b1.files.every((f) => !f.guessed && !f.excluded && f.action === 'new')).toBe(true)
    expect(plan.scenes[0].files.every((f) => f.excluded)).toBe(true)
    expect(plan.scenes[0].files.map((f) => f.vantage).sort()).toEqual(['glasses', 'phone'])
  })
  it('reports unplaceable files with a reason instead of dropping them', () => {
    const plan = planImport([file('2026-08-14/phone/IMG_1.HEIC'), file('2026-08-14/breakfast-img1.HEIC'), file('random/x.HEIC')])
    expect(plan.scenes).toEqual([])
    expect(plan.unplaced.map((u) => u.relPath)).toEqual(['2026-08-14/phone/IMG_1.HEIC', '2026-08-14/breakfast-img1.HEIC', 'random/x.HEIC'])
    expect(plan.unplaced[1].reason).toMatch(/no vantage/)
  })
})

describe('planImport — _unsorted auto-grouping', () => {
  const glasses = { make: 'Meta AI', model: 'Ray-Ban Meta Smart Glasses', width: 2570, height: 3425 }
  const iphone = { make: 'Apple', model: 'iPhone 17 Pro Max', width: 5712, height: 4284 }
  it('groups by time, picks date + slot from the first photo, vantage from camera, flags iPhone as guessed', () => {
    const plan = planImport([
      file('_unsorted/IMG_1.HEIC', { takenAt: at('2026-08-14T10:53:10'), camera: iphone }),
      file('_unsorted/IMG_2.HEIC', { takenAt: at('2026-08-14T10:53:25'), camera: glasses }),
      file('_unsorted/IMG_3.HEIC', { takenAt: at('2026-08-14T10:53:45'), camera: iphone }),
      file('_unsorted/IMG_4.HEIC', { takenAt: at('2026-08-14T11:05:09'), camera: glasses }),
      file('_unsorted/IMG_5.HEIC', { takenAt: at('2026-08-14T21:30:00'), camera: iphone }),
      file('_unsorted/noexif.HEIC'),
    ])
    expect(plan.scenes.map((s) => `${s.date} ${s.slot} ${s.index} ${s.source}`)).toEqual([
      '2026-08-14 breakfast 1 auto',
      '2026-08-14 breakfast 2 auto',
      '2026-08-14 dinner 1 auto',
    ])
    const s1 = plan.scenes[0]
    expect(s1.files.map((f) => `${f.vantage}${f.guessed ? '?' : ''}`).sort()).toEqual(['glasses', 'phone?', 'phone?'])
    expect(plan.unplaced).toEqual([{ relPath: '_unsorted/noexif.HEIC', reason: expect.stringMatching(/no EXIF time/) }])
  })
  it('auto scenes continue the index after trusted scenes of the same meal', () => {
    const plan = planImport([
      file('2026-08-14/phone/breakfast-img1-phone-aug14.HEIC'),
      file('_unsorted/IMG_9.HEIC', { takenAt: at('2026-08-14T11:05:09'), camera: glasses }),
    ])
    expect(plan.scenes.map((s) => `${s.slot} ${s.index} ${s.source}`)).toEqual(['breakfast 1 trusted', 'breakfast 2 auto'])
  })
})

describe('planImport — idempotency by sourcePath + sha256', () => {
  const existing = new Map<string, ExistingArtifact>([
    ['2026-08-14/phone/lunch-img1-phone-aug14.HEIC', { sourcePath: '2026-08-14/phone/lunch-img1-phone-aug14.HEIC', sha256: 'sha-2026-08-14/phone/lunch-img1-phone-aug14.HEIC', date: '2026-08-14', slot: 'lunch', index: 1 }],
    ['2026-08-14/glasses/lunch-img1-glasses-aug14.HEIC', { sourcePath: '2026-08-14/glasses/lunch-img1-glasses-aug14.HEIC', sha256: 'OLD', date: '2026-08-14', slot: 'lunch', index: 1 }],
    ['_unsorted/IMG_7.HEIC', { sourcePath: '_unsorted/IMG_7.HEIC', sha256: 'sha-_unsorted/IMG_7.HEIC', date: '2026-08-14', slot: 'lunch', index: 2 }],
  ])
  it('unchanged bytes → unchanged; changed bytes → changed; new path → new', () => {
    const plan = planImport(
      [
        file('2026-08-14/phone/lunch-img1-phone-aug14.HEIC'),
        file('2026-08-14/glasses/lunch-img1-glasses-aug14.HEIC'),
        file('2026-08-14/tripod/lunch-img1-fixed-aug14.HEIC'),
      ],
      existing,
    )
    const actions = Object.fromEntries(plan.scenes[0].files.map((f) => [f.vantage, f.action]))
    expect(actions).toEqual({ phone: 'unchanged', glasses: 'changed', tripod: 'new' })
  })
  it('an _unsorted file already placed keeps its scene instead of being re-clustered; new ones continue the index', () => {
    const plan = planImport(
      [
        file('_unsorted/IMG_7.HEIC', { takenAt: at('2026-08-14T15:20:00'), camera: { model: 'iPhone 17 Pro Max' } }),
        file('_unsorted/IMG_8.HEIC', { takenAt: at('2026-08-14T15:40:00'), camera: { model: 'iPhone 17 Pro Max' } }),
      ],
      existing,
    )
    expect(plan.scenes.map((s) => `${s.slot} ${s.index}`)).toEqual(['lunch 2', 'lunch 3'])
    expect(plan.scenes[0].files[0].action).toBe('unchanged')
    expect(plan.scenes[1].files[0].action).toBe('new')
  })
})

describe('sceneValidity — METRICS.md scene validity', () => {
  const all = [
    { vantage: 'phone' as const, excluded: false, guessed: false },
    { vantage: 'glasses' as const, excluded: false, guessed: false },
    { vantage: 'tripod' as const, excluded: false, guessed: false },
  ]
  it('valid with every STUDY vantage (phone + glasses since 2026-09-19; tripod optional) + notes + same-scene confirmed', () => {
    expect(sceneValidity({ artifacts: all, notes: 'Salmon - 199 g', sameSceneConfirmed: true })).toEqual({ valid: true, exclusionReason: null, reasons: [] })
  })
  it('missing vantage → missing_vantage', () => {
    // phone + glasses without the tripod is a valid study scene
    expect(sceneValidity({ artifacts: all.slice(0, 2), notes: 'x', sameSceneConfirmed: true }).valid).toBe(true)
    const v = sceneValidity({ artifacts: [all[0], all[2]], notes: 'x', sameSceneConfirmed: true })
    expect(v.valid).toBe(false)
    expect(v.exclusionReason).toBe('missing_vantage')
    expect(v.reasons[0]).toMatch(/glasses/)
  })
  it('excluded captures do not count as present', () => {
    const v = sceneValidity({ artifacts: all.map((a) => ({ ...a, excluded: true })), notes: 'x', sameSceneConfirmed: true })
    expect(v.exclusionReason).toBe('missing_vantage')
    expect(v.reasons).toContain('all captures owner-excluded')
  })
  it('no notes → no_notes; unconfirmed same-scene alone → not valid but no exclusion reason yet', () => {
    expect(sceneValidity({ artifacts: all, notes: null, sameSceneConfirmed: true }).exclusionReason).toBe('no_notes')
    const pending = sceneValidity({ artifacts: all, notes: 'x', sameSceneConfirmed: false })
    expect(pending).toMatchObject({ valid: false, exclusionReason: null })
    expect(pending.reasons).toEqual(['same-scene check not confirmed'])
  })
  it('a guessed (phone?) vantage → manual until confirmed; different_plates from the UI is preserved', () => {
    const guessed = [...all.slice(0, 2), { ...all[2], guessed: true }]
    expect(sceneValidity({ artifacts: guessed, notes: 'x', sameSceneConfirmed: true }).exclusionReason).toBe('manual')
    expect(sceneValidity({ artifacts: all, notes: 'x', sameSceneConfirmed: true, existingReason: 'different_plates' })).toMatchObject({ valid: false, exclusionReason: 'different_plates' })
  })
})
