// HEIC → JPEG normalization at upload time.
// Why: iPhone-native and AirDropped photos arrive as HEIC; Chrome can't render
// it and the OpenAI vision API (pipeline, M2) rejects it. Everything stored
// must be universally consumable, so HEIC converts to JPEG on the way in.
// EXIF is extracted BEFORE conversion (the converted buffer loses metadata).
import convert from 'heic-convert'

const HEIC_EXTS = new Set(['heic', 'heif'])
const HEIC_MIMES = new Set(['image/heic', 'image/heif', 'image/heic-sequence'])

export function isHeic(name: string, contentType: string): boolean {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  return HEIC_EXTS.has(ext) || HEIC_MIMES.has(contentType)
}

export async function heicToJpeg<T extends ArrayBufferLike>(buf: Buffer<T>): Promise<Buffer<T>> {
  const out = await convert({
    buffer: buf as unknown as ArrayBufferLike,
    format: 'JPEG',
    quality: 0.9,
  })
  return Buffer.from(out) as Buffer<T>
}

// ---- Intake v2: primary image size without decoding ------------------------
// HEIF stores each image item's pixel size in an `ispe` box (ISO 23008-12
// §6.5.3: fullbox header 4+4 bytes, then width u32, height u32). A file holds
// several (thumbnail, grid tiles, the primary): the largest by area is the
// primary. Verified 2026-09-16 on the real captures: Ray-Ban Meta files carry
// 2608×3477 / 2570×3425 (portrait), iPhone 17 files 5712×4284 or 4032×3024.
// Any parse failure yields null — sizing is a hint for vantage detection,
// never load-bearing.
export function heicDimensions(buf: Buffer): { width: number; height: number } | null {
  try {
    const marker = Buffer.from('ispe', 'binary')
    let best: { width: number; height: number } | null = null
    let idx = -1
    while ((idx = buf.indexOf(marker, idx + 1)) !== -1) {
      if (idx + 16 > buf.length) break
      const width = buf.readUInt32BE(idx + 8)
      const height = buf.readUInt32BE(idx + 12)
      if (width === 0 || height === 0 || width > 20_000 || height > 20_000) continue
      if (!best || width * height > best.width * best.height) best = { width, height }
    }
    return best
  } catch {
    return null
  }
}
