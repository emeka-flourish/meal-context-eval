import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { normalizeIngredientName, parsePer100g, saveAlias } from '@/lib/fdc'

// Pending approval first (approvedAt null), then alphabetical.
export async function GET() {
  const customFoods = await db.customFood.findMany({
    orderBy: [{ approvedAt: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }],
  })
  return NextResponse.json({ customFoods })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  const { name, origin, draftReasoning } = body as {
    name?: unknown
    origin?: unknown
    draftReasoning?: unknown
  }
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'missing name' }, { status: 400 })
  }
  if (origin !== 'manual' && origin !== 'llm_drafted') {
    return NextResponse.json({ error: 'invalid origin' }, { status: 400 })
  }
  const per100g = parsePer100g((body as { per100g?: unknown }).per100g)
  if (!per100g) {
    return NextResponse.json({ error: 'invalid per100g' }, { status: 400 })
  }

  const customFood = await db.customFood.create({
    data: {
      name: name.trim(),
      aliases: [normalizeIngredientName(name)],
      per100g,
      origin,
      draftReasoning: typeof draftReasoning === 'string' ? draftReasoning : null,
    },
  })
  // Register the identity immediately so re-encounters auto-resolve.
  await saveAlias(name, { customFoodId: customFood.id, per100g })

  return NextResponse.json({ customFood }, { status: 201 })
}
