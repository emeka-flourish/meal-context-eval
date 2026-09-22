import { NextRequest, NextResponse } from 'next/server'
import { buildRunWorkList } from '@/lib/runmatrix'

// GET /api/runs/[id] — the run's config, its full work list (done items
// included) and progress: every cell with its state (queued / interpreted /
// matched / classified / done / failed) and the last error when failed.
// Execution is per item via POST /api/run-item.

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    const { config, items, progress } = await buildRunWorkList(id)
    return NextResponse.json({ run: { id, label: config.label, status: progress.status, config }, items, progress })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: /not found/.test(msg) ? 404 : 500 })
  }
}
