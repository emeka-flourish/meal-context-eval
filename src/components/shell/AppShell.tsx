'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from 'cn'

/* Top bar from the approved mockups: wordmark, four tabs (Intake / Corpus /
   Run / Results) plus the How to guide, run selector on the right. Laptop only — no phone shell.
   Bare on /login (and the legacy /rate/*, /quick pages). */

const TABS = [
  { href: '/intake', label: 'Intake', match: (p: string) => p === '/' || p.startsWith('/intake') },
  { href: '/corpus', label: 'Corpus', match: (p: string) => p.startsWith('/corpus') },
  { href: '/run', label: 'Run', match: (p: string) => p.startsWith('/run') },
  { href: '/results', label: 'Results', match: (p: string) => p.startsWith('/results') },
  { href: '/how-to', label: 'How to', match: (p: string) => p.startsWith('/how-to') },
]

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const bare = pathname.startsWith('/login')
  if (bare) return <>{children}</>

  return (
    <div className="flex h-dvh min-w-[1100px] flex-col overflow-hidden bg-paper">
      <header className="flex h-[52px] shrink-0 items-center gap-6 border-b border-line bg-white px-6">
        <Link href="/intake" className="flex items-center gap-2 text-[15px] font-semibold tracking-[0.01em] text-ink hover:text-ink">
          <span className="inline-block size-[18px] rounded-[4px] bg-brand" aria-hidden />
          Vantage
        </Link>
        <nav className="flex gap-1" aria-label="Sections">
          {TABS.map((t) => {
            const on = t.match(pathname)
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'rounded-md px-3 py-1.5 font-medium text-ink-muted hover:text-ink',
                  on && 'bg-tint text-ink',
                )}
              >
                {t.label}
              </Link>
            )
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-ink-muted" title="Run selector — populated once runs exist">
          Run
          <span className="rounded-md border border-line bg-white px-2.5 py-1 font-mono text-ink">—</span>
          <span className="rounded-md border border-line bg-white px-2.5 py-1 text-ink-faint">no run selected</span>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">{children}</div>
    </div>
  )
}
