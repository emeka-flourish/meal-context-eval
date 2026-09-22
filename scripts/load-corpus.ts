/* Corpus loader (docs/CORPUS.md §1): meal-history export → CorpusMeal / CorpusDish /
   CorpusIngredient. Pure mapping in src/lib/corpus/load.ts; this file owns I/O.

   Input, in order of preference:
     ${VANTAGE_DATA_DIR}/corpus/history/meals.jsonl   (one JSON meal record per line;
                                                        may carry imageFile, see docs/CORPUS.md)
     --csv <CSV export>                                     (default: meals.csv in
                                                        the same folder; imageFile stays null)
   Idempotent by sourceMealId: new meals are created with their dishes and
   ingredients; existing meals only get their scalars refreshed (imageFile /
   imageSha256 are picked up on a re-run once images exist). tier / excluded
   are annotation-owned and never touched. Any localDate on/after CORPUS_CUTOFF_EXCLUSIVE (env; the first day of
   your test captures) aborts the whole load, so history can never leak test days.

   Usage:
     pnpm tsx scripts/load-corpus.ts                     # DRY RUN — plan + counts
     pnpm tsx scripts/load-corpus.ts --commit            # writes
     pnpm tsx scripts/load-corpus.ts --csv path.csv --commit
   Env: VANTAGE_DATA_DIR, DATABASE_URL (from .env; never printed). */
import 'dotenv/config'
import { existsSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { parseCsvRecords } from './lib/csv-parse'
import {
  CutoffError,
  csvRowToRecord,
  mapMeal,
  planMeal,
  summarize,
  type CorpusMealInput,
  type ExistingMeal,
  type MealRecord,
  type PlanEntry,
} from '../src/lib/corpus/load'

const DEFAULT_DATA_DIR = './data'
const DEFAULT_CSV = 'meals.csv'

function parseArgs(argv: string[]) {
  const commit = argv.includes('--commit')
  const at = (flag: string) => {
    const i = argv.indexOf(flag)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const dataDir = at('--data-dir') ?? process.env.VANTAGE_DATA_DIR ?? DEFAULT_DATA_DIR
  const corpusDir = join(dataDir, 'corpus', 'history')
  const jsonl = at('--jsonl') ?? join(corpusDir, 'meals.jsonl')
  const csv = at('--csv') ?? join(corpusDir, DEFAULT_CSV)
  return { commit, jsonl: resolve(jsonl), csv: resolve(csv) }
}

function readRecords(jsonl: string, csv: string): { source: string; records: MealRecord[] } {
  if (existsSync(jsonl)) {
    const byId = new Map<string, MealRecord>()
    for (const line of readFileSync(jsonl, 'utf8').split('\n')) {
      const t = line.trim()
      if (!t) continue
      const rec = JSON.parse(t) as MealRecord
      if (rec && typeof rec.mealId === 'string') byId.set(rec.mealId, rec) // last line wins
    }
    return { source: jsonl, records: [...byId.values()] }
  }
  if (!existsSync(csv)) throw new Error(`neither ${jsonl} nor ${csv} exists`)
  const rows = parseCsvRecords(readFileSync(csv, 'utf8'))
  return { source: csv, records: rows.map(csvRowToRecord) }
}

const toDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`)

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const { source, records } = readRecords(args.jsonl, args.csv)
  console.log(`${args.commit ? 'LOAD' : 'DRY RUN'} ${source}: ${records.length} record(s)`)

  const meals: CorpusMealInput[] = []
  const refused: string[] = []
  for (const rec of records) {
    try {
      meals.push(mapMeal(rec))
    } catch (e) {
      if (e instanceof CutoffError) refused.push(`${e.mealId} (${e.localDate})`)
      else throw e
    }
  }
  if (refused.length) {
    console.error(`REFUSED: ${refused.length} meal(s) on/after the cutoff — nothing loaded:\n  ${refused.join('\n  ')}`)
    process.exit(2)
  }

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/meal_context_eval' }) })
  try {
    const existingRows = await db.corpusMeal.findMany({
      select: { sourceMealId: true, name: true, description: true, servingSize: true, imageFile: true, imageSha256: true, _count: { select: { dishes: true } } },
    })
    const existing = new Map<string, ExistingMeal>(existingRows.map((r) => [r.sourceMealId, { ...r, dishCount: r._count.dishes }]))
    const plan: PlanEntry[] = meals.map((m) => planMeal(m, existing.get(m.sourceMealId)))
    const s = summarize(meals, plan)
    console.log(
      [
        `meals ${s.meals} (create ${s.create} · update ${s.update} · unchanged ${s.unchanged}) · dishes ${s.dishes} · ingredients ${s.ingredients}`,
        `window ${s.dateRange?.start} → ${s.dateRange?.end} · with image file ${s.withImage}`,
        `slot: breakfast ${s.bySlot.breakfast} · lunch ${s.bySlot.lunch} · dinner ${s.bySlot.dinner} · snack ${s.bySlot.snack}`,
        `portion prefill: small ${s.byPortionClass.small} · usual ${s.byPortionClass.usual} · large ${s.byPortionClass.large}`,
        `gramsEst: unit_table ${s.gramsBySource.unit_table} · app_estimate ${s.gramsBySource.app_estimate} · none ${s.gramsBySource.none}`,
      ].join('\n'),
    )
    if (!args.commit) {
      console.log('dry run — pass --commit to write')
      return
    }

    let created = 0
    let updated = 0
    for (const p of plan) {
      if (p.action === 'create') {
        const m = p.meal
        await db.corpusMeal.create({
          data: {
            sourceMealId: m.sourceMealId,
            localDate: toDate(m.localDate),
            localTime: m.localTime,
            slot: m.slot,
            name: m.name,
            description: m.description,
            servingSize: m.servingSize,
            portionClassPrefill: m.portionClassPrefill,
            imageFile: m.imageFile,
            imageSha256: m.imageSha256,
            tier: m.tier,
            dishes: {
              create: m.dishes.map((d) => ({
                name: d.name,
                description: d.description,
                preparation: d.preparation,
                servingSize: d.servingSize,
                order: d.order,
                ingredients: { create: d.ingredients },
              })),
            },
          },
        })
        created++
      } else if (p.action === 'update') {
        await db.corpusMeal.update({ where: { sourceMealId: p.sourceMealId }, data: p.patch })
        updated++
      }
    }
    const [nMeals, nDishes, nIngr, nImg] = await Promise.all([
      db.corpusMeal.count(),
      db.corpusDish.count(),
      db.corpusIngredient.count(),
      db.corpusMeal.count({ where: { imageFile: { not: null } } }),
    ])
    console.log(`written: created ${created} · updated ${updated}`)
    console.log(`DB now: CorpusMeal ${nMeals} · CorpusDish ${nDishes} · CorpusIngredient ${nIngr} · with imageFile ${nImg}`)
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
