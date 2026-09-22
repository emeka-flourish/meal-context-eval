import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'
import { getMediaPath } from '@/lib/storage'

// Dev-only fallback: serves files saved under .data/media/ when Vercel Blob
// is not configured. In prod, artifacts carry absolute Blob URLs instead.

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  webp: 'image/webp',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const { key } = await params
  const root = path.resolve(getMediaPath(''))
  const filePath = path.resolve(getMediaPath(key.join('/')))
  // No path traversal outside .data/media.
  if (!filePath.startsWith(root + path.sep)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  try {
    const buf = await readFile(filePath)
    const ext = path.extname(filePath).slice(1).toLowerCase()
    const contentType = MIME_BY_EXT[ext] ?? 'application/octet-stream'
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    })
  } catch {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
}
