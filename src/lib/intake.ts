// Intake v2 — pure planning logic for the captures importer (REBUILD-SPEC §5).
// No I/O: the script (scripts/import-captures.ts) scans the disk, reads EXIF
// and hashes, then hands everything here. Tested in intake.test.ts.
//
// Layout under ${VANTAGE_DATA_DIR}/captures:
//   _unsorted/**                        → auto-group by EXIF time (10 min = one scene)
//   <YYYY-MM-DD>/<phone|glasses|tripod>/<slot>-imgN-*.HEIC   → trusted placement
//   <YYYY-MM-DD>/_excluded/**           → imported with excludeFromExport=true
import { clusterArtifacts } from './clustering'

export type Vantage = 'phone' | 'glasses' | 'tripod'
export type Slot = 'breakfast' | 'lunch' | 'dinner' | 'snack'
export const VANTAGES: Vantage[] = ['phone', 'glasses', 'tripod']

/** The cameras the STUDY compares. A scene is valid only with one capture from each of these, and
    a run asks each of these per scene. Default: phone vs glasses. A third, stationary camera (tripod) is supported: its photos import and display.
    Override with STUDY_VANTAGES="phone,glasses,tripod". */
export const STUDY_VANTAGES: Vantage[] = (() => {
  const raw = (typeof process !== 'undefined' ? process.env.STUDY_VANTAGES : undefined) ?? 'phone,glasses'
  const out = raw.split(',').map((x) => x.trim()).filter((x): x is Vantage => (VANTAGES as string[]).includes(x))
  return out.length ? out : ['phone', 'glasses']
})()
export const SLOTS: Slot[] = ['breakfast', 'lunch', 'dinner', 'snack']

/** Auto-grouping window (REBUILD-SPEC §5): photos within 10 min = one scene. */
export const SCENE_WINDOW_MINUTES = 10

export const SLOT_DEFAULT_TIME: Record<Slot, string> = {
  breakfast: '08:00',
  lunch: '13:00',
  dinner: '19:30',
  snack: '16:00',
}

// ---- filenames --------------------------------------------------------------

/** Vantage token in a filename or folder name. `fixed` is the pre-v2 name of
    the tripod (old files still import). */
export function vantageFromToken(name: string): Vantage | null {
  const n = name.toLowerCase()
  if (/(^|[^a-z])(glasses|glass|meta|rayban|ray-ban|display|gen1|gen-1)([^a-z]|$)/.test(n)) return 'glasses'
  if (/(^|[^a-z])(fixed|tripod|mount|rig|webcam|cam)([^a-z]|$)/.test(n)) return 'tripod'
  if (/(^|[^a-z])(phone|iphone|mobile)([^a-z]|$)/.test(n)) return 'phone'
  return null
}

/** Folder segment → vantage. Only exact folder names are trusted. */
export function vantageFromFolder(segment: string): Vantage | null {
  const s = segment.toLowerCase()
  if (s === 'phone' || s === 'glasses' || s === 'tripod') return s
  if (s === 'fixed') return 'tripod'
  return null
}

export type ParsedFilename = {
  slot: Slot | null
  /** photo index = scene index; `breakfast-img2-…` → 2, `lunch-1.HEIC` → 1,
      no index token → 1 */
  index: number
  vantageToken: Vantage | null
}

/** `<slot>-imgN-<device>-augDD.HEIC`, `<slot>-N.HEIC`, `<slot>-<device>-augDD.HEIC`. */
export function parseCaptureFilename(name: string): ParsedFilename {
  const base = name.replace(/\.[^.]+$/, '')
  const m = base.match(/^(breakfast|lunch|dinner|snack)(?:[-_ ]?(?:img|image|photo|p)?[-_ ]?(\d+))?(?=$|[-_ .])/i)
  return {
    slot: m ? (m[1].toLowerCase() as Slot) : null,
    index: m && m[2] ? Math.max(1, parseInt(m[2], 10)) : 1,
    vantageToken: vantageFromToken(base),
  }
}

