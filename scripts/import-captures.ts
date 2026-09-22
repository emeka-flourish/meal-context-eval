/* Captures importer v2 (REBUILD-SPEC §5, intake mechanics).

   Reads ${VANTAGE_DATA_DIR}/captures:
     _unsorted/**                                   auto-group: EXIF time within
                                                    10 min = one scene; vantage from
                                                    camera model + size (iPhone
                                                    photos are "phone?" until confirmed)
     <YYYY-MM-DD>/<phone|glasses|tripod>/<slot>-imgN-*.HEIC
                                                    trusted placement; slot + photo
                                                    index N (= scene index) from the
                                                    filename; `fixed` folders/tokens
                                                    still mean tripod
     <YYYY-MM-DD>/_excluded/**                      imported with excludeFromExport=true

   Idempotent per file: Artifact.sourcePath (path under captures/) + sha256.
   Unchanged files are skipped, changed bytes re-converted, new files created.
   After import every touched scene's validity is recomputed (all three
   vantages present + notes + same-scene confirmed) and the reasons printed.

   Usage:
     pnpm tsx scripts/import-captures.ts                  # DRY RUN — prints the plan
     pnpm tsx scripts/import-captures.ts --commit         # imports
     pnpm tsx scripts/import-captures.ts --only 2026-08-14 [--commit]
   Env: VANTAGE_DATA_DIR (default ./data),
        DATABASE_URL (from .env). Never prints .env contents. */
import 'dotenv/config'
import { createHash, randomUUID } from 'crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { extractExifMeta } from '../src/lib/exif'
import { isHeic, heicToJpeg, heicDimensions } from '../src/lib/heic'
import { saveMedia } from '../src/lib/storage'
import {
  planImport,
  sceneValidity,
  localDate,
  SLOT_DEFAULT_TIME,
  VANTAGES,
  type ExistingArtifact,
  type PlannedScene,
  type ScannedFile,
  type Slot,
  type Vantage,
} from '../src/lib/intake'

export const DEFAULT_DATA_DIR = './data'
const IMAGE_EXT = /\.(heic|heif|jpe?g|png)$/i

function parseArgs(argv: string[]) {
  const commit = argv.includes('--commit')
  const onlyIdx = argv.indexOf('--only')
  const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : undefined
  if (only && !/^\d{4}-\d{2}-\d{2}$/.test(only)) throw new Error(`--only expects YYYY-MM-DD, got "${only}"`)
  const dirIdx = argv.indexOf('--data-dir')
  const dataDir = dirIdx >= 0 ? argv[dirIdx + 1] : (process.env.VANTAGE_DATA_DIR ?? DEFAULT_DATA_DIR)
  return { commit, only, dataDir }
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir).sort()) {
    if (e.startsWith('.')) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (IMAGE_EXT.test(e)) out.push(p)
  }
  return out
}

async function scan(root: string): Promise<ScannedFile[]> {
  const files: ScannedFile[] = []
  for (const abs of walk(root)) {
    const buf = readFileSync(abs)
    const meta = await extractExifMeta(buf)
    const dims = isHeic(abs, '') ? heicDimensions(buf) : null
    files.push({
      relPath: relative(root, abs).split(sep).join('/'),
      sha256: createHash('sha256').update(buf).digest('hex'),
      takenAt: meta.takenAt,
      camera: {
        make: meta.make,
        model: meta.model,
        // the container's primary-image size beats the EXIF field (glasses
        // files carry a stale 4032×3024 in EXIF; the ispe box says 2570×3425)
        width: dims?.width ?? meta.width,
        height: dims?.height ?? meta.height,
      },
    })
  }
  return files
}

type SceneRow = {
  id: string
  index: number
  notes: string | null
  sameSceneConfirmed: boolean
  exclusionReason: string | null
  artifacts: { vantage: Vantage | null; surface: Vantage; excludeFromExport: boolean; vantageGuessed: boolean; sourcePath: string | null }[]
}

