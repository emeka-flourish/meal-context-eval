import { NextResponse } from 'next/server'

// POST used to create a MANUAL text artifact (arm A). The manual arm left the
// study with intake v2 (2026-09-16, REBUILD-SPEC §7): the Surface enum has no
// manual value any more, so the route answers 410 Gone. The typed-description
// path will return, if at all, as a GT-only meal (Intake screen, v2 UI).
export async function POST() {
  return NextResponse.json(
    { error: 'manual text artifacts were removed in intake v2 (no manual surface)' },
    { status: 410 },
  )
}
