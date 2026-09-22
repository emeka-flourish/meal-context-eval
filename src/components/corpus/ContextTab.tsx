'use client'
import { useEffect, useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import DishwareTable from './DishwareTable'
import type { DishCardDto, VersionDetail, VersionSummary } from '@/lib/ui/corpus-types'
import { fmtInt, habitBullets, ingredientSummary, matchesSearch, portionMixLabel, shortDate, tierMixLabel, versionOrdinal } from '@/lib/ui/corpus-format'

/* Context tab (REBUILD-SPEC §3.2, CORPUS.md §3): one context version's dish
   cards (sorted by instance count, searchable), its habit profile as notable
   findings, and the live dishware registry. Data: GET /api/corpus/versions?id=. */

export default function ContextTab({ versions, onToast }: { versions: VersionSummary[]; onToast: (m: string) => void }) {
  const [versionId, setVersionId] = useState<string | null>(null)
  // keyed by version id: a newly selected version reads as "loading" until its own detail lands
  const [loaded, setLoaded] = useState<{ id: string; version: VersionDetail } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const selected = versionId ?? versions[0]?.id ?? null
  const detail = loaded?.id === selected ? loaded.version : null

  useEffect(() => {
    if (!selected) return
    let live = true
    fetch(`/api/corpus/versions?id=${encodeURIComponent(selected)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`versions ${r.status}`)
        return (await r.json()) as { version: VersionDetail }
      })
      .then((j) => live && setLoaded({ id: selected, version: j.version }))
      .catch((e) => live && setErr(e instanceof Error ? e.message : String(e)))
    return () => {
      live = false
    }
  }, [selected])

  const cards: DishCardDto[] = useMemo(() => {
    const all = detail?.cards ?? []
    return [...all].filter((c) => matchesSearch(c, search)).sort((a, b) => b.instanceCount - a.instanceCount || a.canonicalName.localeCompare(b.canonicalName))
  }, [detail, search])

  const bullets = habitBullets(detail?.habitProfile)

  if (versions.length === 0) {
    return (
      <div className="rounded-[10px] border border-line bg-white px-5 py-8 text-center">
        <div className="text-[15px] font-semibold">No context built yet</div>
        <div className="mt-1 text-ink-muted">Build context v1 to distill dish cards and a habit profile from the corpus. Dishware can be entered now.</div>
        <div className="mx-auto mt-5 max-w-[560px] text-left">
          <DishwareTable onToast={onToast} />
        </div>
      </div>
    )
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[1.4fr_1fr] gap-3.5">
      <section className="flex min-h-0 flex-col gap-2 overflow-hidden rounded-[10px] border border-line bg-white px-4 py-3.5" aria-label="Dish cards">
        <div className="flex items-baseline gap-2">
          <b>Dish cards</b>
          <span className="text-ink-muted">
            {detail ? `${fmtInt(detail.cards.length)} dishes · sorted by frequency` : err ? `could not load (${err})` : 'loading…'}
            {search && detail ? ` · ${cards.length} match` : ''}
          </span>
          {versions.length > 1 && (
            <select
              value={selected ?? ''}
              onChange={(e) => setVersionId(e.target.value)}
              aria-label="Context version"
              className="ml-2 h-7 rounded-md border border-line bg-white px-2 font-mono text-[12px]"
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  v{versionOrdinal(versions, v.id)} · {shortDate(v.createdAt)} · {v.cardCount} cards
                </option>
              ))}
            </select>
          )}
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="search dishes" aria-label="Search dishes" className="ml-auto h-7 w-[180px] text-[12px]" />
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-white">
              <tr>
                <th className="th-label border-b border-line px-2.5 py-2 text-left">dish</th>
                <th className="th-label border-b border-line px-2.5 py-2 text-right">meals</th>
                <th className="th-label border-b border-line px-2.5 py-2 text-left">portion class</th>
                <th className="th-label border-b border-line px-2.5 py-2 text-right">prior g</th>
                <th className="th-label border-b border-line px-2.5 py-2 text-left">ingredients (inclusion)</th>
                <th className="th-label border-b border-line px-2.5 py-2 text-left" title="corrected / confirmed / unconfirmed instances">
                  tier mix
                </th>
              </tr>
            </thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.id} className="align-top">
                  <td className="border-b border-line-soft px-2.5 py-2">
                    <b>{c.canonicalName}</b>
                    {c.aliases.length > 0 && <div className="text-[11px] text-ink-faint">{c.aliases.join(' · ')}</div>}
                  </td>
                  <td className="border-b border-line-soft px-2.5 py-2 text-right font-mono">{fmtInt(c.instanceCount)}</td>
                  <td className="border-b border-line-soft px-2.5 py-2 whitespace-nowrap text-ink-muted">{portionMixLabel(c.portionClassMix, 2)}</td>
                  <td className="border-b border-line-soft px-2.5 py-2 text-right font-mono text-ink-muted">{c.priorGrams == null ? '—' : fmtInt(c.priorGrams)}</td>
                  <td className="border-b border-line-soft px-2.5 py-2 text-[12px] text-ink-muted">{ingredientSummary(c.ingredients)}</td>
                  <td className="border-b border-line-soft px-2.5 py-2 font-mono text-[11px] whitespace-nowrap text-ink-muted">{tierMixLabel(c.tierMix)}</td>
                </tr>
              ))}
              {detail && cards.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-2.5 py-3 text-ink-faint">
                    No dish matches “{search}”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="text-[12px] text-ink-muted">
          Prior grams are model estimates from the app, weighted by tier (corrected / confirmed / unconfirmed). Absolute grams enter only through dishware and fill level.
        </div>
      </section>

      <div className="flex min-h-0 flex-col gap-3.5">
        <section className="flex flex-col gap-1.5 rounded-[10px] border border-line bg-white px-4 py-3.5" aria-label="Habit profile">
          <div className="flex items-baseline gap-2">
            <b>Habit profile</b>
            <span className="text-ink-muted">notable findings across the corpus</span>
          </div>
          {bullets.length === 0 && <div className="text-ink-faint">{detail ? 'This version has no habit profile.' : '…'}</div>}
          {bullets.map((b, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="mt-[7px] size-1.5 flex-none rounded-[2px] bg-brand" aria-hidden />
              <span>{b}</span>
            </div>
          ))}
          <div className="mt-1 text-[11px] text-ink-faint">
            Read-only here: the profile is written by the pinned model at each build and there is no edit endpoint yet — rebuild the context to refresh it.
          </div>
        </section>

        <DishwareTable onToast={onToast} snapshotCount={detail?.dishware.length} />
      </div>
    </div>
  )
}