// ---- vantage detection (for _unsorted) ---------------------------------------

export type CameraMeta = {
  make?: string | null
  model?: string | null
  width?: number | null
  height?: number | null
}

export type VantageGuess = {
  vantage: Vantage
  /** true = phone-or-tripod could not be told apart ("phone?") — the scene
      carries exclusionReason=manual until confirmed in the UI */
  guessed: boolean
  reason: string
}

const GLASSES_MODEL = /meta|ray-?ban|glasses/i
const IPHONE_MODEL = /iphone|apple/i

/** Ray-Ban Meta stills are ≈2570×3430 portrait (measured 2570×3425 and
    2608×3477); iPhone 17 stills are 24 MP (5712×4284) or 12 MP (4032×3024)
    landscape, and phone vs tripod is the same camera — always a guess. */
export function detectVantage(meta: CameraMeta): VantageGuess {
  const model = `${meta.make ?? ''} ${meta.model ?? ''}`.trim()
  if (model && GLASSES_MODEL.test(model)) {
    return { vantage: 'glasses', guessed: false, reason: `camera model "${model}"` }
  }
  const w = meta.width ?? 0
  const h = meta.height ?? 0
  if (w && h) {
    const long = Math.max(w, h)
    const short = Math.min(w, h)
    const portrait = h > w
    if (portrait && Math.abs(short - 2570) <= 150 && Math.abs(long - 3430) <= 150) {
      return { vantage: 'glasses', guessed: false, reason: `${w}×${h} portrait ≈ glasses` }
    }
    if (model && IPHONE_MODEL.test(model)) {
      return { vantage: 'phone', guessed: true, reason: `camera model "${model}" ${w}×${h}: phone or tripod` }
    }
    if ((Math.abs(long - 5712) <= 50 && Math.abs(short - 4284) <= 50) || (Math.abs(long - 4032) <= 50 && Math.abs(short - 3024) <= 50)) {
      return { vantage: 'phone', guessed: true, reason: `${w}×${h} iPhone-sized: phone or tripod` }
    }
  }
  if (model && IPHONE_MODEL.test(model)) {
    return { vantage: 'phone', guessed: true, reason: `camera model "${model}": phone or tripod` }
  }
  return { vantage: 'phone', guessed: true, reason: 'no camera model or size — unknown device' }
}

// ---- time → slot --------------------------------------------------------------

/** Local-time slot guess for auto-grouped photos. Before 11:30 is breakfast,
    before 17:30 is lunch, later is dinner (late-eater defaults; adjust to taste). Snack is never guessed — the UI reassigns. */
export function slotFromTime(d: Date): Slot {
  const mins = d.getHours() * 60 + d.getMinutes()
  if (mins < 11 * 60 + 30) return 'breakfast'
  if (mins < 17 * 60 + 30) return 'lunch'
  return 'dinner'
}

export function localDate(d: Date): string {
  return d.toLocaleDateString('en-CA')
}

// ---- scene grouping -----------------------------------------------------------

/** Rolling window over capture times (same rule as clustering.ts, 10 min).
    Items without a time cannot be grouped and come back as singletons. */
export function groupScenes<T extends { id: string; takenAt: Date | null }>(
  items: T[],
  windowMinutes = SCENE_WINDOW_MINUTES,
): T[][] {
  const byId = new Map(items.map((i) => [i.id, i]))
  return clusterArtifacts(items, windowMinutes).map((ids) => ids.map((id) => byId.get(id)!))
}

// ---- planning -----------------------------------------------------------------

export type ScannedFile = {
  /** path relative to the captures root, posix separators — the Artifact.sourcePath key */
  relPath: string
  sha256: string
  takenAt: Date | null
  camera: CameraMeta
}

export type ExistingArtifact = {
  sourcePath: string
  sha256: string | null
  date: string
  slot: Slot
  index: number
}

