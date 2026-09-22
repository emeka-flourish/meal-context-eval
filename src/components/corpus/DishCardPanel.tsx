'use client'
import { useEffect, useState } from 'react'
import type { CardsResponse, DishCardDto } from '@/lib/ui/corpus-types'
import { fmtInt, portionMixLabel, shortDate, slotMixLabel } from '@/lib/ui/corpus-format'

/* "Dish card this meal touches" (REBUILD-SPEC §3.2 side panel): every dish
   name on screen (edited names included) is resolved through the retrieval
   cascade against the latest context version — GET /api/corpus/ui/cards —
   and the matching card(s) are shown the way the model will be told them. */

const METHOD_LABEL: Record<string, string> = { exact: 'exact alias', token: 'token overlap', embedding: 'near match' }

export default function DishCardPanel({ names, versionId }: { names: string[]; versionId: string | null }) {
  const [data, setData] = useState<CardsResponse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const key = names.map((n) => n.trim().toLowerCase()).filter(Boolean).join('')

  useEffect(() => {
    if (!versionId) return
    const queries = Array.from(new Set(key.split('').filter(Boolean)))
    if (queries.length === 0) return
    let live = true
    const t = setTimeout(async () => {
      try {
        const qs = queries.map((q) => `q=${encodeURIComponent(q)}`).join('&')
        const r = await fetch(`/api/corpus/ui/cards?version=${encodeURIComponent(versionId)}&${qs}`)
        if (!r.ok) throw new Error(`cards ${r.status}`)
        const j = (await r.json()) as CardsResponse
        if (live) {
          setData(j)
          setErr(null)
        }
      } catch (e) {
        if (live) setErr(e instanceof Error ? e.message : String(e))
      }
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [key, versionId])

  // one entry per card, listing the dish names that resolved to it
  const grouped: { card: DishCardDto; via: { query: string; method: string }[] }[] = []
  const unmatched: string[] = []
  for (const m of data?.matches ?? []) {
    if (!m.card) {
      unmatched.push(m.query)
      continue
    }
    const g = grouped.find((x) => x.card.id === m.card!.id)
    if (g) g.via.push({ query: m.query, method: m.method })
    else grouped.push({ card: m.card, via: [{ query: m.query, method: m.method }] })
  }

  return (
    <section className="flex min-h-0 flex-col gap-2 overflow-y-auto rounded-[10px] border border-line bg-white px-4 py-3.5" aria-label="Dish cards this meal touches">
      <div>
        <b>Dish card{grouped.length === 1 ? '' : 's'} this meal touches</b> <span className="text-ink-muted">· what the model will be told</span>
      </div>
      {!versionId && <div className="text-ink-muted">No context version yet — build one and the matching cards appear here.</div>}
      {versionId && err && <div className="text-over-ink">Could not load cards ({err}).</div>}
      {versionId && !err && !data && <div className="text-ink-muted">Matching…</div>}
      {grouped.map(({ card, via }, i) => (
        <div key={card.id} className={i > 0 ? 'mt-2 border-t border-line-soft pt-3' : undefined}>
          <div className="text-[15px] font-semibold">{card.canonicalName}</div>
          <div className="text-ink-muted">{card.aliases.length ? `aliases: ${card.aliases.join(', ')}` : 'no aliases yet'}</div>
          <div className="mt-1 flex flex-wrap gap-x-3.5 font-mono">
            <span className="whitespace-nowrap">{fmtInt(card.instanceCount)} meals</span>
            <span>{portionMixLabel(card.portionClassMix)}</span>
          </div>
          <div className="text-ink-muted">prior ~{card.priorGrams == null ? '—' : `${fmtInt(card.priorGrams)} g`} (model-estimated)</div>
          <table className="mt-1.5 w-full border-collapse">
            <thead>
              <tr>
                <th className="th-label border-b border-line px-2 py-1.5 text-left">ingredient</th>
                <th className="th-label border-b border-line px-2 py-1.5 text-right">in %</th>
                <th className="th-label border-b border-line px-2 py-1.5 text-right">g</th>
              </tr>
            </thead>
            <tbody>
              {[...card.ingredients]
                .sort((a, b) => b.inclusionRate - a.inclusionRate)
                .slice(0, 6)
                .map((g) => (
                  <tr key={g.name}>
                    <td className="border-b border-line-soft px-2 py-1.5">{g.name.toLowerCase()}</td>
                    <td className="border-b border-line-soft px-2 py-1.5 text-right font-mono">{Math.round(g.inclusionRate * 100)}</td>
                    <td className="border-b border-line-soft px-2 py-1.5 text-right font-mono">{g.medianGramsEst == null ? '—' : fmtInt(g.medianGramsEst)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <div className="mt-1.5 text-ink-muted">
            {card.features.homeShare != null && <>home {Math.round(card.features.homeShare * 100)}% · </>}
            {slotMixLabel(card.features.slotMix)} · last seen {shortDate(card.lastSeen)}
          </div>
          <div className="text-[12px] text-ink-muted">
            Tier mix: corrected {card.tierMix.corrected ?? 0} · confirmed {card.tierMix.confirmed ?? 0} · unconfirmed {card.tierMix.unconfirmed ?? 0}
          </div>
          <div className="text-[11px] text-ink-faint">
            via {via.map((v) => `“${v.query}” (${METHOD_LABEL[v.method] ?? v.method})`).join(', ')}
          </div>
        </div>
      ))}
      {data && unmatched.length > 0 && (
        <div className={grouped.length ? 'mt-2 border-t border-line-soft pt-2 text-[12px] text-ink-muted' : 'text-ink-muted'}>
          No card for {unmatched.map((q) => `“${q}”`).join(', ')} — new to the context, or the name differs from every alias. Fixing the name to a known dish links it on the next build.
        </div>
      )}
    </section>
  )
}
