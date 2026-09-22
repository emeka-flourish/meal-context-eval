'use client'
import { useEffect, useMemo, useState } from 'react'
import { cn } from 'cn'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { RedraftPayload, SceneDto } from '@/lib/ui/intake-types'
import {
  GT_BASES,
  GT_STATES,
  GT_TAGS,
  dishFromQuestion,
  fromDto,
  groupByDish,
  isHiddenFatQuestion,
  loadDraft,
  newKey,
  rowError,
  rowsValid,
  saveDraft,
  toPayload,
  totalGrams,
  type GtBasis,
  type GtRow,
  type GtState,
  type GtTag,
} from '@/lib/ui/gt'
import { fmtGrams } from '@/lib/ui/format'

/* Structured ground truth for ONE photo scene: an editable tree of GtItem
   rows grouped by dish (dish · ingredient | tag | grams | basis | state |
   prep | remove). "Re-draft from notes" calls the structurer and holds the
   result as an unsaved draft (localStorage); "Confirm" persists via
   PUT /api/intake/scenes/[id]/items. Hidden-fat questions from the structurer
   become oil rows when answered. */

export default function GtEditor({
  scene,
  onSceneUpdated,
  onDraftChange,
}: {
  scene: SceneDto
  onSceneUpdated: (s: SceneDto) => void
  onDraftChange: (sceneId: string, hasDraft: boolean) => void
}) {
  const persisted = useMemo(() => JSON.stringify(toPayload(fromDto(scene.items))), [scene.items])
  // GtEditor is mounted per scene (key={scene.id}) and only after the day
  // has been fetched client-side, so a stashed draft can seed state directly.
  const [stash] = useState(() => loadDraft(scene.id))
  const [rows, setRows] = useState<GtRow[]>(() => stash?.rows ?? fromDto(scene.items))
  const [questions, setQuestions] = useState<string[]>(() => stash?.questions ?? [])
  const [dropped, setDropped] = useState<string[]>(() => stash?.dropped ?? [])
  const [structurer, setStructurer] = useState<string | null>(() => stash?.structurer ?? null)
  const [busy, setBusy] = useState<'redraft' | 'confirm' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmRedraft, setConfirmRedraft] = useState(false)

  const dirty = JSON.stringify(toPayload(rows)) !== persisted
  const valid = rowsValid(rows)

  // stash unsaved work so a reload does not lose a re-draft
  useEffect(() => {
    if (dirty) saveDraft(scene.id, { rows, questions, dropped, structurer: structurer ?? 'manual', at: new Date().toISOString() })
    else saveDraft(scene.id, null)
    onDraftChange(scene.id, dirty)
  }, [dirty, rows, questions, dropped, structurer, scene.id, onDraftChange])

  const groups = groupByDish(rows)
  const dishes = groups.map((g) => g.dish)

  function update(key: string, patch: Partial<GtRow>) {
    setRows((rs) =>
      rs.map((r) => {
        if (r.key !== key) return r
        const next = { ...r, ...patch }
        if (next.tag === 'ignore') {
          next.grams = null
          next.basis = null
        }
        if (next.grams != null && next.grams > 0 && !next.basis) next.basis = 'estimated'
        if (next.grams == null) next.basis = null
        return next
      }),
    )
  }
  function remove(key: string) {
    setRows((rs) => rs.filter((r) => r.key !== key))
  }
  function renameDish(from: string, to: string) {
    setRows((rs) => rs.map((r) => (r.dish === from ? { ...r, dish: to } : r)))
  }
  function addIngredient(dish: string, preset?: Partial<GtRow>) {
    setRows((rs) => {
      const last = rs.map((r, i) => (r.dish === dish ? i : -1)).filter((i) => i >= 0).pop()
      const row: GtRow = {
        key: newKey(),
        dish,
        name: '',
        grams: null,
        basis: null,
        tag: 'secondary',
        state: null,
        componentsNote: null,
        ...preset,
      }
      if (last === undefined) return [...rs, row]
      return [...rs.slice(0, last + 1), row, ...rs.slice(last + 1)]
    })
  }
  function addDish() {
    const n = groups.length + 1
    let dish = `Dish ${n}`
    let k = n
    while (dishes.includes(dish)) dish = `Dish ${++k}`
    addIngredient(dish, { tag: 'core' })
  }

  async function redraft() {
    setConfirmRedraft(false)
    setBusy('redraft')
    setError(null)
    try {
      const r = await fetch(`/api/intake/scenes/${scene.id}/redraft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const j = (await r.json()) as RedraftPayload & { error?: string }
      if (!r.ok) throw new Error(j.error ?? `redraft ${r.status}`)
      setRows(fromDto(j.items))
      setQuestions(j.questions)
      setDropped(j.dropped)
      setStructurer(`${j.structurer}${j.mocked ? ' (deterministic — no model key)' : ''}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function confirm() {
    setBusy('confirm')
    setError(null)
    try {
      const r = await fetch(`/api/intake/scenes/${scene.id}/items`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: toPayload(rows) }),
      })
      const j = (await r.json()) as { scene?: SceneDto; error?: string; problems?: string[] }
      if (!r.ok || !j.scene) throw new Error(j.problems?.join('; ') ?? j.error ?? `confirm ${r.status}`)
      saveDraft(scene.id, null)
      setQuestions([])
      onSceneUpdated(j.scene)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  function answerFat(q: string, grams: number | null) {
    setQuestions((qs) => qs.filter((x) => x !== q))
    if (grams == null) return
    const dish = dishFromQuestion(q, dishes) ?? dishes[0] ?? 'Dish 1'
    addIngredient(dish, {
      name: 'cooking oil',
      grams,
      basis: 'estimated',
      tag: grams >= 14 ? 'secondary' : 'garnish',
      state: null,
    })
  }

  const status =
    dirty ? { cls: 'chip-estimated', text: 'drafted · unsaved' } : rows.length ? { cls: 'chip-weighed', text: 'confirmed' } : { cls: '', text: 'no ground truth yet' }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <b>Structured ground truth</b>
        <span className="text-ink-muted">edit anything inline · tags per the tag guide · drinks are never recorded</span>
        <span className={cn('chip', status.cls)}>{status.text}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy !== null || !scene.notes?.trim()}
            title={scene.notes?.trim() ? 'Run the structurer on the verbatim notes' : 'Add notes first'}
            onClick={() => (rows.length ? setConfirmRedraft(true) : redraft())}
          >
            {busy === 'redraft' ? 'Drafting…' : 'Re-draft from notes'}
          </Button>
          <Button type="button" size="sm" disabled={busy !== null || !valid || (!dirty && rows.length > 0)} onClick={confirm}>
            {busy === 'confirm' ? 'Saving…' : 'Confirm'}
          </Button>
        </div>
      </div>

      {error && <div className="rounded-md border border-over-ink/30 bg-over-bg px-2.5 py-1.5 text-xs text-over-ink">{error}</div>}

      {questions.map((q) => (
        <div key={q} className="flex items-center gap-2 rounded-md border border-estimated-line bg-estimated-bg px-2.5 py-1.5 text-xs">
          <b>{isHiddenFatQuestion(q) ? 'Hidden-fat check' : 'Check'}</b>
          <span className="min-w-0 flex-1">{q}</span>
          {isHiddenFatQuestion(q) ? <FatAnswer onAnswer={(g) => answerFat(q, g)} /> : (
            <Button type="button" variant="ghost" size="sm" onClick={() => setQuestions((qs) => qs.filter((x) => x !== q))}>
              noted
            </Button>
          )}
        </div>
      ))}
      {dropped.length > 0 && (
        <div className="text-[11px] text-ink-faint">Dropped (drinks are never items): {dropped.join(' · ')}</div>
      )}
      {structurer && <div className="text-[11px] text-ink-faint">Drafted by {structurer} — nothing is saved until you confirm.</div>}

      {/* no fixed height: every row shows and the page scrolls (long food lists were cut off) */}
      <div className="overflow-x-auto">
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="th-label w-[34%] px-2">dish · ingredient</TableHead>
              <TableHead className="th-label px-2">tag</TableHead>
              <TableHead className="th-label px-2 text-right">grams</TableHead>
              <TableHead className="th-label px-2">basis</TableHead>
              <TableHead className="th-label px-2">state</TableHead>
              <TableHead className="th-label px-2">prep</TableHead>
              <TableHead className="w-8" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => (
              <DishGroup
                key={g.dish}
                dish={g.dish}
                rows={g.rows}
                onRename={(to) => renameDish(g.dish, to)}
                onAdd={() => addIngredient(g.dish)}
                onUpdate={update}
                onRemove={remove}
              />
            ))}
            <TableRow className="hover:bg-transparent">
              <TableCell className="px-2 py-1.5">
                <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={addDish}>
                  + dish
                </Button>
                {groups.length > 0 && (
                  <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => addIngredient(groups[groups.length - 1].dish)}>
                    + ingredient
                  </Button>
                )}
              </TableCell>
              <TableCell />
              <TableCell className="px-2 text-right font-mono text-ink-muted">{fmtGrams(totalGrams(rows))}</TableCell>
              <TableCell className="px-2 text-ink-muted">total</TableCell>
              <TableCell colSpan={3} />
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <div className="text-xs text-ink-muted">
        Core and secondary items must carry grams (weighed, estimated, or converted). Garnish and spice may not. Drinks are never recorded.
      </div>

      <Dialog open={confirmRedraft} onOpenChange={setConfirmRedraft}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Replace the current ground truth?</DialogTitle>
            <DialogDescription>
              Re-drafting from the notes discards the {rows.length} item{rows.length === 1 ? '' : 's'} on screen
              {dirty ? ', including unsaved edits' : ''}. The notes stay verbatim; nothing is saved until you confirm.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmRedraft(false)}>
              Keep my items
            </Button>
            <Button type="button" onClick={redraft}>
              Re-draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function FatAnswer({ onAnswer }: { onAnswer: (grams: number | null) => void }) {
  const [custom, setCustom] = useState<string | null>(null)
  if (custom !== null) {
    return (
      <form
        className="ml-auto flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault()
          const g = Number(custom)
          if (g > 0) onAnswer(g)
        }}
      >
        <Input autoFocus type="number" min={1} step="any" value={custom} onChange={(e) => setCustom(e.target.value)} className="h-6 w-16 text-xs" placeholder="g" />
        <Button type="submit" size="sm" className="h-6 px-2 text-[11px]">
          add
        </Button>
      </form>
    )
  }
  return (
    <span className="seg ml-auto">
      <button type="button" onClick={() => onAnswer(null)}>none</button>
      <button type="button" onClick={() => onAnswer(5)}>a little (~5 g)</button>
      <button type="button" onClick={() => onAnswer(14)}>a lot (~14 g)</button>
      <button type="button" onClick={() => setCustom('')}>grams…</button>
    </span>
  )
}

