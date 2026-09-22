import { NextRequest, NextResponse } from 'next/server'
import { parsePer100g, saveAlias } from '@/lib/fdc'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  const { name, fdcId, customFoodId } = body as {
    name?: unknown
    fdcId?: unknown
    customFoodId?: unknown
  }
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'missing name' }, { status: 400 })
  }
  const per100g = parsePer100g((body as { per100g?: unknown }).per100g)
  if (!per100g) {
    return NextResponse.json({ error: 'invalid per100g' }, { status: 400 })
  }
  const hasFdcId = typeof fdcId === 'number'
  const hasCustomFoodId = typeof customFoodId === 'string' && customFoodId.length > 0
  if (hasFdcId === hasCustomFoodId) {
    return NextResponse.json(
      { error: 'exactly one of fdcId or customFoodId required' },
      { status: 400 }
    )
  }

  await saveAlias(name, {
    fdcId: hasFdcId ? fdcId : undefined,
    customFoodId: hasCustomFoodId ? customFoodId : undefined,
    per100g,
  })
  return NextResponse.json({ ok: true })
}
