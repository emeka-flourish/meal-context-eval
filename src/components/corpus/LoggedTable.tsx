'use client'
import { cn } from 'cn'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import Seg from './Seg'
import type { PortionClass, QueueMeal } from '@/lib/ui/corpus-types'
import { PORTION_CLASSES } from '@/lib/ui/corpus-types'
import { newKey, priorGrams, type EditDish } from '@/lib/ui/corpus-format'

/* "Logged in the app": one row per dish — name with its ingredient list
   beneath, the portion-vs-usual segmented control (prefilled from the app's
   serving size, always live), and the muted model-prior grams column (sum of
   the app's gramsEst; never edited). In edit mode names and ingredients
   become inputs, ingredients can be added / removed, a dish can be removed
   (→ dish-level exclude) and restored. */

export default function LoggedTable({
  meal,
  edits,
  editMode,
  disabled,
  onChange,
}: {
  meal: QueueMeal
  edits: EditDish[]
  editMode: boolean
  disabled?: boolean
  onChange: (e: EditDish[]) => void
}) {
  const update = (dishId: string, patch: (d: EditDish) => EditDish) => onChange(edits.map((d) => (d.dishId === dishId ? patch(d) : d)))

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className="th-label border-b border-line px-2.5 py-2 text-left">dish · ingredients</th>
          <th className="th-label border-b border-line px-2.5 py-2 text-left">portion vs your usual</th>
          <th className="th-label border-b border-line px-2.5 py-2 text-right">model prior</th>
        </tr>
      </thead>
      <tbody>
        {edits.map((d) => {
          const prior = priorGrams(d.ingredients)
          return (
            <tr key={d.dishId} className={cn('align-top', d.removed && 'opacity-50')}>
              <td className="border-b border-line-soft px-2.5 py-2">
                {editMode ? (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <Input
                        value={d.name}
                        disabled={disabled || d.removed}
                        aria-label="Dish name"
                        className={cn('h-7 font-semibold', d.removed && 'line-through')}
                        onChange={(e) => update(d.dishId, (x) => ({ ...x, name: e.target.value }))}
                      />
                      <Button
                        size="xs"
                        variant="ghost"
                        className="shrink-0 text-ink-faint"
                        disabled={disabled}
                        onClick={() => update(d.dishId, (x) => ({ ...x, removed: !x.removed }))}
                        title={d.removed ? 'Restore this dish' : 'Remove this dish from the meal'}
                      >
                        {d.removed ? 'restore' : 'remove dish'}
                      </Button>
                    </div>
                    {!d.removed && (
                      <div className="flex flex-wrap items-center gap-1">
                        {d.ingredients.map((g) => (
                          <span key={g.key} className="inline-flex items-center rounded-md border border-line bg-rail">
                            <input
                              value={g.name}
                              disabled={disabled}
                              aria-label="Ingredient name"
                              placeholder="ingredient"
                              size={Math.max(g.name.length, 6)}
                              className="h-6 bg-transparent px-1.5 text-[12px] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                              onChange={(e) =>
                                update(d.dishId, (x) => ({ ...x, ingredients: x.ingredients.map((y) => (y.key === g.key ? { ...y, name: e.target.value } : y)) }))
                              }
                            />
                            <button
                              type="button"
                              className="px-1 text-ink-faint hover:text-over-ink"
                              disabled={disabled}
                              aria-label={`Remove ${g.name || 'ingredient'}`}
                              onClick={() => update(d.dishId, (x) => ({ ...x, ingredients: x.ingredients.filter((y) => y.key !== g.key) }))}
                            >
                              <X className="size-3" />
                            </button>
                          </span>
                        ))}
                        <Button
                          size="xs"
                          variant="ghost"
                          className="text-ink-muted"
                          disabled={disabled}
                          onClick={() => update(d.dishId, (x) => ({ ...x, ingredients: [...x.ingredients, { key: newKey(), id: null, name: '', gramsEst: null }] }))}
                        >
                          <Plus /> ingredient
                        </Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <b>{d.name}</b>
                    <div className="text-[12px] text-ink-muted">{d.ingredients.map((g) => g.name).filter(Boolean).join(' · ') || <span className="text-ink-faint">no ingredients logged</span>}</div>
                  </>
                )}
              </td>
              <td className="border-b border-line-soft px-2.5 py-2">
                <Seg<PortionClass>
                  value={d.portionClass}
                  disabled={disabled || d.removed}
                  ariaLabel={`Portion class for ${d.name}`}
                  options={PORTION_CLASSES.map((p) => ({ value: p, label: p }))}
                  onChange={(p) => update(d.dishId, (x) => ({ ...x, portionClass: p }))}
                />
                {d.portionClass !== meal.portionClassPrefill && !d.removed && (
                  <div className="mt-1 text-[11px] text-ink-faint">app prefill: {meal.portionClassPrefill}</div>
                )}
              </td>
              <td className="border-b border-line-soft px-2.5 py-2 text-right font-mono whitespace-nowrap text-ink-muted" title="sum of the app's per-ingredient gram estimates — a prior, never edited here">
                {prior == null ? '—' : `${prior} g est.`}
              </td>
            </tr>
          )
        })}
        {edits.length === 0 && (
          <tr>
            <td colSpan={3} className="px-2.5 py-3 text-ink-faint">
              No dishes were logged for this meal.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}