export type PlannedFile = {
  relPath: string
  sha256: string
  vantage: Vantage
  guessed: boolean
  excluded: boolean
  takenAt: Date | null
  /** new = create; changed = same path, different bytes (re-convert); unchanged = skip */
  action: 'new' | 'changed' | 'unchanged'
  note?: string
}

export type PlannedScene = {
  date: string
  slot: Slot
  index: number
  source: 'trusted' | 'auto'
  files: PlannedFile[]
}

export type Unplaced = { relPath: string; reason: string }

export type Plan = { scenes: PlannedScene[]; unplaced: Unplaced[] }

function actionFor(file: ScannedFile, existing: Map<string, ExistingArtifact>): PlannedFile['action'] {
  const prior = existing.get(file.relPath)
  if (!prior) return 'new'
  return prior.sha256 === file.sha256 ? 'unchanged' : 'changed'
}

/** Build the import plan. `existing` = artifacts already in the DB keyed by
    sourcePath (idempotency). Trusted folders win; `_unsorted` is grouped by
    time; anything unplaceable is listed with a reason (it stays in the tray). */
export function planImport(files: ScannedFile[], existing: Map<string, ExistingArtifact> = new Map()): Plan {
  const scenes = new Map<string, PlannedScene>()
  const unplaced: Unplaced[] = []
  const key = (date: string, slot: Slot, index: number) => `${date}|${slot}|${index}`
  const sceneFor = (date: string, slot: Slot, index: number, source: PlannedScene['source']) => {
    const k = key(date, slot, index)
    if (!scenes.has(k)) scenes.set(k, { date, slot, index, source, files: [] })
    return scenes.get(k)!
  }

  const unsorted: ScannedFile[] = []
  for (const file of files) {
    const parts = file.relPath.split('/')
    const name = parts[parts.length - 1]
    if (parts[0] === '_unsorted') {
      unsorted.push(file)
      continue
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
      unplaced.push({ relPath: file.relPath, reason: `top folder "${parts[0]}" is not YYYY-MM-DD or _unsorted` })
      continue
    }
    const date = parts[0]
    const folders = parts.slice(1, -1)
    const excluded = folders.some((f) => f.toLowerCase() === '_excluded' || /^don'?t submit/i.test(f))
    const parsed = parseCaptureFilename(name)
    if (!parsed.slot) {
      unplaced.push({ relPath: file.relPath, reason: 'filename does not start with a slot (breakfast|lunch|dinner|snack)' })
      continue
    }
    // nearest vantage folder wins (…/tripod/x.HEIC, …/_excluded/glasses/x.HEIC), filename token second
    let vantage: Vantage | null = null
    for (let i = folders.length - 1; i >= 0 && !vantage; i--) vantage = vantageFromFolder(folders[i])
    vantage = vantage ?? parsed.vantageToken
    if (!vantage) {
      unplaced.push({ relPath: file.relPath, reason: 'no vantage folder (phone|glasses|tripod) and no device token in the filename' })
      continue
    }
    sceneFor(date, parsed.slot, parsed.index, 'trusted').files.push({
      relPath: file.relPath,
      sha256: file.sha256,
      vantage,
      guessed: false,
      excluded,
      takenAt: file.takenAt,
      action: actionFor(file, existing),
    })
  }

  // _unsorted: files already imported keep their scene; the rest cluster by time
  const fresh: (ScannedFile & { id: string })[] = []
  for (const file of unsorted) {
    const prior = existing.get(file.relPath)
    if (prior) {
      const guess = detectVantage(file.camera)
      sceneFor(prior.date, prior.slot, prior.index, 'auto').files.push({
        relPath: file.relPath,
        sha256: file.sha256,
        vantage: guess.vantage,
        guessed: guess.guessed,
        excluded: false,
        takenAt: file.takenAt,
        action: actionFor(file, existing),
        note: 'already placed',
      })
      continue
    }
    if (!file.takenAt) {
      unplaced.push({ relPath: file.relPath, reason: 'no EXIF time — move it by hand into <date>/<vantage>/' })
      continue
    }
    fresh.push({ ...file, id: file.relPath })
  }
  const nextIndex = new Map<string, number>()
  for (const s of scenes.values()) {
    const k = `${s.date}|${s.slot}`
    nextIndex.set(k, Math.max(nextIndex.get(k) ?? 0, s.index))
  }
  for (const e of existing.values()) {
    const k = `${e.date}|${e.slot}`
    nextIndex.set(k, Math.max(nextIndex.get(k) ?? 0, e.index))
  }
  for (const group of groupScenes(fresh)) {
    const first = group[0].takenAt!
    const date = localDate(first)
    const slot = slotFromTime(first)
    const k = `${date}|${slot}`
    const index = (nextIndex.get(k) ?? 0) + 1
    nextIndex.set(k, index)
    const scene = sceneFor(date, slot, index, 'auto')
    for (const file of group) {
      const guess = detectVantage(file.camera)
      scene.files.push({
        relPath: file.relPath,
        sha256: file.sha256,
        vantage: guess.vantage,
        guessed: guess.guessed,
        excluded: false,
        takenAt: file.takenAt,
        action: 'new',
        note: guess.reason,
      })
    }
  }

  const ordered = [...scenes.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot) || a.index - b.index,
  )
  for (const s of ordered) s.files.sort((a, b) => a.relPath.localeCompare(b.relPath))
  return { scenes: ordered, unplaced }
}

