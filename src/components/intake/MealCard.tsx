'use client'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import ZoomPhoto from '@/components/PhotoLightbox'
import type { MealDto, SceneDto } from '@/lib/ui/intake-types'
import { mealGtStatus } from '@/lib/ui/intake-types'
import { VANTAGES, capitalize, clock, plural, type Vantage } from '@/lib/ui/format'
import { sceneStatus } from '@/lib/ui/scene-status'
import { SceneStatusBox } from './SceneStatus'

/* One meal as a card: header (meal · time · notes chip) and ONE ROW PER PHOTO
   SCENE — one tile per study camera (phone, glasses; a tripod tile only when a
   tripod photo exists). A filled tile opens full screen and can be removed
   (the photo goes back to the unsorted photos); an empty tile adds a photo.
   Under the tiles: exactly one status with, when needed, one action. */

export type SceneActions = {
  /** answer the same-food question: true = yes, false = no (different food), null = take the answer back */
  onSameFood: (scene: SceneDto, answer: boolean | null) => void
  onAssign: (scene: SceneDto, vantage: Vantage) => void
  /** take a photo out of its scene — it returns to the unsorted photos */
  onRemovePhoto: (scene: SceneDto, artifactId: string) => void
  /** settle which camera took a photo the importer guessed */
  onSetCamera: (scene: SceneDto, artifactId: string, vantage: Vantage) => void
  onAddNotes: (scene: SceneDto) => void
}

export type MealCardProps = SceneActions & {
  meal: MealDto
  selected: boolean
  /** scene ids holding an unsaved re-draft */
  drafts: Set<string>
  /** the cameras the study compares */
  studyVantages: Vantage[]
  onSelect: () => void
}

export default function MealCard({ meal, selected, drafts, studyVantages, onSelect, ...actions }: MealCardProps) {
  const gt = mealGtStatus(meal)
  const hasDraft = meal.scenes.some((s) => drafts.has(s.id))
  const gtChip =
    gt === 'confirmed' && !hasDraft
      ? { cls: 'chip-weighed', text: 'Food list saved' }
      : gt !== 'missing' || hasDraft
        ? { cls: 'chip-estimated', text: 'Food list not saved yet' }
        : { cls: '', text: 'No food list yet' }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      aria-pressed={selected}
      className={cn(
        'flex cursor-pointer flex-col gap-2.5 rounded-[10px] border border-line bg-white p-3 text-left outline-none',
        selected && 'outline outline-2 -outline-offset-1 outline-brand',
      )}
    >
      <div className="flex items-baseline gap-2">
        <b className="text-sm">{capitalize(meal.mealType ?? 'meal')}</b>
        <span className="font-mono text-ink-muted">{clock(meal.eatenAt)}</span>
        <span className={cn('chip ml-auto', gtChip.cls)} title="The food list is the weighed list of what was on the plate, built from your notes.">
          {gtChip.text}
        </span>
      </div>
      {meal.scenes.length === 0 && (
        <div className="rounded-md border border-dashed border-line-strong px-3 py-4 text-center text-[11px] text-ink-faint">
          This meal has notes but no photos.
        </div>
      )}
      {meal.scenes.map((s) => (
        <SceneRow key={s.id} scene={s} studyVantages={studyVantages} {...actions} />
      ))}
    </div>
  )
}

