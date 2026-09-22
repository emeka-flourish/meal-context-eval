import { NextRequest, NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'crypto'

export async function POST(req: NextRequest) {
  const { secret } = await req.json()
  const expected = process.env.AUTH_SECRET ?? ''
  const a = Buffer.from(String(secret ?? ''))
  const b = Buffer.from(expected)
  const ok = a.length === b.length && expected.length > 0 && timingSafeEqual(a, b)
  if (!ok) return NextResponse.json({ error: 'invalid secret' }, { status: 401 })

  const cookieValue = createHash('sha256').update(expected).digest('hex')
  const res = NextResponse.json({ ok: true })
  res.cookies.set('cg_auth', cookieValue, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 90, // the study window
    path: '/',
  })
  return res
}
