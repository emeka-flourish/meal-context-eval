import { describe, expect, it } from 'vitest'
import type { QueueMeal } from './corpus-types'
import { editStateFor, editsValid, habitBullets, planAgree, planExclude, portionMixLabel, priorGrams, versionOrdinal } from './corpus-format'

const meal: QueueMeal = {
  id: 'm1',
  sourceMealId: 's1',
  localDate: '2026-07-22',
  localTime: '19:48',
  slot: 'dinner',
  name: 'Jollof rice dinner',
  description: null,
  servingSize: 'STANDARD',
  portionClassPrefill: 'usual',
  imageFile: null,
  tier: 'unconfirmed',
  pilotMatch: null,
  frequency: 3,
  dishes: [
    {
      id: 'd1',
      name: 'Jollof rice',
      description: null,
      preparation: null,
      servingSize: null,
      ingredients: [
        { id: 'i1', name: 'Rice', amount: 1, unit: 'cup', notes: null, gramsEst: 180, gramsSource: 'unit_table' },
        { id: 'i2', name: 'Tomato stew', amount: null, unit: null, notes: null, gramsEst: null, gramsSource: 'none' },
      ],
    },
    { id: 'd2', name: 'Grilled chicken', description: null, preparation: null, servingSize: null, ingredients: [{ id: 'i3', name: 'Chicken thigh', amount: 150, unit: 'g', notes: null, gramsEst: 150, gramsSource: 'app_estimate' }] },
  ],
}

describe('planAgree', () => {
  it('plain Agree is one meal-level agreed row', () => {
    const plan = planAgree(meal, editStateFor(meal))
    expect(plan.payloads).toEqual([{ mealId: 'm1', agreed: true }])
    expect(plan.changedDishes).toBe(0)
  })

  it('a portion-class change alone becomes a dish-level row before the agreed row', () => {
    const edits = editStateFor(meal)
    edits[0].portionClass = 'large'
    const plan = planAgree(meal, edits)
    expect(plan.payloads).toEqual([{ mealId: 'm1', dishId: 'd1', portionClass: 'large' }, { mealId: 'm1', agreed: true }])
  })

  it('a Fix carries editedJson with the app prior kept only on retained ingredients', () => {
    const edits = editStateFor(meal)
    edits[0].name = 'Party jollof'
    edits[0].ingredients = [edits[0].ingredients[0], { key: 'k', id: null, name: ' Bell pepper ', gramsEst: null }]
    edits[1].removed = true
    const plan = planAgree(meal, edits)
    expect(plan.payloads).toEqual([
      {
        mealId: 'm1',
        dishId: 'd1',
        portionClass: 'usual',
        editedJson: { name: 'Party jollof', portionClass: 'usual', ingredients: [{ name: 'Rice', gramsEst: 180 }, { name: 'Bell pepper' }] },
      },
      { mealId: 'm1', dishId: 'd2', excluded: true },
      { mealId: 'm1', agreed: true },
    ])
    expect(plan.changedDishes).toBe(1)
    expect(plan.removedDishes).toBe(1)
  })

  it('Exclude is a single meal-level row', () => {
    expect(planExclude(meal)).toEqual([{ mealId: 'm1', excluded: true }])
  })
})

describe('helpers', () => {
  it('editsValid refuses an all-removed or unnamed fix', () => {
    const edits = editStateFor(meal)
    expect(editsValid(edits)).toBeNull()
    edits[0].name = '  '
    expect(editsValid(edits)).toMatch(/no name/)
    edits.forEach((d) => (d.removed = true))
    expect(editsValid(edits)).toMatch(/Exclude/)
  })
  it('priorGrams sums only convertible priors', () => {
    expect(priorGrams(meal.dishes[0].ingredients)).toBe(180)
    expect(priorGrams([{ gramsEst: null }])).toBeNull()
  })
  it('portionMixLabel orders by share and drops zeros', () => {
    expect(portionMixLabel({ small: 0.08, usual: 0.71, large: 0.21 })).toBe('usual 71% · large 21% · small 8%')
    expect(portionMixLabel({ usual: 1, large: 0 })).toBe('usual 100%')
  })
  it('habitBullets strips numbering', () => {
    expect(habitBullets('1. First\n\n2) Second\n- Third')).toEqual(['First', 'Second', 'Third'])
  })
  it('versionOrdinal counts from the oldest version', () => {
    const vs = [
      { id: 'b', label: '', createdAt: '2026-09-17T00:00:00Z', cardCount: 1, corpusHash: '' },
      { id: 'a', label: '', createdAt: '2026-09-15T00:00:00Z', cardCount: 1, corpusHash: '' },
    ]
    expect(versionOrdinal(vs, 'a')).toBe(1)
    expect(versionOrdinal(vs, 'b')).toBe(2)
  })
})