function SceneRow({ scene, studyVantages, onSameFood, onAssign, onRemovePhoto, onSetCamera, onAddNotes }: SceneActions & { scene: SceneDto; studyVantages: Vantage[] }) {
  const dishes = new Set(scene.items.map((i) => i.dish)).size
  const status = sceneStatus(scene)
  const live = scene.artifacts.filter((a) => !a.excludeFromExport && a.vantage)
  // study cameras always get a tile; any other camera (the tripod) only when it has a photo
  const cameras = VANTAGES.filter((v) => studyVantages.includes(v) || live.some((a) => a.vantage === v))
  const gallery = live.filter((a) => a.blobUrl).map((a) => ({ src: a.blobUrl!, alt: `${a.vantage} photo, photo ${scene.index}`, label: `${a.vantage}${a.vantageGuessed ? ' (camera guessed)' : ''}` }))
  const stop = (e: React.MouseEvent) => e.stopPropagation()

  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[11px] font-semibold text-ink-muted">
        Photo {scene.index}
        {dishes > 0 && ` · ${plural(dishes, 'dish', 'dishes')}`}
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${cameras.length}, minmax(0, 1fr))` }}>
        {cameras.flatMap((v) => {
          const mine = live.filter((a) => a.vantage === v)
          const ownerExcluded = mine.length === 0 && scene.artifacts.some((a) => a.vantage === v && a.excludeFromExport)
          if (mine.length === 0) {
            return [
              <button
                key={v}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onAssign(scene, v)
                }}
                title={`Add a ${v} photo from the unsorted photos`}
                className="flex h-[78px] flex-col items-center justify-center rounded-lg border border-dashed border-line-strong bg-paper text-[11px] text-ink-faint hover:border-brand hover:text-brand"
              >
                <span>{ownerExcluded ? `${v} photo set aside` : `no ${v} photo`}</span>
                <span className="text-[10px]">click to add one</span>
              </button>,
            ]
          }
          return mine.map((a) => (
            <div key={a.id} className="group relative h-[78px]">
              {a.blobUrl ? (
                <ZoomPhoto
                  src={a.blobUrl}
                  alt={`${v} photo, photo ${scene.index}`}
                  label={`${v}${a.vantageGuessed ? '?' : ''}`}
                  className="size-full bg-tile-deep"
                  gallery={gallery}
                  galleryIndex={gallery.findIndex((g) => g.src === a.blobUrl)}
                  stopPropagation
                />
              ) : (
                <div className="flex size-full items-center justify-center rounded-lg bg-tile-deep text-[11px] text-ink-faint">{v} · no preview</div>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onRemovePhoto(scene, a.id)
                }}
                title="Take this photo out of the scene. It goes back to the unsorted photos — nothing is deleted."
                className="absolute right-1 top-1 rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-medium text-ink opacity-0 shadow-sm hover:bg-white focus-visible:opacity-100 group-hover:opacity-100"
              >
                Remove
              </button>
            </div>
          ))
        })}
      </div>

      <SceneStatusBox status={status}>
        {status.kind === 'check_same_food' && scene.reasons.length > 0 && !scene.sameSceneConfirmed && (
          <>
            <Button type="button" size="sm" className="h-7" onClick={(e) => (stop(e), onSameFood(scene, true))}>
              Yes, same food
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-7 bg-white" onClick={(e) => (stop(e), onSameFood(scene, false))}>
              No, different
            </Button>
          </>
        )}
        {status.kind === 'check_camera' &&
          status.guessed &&
          VANTAGES.map((v) => (
            <Button key={v} type="button" size="sm" variant={v === status.guessed!.vantage ? 'default' : 'outline'} className={cn('h-7', v !== status.guessed!.vantage && 'bg-white')} onClick={(e) => (stop(e), onSetCamera(scene, status.guessed!.id, v))}>
              {capitalize(v)}
            </Button>
          ))}
        {status.kind === 'no_photo' && status.missing?.[0] && (
          <Button type="button" size="sm" variant="outline" className="h-7 bg-white" onClick={(e) => (stop(e), onAssign(scene, status.missing![0]))}>
            Add a {status.missing[0]} photo
          </Button>
        )}
        {status.kind === 'no_notes' && (
          <Button type="button" size="sm" variant="outline" className="h-7 bg-white" onClick={(e) => (stop(e), onAddNotes(scene))}>
            Add notes
          </Button>
        )}
        {status.kind === 'different_food' && (
          <Button type="button" size="sm" variant="outline" className="h-7 bg-white" onClick={(e) => (stop(e), onSameFood(scene, null))}>
            Change my answer
          </Button>
        )}
        {status.kind === 'ready' && (
          <button type="button" className="text-[11px] text-ink-muted underline underline-offset-2 hover:text-ink" onClick={(e) => (stop(e), onSameFood(scene, null))}>
            Undo my “same food” answer
          </button>
        )}
      </SceneStatusBox>
    </div>
  )
}
