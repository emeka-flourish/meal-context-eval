'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import Seg from './Seg'
import MealReview from './MealReview'
import type { AnnotateResponse, AnnotationPayload, QueueMeal, QueueResponse } from '@/lib/ui/corpus-types'
import { editStateFor, editsValid, planAgree, planExclude, type EditDish } from '@/lib/ui/corpus-format'

/* The annotation queue (CORPUS.md §2): GET /api/corpus/queue serves every
   meal that is not excluded and has no meal-level annotation yet. One meal per
   screen; Agree / Fix / Exclude write through POST /api/corpus/annotate and
   drop the meal from the local list; Skip only moves on. Keys: A F X S, Esc. */

type Order = 'pilot' | 'frequency' | 'all'
const PAGE = 500

const ORDER_HELP: Record<Order, string> = {
  pilot: 'Pilot = meals whose dishes also appear in the study ground truth, then by dish frequency',
  frequency: 'Meals with your most-logged dishes first',
  all: 'Every meal still in the queue, oldest first',
}

async function fetchQueue(order: Order): Promise<{ meals: QueueMeal[]; counts: QueueResponse['counts'] }> {
  const apiOrder = order === 'pilot' ? 'pilot' : 'frequency'
  const meals: QueueMeal[] = []
  let counts: QueueResponse['counts'] = { total: 0, pending: 0, annotated: 0, pilot: 0 }
  for (let offset = 0; ; offset += PAGE) {
    const r = await fetch(`/api/corpus/queue?order=${apiOrder}&limit=${PAGE}&offset=${offset}`)
    if (!r.ok) throw new Error(`queue ${r.status}`)
    const j = (await r.json()) as QueueResponse
    meals.push(...j.meals)
    counts = j.counts
    if (j.meals.length < PAGE) break
  }
  if (order === 'all') meals.sort((a, b) => a.localDate.localeCompare(b.localDate) || a.localTime.localeCompare(b.localTime))
  return { meals, counts }
}

