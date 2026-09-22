/* Minimal RFC 4180 CSV parser — no dependencies.
   Handles quoted fields with embedded commas, newlines and doubled quotes,
   CRLF / LF / CR line endings, a leading UTF-8 BOM, and a missing trailing
   newline. Used to read pgAdmin "Save results to file" exports. */

export type CsvRow = Record<string, string>

/** Parse CSV text into rows of fields. Blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let rowHadQuote = false
  let i = 0
  const n = text.length

  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    // drop a blank line (a single empty field) — but keep a real one-column row like `""`
    if (!(row.length === 1 && row[0] === '' && !rowHadQuote)) rows.push(row)
    row = []
    rowHadQuote = false
  }

  while (i < n) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i++
        continue
      }
      field += c
      i++
      continue
    }
    if (c === '"' && field === '') {
      quoted = true
      rowHadQuote = true
      i++
      continue
    }
    if (c === ',') {
      endField()
      i++
      continue
    }
    if (c === '\r') {
      if (text[i + 1] === '\n') i++
      endRow()
      i++
      continue
    }
    if (c === '\n') {
      endRow()
      i++
      continue
    }
    field += c
    i++
  }
  if (quoted) throw new Error('CSV: unterminated quoted field at end of input')
  if (field !== '' || row.length > 0 || rowHadQuote) endRow()
  return rows
}

/** Parse CSV text whose first row is a header into objects keyed by column name.
    Short rows are padded with '' and long rows throw. */
export function parseCsvRecords(text: string): CsvRow[] {
  const rows = parseCsv(text)
  if (rows.length === 0) return []
  const header = rows[0].map((h) => h.trim())
  const out: CsvRow[] = []
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r]
    if (cells.length > header.length) {
      throw new Error(`CSV: row ${r + 1} has ${cells.length} fields but the header has ${header.length}`)
    }
    const rec: CsvRow = {}
    header.forEach((h, c) => {
      rec[h] = cells[c] ?? ''
    })
    out.push(rec)
  }
  return out
}