async function loadExisting(db: PrismaClient): Promise<{ existing: Map<string, ExistingArtifact>; scenes: Map<string, SceneRow> }> {
  const rows = await db.artifact.findMany({
    where: { sourcePath: { not: null } },
    include: { meal: { select: { eatenAt: true, mealType: true } }, scene: true },
  })
  const existing = new Map<string, ExistingArtifact>()
  for (const a of rows) {
    if (!a.sourcePath || !a.scene || !a.meal.mealType) continue
    existing.set(a.sourcePath, {
      sourcePath: a.sourcePath,
      sha256: a.sha256,
      date: localDate(a.meal.eatenAt),
      slot: a.meal.mealType as Slot,
      index: a.scene.index,
    })
  }
  const sceneRows = await db.photoScene.findMany({
    include: { meal: { select: { eatenAt: true, mealType: true } }, artifacts: true },
  })
  const scenes = new Map<string, SceneRow>()
  for (const s of sceneRows) {
    if (!s.meal.mealType) continue
    scenes.set(`${localDate(s.meal.eatenAt)}|${s.meal.mealType}|${s.index}`, {
      id: s.id,
      index: s.index,
      notes: s.notes,
      sameSceneConfirmed: s.sameSceneConfirmed,
      exclusionReason: s.exclusionReason,
      artifacts: s.artifacts.map((a) => ({
        vantage: (a.vantage ?? a.surface) as Vantage,
        surface: a.surface as Vantage,
        excludeFromExport: a.excludeFromExport,
        vantageGuessed: a.vantageGuessed,
        sourcePath: a.sourcePath,
      })),
    })
  }
  return { existing, scenes }
}

/** Validity preview for a planned scene = planned files ∪ DB artifacts not in the plan. */
function previewValidity(scene: PlannedScene, db?: SceneRow) {
  const planned = new Set(scene.files.map((f) => f.relPath))
  const artifacts = [
    ...scene.files.map((f) => ({ vantage: f.vantage as Vantage | null, excluded: f.excluded, guessed: f.guessed })),
    ...(db?.artifacts ?? [])
      .filter((a) => !a.sourcePath || !planned.has(a.sourcePath))
      .map((a) => ({ vantage: a.vantage, excluded: a.excludeFromExport, guessed: a.vantageGuessed })),
  ]
  return sceneValidity({
    artifacts,
    notes: db?.notes ?? null,
    sameSceneConfirmed: db?.sameSceneConfirmed ?? false,
    existingReason: db?.exclusionReason ?? null,
  })
}

function printPlan(scenes: PlannedScene[], dbScenes: Map<string, SceneRow>) {
  let currentDate = ''
  const perDate = new Map<string, { scenes: number; valid: number; reasons: Map<string, number> }>()
  for (const s of scenes) {
    if (s.date !== currentDate) {
      currentDate = s.date
      console.log(`\n${s.date}`)
    }
    const present = new Map<Vantage, string>()
    for (const f of s.files) {
      const mark = f.excluded ? 'x' : f.guessed ? '?' : '✓'
      present.set(f.vantage, (present.get(f.vantage) ?? '') + mark)
    }
    const vant = VANTAGES.map((v) => `${v} ${present.get(v) ?? '–'}`).join('  ')
    const dbScene = dbScenes.get(`${s.date}|${s.slot}|${s.index}`)
    const validity = previewValidity(s, dbScene)
    console.log(`  ${s.slot.padEnd(9)} photo ${s.index}  [${s.source}${dbScene ? ', in DB' : ''}]  ${vant}`)
    for (const f of s.files) {
      const sym = f.action === 'new' ? '+' : f.action === 'changed' ? '~' : '='
      const flags = [f.excluded ? 'excluded' : '', f.guessed ? 'vantage guessed' : '', f.note ?? ''].filter(Boolean).join('; ')
      console.log(`      ${sym} ${f.relPath}${flags ? `  (${flags})` : ''}`)
    }
    console.log(`      → ${validity.valid ? 'VALID' : `not valid: ${validity.reasons.join(' · ')}`}${validity.exclusionReason ? `  [${validity.exclusionReason}]` : ''}`)
    const agg = perDate.get(s.date) ?? { scenes: 0, valid: 0, reasons: new Map() }
    agg.scenes++
    if (validity.valid) agg.valid++
    for (const r of validity.reasons) agg.reasons.set(r.split(':')[0], (agg.reasons.get(r.split(':')[0]) ?? 0) + 1)
    perDate.set(s.date, agg)
  }
  console.log('\nSummary (scenes per date · valid · reasons):')
  for (const [date, agg] of perDate) {
    const reasons = [...agg.reasons.entries()].map(([r, n]) => `${r} ×${n}`).join(', ')
    console.log(`  ${date}: ${agg.scenes} scene(s), ${agg.valid} valid${reasons ? ` — ${reasons}` : ''}`)
  }
}

