import { NextRequest, NextResponse } from 'next/server'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import path from 'path'
import { Readable } from 'stream'
import { db } from '@/lib/db'

// GET /api/corpus/ui/image/[mealId] — the logged photo of one corpus meal,
// streamed read-only from ${VANTAGE_DATA_DIR}/corpus/history/images/ (the
// image step writes `<mealId>.<ext>` there; CorpusMeal.imageFile holds the
// file name, with or without the `images/` prefix). 404 when the meal has no
// photo or the file is missing; the path never leaves the images folder.
export const dynamic = 'force-dynamic'

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  gif: 'image/gif',
}

function imagesDir(): string {
  const dataDir = process.env.VANTAGE_DATA_DIR || path.resolve(process.cwd(), 'data')
  return path.resolve(dataDir, 'corpus', 'history', 'images')
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ mealId: string }> }) {
  const { mealId } = await params
  const meal = await db.corpusMeal.findUnique({ where: { id: mealId }, select: { imageFile: true, imageSha256: true } })
  if (!meal?.imageFile) return NextResponse.json({ error: 'no photo for this meal' }, { status: 404 })

  const root = imagesDir()
  const rel = meal.imageFile.replace(/^images[\\/]/, '')
  const filePath = path.resolve(root, rel)
  if (!filePath.startsWith(root + path.sep)) return NextResponse.json({ error: 'not found' }, { status: 404 })

  let size: number
  try {
    const s = await stat(filePath)
    if (!s.isFile()) throw new Error('not a file')
    size = s.size
  } catch {
    return NextResponse.json({ error: 'photo file missing on disk' }, { status: 404 })
  }

  const etag = meal.imageSha256 ? `"${meal.imageSha256}"` : undefined
  if (etag && req.headers.get('if-none-match') === etag) return new NextResponse(null, { status: 304, headers: { ETag: etag } })

  const ext = path.extname(filePath).slice(1).toLowerCase()
  const headers: Record<string, string> = {
    'Content-Type': MIME_BY_EXT[ext] ?? 'application/octet-stream',
    'Content-Length': String(size),
    'Cache-Control': 'private, max-age=86400',
  }
  if (etag) headers.ETag = etag
  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream
  return new NextResponse(stream, { headers })
}
