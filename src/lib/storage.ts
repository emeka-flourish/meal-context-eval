import { put } from '@vercel/blob'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'

// Media storage: Vercel Blob when BLOB_READ_WRITE_TOKEN is set,
// else local .data/media/ (gitignored) served via /api/media/<key>.

const LOCAL_MEDIA_DIR = path.join(process.cwd(), '.data', 'media')

export function getMediaPath(key: string): string {
  return path.join(LOCAL_MEDIA_DIR, key)
}

export async function saveMedia(
  file: File | Buffer,
  key: string,
  contentType: string
): Promise<string> {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { url } = await put(key, file, { access: 'public', contentType })
    return url
  }
  const buf = Buffer.isBuffer(file) ? file : Buffer.from(await file.arrayBuffer())
  const filePath = getMediaPath(key)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, buf)
  return `/api/media/${key}`
}
