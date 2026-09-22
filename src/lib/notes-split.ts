// Notes splitter (REBUILD-SPEC §5, notes importer). The notes format:
//
//   Aug 14                     ← day header ("Aug 14", "August 14", "2026-08-14",
//   Breakfast                     "Thursday, Aug 14, 2026" all accepted)
//   Photo 1:                   ← photo block (= scene index); absent → Photo 1
//   Plate 1 - Toast:           ← plate lines stay INSIDE the block's prose
//   Two slices wheat bread …
//
// Pure, deterministic. The prose of each (day, slot, photo) is returned
// VERBATIM (outer blank lines trimmed) — never rewritten.

export type Slot = 'breakfast' | 'lunch' | 'dinner' | 'snack'

export type NoteBlock = {
  date: string // YYYY-MM-DD
  slot: Slot
  photoIndex: number
  text: string
}

export type SplitResult = { blocks: NoteBlock[]; warnings: string[] }

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
}

const DAY_ISO = /^#{0,3}\s*(\d{4})-(\d{2})-(\d{2})\s*:?\s*$/
const DAY_WORDS =
  /^#{0,3}\s*(?:(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?,?\s+)?([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\s*:?\s*$/i
const SLOT_LINE = /^#{0,3}\s*(breakfast|lunch|dinner|snack)\b\s*[:\-–]?\s*(.{0,24})$/i
const PHOTO_LINE = /^#{0,3}\s*(?:photo|pic|picture|img|image)\s*#?\s*(\d+)\s*[:\-–.]?\s*(.*)$/i

export function parseDayHeader(line: string, defaultYear: number): string | null {
  const iso = line.match(DAY_ISO)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const w = line.match(DAY_WORDS)
  if (!w) return null
  const month = MONTHS[w[1].toLowerCase()]
  if (!month) return null
  const day = parseInt(w[2], 10)
  if (day < 1 || day > 31) return null
  const year = w[3] ? parseInt(w[3], 10) : defaultYear
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function splitNotes(markdown: string, opts: { defaultYear: number }): SplitResult {
  const warnings: string[] = []
  const blocks: NoteBlock[] = []
  let date: string | null = null
  let slot: Slot | null = null
  let photo = 0
  let buf: string[] = []

  const flush = () => {
    const text = buf.join('\n').replace(/^\s*\n+|\n+\s*$/g, '').trimEnd()
    if (text.trim() && date && slot) blocks.push({ date, slot, photoIndex: Math.max(1, photo), text })
    else if (text.trim()) warnings.push(`orphan text before a day/slot header: "${text.slice(0, 40)}"`)
    buf = []
  }

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd()
    const day = parseDayHeader(line, opts.defaultYear)
    if (day) {
      flush()
      date = day
      slot = null
      photo = 0
      continue
    }
    const s = line.match(SLOT_LINE)
    if (s && !/\d+\s*g\b/i.test(line)) {
      flush()
      slot = s[1].toLowerCase() as Slot
      photo = 0
      if (!date) warnings.push(`slot "${s[1]}" before any day header`)
      continue
    }
    const p = line.match(PHOTO_LINE)
    if (p) {
      flush()
      photo = parseInt(p[1], 10)
      if (!slot) warnings.push(`"${line.trim()}" before any slot header`)
      if (p[2].trim()) buf.push(p[2].trim())
      continue
    }
    if (!line.trim() && buf.length === 0) continue
    buf.push(line)
  }
  flush()

  // duplicate (date, slot, photo) → merged, flagged
  const seen = new Map<string, NoteBlock>()
  const merged: NoteBlock[] = []
  for (const b of blocks) {
    const k = `${b.date}|${b.slot}|${b.photoIndex}`
    const prior = seen.get(k)
    if (prior) {
      prior.text = `${prior.text}\n${b.text}`
      warnings.push(`duplicate block ${b.date} ${b.slot} photo ${b.photoIndex} — merged`)
      continue
    }
    seen.set(k, b)
    merged.push(b)
  }
  return { blocks: merged, warnings }
}
