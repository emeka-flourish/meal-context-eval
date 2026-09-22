import { NextResponse } from 'next/server'
import { buildFlatRows, FLAT_COLUMNS } from '@/lib/flat'
import { toCsv } from '@/lib/csv'

// GET /api/export/flat — the analysis flat file: one CSV row per meal×surface.
// Flip/MAPE computed at export time (src/lib/flat.ts); missing = empty cell.

export const dynamic = 'force-dynamic'

export async function GET() {
  const rows = await buildFlatRows()
  const csv = toCsv(rows, FLAT_COLUMNS)
  const stamp = new Date().toISOString().slice(0, 10)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="flat-${stamp}.csv"`,
    },
  })
}
