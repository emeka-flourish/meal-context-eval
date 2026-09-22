import { NextRequest, NextResponse } from 'next/server'
import { resolveIngredient, searchFdc } from '@/lib/fdc'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q) return NextResponse.json({ error: 'missing q' }, { status: 400 })

  // Already aliased → skip the search entirely (no API spend, stable identity).
  const resolved = await resolveIngredient(q)
  if (resolved) return NextResponse.json({ matches: [], resolved })

  const matches = await searchFdc(q)
  return NextResponse.json({ matches, resolved: null })
}
