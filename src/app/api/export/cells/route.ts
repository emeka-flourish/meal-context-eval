import { NextRequest, NextResponse } from 'next/server'
import { buildCellRows, CELL_COLUMNS } from '@/lib/flat'
import { toCsv } from '@/lib/csv'

// GET /api/export/cells[?run=<runId>] — one CSV row per ScoreCell with the
// METRICS.md export columns (+ the six dec_* triples). Missing = empty cell.

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const runId = req.nextUrl.searchParams.get('run') ?? undefined
  const rows = await buildCellRows(runId)
  const csv = toCsv(rows, CELL_COLUMNS)
  const stamp = new Date().toISOString().slice(0, 10)
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="cells-${runId ? runId.slice(0, 8) + '-' : ''}${stamp}.csv"`,
    },
  })
}