// ---- scene validity (METRICS.md "Scene validity") -----------------------------

export type SceneArtifactLike = { vantage: Vantage | null; excluded: boolean; guessed: boolean }

export type SceneValidity = {
  valid: boolean
  /** missing_vantage | no_notes | manual | different_plates | null (only the
      same-scene confirmation is outstanding) */
  exclusionReason: string | null
  reasons: string[]
}

/** valid iff all three vantages have a non-excluded, confidently-placed
    capture AND notes exist AND the same-scene check is confirmed.
    `different_plates` is a UI verdict and is never overwritten here. */
export function sceneValidity(input: {
  artifacts: SceneArtifactLike[]
  notes: string | null | undefined
  sameSceneConfirmed: boolean
  existingReason?: string | null
}): SceneValidity {
  const reasons: string[] = []
  const live = input.artifacts.filter((a) => !a.excluded && a.vantage)
  const counts = new Map<Vantage, number>()
  for (const a of live) counts.set(a.vantage!, (counts.get(a.vantage!) ?? 0) + 1)
  const missing = STUDY_VANTAGES.filter((v) => !counts.has(v))
  const excludedOnly = input.artifacts.length > 0 && live.length === 0
  if (excludedOnly) reasons.push('all captures owner-excluded')
  if (missing.length) reasons.push(`missing vantage: ${missing.join(', ')}`)
  const dup = [...counts.entries()].filter(([, n]) => n > 1).map(([v, n]) => `${v}×${n}`)
  if (dup.length) reasons.push(`duplicate vantage: ${dup.join(', ')}`)
  const guessed = live.filter((a) => a.guessed)
  if (guessed.length) reasons.push(`vantage guessed (phone?) on ${guessed.length} capture(s) — confirm`)
  const hasNotes = Boolean(input.notes && input.notes.trim())
  if (!hasNotes) reasons.push('no notes for this photo')
  if (input.existingReason === 'different_plates') reasons.push('marked different plates')
  if (!input.sameSceneConfirmed) reasons.push('same-scene check not confirmed')

  let exclusionReason: string | null = null
  if (input.existingReason === 'different_plates') exclusionReason = 'different_plates'
  else if (missing.length || excludedOnly) exclusionReason = 'missing_vantage'
  else if (!hasNotes) exclusionReason = 'no_notes'
  else if (guessed.length || dup.length) exclusionReason = 'manual'
  return { valid: reasons.length === 0, exclusionReason, reasons }
}
