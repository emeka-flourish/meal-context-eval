// Tiny CSV serializer for export routes. RFC 4180-ish: cells containing
// quotes, commas, or newlines are double-quoted with quotes doubled.
// null/undefined → empty cell (missing-surface rule: missing is NEVER zero).
// Dates → ISO 8601; objects (Json columns) → JSON strings.

export type CsvValue = string | number | boolean | null | undefined | Date | object

export function csvCell(v: CsvValue): string {
  if (v === null || v === undefined) return ''
  let s: string
  if (v instanceof Date) s = v.toISOString()
  else if (typeof v === 'object') s = JSON.stringify(v)
  else s = String(v)
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

/** Serialize rows to CSV. Header row from `headers` (or keys of the first row). */
export function toCsv(rows: Record<string, CsvValue>[], headers?: string[]): string {
  const cols = headers ?? (rows[0] ? Object.keys(rows[0]) : [])
  const lines = [cols.map(csvCell).join(',')]
  for (const row of rows) lines.push(cols.map((c) => csvCell(row[c])).join(','))
  return lines.join('\r\n') + '\r\n'
}