function DishGroup({
  dish,
  rows,
  onRename,
  onAdd,
  onUpdate,
  onRemove,
}: {
  dish: string
  rows: GtRow[]
  onRename: (to: string) => void
  onAdd: () => void
  onUpdate: (key: string, patch: Partial<GtRow>) => void
  onRemove: (key: string) => void
}) {
  // keyed by dish name in the parent → a rename remounts with the new name
  const [name, setName] = useState(dish)
  return (
    <>
      <TableRow className="bg-rail hover:bg-rail">
        <TableCell colSpan={7} className="px-2 py-1">
          <div className="flex items-center gap-2">
            <span className="th-label">dish</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name.trim() && name !== dish && onRename(name.trim())}
              className="h-6 max-w-[360px] border-transparent bg-transparent px-1 text-[13px] font-semibold shadow-none hover:border-line focus-visible:border-line"
              aria-label="Dish name"
            />
            <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={onAdd}>
              + ingredient
            </Button>
          </div>
        </TableCell>
      </TableRow>
      {rows.map((r) => (
        <ItemRow key={r.key} row={r} onUpdate={onUpdate} onRemove={onRemove} />
      ))}
    </>
  )
}

function ItemRow({
  row,
  onUpdate,
  onRemove,
}: {
  row: GtRow
  onUpdate: (key: string, patch: Partial<GtRow>) => void
  onRemove: (key: string) => void
}) {
  const err = rowError(row)
  const gramsErr = err && /grams|basis/.test(err)
  return (
    <TableRow className={cn('align-top hover:bg-transparent', err && 'bg-over-bg/40')}>
      <TableCell className="px-2 py-1">
        <div className="flex items-center gap-1 pl-4">
          <Input
            value={row.name}
            onChange={(e) => onUpdate(row.key, { name: e.target.value })}
            placeholder="ingredient"
            aria-invalid={!row.name.trim()}
            className={cn('h-7 text-[13px]', row.tag === 'core' && 'font-semibold', (row.tag === 'garnish' || row.tag === 'spice' || row.tag === 'ignore') && 'text-ink-muted')}
          />
        </div>
        {row.componentsNote !== null && (
          <Input
            value={row.componentsNote}
            onChange={(e) => onUpdate(row.key, { componentsNote: e.target.value })}
            placeholder="components — shared weight"
            className="mt-1 ml-4 h-6 border-transparent bg-transparent px-1 text-[11px] text-ink-muted shadow-none hover:border-line"
            aria-label="Components note"
          />
        )}
        {err && <div className="ml-4 mt-0.5 text-[11px] text-over-ink">{err}</div>}
      </TableCell>
      <TableCell className="px-2 py-1">
        <Select value={row.tag} onValueChange={(v) => onUpdate(row.key, { tag: v as GtTag })}>
          <SelectTrigger size="sm" className={cn('h-7 w-[112px] text-xs', row.tag === 'core' && 'bg-brand-soft')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GT_TAGS.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="px-2 py-1 text-right">
        <Input
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          value={row.grams ?? ''}
          disabled={row.tag === 'ignore'}
          aria-invalid={Boolean(gramsErr)}
          onChange={(e) => onUpdate(row.key, { grams: e.target.value === '' ? null : Number(e.target.value) })}
          className="h-7 w-[84px] text-right font-mono text-[13px]"
          placeholder={row.tag === 'core' || row.tag === 'secondary' ? 'required' : '—'}
        />
      </TableCell>
      <TableCell className="px-2 py-1">
        <Select
          value={row.basis ?? ''}
          disabled={row.grams == null}
          onValueChange={(v) => onUpdate(row.key, { basis: (v || null) as GtBasis | null })}
        >
          <SelectTrigger
            size="sm"
            className={cn('h-7 w-[118px] text-xs', row.basis === 'weighed' && 'border-weighed-line bg-weighed-bg text-weighed-ink', (row.basis === 'estimated' || row.basis === 'converted') && 'border-estimated-line bg-estimated-bg text-estimated-ink')}
          >
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {GT_BASES.map((b) => (
              <SelectItem key={b} value={b}>
                {b}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="px-2 py-1">
        <Select value={row.state ?? 'none'} onValueChange={(v) => onUpdate(row.key, { state: v === 'none' ? null : (v as GtState) })}>
          <SelectTrigger size="sm" className="h-7 w-[96px] text-xs">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">—</SelectItem>
            {GT_STATES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="px-2 py-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Input disabled value="" placeholder="—" className="h-7 w-[84px] text-xs" aria-label="Preparation (not stored)" />
            </span>
          </TooltipTrigger>
          <TooltipContent>Preparation is read from the notes; GtItem has no column for it yet, so it is not stored.</TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell className="px-1 py-1">
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => onRemove(row.key)} aria-label={`Remove ${row.name || 'item'}`} className="text-ink-faint hover:text-over-ink">
          <Trash2 className="size-3.5" />
        </Button>
      </TableCell>
    </TableRow>
  )
}
