import exifr from 'exifr'

// EXIF timestamps are an unverified convenience (glasses may strip them) —
// NEVER load-bearing. Any failure whatsoever resolves to null.
//
// exifr (unmaintained) rejects newer iPhone HEIC containers ("Unknown file
// format" on iPhone 17 HDR files with MiHB/MiHA sub-brands). Fallback: scan
// the raw container for an `Exif\0\0` marker immediately followed by a valid
// TIFF header and hand exifr that slice — verified against a real
// iPhone 17 Pro Max HEIC (2026-08-11).

const EXIF_MARKER = Buffer.from('Exif\x00\x00', 'binary')

function pickDate(tags: unknown): Date | null {
  if (!tags || typeof tags !== 'object') return null
  const t = tags as { DateTimeOriginal?: unknown; CreateDate?: unknown }
  const raw = t.DateTimeOriginal ?? t.CreateDate
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw
  return null
}

async function parseSlice(buf: Buffer): Promise<Date | null> {
  try {
    const tags: unknown = await exifr.parse(buf, {
      pick: ['DateTimeOriginal', 'CreateDate'],
    })
    return pickDate(tags)
  } catch {
    return null
  }
}

export async function extractTakenAt(buf: Buffer): Promise<Date | null> {
  // 1) normal path
  const direct = await parseSlice(buf)
  if (direct) return direct

  // 2) raw-container fallback: every Exif\0\0 occurrence whose next bytes are
  //    a TIFF magic (II*\0 / MM\0*) is a candidate payload.
  try {
    let idx = -1
    while ((idx = buf.indexOf(EXIF_MARKER, idx + 1)) !== -1) {
      const tiff = buf.subarray(idx + EXIF_MARKER.length)
      const magic = tiff.subarray(0, 4).toString('hex')
      if (magic === '49492a00' || magic === '4d4d002a') {
        const date = await parseSlice(tiff)
        if (date) return date
      }
    }
  } catch {
    // fall through
  }
  return null
}

// ---- Intake v2: camera identity + pixel size -------------------------------
// Vantage detection (REBUILD-SPEC §5) reads the camera model and the image
// size. Same two-step parse as extractTakenAt (direct, then raw-container
// slice) — verified on real device files: glasses report
// Make "Meta AI" / Model "Ray-Ban Meta Smart Glasses"; iPhone files report
// Make "Apple" / Model "iPhone 17 Pro Max" with ExifImageWidth/Height
// 5712×4284 (24 MP) or 4032×3024 (12 MP). Any failure yields nulls.

export type ExifMeta = {
  takenAt: Date | null
  make: string | null
  model: string | null
  width: number | null // EXIF-reported pixel width (pre-rotation)
  height: number | null
  orientation: string | null
}

const META_PICK = [
  'DateTimeOriginal',
  'CreateDate',
  'Make',
  'Model',
  'ExifImageWidth',
  'ExifImageHeight',
  'ImageWidth',
  'ImageHeight',
  'Orientation',
]

function toMeta(tags: unknown): ExifMeta | null {
  if (!tags || typeof tags !== 'object') return null
  const t = tags as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  return {
    takenAt: pickDate(tags),
    make: str(t.Make),
    model: str(t.Model),
    width: num(t.ExifImageWidth) ?? num(t.ImageWidth),
    height: num(t.ExifImageHeight) ?? num(t.ImageHeight),
    orientation: str(t.Orientation),
  }
}

async function parseMetaSlice(buf: Buffer): Promise<ExifMeta | null> {
  try {
    const tags: unknown = await exifr.parse(buf, { pick: META_PICK })
    return toMeta(tags)
  } catch {
    return null
  }
}

export async function extractExifMeta(buf: Buffer): Promise<ExifMeta> {
  const empty: ExifMeta = { takenAt: null, make: null, model: null, width: null, height: null, orientation: null }
  const direct = await parseMetaSlice(buf)
  if (direct && (direct.takenAt || direct.model)) return direct
  try {
    let idx = -1
    while ((idx = buf.indexOf(EXIF_MARKER, idx + 1)) !== -1) {
      const tiff = buf.subarray(idx + EXIF_MARKER.length)
      const magic = tiff.subarray(0, 4).toString('hex')
      if (magic === '49492a00' || magic === '4d4d002a') {
        const meta = await parseMetaSlice(tiff)
        if (meta && (meta.takenAt || meta.model)) return meta
      }
    }
  } catch {
    // fall through
  }
  return direct ?? empty
}
