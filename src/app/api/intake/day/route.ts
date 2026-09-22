import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { artifactDto, dayRange, isCalendarDate, mealDto, sceneInclude } from '../_shared'
import type { DayPayload } from '@/lib/ui/intake-types'
import { STUDY_VANTAGES } from '@/lib/intake'

// GET /api/intake/day?date=YYYY-MM-DD — everything the Intake day view needs:
// meals in slot order with their photo scenes (captures + GT items), plus the
// global unsorted tray (artifacts with no scene, any day).
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date')
  if (!date || !isCalendarDate(date)) {
    return NextResponse.json({ error: 'date=YYYY-MM-DD required' }, { status: 400 })
  }
  const [meals, unsorted] = await Promise.all([
    db.meal.findMany({
      where: { eatenAt: dayRange(date) },
      orderBy: { eatenAt: 'asc' },
      include: { scenes: { include: sceneInclude } },
    }),
    db.artifact.findMany({
      where: { sceneId: null, isReference: false },
      orderBy: { exifTakenAt: 'asc' },
    }),
  ])
  const payload: DayPayload = {
    date,
    meals: meals.map(mealDto),
    unsorted: unsorted.map(artifactDto),
    studyVantages: [...STUDY_VANTAGES],
  }
  return NextResponse.json(payload)
}
