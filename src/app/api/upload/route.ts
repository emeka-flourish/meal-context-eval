import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import { saveMedia } from '@/lib/storage'
import { extractTakenAt } from '@/lib/exif'
import { clusterArtifacts } from '@/lib/clustering'
import { isHeic, heicToJpeg } from '@/lib/heic'
import { Surface } from '@/generated/prisma/enums'

// POST multipart form-data: `files` (repeated) + optional `mealId` + optional `surface`.
// - mealId present  → save media + create Artifact rows attached to that meal.
// - mealId absent   → save media, return parsed metadata + suggested clusters
//                     WITHOUT touching the DB; the client commits groupings
//                     via /api/meals/ingest.

export const maxDuration = 120

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/webp': 'webp',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
}

function extFor(file: File): string {
  const fromName = file.name.includes('.')
    ? file.name.split('.').pop()!.toLowerCase()
    : ''
  if (/^[a-z0-9]{1,5}$/.test(fromName)) return fromName
  return EXT_BY_MIME[file.type] ?? 'bin'
}

function isSurface(v: unknown): v is Surface {
  return typeof v === 'string' && v in Surface
}

// Magic-byte sniff for files claiming image/*: a .txt renamed .jpg must not
// reach storage (the vision APIs would choke downstream). Audio is not sniffed.
function looksLikeImage(buf: Buffer): boolean {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true // jpeg
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  )
    return true // png
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  )
    return true // webp
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') return true // heic/heif
  if (buf.length >= 6 && /^GIF8[79]a/.test(buf.toString('ascii', 0, 6))) return true // gif
  return false
}

export async function POST(req: NextRequest) {
  // An oversized or aborted body throws mid-parse — surface it as 413, not a
  // naked 500.
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json(
      { error: 'file too large — keep uploads under ~20MB per photo' },
      { status: 413 },
    )
  }
  const files = form.getAll('files').filter((f): f is File => f instanceof File)
  if (files.length === 0) {
    return NextResponse.json({ error: 'no files' }, { status: 400 })
  }

  const mealIdRaw = form.get('mealId')
  const mealId = typeof mealIdRaw === 'string' && mealIdRaw !== '' ? mealIdRaw : null
  const surfaceRaw = form.get('surface')
  const surface: Surface = isSurface(surfaceRaw) ? surfaceRaw : Surface.phone

  if (mealId) {
    const meal = await db.meal.findUnique({ where: { id: mealId } })
    if (!meal) return NextResponse.json({ error: 'meal not found' }, { status: 404 })
  }

  const parsed = []
  for (const file of files) {
    let buf = Buffer.from(await file.arrayBuffer())
    if (file.type.startsWith('image/') && !looksLikeImage(buf)) {
      return NextResponse.json(
        { error: `${file.name} claims to be an image but is not a recognizable jpeg/png/webp/heic/gif` },
        { status: 400 },
      )
    }
    // EXIF first — conversion strips metadata.
    const exifTakenAt = await extractTakenAt(buf)
    let ext = extFor(file)
    let contentType = file.type || 'application/octet-stream'
    // HEIC (AirDrop path) → JPEG: Chrome can't render HEIC and the vision
    // APIs reject it; everything stored must be universally consumable.
    if (isHeic(file.name, contentType)) {
      buf = await heicToJpeg(buf)
      ext = 'jpg'
      contentType = 'image/jpeg'
    }
    const key = mealId
      ? `meal/${mealId}/${randomUUID()}.${ext}`
      : `incoming/${randomUUID()}.${ext}`
    const url = await saveMedia(buf, key, contentType)
    parsed.push({ tempKey: key, url, name: file.name, contentType, exifTakenAt })
  }

  if (mealId) {
    const artifacts = []
    for (const p of parsed) {
      const artifact = await db.artifact.create({
        data: {
          mealId,
          surface,
          blobUrl: p.url,
          exifTakenAt: p.exifTakenAt,
        },
      })
      artifacts.push(artifact)
    }
    return NextResponse.json({ mealId, artifacts })
  }

  const clusters = clusterArtifacts(
    parsed.map((p) => ({ id: p.tempKey, takenAt: p.exifTakenAt }))
  )
  return NextResponse.json({ files: parsed, clusters })
}
