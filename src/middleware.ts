import { NextRequest, NextResponse } from 'next/server'

// Single-user auth: cookie must carry SHA-256(AUTH_SECRET).
// External-rater pages (/rate/*) use their own signed tokens instead.
async function expectedCookie(): Promise<string> {
  const secret = process.env.AUTH_SECRET ?? ''
  const data = new TextEncoder().encode(secret)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/login')
  ) {
    return NextResponse.next()
  }
  const cookie = req.cookies.get('cg_auth')?.value
  if (cookie && cookie === (await expectedCookie())) return NextResponse.next()
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = req.nextUrl.clone()
  url.pathname = '/login'
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/).*)'],
}
