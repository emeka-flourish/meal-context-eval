import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { validateAnnotation } from '@/lib/corpus/annotate'

// POST /api/corpus/annotate — one annotation (CORPUS.md §2).
// Body: { mealId, dishId?, portionClass?: small|usual|large, agreed?: bool,
//         excluded?: bool, editedJson?: {name?, portionClass?, ingredients?: [{name, gramsEst?}]} }
// Effects: agreed → meal.tier = corrected; excluded at meal level → meal.excluded = true.
// The annotation row itself is append-only (the latest per scope wins at distill time).
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'bad request: expected JSON body' }, { status: 400 })
  }
  const parsed = validateAnnotation(body)
  if (typeof parsed === 'string') return NextResponse.json({ error: parsed }, { status: 400 })

  const meal = await db.corpusMeal.findUnique({ where: { id: parsed.mealId }, select: { id: true } })
  if (!meal) return NextResponse.json({ error: 'corpus meal not found' }, { status: 404 })
  if (parsed.dishId) {
    const dish = await db.corpusDish.findUnique({ where: { id: parsed.dishId }, select: { mealId: true } })
    if (!dish || dish.mealId !== parsed.mealId) return NextResponse.json({ error: 'dish not found on this meal' }, { status: 404 })
  }

  const result = await db.$transaction(async (tx) => {
    const annotation = await tx.corpusAnnotation.create({
      data: {
        mealId: parsed.mealId,
        dishId: parsed.dishId,
        portionClass: parsed.portionClass,
        agreed: parsed.agreed,
        excluded: parsed.excluded,
        editedJson: parsed.editedJson === null ? undefined : parsed.editedJson,
      },
    })
    const mealPatch: { tier?: 'corrected'; excluded?: boolean } = {}
    if (parsed.agreed) mealPatch.tier = 'corrected'
    if (parsed.excluded && !parsed.dishId) mealPatch.excluded = true
    const updated = Object.keys(mealPatch).length
      ? await tx.corpusMeal.update({ where: { id: parsed.mealId }, data: mealPatch, select: { id: true, tier: true, excluded: true } })
      : await tx.corpusMeal.findUniqueOrThrow({ where: { id: parsed.mealId }, select: { id: true, tier: true, excluded: true } })
    return { annotation, meal: updated }
  })
  return NextResponse.json({ ok: true, ...result }, { status: 201 })
}
