'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import Seg from './Seg'
import ReviewQueue from './ReviewQueue'
import ContextTab from './ContextTab'
import type { CorpusStats, DistillResponse } from '@/lib/ui/corpus-types'
import { fmtInt, versionChip } from '@/lib/ui/corpus-format'

/* Corpus (REBUILD-SPEC §3.2): header (tier tiles, "Build context vN", current
   version chip) over two tabs — the review queue (one historical meal per
   screen, keyboard-driven Agree / Fix / Exclude / Skip) and the context layer
   (dish cards, habit profile, dishware). URL carries the tab: /corpus?tab=context.
   Data: /api/corpus/ui/stats (tiles), /api/corpus/queue, /api/corpus/annotate,
   /api/corpus/versions, /api/corpus/dishware, /api/corpus/distill. */

type Tab = 'queue' | 'context'

async function fetchStats(): Promise<CorpusStats> {
  const r = await fetch('/api/corpus/ui/stats')
  if (!r.ok) throw new Error(`stats ${r.status}`)
  return (await r.json()) as CorpusStats
}

export default function CorpusScreen() {
  const params = useSearchParams()
  const router = useRouter()
  const tab: Tab = params.get('tab') === 'context' ? 'context' : 'queue'
  const [stats, setStats] = useState<CorpusStats | null>(null)
  const [statsErr, setStatsErr] = useState<string | null>(null)
  const [building, setBuilding] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [contextKey, setContextKey] = useState(0)

  const loadStats = useCallback(
    () =>
      fetchStats()
        .then((s) => {
          setStats(s)
          setStatsErr(null)
        })
        .catch((e) => setStatsErr(e instanceof Error ? e.message : String(e))),
    [],
  )

  useEffect(() => {
    let live = true
    fetchStats()
      .then((s) => {
        if (!live) return
        setStats(s)
        setStatsErr(null)
      })
      .catch((e) => live && setStatsErr(e instanceof Error ? e.message : String(e)))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  function setTab(next: Tab) {
    router.replace(next === 'context' ? '/corpus?tab=context' : '/corpus')
  }

  const versions = stats?.versions ?? []
  const latest = stats?.latestVersion ?? null
  const nextOrdinal = versions.length + 1

  async function build() {
    if (building) return
    setBuilding(true)
    try {
      const r = await fetch('/api/corpus/distill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: `corpus v${nextOrdinal}` }),
      })
      const j = (await r.json()) as Partial<DistillResponse> & { error?: string }
      if (!r.ok || !j.ok) throw new Error(j.error ?? `distill ${r.status}`)
      setToast(`context v${nextOrdinal} built · ${fmtInt(j.cardCount)} dish cards from ${fmtInt(j.mealCount)} meals${j.mocked ? ' · mock distill' : ''}`)
      await loadStats()
      setContextKey((k) => k + 1)
    } catch (e) {
      setToast(`Build failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBuilding(false)
    }
  }

  const tiles: { label: string; value: number | null }[] = [
    { label: 'meals exported', value: stats?.total ?? null },
    { label: 'corrected by you', value: stats?.byTier.corrected ?? null },
    { label: 'confirmed, untouched', value: stats?.byTier.confirmed ?? null },
    { label: 'unconfirmed', value: stats?.byTier.unconfirmed ?? null },
    { label: 'in review queue', value: stats?.inQueue ?? null },
  ]

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 px-7 py-5">
      <div className="flex items-baseline gap-3.5">
        <h1 className="text-xl font-semibold tracking-[-0.01em]">Corpus</h1>
        <Seg<Tab>
          value={tab}
          onChange={setTab}
          ariaLabel="Corpus tab"
          options={[
            { value: 'queue', label: 'Review queue' },
            { value: 'context', label: 'Context' },
          ]}
        />
        <span className="text-ink-muted">
          {tab === 'queue' ? 'your logged meal history from before the test captures' : `what the model is told about you · built from all ${fmtInt(stats?.total)} meals`}
        </span>
        <span className="chip ml-auto" title={latest ? `${latest.label} · ${latest.cardCount} cards` : undefined}>
          {stats ? versionChip(versions, latest) : '…'}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="sm" onClick={build} disabled={building || !stats} aria-busy={building}>
              {building && <Loader2 className="animate-spin" />}
              {building ? 'Building…' : `Build context v${nextOrdinal}`}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Distill dish cards, habit profile and a dishware snapshot from every non-excluded meal.</TooltipContent>
        </Tooltip>
      </div>

      {statsErr && <div className="text-over-ink">Could not load corpus stats ({statsErr}).</div>}

      {tab === 'queue' && (
        <div className="flex gap-3">
          {tiles.map((t) => (
            <div key={t.label} className="flex-1 rounded-[10px] border border-line bg-white px-4 py-3.5">
              <div className="text-ink-muted">{t.label}</div>
              <div className="my-0.5 font-mono text-[26px] font-semibold tracking-[-0.02em]">{t.value == null ? '—' : fmtInt(t.value)}</div>
            </div>
          ))}
        </div>
      )}

      {tab === 'queue' ? (
        <ReviewQueue versionId={latest?.id ?? null} onChanged={loadStats} onToast={setToast} />
      ) : (
        <ContextTab key={contextKey} versions={versions} onToast={setToast} />
      )}

      {toast && (
        <div className="fixed right-6 bottom-6 z-50 rounded-md border border-line bg-ink px-3.5 py-2 text-white shadow-lg" role="status">
          {toast}
        </div>
      )}
    </main>
  )
}
