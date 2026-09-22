'use client'
import { useMemo, useState } from 'react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Identity, Tag } from '@/lib/scoring/types'
import { fmtGrams } from '@/lib/ui/format'
import type { MatchOverrideRequest, MatchOverrideResponse, MealColumn, TruthItemDto } from '@/lib/ui/results-types'

/* Match review (REBUILD-SPEC §3.4): click a pairing → re-pair the truth item
   with other prediction(s) (many-to-one allowed) at exact / substitute, or
   mark it unmatched. POST /api/results/match-override writes
   MatchTable.overrides and rescores the cell. */

export type ReviewTarget = { column: MealColumn; truth: TruthItemDto }

type Props = {
  runId: string
  target: ReviewTarget | null
  onClose: () => void
  onSaved: (res: MatchOverrideResponse) => void
}

export default function MatchReviewDialog(props: Props) {
  const { target, onClose } = props
  return (
    <Dialog open={Boolean(target)} onOpenChange={(o) => !o && onClose()}>
      {target && <ReviewBody key={`${target.column.key}|${target.truth.id}`} {...props} target={target} />}
    </Dialog>
  )
}

/** Keyed by (column, truth item) so every opening starts from the stored pairing. */
function ReviewBody({ runId, target, onClose, onSaved }: Props & { target: ReviewTarget }) {
  const { column, truth } = target
  const current = useMemo(() => column.matches.find((m) => m.truthId === truth.id) ?? null, [column, truth.id])
  const [selected, setSelected] = useState<Set<string>>(() => new Set(current?.predIds ?? []))
  const [identity, setIdentity] = useState<Identity>(() => (current && current.identity !== 0 ? current.identity : 1))
  const [inventedTag, setInventedTag] = useState<Tag>('garnish')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** where each prediction currently sits, for the picker labels */
  const placeOf = (predId: string): string => {
    const row = column.matches.find((m) => m.predIds.includes(predId))
    if (row) return row.truthId === truth.id ? 'this item' : 'paired elsewhere'
    if (column.invented.some((i) => i.predId === predId)) return 'invented'
    if (column.droppedDrinks.includes(predId)) return 'drink (dropped)'
    return ''
  }

  async function save(asUnmatched: boolean) {
    setBusy(true)
    setError(null)
    const body: MatchOverrideRequest = {
      run: runId,
      decompositionId: column.decompositionId!,
      truthId: truth.id,
      predIds: asUnmatched ? [] : [...selected],
      identity: asUnmatched ? 0 : identity,
      inventedTag,
    }
    try {
      const r = await fetch('/api/results/match-override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = (await r.json()) as MatchOverrideResponse | { error: string }
      if (!r.ok || !('ok' in j)) throw new Error('error' in j ? j.error : `override ${r.status}`)
      onSaved(j)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const unchanged = current !== null && selected.size === current.predIds.length && current.predIds.every((id) => selected.has(id)) && (selected.size === 0 || identity === current.identity)

  return (
    <DialogContent className="max-w-[640px] sm:max-w-[640px]">
      <DialogHeader>
        <DialogTitle>
          Fix the pairing · <span className="font-normal text-ink-muted">{column.label}</span>
        </DialogTitle>
        <DialogDescription>
          Ground truth <b className="text-ink">{truth.name}</b> ({truth.dish}
          {truth.grams != null ? ` · ${fmtGrams(truth.grams)} g` : ''}) — currently{' '}
          {current && current.predIds.length ? `paired with ${current.predIds.length} prediction(s), ${current.status}` : 'unmatched'}. Pick the prediction(s) that are this item; a prediction taken
          from another row frees that row, and freed predictions become invented.
        </DialogDescription>
      </DialogHeader>

      <div className="flex max-h-[46vh] flex-col gap-1 overflow-auto rounded-md border border-line">
        {column.preds.length === 0 && <span className="px-3 py-2 text-ink-faint">this column has no predictions</span>}
        {column.preds
          .filter((p) => !column.droppedDrinks.includes(p.id))
          .map((p) => {
            const on = selected.has(p.id)
            const place = placeOf(p.id)
            return (
              <label key={p.id} className={cn('flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-tint', on && 'bg-brand-soft/60')}>
                <Checkbox
                  checked={on}
                  onCheckedChange={(c) =>
                    setSelected((s) => {
                      const n = new Set(s)
                      if (c) n.add(p.id)
                      else n.delete(p.id)
                      return n
                    })
                  }
                />
                <span className="flex-1">
                  {p.name}
                  {p.inferred && <span className="text-ink-faint"> (inferred)</span>}
                  <span className="text-ink-muted"> · {p.dish}</span>
                </span>
                <span className="font-mono text-ink-muted">{p.grams != null ? `${fmtGrams(p.grams)} g` : '—'}</span>
                <span className={cn('chip chip-sm', place === 'this item' && 'chip-weighed', place === 'invented' && 'chip-estimated')}>{place || '—'}</span>
              </label>
            )
          })}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[12px]">
        <span className="text-ink-muted">identity</span>
        <span className="seg">
          <button type="button" data-on={identity === 1} onClick={() => setIdentity(1)}>
            exact
          </button>
          <button type="button" data-on={identity === 0.5} onClick={() => setIdentity(0.5)}>
            substitute
          </button>
        </span>
        <span className="ml-3 text-ink-muted">freed predictions become</span>
        <span className="seg">
          {(['core', 'secondary', 'garnish', 'spice'] as Tag[]).map((t) => (
            <button key={t} type="button" data-on={inventedTag === t} onClick={() => setInventedTag(t)}>
              {t}
            </button>
          ))}
        </span>
      </div>

      {error && <div className="text-over-ink">{error}</div>}

      <DialogFooter className="gap-2 sm:justify-between">
        <Button variant="outline" size="sm" disabled={busy || (current !== null && current.predIds.length === 0)} onClick={() => save(true)}>
          Mark unmatched (missed)
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" disabled={busy || selected.size === 0 || unchanged} onClick={() => save(false)}>
            {busy ? 'Saving…' : 'Save pairing & rescore'}
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  )
}
