/* Dishware registry input validation (CORPUS.md §3). Pure; shared by the
   POST and PATCH routes (a route file may only export handlers). */
const num = (v: unknown): number | null | undefined => {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}
const str = (v: unknown): string | null | undefined => (v === undefined ? undefined : v === null ? null : String(v).trim() || null)

export function parseDishware(body: Record<string, unknown>, partial = false) {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!partial && !name) return 'name required'
  if (partial && body.name !== undefined && !name) return 'name cannot be empty'
  const capacityMl = num(body.capacityMl)
  const capacityG = num(body.capacityG)
  if (body.capacityMl !== undefined && capacityMl === undefined) return 'capacityMl must be a non-negative number'
  if (body.capacityG !== undefined && capacityG === undefined) return 'capacityG must be a non-negative number'
  const data: { name?: string; capacityMl?: number | null; capacityG?: number | null; usedFor?: string | null; photo?: string | null } = {}
  if (name) data.name = name
  if (capacityMl !== undefined) data.capacityMl = capacityMl
  if (capacityG !== undefined) data.capacityG = capacityG
  const usedFor = str(body.usedFor)
  if (usedFor !== undefined) data.usedFor = usedFor
  const photo = str(body.photo)
  if (photo !== undefined) data.photo = photo
  return data
}
