/* One-off: convert any stored .heic artifacts to .jpg in place (pre-fix uploads). */
import 'dotenv/config'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { extractTakenAt } from '../src/lib/exif'
import { heicToJpeg } from '../src/lib/heic'

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
})

async function main() {
  const artifacts = await db.artifact.findMany({
    where: { blobUrl: { endsWith: '.heic' } },
  })
  console.log(`${artifacts.length} .heic artifact(s) to migrate`)
  for (const a of artifacts) {
    const key = a.blobUrl!.replace('/api/media/', '')
    const path = join(process.cwd(), '.data/media', key)
    const buf = readFileSync(path)
    const exif = await extractTakenAt(buf)
    console.log(
      `  ${key}: exifTakenAt=${exif?.toISOString() ?? 'null'} (db has ${a.exifTakenAt?.toISOString() ?? 'null'})`,
    )
    const jpeg = await heicToJpeg(buf)
    const newKey = key.replace(/\.heic$/, '.jpg')
    writeFileSync(join(process.cwd(), '.data/media', newKey), jpeg)
    await db.artifact.update({
      where: { id: a.id },
      data: {
        blobUrl: `/api/media/${newKey}`,
        // backfill EXIF if the original upload missed it
        ...(exif && !a.exifTakenAt ? { exifTakenAt: exif } : {}),
      },
    })
    console.log(`  -> ${newKey} (${jpeg.length} bytes)`)
  }
}
main().finally(() => db.$disconnect())
