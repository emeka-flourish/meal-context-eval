import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/lib/db'
import { recomputeScene, sceneDto, sceneInclude } from '../../../_shared'

// PUT /api/intake/scenes/[id]/items — "Confirm": replace the scene's GtItem
// rows atomically with the edited tree. TAG-GUIDE rule 10 is enforced here
// too (core / secondary need grams + basis; ignore carries none).
//
// GT-confirmation compromise (no schema change allowed from the UI slice):
// there is no `gtConfirmedAt` column. "Confirmed" = the scene has ≥1 GtItem
// row, i.e. The owner pressed Confirm at least once; a re-draft is held client-
// side (localStorage) until confirmed, so persisted rows are always the reviewer's.
// Validity is recomputed after the write so a scene whose only outstanding
// reason was GT/notes clears its exclusionReason.
const item = z.object({
  dish: z.string().min(1),
  name: z.string().min(1),
  grams: z.number().positive().nullable(),
  basis: z.enum(['weighed', 'estimated', 'converted']).nullable(),
  tag: z.enum(['core', 'secondary', 'garnish', 'spice', 'ignore']),
  state: z.enum(['cooked', 'dry', 'raw']).nullable(),
  componentsNote: z.string().nullable(),
  order: z.number().int().nonnegative(),
})
const bodySchema = z.object({ items: z.array(item) })

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues }, { status: 400 })
  }
  const problems: string[] = []
  parsed.data.items.forEach((i, n) => {
    if ((i.tag === 'core' || i.tag === 'secondary') && (i.grams == null || !i.basis)) {
      problems.push(`row ${n + 1} (${i.name}): ${i.tag} items need grams and a basis`)
    }
    if (i.tag === 'ignore' && i.grams != null) problems.push(`row ${n + 1} (${i.name}): ignore items carry no grams`)
    if (i.grams == null && i.basis) problems.push(`row ${n + 1} (${i.name}): basis without grams`)
  })
  if (problems.length) return NextResponse.json({ error: 'validation', problems }, { status: 422 })

  const exists = await db.photoScene.findUnique({ where: { id }, select: { id: true } })
  if (!exists) return NextResponse.json({ error: 'not found' }, { status: 404 })

  await db.$transaction([
    db.gtItem.deleteMany({ where: { sceneId: id } }),
    ...(parsed.data.items.length
      ? [
          db.gtItem.createMany({
            data: parsed.data.items.map((i, order) => ({
              sceneId: id,
              dish: i.dish,
              name: i.name,
              grams: i.grams,
              basis: i.grams == null ? null : i.basis,
              tag: i.tag,
              state: i.state,
              componentsNote: i.componentsNote,
              order,
            })),
          }),
        ]
      : []),
  ])
  await recomputeScene(id)
  const scene = await db.photoScene.findUnique({ where: { id }, include: sceneInclude })
  return NextResponse.json({ scene: scene ? sceneDto(scene) : null })
}
