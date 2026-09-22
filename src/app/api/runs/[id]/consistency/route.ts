import { NextRequest, NextResponse } from 'next/server'
import { runClassifyConsistency } from '@/runners/classify'

// POST /api/runs/[id]/consistency — the `--consistency` step (METRICS Level 3):
// re-run the blind classifier on a seeded 20 % sample of this run's
// classifications and store the agreement under Run.config.consistency.
// Body (optional): { seed?: number, share?: number }.

export const maxDuration = 300

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let opts: { seed?: number; share?: number } = {}
  try {
    const body = await req.json()
    if (typeof body?.seed === 'number') opts.seed = body.seed
    if (typeof body?.share === 'number' && body.share > 0 && body.share <= 1) opts.share = body.share
  } catch {
    opts = {}
  }
  try {
    const report = await runClassifyConsistency(id, opts)
    return NextResponse.json({ ok: true, report })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: /not found/.test(msg) ? 404 : 500 })
  }
}
