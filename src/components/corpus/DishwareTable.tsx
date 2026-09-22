'use client'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { DishwareDto } from '@/lib/ui/corpus-types'
import { fmtCapacity } from '@/lib/ui/corpus-format'

/* Dishware registry (CORPUS.md §3): the LIVE rows (contextVersionId NULL),
   hand-entered once — add / edit / delete through /api/corpus/dishware. A
   build snapshots the live rows onto the new context version. */

type Draft = { name: string; capacityMl: string; capacityG: string; usedFor: string }
const EMPTY: Draft = { name: '', capacityMl: '', capacityG: '', usedFor: '' }

const toDraft = (d: DishwareDto): Draft => ({
  name: d.name,
  capacityMl: d.capacityMl == null ? '' : String(d.capacityMl),
  capacityG: d.capacityG == null ? '' : String(d.capacityG),
  usedFor: d.usedFor ?? '',
})

async function fetchDishware(): Promise<DishwareDto[]> {
  const r = await fetch('/api/corpus/dishware')
  if (!r.ok) throw new Error(`dishware ${r.status}`)
  return ((await r.json()) as { dishware: DishwareDto[] }).dishware
}

const toBody = (d: Draft) => ({
  name: d.name.trim(),
  capacityMl: d.capacityMl.trim() === '' ? null : Number(d.capacityMl),
  capacityG: d.capacityG.trim() === '' ? null : Number(d.capacityG),
  usedFor: d.usedFor.trim() || null,
})

export default function DishwareTable({ onToast, snapshotCount }: { onToast: (m: string) => void; snapshotCount?: number }) {
  const [rows, setRows] = useState<DishwareDto[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    () =>
      fetchDishware()
        .then((rows) => {
          setRows(rows)
          setErr(null)
        })
        .catch((e) => setErr(e instanceof Error ? e.message : String(e))),
    [],
  )

  useEffect(() => {
    let live = true
    fetchDishware()
      .then((rows) => live && setRows(rows))
      .catch((e) => live && setErr(e instanceof Error ? e.message : String(e)))
    return () => {
      live = false
    }
  }, [])

  async function send(method: 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown) {
    const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
    const j = (await r.json().catch(() => ({}))) as { error?: string }
    if (!r.ok) throw new Error(j.error ?? `${method} ${r.status}`)
  }

  async function save() {
    if (!draft.name.trim()) {
      setErr('name required')
      return
    }
    setBusy(true)
    try {
      if (editId) await send('PATCH', `/api/corpus/dishware/${editId}`, toBody(draft))
      else await send('POST', '/api/corpus/dishware', toBody(draft))
      onToast(`${editId ? 'Updated' : 'Added'} dishware · ${draft.name.trim()}`)
      setAdding(false)
      setEditId(null)
      setDraft(EMPTY)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove(d: DishwareDto) {
    if (!window.confirm(`Delete “${d.name}” from the live registry? Snapshots on built versions keep it.`)) return
    setBusy(true)
    try {
      await send('DELETE', `/api/corpus/dishware/${d.id}`)
      onToast(`Deleted dishware · ${d.name}`)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function startEdit(d: DishwareDto) {
    setAdding(false)
    setEditId(d.id)
    setDraft(toDraft(d))
    setErr(null)
  }

  function cancel() {
    setAdding(false)
    setEditId(null)
    setDraft(EMPTY)
    setErr(null)
  }

  // Enter saves from any field, Esc cancels
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void save()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
  }

  const form = (
    <tr className="bg-rail">
      <td className="px-2 py-1.5">
        <Input value={draft.name} autoFocus placeholder="Blue bowl" aria-label="Dishware name" className="h-7" onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={onKey} />
      </td>
      <td className="px-2 py-1.5">
        <div className="flex gap-1">
          <Input value={draft.capacityMl} inputMode="decimal" placeholder="ml" aria-label="Capacity in ml" className="h-7 w-[64px] text-right font-mono" onChange={(e) => setDraft({ ...draft, capacityMl: e.target.value })} onKeyDown={onKey} />
          <Input value={draft.capacityG} inputMode="decimal" placeholder="g" aria-label="Capacity in grams" className="h-7 w-[64px] text-right font-mono" onChange={(e) => setDraft({ ...draft, capacityG: e.target.value })} onKeyDown={onKey} />
        </div>
      </td>
      <td className="px-2 py-1.5">
        <Input value={draft.usedFor} placeholder="soups, oatmeal" aria-label="Used for" className="h-7" onChange={(e) => setDraft({ ...draft, usedFor: e.target.value })} onKeyDown={onKey} />
      </td>
      <td className="px-2 py-1.5 whitespace-nowrap">
        <Button size="xs" onClick={save} disabled={busy}>
          {editId ? 'save' : 'add'}
        </Button>
        <Button size="xs" variant="ghost" onClick={cancel} disabled={busy} className="ml-1 text-ink-muted">
          cancel
        </Button>
      </td>
    </tr>
  )

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden rounded-[10px] border border-line bg-white px-4 py-3.5" aria-label="Dishware">
      <div className="flex items-baseline gap-2">
        <b>Dishware</b>
        <span className="text-ink-muted">entered once by you{snapshotCount != null ? ` · ${snapshotCount} on this version` : ''}</span>
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto text-ink-muted"
          disabled={busy || adding}
          onClick={() => {
            setEditId(null)
            setDraft(EMPTY)
            setAdding(true)
            setErr(null)
          }}
        >
          + add
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="th-label border-b border-line px-2 py-1.5 text-left">item</th>
              <th className="th-label border-b border-line px-2 py-1.5 text-left">capacity</th>
              <th className="th-label border-b border-line px-2 py-1.5 text-left">used for</th>
              <th className="th-label border-b border-line px-2 py-1.5 text-left" />
            </tr>
          </thead>
          <tbody>
            {rows?.map((d) =>
              editId === d.id ? (
                <DishwareFormRow key={d.id}>{form}</DishwareFormRow>
              ) : (
                <tr key={d.id} className="group">
                  <td className="border-b border-line-soft px-2 py-1.5">{d.name}</td>
                  <td className="border-b border-line-soft px-2 py-1.5 font-mono whitespace-nowrap">{fmtCapacity(d)}</td>
                  <td className="border-b border-line-soft px-2 py-1.5 text-ink-muted">{d.usedFor ?? '—'}</td>
                  <td className="border-b border-line-soft px-2 py-1.5 text-right whitespace-nowrap">
                    <Button size="xs" variant="ghost" className="text-ink-muted" disabled={busy} onClick={() => startEdit(d)}>
                      edit
                    </Button>
                    <Button size="xs" variant="ghost" className="text-ink-muted hover:text-over-ink" disabled={busy} onClick={() => remove(d)}>
                      delete
                    </Button>
                  </td>
                </tr>
              ),
            )}
            {adding && form}
            {rows && rows.length === 0 && !adding && (
              <tr>
                <td colSpan={4} className="px-2 py-3 text-ink-faint">
                  Nothing entered yet — add the bowls, plates and boxes you eat from.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {err && <div className="text-over-ink">{err}</div>}
      <div className="text-[12px] text-ink-muted">Fill level in a known dish is what turns a photo into grams.</div>
    </section>
  )
}

/** React needs a keyed wrapper when the same form element replaces a row. */
function DishwareFormRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
