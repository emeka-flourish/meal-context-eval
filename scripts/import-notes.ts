/* Notes importer (intake v2, REBUILD-SPEC §5).

   Reads ${VANTAGE_DATA_DIR}/notes/all-notes.md and/or notes/<date>.md, splits
   the prose by day ("Aug 14" / "August 14" / "2026-08-14"), slot
   (Breakfast/Lunch/Dinner/Snack) and "Photo N:" block, attaches each block
   VERBATIM to the matching PhotoScene (date + slot + photo index), then drafts
   GtItems through the structurer (runners/gtStructure.ts — TAG-GUIDE.md as
   the system prompt; deterministic parser when no provider key). Hidden-fat
   checks and defaulted portions come back as QUESTIONS, printed, never
   answered here. Nothing is auto-confirmed.

   A block whose meal or scene does not exist yet creates a GT-only meal/scene
   (REBUILD-SPEC §3.1: "meal with GT but no photos — kept, shown as GT-only").

   Usage:
     pnpm tsx scripts/import-notes.ts                  # DRY RUN — split + draft preview
     pnpm tsx scripts/import-notes.ts --commit         # attach notes, write GtItems
     pnpm tsx scripts/import-notes.ts --only 2026-08-14 [--commit] [--redraft] [--mock]
   --redraft replaces existing GtItems of a scene (default: scenes that already
   have items are left alone — the owner's edits are never overwritten silently).
   --mock forces the deterministic structurer even when a provider key exists
   (no paid call; the LlmCall ledger row is stamped "[MOCK]").
   Env: VANTAGE_DATA_DIR, DATABASE_URL (.env), VANTAGE_STUDY_YEAR (default 2026). */
import 'dotenv/config'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { splitNotes, type NoteBlock } from '../src/lib/notes-split'
import { parseNotesToGtItems, type StructuredNotes } from '../src/lib/prose-parse'
import { structureSceneNotes } from '../src/runners/gtStructure'
import { sceneValidity, localDate, SLOT_DEFAULT_TIME, type Vantage } from '../src/lib/intake'
import { CONFIG } from '../src/lib/config'
import { keyPresent, providerFor } from '../src/lib/llm'

const DEFAULT_DATA_DIR = './data'

function parseArgs(argv: string[]) {
  const commit = argv.includes('--commit')
  const redraft = argv.includes('--redraft')
  const mock = argv.includes('--mock')
  const onlyIdx = argv.indexOf('--only')
  const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : undefined
  if (only && !/^\d{4}-\d{2}-\d{2}$/.test(only)) throw new Error(`--only expects YYYY-MM-DD, got "${only}"`)
  const dirIdx = argv.indexOf('--data-dir')
  const dataDir = dirIdx >= 0 ? argv[dirIdx + 1] : (process.env.VANTAGE_DATA_DIR ?? DEFAULT_DATA_DIR)
  const year = parseInt(process.env.VANTAGE_STUDY_YEAR ?? '2026', 10)
  return { commit, redraft, mock, only, dataDir, year }
}

/** all-notes.md first, then notes/<date>.md — a per-day file wins for its day. */
export function readNoteBlocks(notesDir: string, year: number): { blocks: NoteBlock[]; sources: string[]; warnings: string[] } {
  const blocks = new Map<string, NoteBlock>()
  const sources: string[] = []
  const warnings: string[] = []
  const key = (b: NoteBlock) => `${b.date}|${b.slot}|${b.photoIndex}`
  const all = join(notesDir, 'all-notes.md')
  if (existsSync(all)) {
    sources.push(all)
    const r = splitNotes(readFileSync(all, 'utf-8'), { defaultYear: year })
    warnings.push(...r.warnings.map((w) => `all-notes.md: ${w}`))
    for (const b of r.blocks) blocks.set(key(b), b)
  }
  if (existsSync(notesDir)) {
    for (const f of readdirSync(notesDir).sort()) {
      const m = f.match(/^(\d{4}-\d{2}-\d{2})\.md$/)
      if (!m) continue
      const path = join(notesDir, f)
      sources.push(path)
      const r = splitNotes(readFileSync(path, 'utf-8'), { defaultYear: year })
      warnings.push(...r.warnings.map((w) => `${f}: ${w}`))
      for (const [k, b] of [...blocks]) if (b.date === m[1]) blocks.delete(k) // per-day file wins
      for (const b of r.blocks) {
        if (b.date !== m[1]) warnings.push(`${f}: block dated ${b.date} inside a ${m[1]} file — kept as ${b.date}`)
        blocks.set(key(b), b)
      }
    }
  }
  return { blocks: [...blocks.values()], sources, warnings }
}

