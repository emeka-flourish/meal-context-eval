'use client'
import { Button } from '@/components/ui/button'
import ZoomImage from '@/components/intake/ZoomImage'
import LoggedTable from './LoggedTable'
import DishCardPanel from './DishCardPanel'
import type { QueueMeal } from '@/lib/ui/corpus-types'
import { longDate, servingLabel, type EditDish } from '@/lib/ui/corpus-format'
import { capitalize } from '@/lib/ui/format'

/* One historical meal (REBUILD-SPEC §3.2): photo (tap to zoom) with slot /
   date / app serving-size chips · "Logged in the app" editable table with the
   action row · the dish card(s) this meal touches. */

const TIER_CHIP: Record<QueueMeal['tier'], { cls: string; text: string }> = {
  corrected: { cls: 'chip-weighed', text: 'corrected by you' },
  confirmed: { cls: 'chip-solid', text: 'confirmed in app' },
  unconfirmed: { cls: '', text: 'unconfirmed' },
}

export default function MealReview({
  meal,
  edits,
  editMode,
  busy,
  actionErr,
  versionId,
  zoomOpen,
  onZoomChange,
  onEditsChange,
  onAgree,
  onFix,
  onCancelFix,
  onExclude,
  onSkip,
  onBack,
}: {
  meal: QueueMeal
  edits: EditDish[]
  editMode: boolean
  busy: boolean
  actionErr: string | null
  versionId: string | null
  zoomOpen: boolean
  onZoomChange: (o: boolean) => void
  onEditsChange: (e: EditDish[]) => void
  onAgree: () => void
  onFix: () => void
  onCancelFix: () => void
  onExclude: () => void
  onSkip: () => void
  onBack?: () => void
}) {
  const tier = TIER_CHIP[meal.tier]
  const photoAlt = `${capitalize(meal.slot)} · ${longDate(meal.localDate)} · ${meal.name}`
  const dishNames = edits.filter((d) => !d.removed).map((d) => d.name)

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[1fr_1fr_0.7fr] gap-3.5">
      {/* photo */}
      <section className="flex min-h-0 flex-col overflow-hidden rounded-[10px] border border-line bg-white" aria-label="Logged photo">
        {meal.imageFile ? (
          <ZoomImage
            src={`/api/corpus/ui/image/${meal.id}`}
            alt={photoAlt}
            label={`${capitalize(meal.slot)} · ${meal.localTime}`}
            className="min-h-0 flex-1 rounded-none rounded-t-[10px]"
            open={zoomOpen}
            onOpenChange={onZoomChange}
          />
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center bg-paper text-[11px] text-ink-faint">no photo logged · {capitalize(meal.slot)}, {longDate(meal.localDate)}</div>
        )}
        <div className="flex flex-wrap items-center gap-2 px-3.5 py-2.5">
          <span className="chip">{meal.slot}</span>
          <span className="chip">
            {longDate(meal.localDate)} · {meal.localTime}
          </span>
          <span className="chip" title="serving size as logged in the app; prefills the portion class">
            {servingLabel(meal.servingSize)}
          </span>
          <span className={`chip ${tier.cls}`}>{tier.text}</span>
          {meal.pilotMatch && (
            <span className="chip chip-weighed" title={`dish name matches study GT: ${meal.pilotMatch}`}>
              pilot dish
            </span>
          )}
        </div>
        <div className="truncate border-t border-line-soft px-3.5 py-2 text-ink-muted" title={meal.description ?? undefined}>
          <span className="font-medium text-ink">{meal.name}</span>
          {meal.description && <span> · {meal.description}</span>}
        </div>
      </section>

      {/* logged in the app */}
      <section className="flex min-h-0 flex-col gap-2.5 rounded-[10px] border border-line bg-white px-4 py-3.5" aria-label="Logged in the app">
        <div className="flex items-baseline gap-2">
          <b>Logged in the app</b>
          <span className="text-ink-muted">{editMode ? 'fix names, ingredients and portion class, then Agree' : 'confirm what it was and how much, relative to your usual'}</span>
          {editMode && <span className="chip chip-estimated ml-auto">editing</span>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <LoggedTable meal={meal} edits={edits} editMode={editMode} disabled={busy} onChange={onEditsChange} />
        </div>
        <div className="text-[12px] text-ink-muted">Grams are the app&apos;s estimates and stay a prior. You confirm identity, ingredients, and portion class. Drinks are ignored.</div>
        {actionErr && (
          <div className="rounded-md bg-over-bg px-2.5 py-1.5 text-over-ink" role="alert">
            {actionErr}
          </div>
        )}
        <div className="mt-auto flex items-center gap-2 border-t border-line-soft pt-2.5">
          <Button size="sm" onClick={onAgree} disabled={busy} title={editMode ? 'Save the fix and mark corrected (A)' : 'Mark this meal corrected as logged (A)'}>
            {editMode ? 'Agree with fix' : 'Agree'} <span className="kbd border-[#4f8480] bg-transparent text-[#dfe9e8]">A</span>
          </Button>
          <Button size="sm" variant="outline" onClick={onFix} disabled={busy} aria-pressed={editMode} title="Toggle edit mode (F)">
            {editMode ? 'Done editing' : 'Fix'} <span className="kbd">F</span>
          </Button>
          {editMode && (
            <Button size="sm" variant="ghost" onClick={onCancelFix} disabled={busy} title="Discard edits (Esc)">
              Discard <span className="kbd">Esc</span>
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onExclude} disabled={busy} title="Leave this meal out of distillation (X)">
            Exclude <span className="kbd">X</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={onSkip} disabled={busy} title="Move on, tier unchanged (S)">
            Skip <span className="kbd">S</span>
          </Button>
          {onBack && (
            <Button size="sm" variant="ghost" className="ml-auto text-ink-faint" onClick={onBack} disabled={busy} title="Previous skipped meal">
              ‹ previous
            </Button>
          )}
        </div>
      </section>

      {/* dish card(s) this meal touches */}
      <DishCardPanel names={dishNames} versionId={versionId} />
    </div>
  )
}