async function findOrCreateMeal(db: PrismaClient, scene: PlannedScene, commitLog: string[]) {
  const dayStart = new Date(`${scene.date}T00:00:00`)
  const existing = await db.meal.findFirst({
    where: { mealType: scene.slot, eatenAt: { gte: dayStart, lt: new Date(dayStart.getTime() + 86400_000) } },
    orderBy: { createdAt: 'asc' },
  })
  if (existing) return existing
  const exifOnDay = scene.files
    .map((f) => f.takenAt)
    .filter((d): d is Date => d !== null && localDate(d) === scene.date)
    .sort((a, b) => a.getTime() - b.getTime())[0]
  const eatenAt = exifOnDay ?? new Date(`${scene.date}T${SLOT_DEFAULT_TIME[scene.slot]}:00`)
  const meal = await db.meal.create({ data: { eatenAt, mealType: scene.slot } })
  commitLog.push(`+ meal ${scene.date} ${scene.slot} @ ${eatenAt.toTimeString().slice(0, 5)}${exifOnDay ? ' (EXIF)' : ' (slot default)'} → ${meal.id.slice(0, 8)}`)
  return meal
}

async function recomputeValidity(db: PrismaClient, sceneId: string): Promise<{ valid: boolean; reasons: string[]; exclusionReason: string | null }> {
  const s = await db.photoScene.findUniqueOrThrow({ where: { id: sceneId }, include: { artifacts: true } })
  const v = sceneValidity({
    artifacts: s.artifacts.map((a) => ({ vantage: (a.vantage ?? a.surface) as Vantage, excluded: a.excludeFromExport, guessed: a.vantageGuessed })),
    notes: s.notes,
    sameSceneConfirmed: s.sameSceneConfirmed,
    existingReason: s.exclusionReason,
  })
  if (s.valid !== v.valid || s.exclusionReason !== v.exclusionReason) {
    await db.photoScene.update({ where: { id: sceneId }, data: { valid: v.valid, exclusionReason: v.exclusionReason } })
  }
  return v
}