function printDraft(s: StructuredNotes, indent = '      ') {
  for (const i of s.items) {
    const grams = i.grams != null ? `${i.grams} g ${i.basis}` : '—'
    console.log(`${indent}${i.tag.padEnd(9)} ${i.name.padEnd(22)} ${grams.padEnd(18)} [${i.dish}]${i.state ? ` ${i.state}` : ''}${i.componentsNote ? ` · ${i.componentsNote}` : ''}`)
  }
  for (const q of s.questions) console.log(`${indent}? ${q}`)
  for (const d of s.dropped) console.log(`${indent}x dropped: ${d}`)
}

async function main() {
  const { commit, redraft, mock, only, dataDir, year } = parseArgs(process.argv.slice(2))
  const notesDir = join(dataDir, 'notes')
  const { blocks: allBlocks, sources, warnings } = readNoteBlocks(notesDir, year)
  const blocks = (only ? allBlocks.filter((b) => b.date === only) : allBlocks).sort(
    (a, b) => a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot) || a.photoIndex - b.photoIndex,
  )
  console.log(`${commit ? 'IMPORT' : 'DRY RUN'} · notes from ${sources.length ? sources.join(', ') : `${notesDir} (nothing found)`}${only ? ` · only ${only}` : ''}`)
  for (const w of warnings) console.log(`  ! ${w}`)
  if (blocks.length === 0) {
    console.log('no note blocks to import')
    return
  }
  const modelId = CONFIG.gtStructure.modelId
  if (mock) {
    // runLlm decides mock-vs-live by the provider key's presence at call time
    const keyEnv = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', google: 'GOOGLE_AI_API_KEY' }[providerFor(modelId)]
    delete process.env[keyEnv]
  }
  const live = keyPresent(modelId)
  console.log(`structurer: ${live ? modelId : `${modelId} ${mock ? '--mock' : 'has no key'} → deterministic parser (mock)`}; dry run always previews with the deterministic parser\n`)

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  const log: string[] = []
  const questionsByScene: { ref: string; questions: string[] }[] = []
  try {
    for (const b of blocks) {
      const ref = `${b.date} ${b.slot} photo ${b.photoIndex}`
      const dayStart = new Date(`${b.date}T00:00:00`)
      const meal = await db.meal.findFirst({
        where: { mealType: b.slot, eatenAt: { gte: dayStart, lt: new Date(dayStart.getTime() + 86400_000) } },
        orderBy: { createdAt: 'asc' },
      })
      const scene = meal
        ? await db.photoScene.findUnique({ where: { mealId_index: { mealId: meal.id, index: b.photoIndex } }, include: { gtItems: true, artifacts: true } })
        : null
      const state = !meal ? 'no meal → GT-only meal + scene will be created' : !scene ? 'no scene → GT-only scene will be created' : scene.notes === b.text ? 'notes unchanged' : scene.notes ? 'notes differ → will update' : 'notes missing → will attach'
      const hasItems = (scene?.gtItems.length ?? 0) > 0
      console.log(`${ref}  (${state}${hasItems ? `; ${scene!.gtItems.length} GtItems exist${redraft ? ' → redraft' : ' → kept'}` : ''})`)
      console.log(b.text.split('\n').map((l) => `    | ${l}`).join('\n'))

      if (!commit) {
        const preview = parseNotesToGtItems(b.text)
        printDraft(preview)
        console.log('')
        continue
      }

      // --- commit ---
      let mealId = meal?.id
      if (!mealId) {
        const created = await db.meal.create({ data: { eatenAt: new Date(`${b.date}T${SLOT_DEFAULT_TIME[b.slot]}:00`), mealType: b.slot } })
        mealId = created.id
        log.push(`+ GT-only meal ${b.date} ${b.slot} → ${created.id.slice(0, 8)}`)
      }
      let sceneId = scene?.id
      if (!sceneId) {
        const created = await db.photoScene.create({ data: { mealId, index: b.photoIndex, notes: b.text } })
        sceneId = created.id
        log.push(`+ scene ${ref} (GT-only) → ${created.id.slice(0, 8)}`)
      } else if (scene!.notes !== b.text) {
        await db.photoScene.update({ where: { id: sceneId }, data: { notes: b.text } })
        log.push(`~ notes ${scene!.notes ? 'updated' : 'attached'} on ${ref}`)
      }
      if (hasItems && !redraft) {
        log.push(`= GtItems kept on ${ref} (${scene!.gtItems.length}; use --redraft to replace)`)
      } else {
        const structured = await structureSceneNotes({ sceneId, prose: b.text })
        if (hasItems) {
          await db.gtItem.deleteMany({ where: { sceneId } })
          log.push(`- removed ${scene!.gtItems.length} GtItems on ${ref} (--redraft)`)
        }
        await db.gtItem.createMany({
          data: structured.items.map((i) => ({
            sceneId: sceneId!,
            dish: i.dish,
            name: i.name,
            grams: i.grams,
            basis: i.basis,
            tag: i.tag,
            state: i.state,
            componentsNote: i.componentsNote,
            order: i.order,
          })),
        })
        log.push(`+ ${structured.items.length} GtItems on ${ref} via ${structured.structurer}${structured.mocked ? ' (mock)' : ''}`)
        printDraft(structured)
        if (structured.questions.length) questionsByScene.push({ ref, questions: structured.questions })
      }
      // validity: notes now exist; vantages + confirmation decide the rest
      const full = await db.photoScene.findUniqueOrThrow({ where: { id: sceneId }, include: { artifacts: true } })
      const v = sceneValidity({
        artifacts: full.artifacts.map((a) => ({ vantage: (a.vantage ?? a.surface) as Vantage, excluded: a.excludeFromExport, guessed: a.vantageGuessed })),
        notes: full.notes,
        sameSceneConfirmed: full.sameSceneConfirmed,
        existingReason: full.exclusionReason,
      })
      if (full.valid !== v.valid || full.exclusionReason !== v.exclusionReason) {
        await db.photoScene.update({ where: { id: sceneId }, data: { valid: v.valid, exclusionReason: v.exclusionReason } })
      }
      console.log(`      → ${v.valid ? 'VALID' : `not valid: ${v.reasons.join(' · ')}`}${v.exclusionReason ? ` [${v.exclusionReason}]` : ''}\n`)
    }
    if (!commit) {
      console.log('(dry run — re-run with --commit to attach notes and write GtItems)')
      return
    }
    console.log('\nWhat I did:')
    for (const l of log) console.log(`  ${l}`)
    if (questionsByScene.length) {
      console.log('\nQuestions for the owner (not auto-answered):')
      for (const q of questionsByScene) for (const line of q.questions) console.log(`  ${q.ref}: ${line}`)
    }
    const totals = await Promise.all([db.photoScene.count({ where: { notes: { not: null } } }), db.gtItem.count()])
    console.log(`\nWhat I verified: ${totals[0]} scene(s) carry notes · ${totals[1]} GtItems in DB · date ${localDate(new Date())}`)
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
