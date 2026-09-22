import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { structureSceneNotes, enforceGramsRule } from '@/runners/gtStructure'
import { parseNotesToGtItems } from '@/lib/prose-parse'
import type { RedraftPayload } from '@/lib/ui/intake-types'

// POST /api/intake/scenes/[id]/redraft — "Re-draft from notes": run the GT
// structurer on the scene's verbatim notes and return a DRAFT (never
// persisted here — Confirm writes it via PUT …/items, so edits are never
// overwritten without the confirm dialog). Body { mock: true } forces the
// deterministic parser (no model call) — the same path runLlm takes when the
// provider key is absent.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const body = (await req.json().catch(() => ({}))) as { mock?: boolean }
  const scene = await db.photoScene.findUnique({ where: { id }, select: { id: true, notes: true } })
  if (!scene) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!scene.notes || !scene.notes.trim()) {
    return NextResponse.json({ error: 'scene has no notes to structure' }, { status: 422 })
  }
  try {
    const out = body.mock
      ? { ...enforceGramsRule(parseNotesToGtItems(scene.notes)), structurer: 'notes-parser-v1', mocked: true }
      : await structureSceneNotes({ sceneId: id, prose: scene.notes })
    const payload: RedraftPayload = {
      items: out.items.map((i) => ({
        dish: i.dish,
        name: i.name,
        grams: i.grams,
        basis: i.basis,
        tag: i.tag,
        state: i.state,
        componentsNote: i.componentsNote,
        order: i.order,
      })),
      questions: out.questions,
      dropped: out.dropped,
      structurer: out.structurer,
      mocked: out.mocked,
    }
    return NextResponse.json(payload)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 })
  }
}
