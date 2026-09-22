/* CLI backup: `pnpm backup` — same full JSON dump as POST /api/backup,
   written to .data/backups/<timestamp>.json. */
import 'dotenv/config'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { dumpAllTables, backupStamp } from '../src/lib/backup'

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
})

async function main() {
  const dump = await dumpAllTables(db)
  const dir = join(process.cwd(), '.data', 'backups')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${backupStamp()}.json`)
  writeFileSync(file, JSON.stringify(dump, null, 2))
  const counts = Object.entries(dump.tables)
    .map(([t, rows]) => `${t}=${rows.length}`)
    .join(' ')
  console.log(`backup written: ${file}`)
  console.log(`rows: ${counts}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