async function postAnnotation(p: AnnotationPayload): Promise<AnnotateResponse> {
  const r = await fetch('/api/corpus/annotate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) })
  const j = (await r.json().catch(() => ({}))) as Partial<AnnotateResponse> & { error?: string }
  if (!r.ok || !j.ok) throw new Error(j.error ?? `annotate ${r.status}`)
  return j as AnnotateResponse
}

export default function ReviewQueue({
  versionId,
  onChanged,
  onToast,
}: {
  versionId: string | null
  onChanged: () => void
  onToast: (msg: string) => void
}) {
  const [order, setOrder] = useState<Order>('pilot')
  // the loaded queue is keyed by its order, so switching orders shows "loading" without a reset effect
  const [loaded, setLoaded] = useState<{ order: Order; meals: QueueMeal[]; counts: QueueResponse['counts'] } | null>(null)
  const [loadErr, setLoadErr] = useState<{ order: Order; message: string } | null>(null)
  const [index, setIndex] = useState(0)
  const [done, setDone] = useState(0)
  const [initialTotal, setInitialTotal] = useState(0)
  // per-meal edit state, keyed so a new meal always starts from its own rows
  const [editing, setEditing] = useState<{ mealId: string; edits: EditDish[]; mode: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionErr, setActionErr] = useState<string | null>(null)
  const [zoomOpen, setZoomOpen] = useState(false)

  useEffect(() => {
    let live = true
    fetchQueue(order)
      .then((q) => {
        if (!live) return
        setLoaded({ order, meals: q.meals, counts: q.counts })
        setLoadErr(null)
        setIndex(0)
        setDone(0)
        setInitialTotal(q.meals.length)
        setEditing(null)
      })
      .catch((e) => live && setLoadErr({ order, message: e instanceof Error ? e.message : String(e) }))
    return () => {
      live = false
    }
  }, [order])

  const meals = loaded?.order === order ? loaded.meals : null
  const counts = loaded?.order === order ? loaded.counts : null
  const setMeals = (fn: (ms: QueueMeal[]) => QueueMeal[]) => setLoaded((l) => (l ? { ...l, meals: fn(l.meals) } : l))
  const meal = meals && index < meals.length ? meals[index] : null
  const edits = meal ? (editing?.mealId === meal.id ? editing.edits : editStateFor(meal)) : []
  const editMode = Boolean(meal && editing?.mealId === meal.id && editing.mode)

  const setEdits = (next: EditDish[]) => {
    if (!meal) return
    setEditing({ mealId: meal.id, edits: next, mode: editing?.mealId === meal.id ? editing.mode : false })
  }

  function complete(label: string) {
    if (!meal) return
    const id = meal.id
    setMeals((ms) => ms.filter((m) => m.id !== id))
    setDone((d) => d + 1)
    setEditing(null)
    setActionErr(null)
    onChanged()
    onToast(label)
  }

  async function runPlan(payloads: AnnotationPayload[], label: string) {
    if (busy || !meal) return
    setBusy(true)
    setActionErr(null)
    try {
      for (const p of payloads) await postAnnotation(p)
      complete(label)
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function agree() {
    if (!meal) return
    if (editMode) {
      const problem = editsValid(edits)
      if (problem) {
        setActionErr(`Cannot save fix: ${problem}.`)
        return
      }
    }
    const plan = planAgree(meal, edits)
    const what =
      plan.changedDishes || plan.removedDishes
        ? `Fixed · ${meal.name} → corrected (${plan.changedDishes} dish${plan.changedDishes === 1 ? '' : 'es'} changed${plan.removedDishes ? `, ${plan.removedDishes} removed` : ''})`
        : `Agreed · ${meal.name} → corrected`
    void runPlan(plan.payloads, what)
  }

  function fix() {
    if (!meal) return
    setActionErr(null)
    setEditing({ mealId: meal.id, edits, mode: !editMode })
  }

  function cancelFix() {
    if (!meal) return
    setEditing(null)
    setActionErr(null)
  }

  function exclude() {
    if (!meal) return
    void runPlan(planExclude(meal), `Excluded · ${meal.name} (out of distillation)`)
  }

  function skip() {
    if (!meals) return
    setEditing(null)
    setActionErr(null)
    setIndex((i) => Math.min(i + 1, meals.length))
  }

  function back() {
    setEditing(null)
    setActionErr(null)
    setIndex((i) => Math.max(i - 1, 0))
  }

  // keyboard: A agree · F fix · X exclude · S skip · Esc leaves edit mode.
  // Ignored while typing, while the zoom dialog is open, or while a write is in flight.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      const typing = Boolean(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable))
      if (typing) {
        if (e.key === 'Escape') t?.blur()
        return
      }
      if (zoomOpen || busy || !meal) return
      switch (e.key.toLowerCase()) {
        case 'a':
          e.preventDefault()
          agree()
          break
        case 'f':
          e.preventDefault()
          fix()
          break
        case 'x':
          e.preventDefault()
          exclude()
          break
        case 's':
          e.preventDefault()
          skip()
          break
        case 'escape':
          if (editMode) cancelFix()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const position = done + index + 1
  const total = initialTotal || (meals?.length ?? 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <Seg<Order>
          value={order}
          onChange={setOrder}
          ariaLabel="Queue order"
          options={[
            { value: 'pilot', label: 'Pilot dishes first' },
            { value: 'frequency', label: 'Frequent dishes' },
            { value: 'all', label: 'Everything' },
          ]}
        />
        <span className="text-ink-muted">{ORDER_HELP[order]}</span>
        <span className="ml-auto font-mono text-ink-muted">
          {meals && meals.length > 0 && index < meals.length ? `meal ${position} of ${total}` : meals ? `${meals.length} left` : ''}
        </span>
      </div>

      {order === 'pilot' && counts && counts.pilot === 0 && meals && meals.length > 0 && (
        <div className="rounded-md border border-estimated-line bg-estimated-bg px-3 py-2 text-estimated-ink">
          No pilot matches yet — the study ground truth has no confirmed dish names to match against. Showing your frequent dishes instead;
          switch back once GT is confirmed on Intake.
        </div>
      )}

      {loadErr?.order === order && <div className="text-over-ink">Could not load the queue ({loadErr.message}).</div>}
      {!meals && !loadErr && <div className="text-ink-muted">Loading queue…</div>}

      {meals && meals.length === 0 && (
        <div className="rounded-[10px] border border-line bg-white px-5 py-8 text-center">
          <div className="text-[15px] font-semibold">Queue empty</div>
          <div className="mt-1 text-ink-muted">Every non-excluded meal has a meal-level annotation. Build the context to distill what you confirmed.</div>
        </div>
      )}

      {meals && meals.length > 0 && !meal && (
        <div className="rounded-[10px] border border-line bg-white px-5 py-8 text-center">
          <div className="text-[15px] font-semibold">End of the queue</div>
          <div className="mt-1 text-ink-muted">
            {meals.length} skipped meal{meals.length === 1 ? '' : 's'} remain unannotated in this order.
          </div>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => setIndex(0)}>
            Start over with the skipped meals
          </Button>
        </div>
      )}

      {meal && (
        <MealReview
          meal={meal}
          edits={edits}
          editMode={editMode}
          busy={busy}
          actionErr={actionErr}
          versionId={versionId}
          zoomOpen={zoomOpen}
          onZoomChange={setZoomOpen}
          onEditsChange={setEdits}
          onAgree={agree}
          onFix={fix}
          onCancelFix={cancelFix}
          onExclude={exclude}
          onSkip={skip}
          onBack={index > 0 ? back : undefined}
        />
      )}
    </div>
  )
}
