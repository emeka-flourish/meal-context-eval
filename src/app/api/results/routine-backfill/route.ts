import { NextRequest, NextResponse } from 'next/server'
import { bad } from '../_shared'
import { backfillRoutine } from '@/lib/corpus/routine-flag'

// POST /api/results/routine-backfill?run=<id> — one-off: compute the
// routine/novel flag (CORPUS.md §5) for every existing ScoreCell of a run
// against the run's config.contextVersionId and write ScoreCell.routine
// (null for every cell when the run has no context version). New cells get
// the flag at score time; this is for cells scored before scorecell_routine.

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest) {
  const runId = req.nextUrl.searchParams.get('run')
  if (!runId) return bad('run required')
  try {
    return NextResponse.json(await backfillRoutine(runId))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return bad(msg, /not found/.test(msg) ? 404 : 500)
  }
}
