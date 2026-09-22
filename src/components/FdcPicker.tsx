'use client'
import { useEffect, useRef, useState } from 'react'
import type { FdcMatch, Per100g, Resolution } from '@/lib/fdc'

type Props = {
  ingredientName: string
  onPicked: (resolution: Resolution) => void
}

type SearchResult = {
  query: string
  resolved: Resolution | null
  matches: FdcMatch[]
  error: string | null
}

// Obviously-wrong placeholder; real values arrive via LLM draft + owner approval.
const PLACEHOLDER_PER100G: Per100g = { kcal: 100, protein_g: 5, carbs_g: 10, fat_g: 5 }

export default function FdcPicker({ ingredientName, onPicked }: Props) {
  const [result, setResult] = useState<SearchResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // Latest callback for the async search effect (avoids re-searching when the
  // parent passes a fresh closure each render).
  const onPickedRef = useRef(onPicked)
  useEffect(() => {
    onPickedRef.current = onPicked
  })

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`/api/fdc/search?q=${encodeURIComponent(ingredientName)}`)
        if (!res.ok) throw new Error(`search failed (${res.status})`)
        const data = (await res.json()) as {
          matches: FdcMatch[]
          resolved: Resolution | null
        }
        if (cancelled) return
        setResult({ query: ingredientName, ...data, error: null })
        if (data.resolved) onPickedRef.current(data.resolved)
      } catch (e) {
        if (cancelled) return
        setResult({
          query: ingredientName,
          resolved: null,
          matches: [],
          error: e instanceof Error ? e.message : 'search failed',
        })
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [ingredientName])

  async function pickMatch(match: FdcMatch) {
    setBusy(true)
    setActionError(null)
    try {
      const res = await fetch('/api/fdc/alias', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: ingredientName,
          fdcId: match.fdcId,
          per100g: match.per100g,
        }),
      })
      if (!res.ok) throw new Error(`saving alias failed (${res.status})`)
      onPicked({ kind: 'fdc', fdcId: match.fdcId, per100g: match.per100g })
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'saving alias failed')
    } finally {
      setBusy(false)
    }
  }

  async function queueCustomFood() {
    setBusy(true)
    setActionError(null)
    try {
      const res = await fetch('/api/custom-foods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: ingredientName,
          per100g: PLACEHOLDER_PER100G,
          origin: 'llm_drafted',
          draftReasoning: 'queued for LLM draft + owner approval',
        }),
      })
      if (!res.ok) throw new Error(`queueing custom food failed (${res.status})`)
      const data = (await res.json()) as { customFood: { id: string } }
      onPicked({
        kind: 'custom_food',
        customFoodId: data.customFood.id,
        per100g: PLACEHOLDER_PER100G,
      })
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'queueing custom food failed')
    } finally {
      setBusy(false)
    }
  }

  // Ignore results from a previous ingredientName while the new search runs.
  const current = result && result.query === ingredientName ? result : null

  if (current?.resolved) {
    return <p className="text-sm text-green-700 dark:text-green-400">auto-mapped ✓</p>
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Match &ldquo;{ingredientName}&rdquo;
      </p>
      {current?.error && (
        <p className="text-sm text-red-600 dark:text-red-400">{current.error}</p>
      )}
      {actionError && (
        <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p>
      )}
      {!current && (
        <p className="text-base text-gray-500 dark:text-gray-400">Searching…</p>
      )}
      {current?.matches.map((match) => (
        <button
          key={match.fdcId}
          type="button"
          disabled={busy}
          onClick={() => pickMatch(match)}
          className="w-full rounded border px-3 py-3 text-left text-base disabled:opacity-50 dark:border-gray-700"
        >
          <span className="block">{match.description}</span>
          <span className="block text-sm text-gray-500 dark:text-gray-400">
            {Math.round(match.per100g.kcal)} kcal/100g · {match.dataType}
          </span>
        </button>
      ))}
      {current && !current.error && (
        <button
          type="button"
          disabled={busy}
          onClick={queueCustomFood}
          className="w-full rounded border border-dashed px-3 py-3 text-base text-gray-700 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300"
        >
          No good match → queue custom food
        </button>
      )}
    </div>
  )
}
