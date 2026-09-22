'use client'
import { useState } from 'react'
import { cn } from 'cn'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import ZoomPhoto from '@/components/PhotoLightbox'
import type { ArtifactDto, MealDto, SceneDto } from '@/lib/ui/intake-types'
import { capitalize, clock, dayShort, isoDay, plural, type Vantage } from '@/lib/ui/format'

/* Unsorted photos: photos from the data folder's `_unsorted` directory (or
   removed from a scene by hand) that belong to no photo scene yet. A
   collapsible panel at the top of the day view; one quiet line when empty. */

export const TRAY_EXPLAINER =
  'Photos from the “_unsorted” folder that the importer could not confidently place into a day, meal and camera wait here until you assign them; photos you remove from a scene come back here too.'

export type AssignTarget = { scene: SceneDto; vantage: Vantage; mealLabel: string }

export function artifactWhen(a: ArtifactDto): string {
  if (!a.exifTakenAt) return 'time unknown'
  const d = new Date(a.exifTakenAt)
  return `${dayShort(isoDay(d))} · ${clock(d)}`
}

function cameraLabel(a: ArtifactDto): string {
  if (!a.vantage) return 'camera unknown'
  return a.vantageGuessed ? `${a.vantage} (guessed)` : a.vantage
}

function Thumb({ a, size }: { a: ArtifactDto; size: number }) {
  return a.blobUrl ? (
    <span className="shrink-0" style={{ width: size, height: size }}>
      <ZoomPhoto src={a.blobUrl} alt={`Unsorted photo, ${artifactWhen(a)}`} className="size-full rounded" />
    </span>
  ) : (
    <span className="shrink-0 rounded bg-tile-deep" style={{ width: size, height: size }} />
  )
}

export default function UnsortedTray({
  artifacts,
  meals,
  onAssign,
  onNewScene,
}: {
  artifacts: ArtifactDto[]
  meals: MealDto[]
  onAssign: (artifactId: string, sceneId: string, vantage?: Vantage) => Promise<void>
  onNewScene: (mealId: string) => Promise<SceneDto | null>
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  if (artifacts.length === 0) {
    return (
      <div className="text-[11px] text-ink-faint" title={TRAY_EXPLAINER}>
        No unsorted photos — every imported photo is placed in a meal.
      </div>
    )
  }

  const targets = meals.flatMap((m) =>
    m.scenes.map((s) => ({
      value: `scene:${s.id}`,
      label: `${capitalize(m.mealType ?? 'meal')} · Photo ${s.index}`,
    })),
  )
  const newScene = meals.map((m) => ({ value: `new:${m.id}`, label: `A new photo on ${capitalize(m.mealType ?? 'meal')}` }))

  async function pick(a: ArtifactDto, value: string) {
    setBusy(a.id)
    try {
      if (value.startsWith('scene:')) await onAssign(a.id, value.slice(6), a.vantage ?? undefined)
      else if (value.startsWith('new:')) {
        const s = await onNewScene(value.slice(4))
        if (s) await onAssign(a.id, s.id, a.vantage ?? undefined)
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-[10px] border border-estimated-line bg-estimated-bg/50" aria-label="Unsorted photos">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        {open ? <ChevronDown className="size-4 shrink-0 text-ink-muted" /> : <ChevronRight className="size-4 shrink-0 text-ink-muted" />}
        <b className="text-sm">Unsorted photos</b>
        <span className="rounded-full bg-estimated-ink px-1.5 py-px text-[11px] font-semibold text-white">{artifacts.length}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-ink-muted">{plural(artifacts.length, 'photo')} waiting for you to say which meal they belong to</span>
        <span className="text-xs text-ink-muted underline underline-offset-2">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-estimated-line px-3 py-2.5">
          <p className="text-xs text-ink-muted">
            {TRAY_EXPLAINER} {meals.length ? 'Choose a meal and photo of the day shown below; to use another day, pick it in the calendar first.' : 'Pick a day with meals in the calendar to assign them.'}
          </p>
          <div className="grid max-h-[260px] grid-cols-2 gap-x-6 gap-y-1.5 overflow-auto">
            {artifacts.map((a) => (
              <div key={a.id} className={cn('flex items-center gap-2 text-xs', busy === a.id && 'opacity-50')}>
                <Thumb a={a} size={40} />
                <span className="font-mono">{artifactWhen(a)}</span>
                <span className="chip chip-sm">{cameraLabel(a)}</span>
                <div className="ml-auto w-[220px]">
                  <Select onValueChange={(v) => pick(a, v)} disabled={busy === a.id || meals.length === 0}>
                    <SelectTrigger size="sm" className="h-7 w-full bg-white text-xs">
                      <SelectValue placeholder="Assign to…" />
                    </SelectTrigger>
                    <SelectContent>
                      {targets.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                      {newScene.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

/** Empty camera tile → pick one of the unsorted photos for this scene and camera. */
export function AssignDialog({
  target,
  artifacts,
  onClose,
  onAssign,
}: {
  target: AssignTarget | null
  artifacts: ArtifactDto[]
  onClose: () => void
  onAssign: (artifactId: string, sceneId: string, vantage: Vantage) => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={Boolean(target)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Add a {target?.vantage} photo · {target?.mealLabel} · Photo {target?.scene.index}
          </DialogTitle>
          <DialogDescription>
            Choose one of the unsorted photos. It will be saved as the <b>{target?.vantage}</b> photo of this scene. Click a small photo to see it full screen first.
          </DialogDescription>
        </DialogHeader>
        {artifacts.length === 0 ? (
          <div className="text-ink-muted">
            There are no unsorted photos to choose from. Put the photo in the “_unsorted” folder (or the day’s camera folder) and run the photo importer again — the How to page explains the folders.
          </div>
        ) : (
          <div className="flex max-h-[50vh] flex-col gap-1 overflow-auto">
            {artifacts.map((a) => (
              <div key={a.id} className="flex items-center gap-3 rounded-md border border-line px-2 py-1.5 text-xs">
                <Thumb a={a} size={48} />
                <span className="font-mono">{artifactWhen(a)}</span>
                <span className="chip chip-sm">{cameraLabel(a)}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  className="ml-auto h-7"
                  onClick={async () => {
                    if (!target) return
                    setBusy(true)
                    try {
                      await onAssign(a.id, target.scene.id, target.vantage)
                      onClose()
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  Use this photo
                </Button>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
