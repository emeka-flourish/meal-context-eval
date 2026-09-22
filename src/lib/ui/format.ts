/* Pure UI helpers shared by the Intake / Run screens. No DB, no I/O. */

export type Vantage = 'phone' | 'glasses' | 'tripod'
export const VANTAGES: Vantage[] = ['phone', 'glasses', 'tripod']
/** The cameras the study compares today (mirrors STUDY_VANTAGES in lib/intake.ts).
    Tripod photos are shown when they exist, never asked for (see STUDY_VANTAGES). */
export const REQUIRED_VANTAGES: Vantage[] = ['phone', 'glasses']
/** Runs created before 2026-09-19 carry no `config.vantages`; they used all three cameras. */
export const LEGACY_RUN_VANTAGES: Vantage[] = ['phone', 'glasses', 'tripod']

/** Cameras of a run, from its saved settings. */
export function runVantages(config: { vantages?: readonly string[] | null } | null | undefined): Vantage[] {
  const v = (config?.vantages ?? []).filter((x): x is Vantage => (VANTAGES as string[]).includes(x))
  return v.length ? v : [...LEGACY_RUN_VANTAGES]
}

/** Cameras to show for a set of photos: the required ones, plus any other camera that has a photo. */
export function shownVantages(present: Iterable<Vantage | null | undefined>): Vantage[] {
  const have = new Set([...present].filter(Boolean) as Vantage[])
  return VANTAGES.filter((v) => REQUIRED_VANTAGES.includes(v) || have.has(v))
}

export type Slot = 'breakfast' | 'lunch' | 'dinner' | 'snack'
export const SLOTS: Slot[] = ['breakfast', 'lunch', 'dinner', 'snack']

export function slotRank(slot: string | null | undefined): number {
  const i = SLOTS.indexOf((slot ?? '') as Slot)
  return i === -1 ? SLOTS.length : i
}

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

/** YYYY-MM-DD in the browser's local zone. */
export function isoDay(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** YYYY-MM for the calendar rail. */
export function isoMonth(d: Date): string {
  return isoDay(d).slice(0, 7)
}

export function parseIsoDay(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return isoMonth(d)
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3))
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function monthTitle(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

/** "Thursday, Aug 14" */
export function dayTitle(day: string): string {
  const d = parseIsoDay(day)
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`
}

/** "Aug 14" */
export function dayShort(day: string): string {
  const d = parseIsoDay(day)
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`
}

/** "07:52" in the browser's local zone. */
export function clock(iso: string | Date | null | undefined): string {
  if (!iso) return '—'
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Calendar grid for a month, Monday-first, leading blanks as null. */
export function monthGrid(month: string): (string | null)[] {
  const [y, m] = month.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const lead = (first.getDay() + 6) % 7 // Monday = 0
  const days = new Date(y, m, 0).getDate()
  const cells: (string | null)[] = Array.from({ length: lead }, () => null)
  for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, '0')}`)
  return cells
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

export function fmtGrams(g: number | null | undefined): string {
  if (g == null) return '—'
  return Number.isInteger(g) ? String(g) : g.toFixed(1)
}
