'use client'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import type { MealDto, SceneDto } from '@/lib/ui/intake-types'
import { VANTAGES, capitalize, clock, type Vantage } from '@/lib/ui/format'
import { sceneStatus } from '@/lib/ui/scene-status'
import ZoomImage from './ZoomImage'
import GtEditor from './GtEditor'
import { SceneStatusBox } from './SceneStatus'

/* Meal drawer (the panel under the cards): one photo scene at a time
   (Photo 1 | Photo 2 tabs) — the photos large, click for full screen;
   left = your notes word for word (editable, saved with PATCH); right = the
   food list. Nothing here has a fixed height: the notes box grows with its
   text and the food list shows every row, and the page scrolls. */

export default function MealDrawer({
  meal,
  studyVantages,
  focusScene,
  onSceneUpdated,
  onDraftChange,
}: {
  meal: MealDto
  studyVantages: Vantage[]
  /** "Add notes" on a card: open that scene's tab and bring the drawer into view */
  focusScene?: { id: string; nonce: number } | null
  onSceneUpdated: (s: SceneDto) => void
  onDraftChange: (sceneId: string, hasDraft: boolean) => void
}) {
  const [sceneId, setSceneId] = useState<string | null>(() => (focusScene && meal.scenes.some((x) => x.id === focusScene.id) ? focusScene.id : (meal.scenes[0]?.id ?? null)))
  const [seenNonce, setSeenNonce] = useState(focusScene?.nonce ?? 0)
  if (focusScene && focusScene.nonce !== seenNonce) {
    setSeenNonce(focusScene.nonce)
    if (meal.scenes.some((x) => x.id === focusScene.id)) setSceneId(focusScene.id)
  }
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focusScene) rootRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [focusScene])
  // derived: fall back to the first scene when the chosen one disappears
  const scene = meal.scenes.find((s) => s.id === sceneId) ?? meal.scenes[0] ?? null
  const label = capitalize(meal.mealType ?? 'meal')

  if (!scene) {
    return (
      <div className="flex items-center justify-center rounded-[10px] border border-line bg-white p-6 text-ink-muted">
        {label} has no photos yet — open “Unsorted photos” at the top of the page and assign one to this meal.
      </div>
    )
  }

  return (
    <div ref={rootRef} className="grid scroll-mt-4 grid-cols-[1fr_1.35fr] items-start rounded-[10px] border border-line bg-white">
      <div className="flex flex-col gap-2 self-stretch border-r border-line px-[18px] pb-6 pt-3.5">
        <div className="flex items-center gap-2">
          <b>
            {label} · {clock(meal.eatenAt)}
          </b>
          {meal.scenes.length > 1 ? (
            <Tabs value={scene.id} onValueChange={setSceneId}>
              <TabsList className="h-7">
                {meal.scenes.map((s) => (
                  <TabsTrigger key={s.id} value={s.id} className="h-6 px-2.5 text-xs">
                    Photo {s.index}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : (
            <span className="text-ink-muted">Photo {scene.index}</span>
          )}
        </div>
        <SceneStatusBox status={sceneStatus(scene)} compact />
        <PhotoStrip scene={scene} studyVantages={studyVantages} />
        <NotesPane key={scene.id} scene={scene} label={label} onSceneUpdated={onSceneUpdated} />
      </div>
      <div className="flex min-w-0 flex-col px-[18px] pb-6 pt-3.5">
        <GtEditor key={scene.id} scene={scene} onSceneUpdated={onSceneUpdated} onDraftChange={onDraftChange} />
      </div>
    </div>
  )
}

function PhotoStrip({ scene, studyVantages }: { scene: SceneDto; studyVantages: Vantage[] }) {
  const live = scene.artifacts.filter((x) => !x.excludeFromExport && x.vantage)
  // study cameras always; any other camera (the tripod) only when it has a photo
  const cameras = VANTAGES.filter((v) => studyVantages.includes(v) || live.some((a) => a.vantage === v))
  const gallery = cameras.flatMap((v) => {
    const a = live.find((x) => x.vantage === v)
    return a?.blobUrl ? [{ src: a.blobUrl, alt: `${v} photo, photo ${scene.index}`, label: `${v}${a.vantageGuessed ? ' (camera guessed)' : ''}` }] : []
  })
  return (
    <div className="grid shrink-0 gap-1.5" style={{ gridTemplateColumns: `repeat(${cameras.length}, minmax(0, 1fr))` }}>
      {cameras.map((v) => {
        const a = live.find((x) => x.vantage === v)
        if (a?.blobUrl) {
          return (
            <ZoomImage
              key={v}
              src={a.blobUrl}
              alt={`${v} photo, photo ${scene.index}`}
              label={`${v}${a.vantageGuessed ? '?' : ''}`}
              className="h-[150px] w-full"
              gallery={gallery}
              galleryIndex={gallery.findIndex((g) => g.src === a.blobUrl)}
            />
          )
        }
        return (
          <div key={v} className="flex h-[150px] flex-col items-center justify-center rounded-lg border border-dashed border-line-strong bg-paper text-[11px] text-ink-faint">
            <span>no {v} photo</span>
          </div>
        )
      })}
    </div>
  )
}

function NotesPane({ scene, label, onSceneUpdated }: { scene: SceneDto; label: string; onSceneUpdated: (s: SceneDto) => void }) {
  const [text, setText] = useState(scene.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const dirty = text !== (scene.notes ?? '')
  // the box grows with the text (15+ lines are normal) — never a scrollbar inside a scrolling page
  const boxRef = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight + 2}px`
  }, [text])

  async function save() {
    setBusy(true)
    setErr(null)
    try {
      const r = await fetch(`/api/intake/scenes/${scene.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: text }),
      })
      const j = (await r.json()) as { scene?: SceneDto; error?: string }
      if (!r.ok || !j.scene) throw new Error(j.error ?? `save ${r.status}`)
      onSceneUpdated(j.scene)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <b>{label} · your notes</b>
        <span className="text-ink-muted">word for word · Photo {scene.index}</span>
        <Button type="button" size="sm" variant={dirty ? 'default' : 'outline'} disabled={!dirty || busy} onClick={save} className="ml-auto h-7">
          {busy ? 'Saving…' : 'Save notes'}
        </Button>
      </div>
      <Textarea
        ref={boxRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        placeholder={`No notes for Photo ${scene.index} yet. Paste this photo's lines from your notes (the plates and the "name - grams - seasoning" lines). They are kept exactly as you wrote them, and the food list on the right is built from them.`}
        className="min-h-[240px] resize-none overflow-hidden rounded-lg border-line-soft bg-rail p-3 font-mono text-xs leading-[1.5] text-ink"
      />
      {err && <div className="text-xs text-over-ink">{err}</div>}
    </div>
  )
}
