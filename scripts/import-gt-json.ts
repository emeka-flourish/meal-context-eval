/* Import curated ground truth from ${VANTAGE_DATA_DIR}/notes/ground-truth-clarified.json.
   Use when the owner has clarified the notes by hand and the items should be taken
   exactly as written (no structurer model in between). Replaces the GtItems of every
   scene named in the file; scenes are found by local date + slot + photo index.

     pnpm tsx scripts/import-gt-json.ts            # dry run
     pnpm tsx scripts/import-gt-json.ts --commit

   File shape: { scenes: [{ date: "2026-08-14", slot: "lunch", photo: 1,
     items: [{ dish, name, grams|null, basis: weighed|estimated|converted|null,
               tag: core|secondary|garnish|spice|ignore, state|null, note|null }] }] } */
import 'dotenv/config'
import { readFileSync } from 'fs'
import { join } from 'path'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

type Item = { dish: string; name: string; grams: number | null; basis: 'weighed' | 'estimated' | 'converted' | null; tag: 'core' | 'secondary' | 'garnish' | 'spice' | 'ignore'; state: string | null; note: string | null; hidden?: boolean }
type Scene = { date: string; slot: 'breakfast' | 'lunch' | 'dinner' | 'snack'; photo: number; items: Item[] }

async function main() {
  const commit = process.argv.includes('--commit')
  const dir = process.env.VANTAGE_DATA_DIR ?? './data'
  const file = JSON.parse(readFileSync(join(dir, 'notes', 'ground-truth-clarified.json'), 'utf-8')) as { scenes: Scene[] }
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  let replaced = 0, missing = 0, items = 0
  for (const s of file.scenes) {
    const dayStart = new Date(`${s.date}T00:00:00`)
    const meal = await db.meal.findFirst({ where: { mealType: s.slot, eatenAt: { gte: dayStart, lt: new Date(dayStart.getTime() + 86400_000) } }, orderBy: { createdAt: 'asc' } })
    const scene = meal ? await db.photoScene.findUnique({ where: { mealId_index: { mealId: meal.id, index: s.photo } }, include: { _count: { select: { gtItems: true } } } }) : null
    const ref = `${s.date} ${s.slot} photo ${s.photo}`
    if (!scene) { console.log(`!! ${ref}: no scene in the database — skipped`); missing++; continue }
    for (const i of s.items) if ((i.tag === 'core' || i.tag === 'secondary') && i.grams == null) console.log(`   (identity only) ${ref}: ${i.name}`)
    console.log(`${commit ? '~' : '?'} ${ref}: ${scene._count.gtItems} → ${s.items.length} items`)
    if (!commit) continue
    await db.$transaction([
      db.gtItem.deleteMany({ where: { sceneId: scene.id } }),
      db.gtItem.createMany({ data: s.items.map((i, order) => ({ sceneId: scene.id, dish: i.dish, name: i.name, grams: i.grams, basis: i.grams == null ? null : i.basis, tag: i.tag, state: i.state, componentsNote: i.note, hidden: Boolean(i.hidden), order })) }),
    ])
    replaced++; items += s.items.length
  }
  console.log(`\n${commit ? `replaced ${replaced} scenes · ${items} items` : '(dry run — add --commit)'} · ${missing} scene(s) not found`)
  await db.$disconnect()
}
main().catch((e) => { console.error(e); process.exit(1) })
