/* Annotation input validation (CORPUS.md §2). Pure; used by POST /api/corpus/annotate. */
import type { Prisma } from '@/generated/prisma/client'
import type { PortionClass } from './load'

export type AnnotationInput = {
  mealId: string
  dishId: string | null
  portionClass: PortionClass | null
  agreed: boolean
  excluded: boolean
  editedJson: Prisma.InputJsonObject | null
}

const PORTION = new Set(['small', 'usual', 'large'])

export function validateAnnotation(body: Record<string, unknown>): AnnotationInput | string {
  const mealId = typeof body.mealId === 'string' ? body.mealId.trim() : ''
  if (!mealId) return 'mealId required'
  const dishId = typeof body.dishId === 'string' && body.dishId.trim() ? body.dishId.trim() : null
  let portionClass: PortionClass | null = null
  if (body.portionClass != null) {
    if (typeof body.portionClass !== 'string' || !PORTION.has(body.portionClass)) return 'portionClass must be small | usual | large'
    portionClass = body.portionClass as PortionClass
  }
  const agreed = body.agreed === true
  const excluded = body.excluded === true
  if (agreed && excluded) return 'an annotation cannot be both agreed and excluded'
  let editedJson: Prisma.InputJsonObject | null = null
  if (body.editedJson != null) {
    if (typeof body.editedJson !== 'object' || Array.isArray(body.editedJson)) return 'editedJson must be an object'
    const e = body.editedJson as Record<string, unknown>
    if (e.name != null && typeof e.name !== 'string') return 'editedJson.name must be a string'
    if (e.portionClass != null && (typeof e.portionClass !== 'string' || !PORTION.has(e.portionClass))) return 'editedJson.portionClass must be small | usual | large'
    if (e.ingredients != null) {
      if (!Array.isArray(e.ingredients)) return 'editedJson.ingredients must be an array'
      for (const g of e.ingredients as unknown[]) {
        const it = g as Record<string, unknown>
        if (!it || typeof it.name !== 'string' || !it.name.trim()) return 'every editedJson.ingredients entry needs a name'
        if (it.gramsEst != null && (typeof it.gramsEst !== 'number' || !Number.isFinite(it.gramsEst) || it.gramsEst < 0)) return 'editedJson.ingredients[].gramsEst must be a non-negative number'
      }
    }
    editedJson = e as Prisma.InputJsonObject
  }
  if (!agreed && !excluded && !portionClass && !editedJson) return 'nothing to record: set agreed, excluded, portionClass or editedJson'
  return { mealId, dishId, portionClass, agreed, excluded, editedJson }
}
