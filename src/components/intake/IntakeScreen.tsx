'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import CalendarRail from '@/components/shell/CalendarRail'
import MealCard from './MealCard'
import MealDrawer from './MealDrawer'
import UnsortedTray, { AssignDialog, type AssignTarget } from './UnsortedTray'
import { StatusHelp } from './SceneStatus'
import type { DayPayload, MealDto, SceneDto } from '@/lib/ui/intake-types'
import { mealGtStatus } from '@/lib/ui/intake-types'
import { REQUIRED_VANTAGES, addMonths, capitalize, dayTitle, isoDay, isoMonth, plural, slotRank, type Vantage } from '@/lib/ui/format'

/* Intake (REBUILD-SPEC §3.1): calendar rail → day view (unsorted photos panel,
   meal cards with one row per photo scene) → meal drawer (notes + food list).
   The day view scrolls as one page: nothing in it has a fixed height, so long
   notes and long food lists are never cut off. URL carries the day:
   /intake?date=YYYY-MM-DD. Data: /api/intake/day, /api/intake/days. */

export default function IntakeScreen() {
  const params = useSearchParams()
  const router = useRouter()
  const [date, setDate] = useState<string | null>(params.get('date'))
  const [month, setMonth] = useState<string>(params.get('date')?.slice(0, 7) ?? isoMonth(new Date()))
  const [day, setDay] = useState<DayPayload | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [selectedMeal, setSelectedMeal] = useState<string | null>(null)
  const [railKey, setRailKey] = useState(0)
  const [drafts, setDrafts] = useState<Set<string>>(() => new Set())
  const [assign, setAssign] = useState<AssignTarget | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [focusScene, setFocusScene] = useState<{ id: string; nonce: number } | null>(null)

  // No day in the URL: open the most recent day that has captures (walk back
  // month by month), else today.
  useEffect(() => {
    if (date) return
    let live = true
    ;(async () => {
      let m = isoMonth(new Date())
      for (let i = 0; i < 12; i++) {
        const r = await fetch(`/api/intake/days?month=${m}`)
        if (!r.ok) break
        const p = (await r.json()) as { days: { date: string }[] }
        if (p.days.length) {
          if (!live) return
          setMonth(m)
          setDate(p.days[p.days.length - 1].date)
          return
        }
        m = addMonths(m, -1)
      }
      if (live) setDate(isoDay(new Date()))
    })()
    return () => {
      live = false
    }
  }, [date])

  const applyDay = useCallback((p: DayPayload) => {
    setDay(p)
    setLoadErr(null)
    setSelectedMeal((cur) => (cur && p.meals.some((m) => m.id === cur) ? cur : (p.meals[0]?.id ?? null)))
  }, [])

  const fetchDay = useCallback(
    (d: string) =>
      fetch(`/api/intake/day?date=${d}`).then(async (r) => {
        if (!r.ok) throw new Error(`day ${r.status}`)
        return (await r.json()) as DayPayload
      }),
    [],
  )

  useEffect(() => {
    if (!date) return
    let live = true
    fetchDay(date)
      .then((p) => live && applyDay(p))
      .catch((e) => live && setLoadErr(e instanceof Error ? e.message : String(e)))
    return () => {
      live = false
    }
  }, [date, fetchDay, applyDay])

  /** manual reload after a write that moves artifacts between scenes */
  const loadDay = () => (date ? fetchDay(date).then(applyDay).catch((e) => setLoadErr(e instanceof Error ? e.message : String(e))) : Promise.resolve())

  useEffect(() => {
    if (!date) return
    const cur = params.get('date')
    if (cur !== date) router.replace(`/intake?date=${date}`)
  }, [date, params, router])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  const meals = useMemo(
    () => (day ? [...day.meals].sort((a, b) => slotRank(a.mealType) - slotRank(b.mealType) || a.eatenAt.localeCompare(b.eatenAt)) : []),
    [day],
  )
  const meal = meals.find((m) => m.id === selectedMeal) ?? null

  function applyScene(scene: SceneDto) {
    setDay((d) =>
      d
        ? { ...d, meals: d.meals.map((m) => (m.id === scene.mealId ? { ...m, scenes: m.scenes.map((s) => (s.id === scene.id ? scene : s)) } : m)) }
        : d,
    )
    setRailKey((k) => k + 1)
  }

  /** the same-food answer: true = yes, false = no (different food), null = take the answer back */
  async function answerSameFood(scene: SceneDto, answer: boolean | null) {
    const body =
      answer === true
        ? { sameSceneConfirmed: true }
        : answer === false
          ? { differentPlates: true }
          : scene.exclusionReason === 'different_plates'
            ? { differentPlates: false }
            : { sameSceneConfirmed: false }
    const r = await fetch(`/api/intake/scenes/${scene.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const j = (await r.json()) as { scene?: SceneDto; error?: string }
    if (!r.ok || !j.scene) {
      setToast(j.error ?? `Could not save your answer (${r.status})`)
      return
    }
    applyScene(j.scene)
    setToast(answer === true ? `Photo ${scene.index}: saved as the same food` : answer === false ? `Photo ${scene.index}: saved as different food — left out of the study` : `Photo ${scene.index}: your answer was taken back`)
  }

  async function patchArtifact(artifactId: string, body: { sceneId: string | null; vantage?: Vantage }, done: string) {
    const r = await fetch(`/api/intake/artifacts/${artifactId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const j = (await r.json()) as { error?: string }
    if (!r.ok) {
      setToast(j.error ?? `Could not save (${r.status})`)
      return
    }
    await loadDay()
    setRailKey((k) => k + 1)
    setToast(done)
  }

  const assignArtifact = (artifactId: string, sceneId: string, vantage?: Vantage) =>
    patchArtifact(artifactId, { sceneId, ...(vantage ? { vantage } : {}) }, 'Photo added to the scene')

  /** undo an assignment: the photo leaves its scene and reappears under Unsorted photos (nothing is deleted) */
  const removePhoto = (scene: SceneDto, artifactId: string) =>
    patchArtifact(artifactId, { sceneId: null }, `Photo removed from Photo ${scene.index} — it is back under Unsorted photos`)

  const setCamera = (scene: SceneDto, artifactId: string, vantage: Vantage) =>
    patchArtifact(artifactId, { sceneId: scene.id, vantage }, `Saved: that photo was taken with the ${vantage}`)

  async function newScene(mealId: string): Promise<SceneDto | null> {
    const r = await fetch(`/api/intake/meals/${mealId}/scenes`, { method: 'POST' })
    const j = (await r.json()) as { scene?: SceneDto; error?: string }
    if (!r.ok || !j.scene) {
      setToast(j.error ?? `Could not add a photo row (${r.status})`)
      return null
    }
    return j.scene
  }

  const onDraftChange = useCallback((sceneId: string, has: boolean) => {
    setDrafts((prev) => {
      if (prev.has(sceneId) === has) return prev
      const n = new Set(prev)
      if (has) n.add(sceneId)
      else n.delete(sceneId)
      return n
    })
  }, [])

  const scenes = meals.flatMap((m) => m.scenes)
  const validN = scenes.filter((s) => s.valid).length
  const gtConfirmed = meals.filter((m) => mealGtStatus(m) === 'confirmed').length
  const studyVantages = day?.studyVantages ?? REQUIRED_VANTAGES

  return (
    <>
      <CalendarRail
        month={month}
        onMonthChange={setMonth}
        selected={date}
        onSelect={(d) => {
          setDate(d)
          setMonth(d.slice(0, 7))
        }}
        refreshKey={railKey}
      />
      <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-28 pt-5 [&>*]:shrink-0">
        <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
          <h1 className="text-xl font-semibold tracking-[-0.01em]">{date ? dayTitle(date) : 'Intake'}</h1>
          {day && (
            <span className="text-ink-muted">
              {plural(meals.length, 'meal')} · {plural(scenes.length, 'photo scene')} · {validN} ready for the study, {scenes.length - validN} not yet · food list saved for {gtConfirmed} of {meals.length} {meals.length === 1 ? 'meal' : 'meals'}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            <StatusHelp />
            <Link href="/how-to#intake" className="rounded-md px-2 py-1 text-xs text-ink-muted hover:bg-tint hover:text-ink">
              How to add photos and notes
            </Link>
          </div>
        </div>

        {loadErr && <div className="rounded-md border border-over-ink/30 bg-over-bg px-3 py-2 text-xs text-over-ink">Could not load the day: {loadErr}</div>}

        {day && <UnsortedTray artifacts={day.unsorted} meals={meals} onAssign={assignArtifact} onNewScene={newScene} />}

        {day && meals.length === 0 && (
          <div className="rounded-[10px] border border-dashed border-line-strong bg-white/60 px-4 py-10 text-center text-ink-muted">
            No photos on this day. Pick a day with dots in the calendar, or import photos first (see the How to page).
          </div>
        )}

        {meals.length > 0 && (
          <div className="grid grid-cols-3 gap-3.5">
            {meals.map((m) => (
              <MealCard
                key={m.id}
                meal={m}
                selected={m.id === selectedMeal}
                drafts={drafts}
                studyVantages={studyVantages}
                onSelect={() => setSelectedMeal(m.id)}
                onSameFood={answerSameFood}
                onRemovePhoto={removePhoto}
                onSetCamera={setCamera}
                onAddNotes={(scene) => {
                  setSelectedMeal(m.id)
                  setFocusScene((f) => ({ id: scene.id, nonce: (f?.nonce ?? 0) + 1 }))
                }}
                onAssign={(scene, vantage) => setAssign({ scene, vantage, mealLabel: capitalize(m.mealType ?? 'meal') })}
              />
            ))}
          </div>
        )}

        {meal && <MealDrawer key={meal.id} meal={meal as MealDto} studyVantages={studyVantages} focusScene={focusScene} onSceneUpdated={applyScene} onDraftChange={onDraftChange} />}
      </main>

      <AssignDialog target={assign} artifacts={day?.unsorted ?? []} onClose={() => setAssign(null)} onAssign={assignArtifact} />

      {toast && (
        <div role="status" className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-ink px-3 py-1.5 text-xs text-white shadow">
          {toast}
        </div>
      )}
    </>
  )
}