async function importScene(db: PrismaClient, root: string, scene: PlannedScene, commitLog: string[]) {
  const meal = await findOrCreateMeal(db, scene, commitLog)
  let photoScene = await db.photoScene.findUnique({ where: { mealId_index: { mealId: meal.id, index: scene.index } } })
  if (!photoScene) {
    photoScene = await db.photoScene.create({ data: { mealId: meal.id, index: scene.index } })
    commitLog.push(`+ scene ${scene.date} ${scene.slot} photo ${scene.index} → ${photoScene.id.slice(0, 8)}`)
  }
  for (const f of scene.files) {
    if (f.action === 'unchanged') {
      // make sure an older import is linked to its scene
      const a = await db.artifact.findUnique({ where: { sourcePath: f.relPath } })
      if (a && (a.sceneId !== photoScene.id || a.vantage == null)) {
        await db.artifact.update({ where: { id: a.id }, data: { sceneId: photoScene.id, vantage: f.vantage } })
        commitLog.push(`~ linked ${f.relPath} to scene ${scene.index}`)
      }
      continue
    }
    let buf = readFileSync(join(root, f.relPath))
    let ext = f.relPath.split('.').pop()!.toLowerCase()
    let contentType = 'image/jpeg'
    if (isHeic(f.relPath, '')) {
      buf = await heicToJpeg(buf)
      ext = 'jpg'
    } else if (ext === 'png') contentType = 'image/png'
    const url = await saveMedia(buf, `captures/${randomUUID()}.${ext}`, contentType)
    const data = {
      mealId: meal.id,
      sceneId: photoScene.id,
      surface: f.vantage,
      vantage: f.vantage,
      vantageGuessed: f.guessed,
      sourcePath: f.relPath,
      sha256: f.sha256,
      blobUrl: url,
      exifTakenAt: f.takenAt,
      excludeFromExport: f.excluded,
    }
    if (f.action === 'changed') {
      await db.artifact.update({ where: { sourcePath: f.relPath }, data })
      commitLog.push(`~ re-imported ${f.relPath} (bytes changed)`)
    } else {
      await db.artifact.create({ data })
      commitLog.push(`+ artifact ${f.relPath} → ${f.vantage}${f.guessed ? '?' : ''}${f.excluded ? ' (excluded)' : ''}`)
    }
  }
  const validity = await recomputeValidity(db, photoScene.id)
  return { mealId: meal.id, sceneId: photoScene.id, validity }
}

async function main() {
  const { commit, only, dataDir } = parseArgs(process.argv.slice(2))
  const root = join(dataDir, 'captures')
  if (!existsSync(root)) throw new Error(`captures folder not found: ${root}`)
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  try {
    console.log(`${commit ? 'IMPORT' : 'DRY RUN'} · ${root}${only ? ` · only ${only}` : ''}`)
    const files = await scan(root)
    console.log(`scanned ${files.length} image file(s)`)
    const { existing, scenes: dbScenes } = await loadExisting(db)
    const plan = planImport(files, existing)
    const scenes = only ? plan.scenes.filter((s) => s.date === only) : plan.scenes
    printPlan(scenes, dbScenes)
    if (plan.unplaced.length) {
      console.log('\nUnplaced (stay in the tray):')
      for (const u of plan.unplaced) console.log(`  ! ${u.relPath} — ${u.reason}`)
    }
    const counts = { new: 0, changed: 0, unchanged: 0 }
    for (const s of scenes) for (const f of s.files) counts[f.action]++
    console.log(`\nfiles: ${counts.new} new · ${counts.changed} changed · ${counts.unchanged} unchanged`)
    if (!commit) {
      console.log('\n(dry run — re-run with --commit to import)')
      return
    }
    const log: string[] = []
    const results: { scene: PlannedScene; validity: { valid: boolean; reasons: string[]; exclusionReason: string | null } }[] = []
    for (const s of scenes) {
      const r = await importScene(db, root, s, log)
      results.push({ scene: s, validity: r.validity })
    }
    console.log('\nWhat I did:')
    for (const l of log) console.log(`  ${l}`)
    if (!log.length) console.log('  nothing — every file was already imported')
    console.log('\nWhat I verified (DB end state per scene):')
    for (const { scene, validity } of results) {
      console.log(
        `  ${scene.date} ${scene.slot} photo ${scene.index}: ${validity.valid ? 'VALID' : `not valid — ${validity.reasons.join(' · ')}`}${validity.exclusionReason ? ` [${validity.exclusionReason}]` : ''}`,
      )
    }
    const totals = await Promise.all([db.meal.count(), db.photoScene.count(), db.artifact.count({ where: { sourcePath: { not: null } } })])
    console.log(`\nDB totals: ${totals[0]} meals · ${totals[1]} scenes · ${totals[2]} imported artifacts`)
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
