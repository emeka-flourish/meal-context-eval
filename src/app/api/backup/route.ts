import { NextResponse } from 'next/server'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { db } from '@/lib/db'
import { dumpAllTables, backupStamp } from '@/lib/backup'

// POST /api/backup — full JSON dump of every table: saved to
// .data/backups/<timestamp>.json AND returned as a direct download.

export async function POST() {
  const dump = await dumpAllTables(db)
  const json = JSON.stringify(dump, null, 2)
  const filename = `${backupStamp()}.json`
  const dir = path.join(process.cwd(), '.data', 'backups')
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, filename), json)
  return new NextResponse(json, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'X-Backup-Path': `.data/backups/${filename}`,
    },
  })
}
