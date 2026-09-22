/* Retrieval router (CORPUS.md §4, REBUILD-SPEC §4.3): a cheap pinned vision
   call on ONE photo → 3–5 plausible dish names + visible dishware. The names
   are the cascade's queries; the GT never reaches this call.
   Mock (MOCK_LLM=1 or no key): the scene's GT dish names (then item names)
   — only ever inside mock(), like interpret.ts. context_only cells have no
   image and never call the router (the provider uses slot affinity). */
import { readFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import { db } from '@/lib/db'
import { runLlm, willMock, type ContentPart } from '@/lib/llm'
import { CORPUS_CONFIG } from '@/lib/corpus/config'
import type { Vantage } from '@/lib/prompt-blocks'

export const routerSchema = z.object({
  dish_names: z.array(z.string()).max(6).default([]), // tolerant: a provider may omit the key; empty → no retrieval hit
  dishware: z.array(z.string()).default([]),
})
export type RouterOutput = z.infer<typeof routerSchema>

export const ROUTER_PROMPT_VERSION = 'router.v1'
export const ROUTER_USER_TEXT = 'Name the dishes and dishware in this photo.'
export const ROUTER_SYSTEM =
  'You name what is on ONE meal photo for a retrieval step. Return 3–5 plausible dish names for the plate(s) the subject is eating, most likely first, each a short dish name as a home cook would say it (e.g. "jollof rice", "scrambled eggs with spinach", "oatmeal"). Also list visible dishware (bowl, plate, mug, glass — with a size word if obvious). No drinks as dishes, no ingredients lists, no commentary. Output the JSON object only.'

/** Local-dev media URLs (/api/media/...) aren't fetchable by providers — load bytes from disk. */
function imageInput(blobUrl: string): URL | Buffer {
  if (blobUrl.startsWith('/api/media/')) return readFileSync(join(process.cwd(), '.data/media', blobUrl.replace('/api/media/', '')))
  return new URL(blobUrl)
}

/** Deterministic mock: distinct GT dish labels of the scene, padded with item names to ≥ 3, capped at 5. */
export function mockRouterNames(items: { dish: string; name: string; tag: string }[]): string[] {
  const out: string[] = []
  const push = (s: string) => {
    const t = s.trim()
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t)
  }
  for (const it of items) if (it.tag !== 'ignore') push(it.dish)
  for (const it of items) if (out.length < 3 && it.tag !== 'ignore') push(it.name)
  return out.slice(0, 5)
}

/* router.v2: the router is told the person's OWN dish names and picks from
   them first. v1 named photos generically ("spinach stew", "fufu"), so the lookup returned one-off cards and
   missed the frequent ones. The vocabulary comes only from the context
   version (history before the study window) — never from the scene's ground truth. */
export const ROUTER_V2_PROMPT_VERSION = 'router.v2'
export const ROUTER_V2_SYSTEM =
  'You name what is on ONE meal photo for a retrieval step. You are given THIS PERSON\'S OWN DISH NAMES (what they have logged before, most frequent first). For every plate or bowl the subject is eating: if it is one of their dishes, return that dish name EXACTLY as written in the list under `known_dishes`. If a plate matches nothing on the list, give a short dish name as a home cook would say it under `other_dishes`. One entry per plate or bowl; do not guess extra dishes; up to 6 in total. Also list visible dishware (bowl, plate, mug, glass — with a size word if obvious). No drinks as dishes, no ingredient lists, no commentary. Output the JSON object only.'
export const routerV2Schema = z.object({
  // tolerant: a model may list more than 6; the provider keeps the first V2_MAX_CARDS (an over-long list must not fail the cell)
  known_dishes: z.array(z.string()).default([]),
  other_dishes: z.array(z.string()).default([]),
  dishware: z.array(z.string()).default([]),
})
export type RouterV2Output = z.infer<typeof routerV2Schema>

export async function routeSceneV2(args: RouteArgs & { vocabulary: string[] }): Promise<RouterV2Output & { mocked: boolean; callId: string }> {
  const { sceneId, vantage } = args
  const modelId = CORPUS_CONFIG.routerModelId
  const artifact = await db.artifact.findFirst({
    where: { sceneId, OR: [{ vantage }, { vantage: null, surface: vantage }], isReference: false, excludeFromExport: false, blobUrl: { not: null } },
    orderBy: { uploadedAt: 'asc' },
  })
  if (!artifact?.blobUrl) throw new Error(`router: no ${vantage} capture for scene ${sceneId}`)
  const list = args.vocabulary.map((n, i) => `${i + 1}. ${n}`).join('\n')
  const content: ContentPart[] = [{ type: 'image', image: imageInput(artifact.blobUrl) }, { type: 'text', text: `This person's dish names:\n${list}\n\n${ROUTER_USER_TEXT}` }]
  const mocked = willMock(modelId)
  const { output, callId, mocked: wasMocked } = await runLlm<RouterV2Output>({
    runner: 'router',
    modelId,
    promptVersion: ROUTER_V2_PROMPT_VERSION,
    subjectRef: `${args.runId ? `run:${args.runId}|` : ''}scene:${sceneId}|vantage:${vantage}`,
    system: ROUTER_V2_SYSTEM,
    messages: [{ role: 'user', content }],
    schema: routerV2Schema,
    temperature: 0,
    mock: () => ({ known_dishes: mocked ? args.vocabulary.slice(0, 1) : [], other_dishes: [], dishware: [] }),
  })
  return { ...routerV2Schema.parse(output), mocked: wasMocked, callId }
}

export type RouteArgs = { sceneId: string; vantage: Vantage; runId?: string }
export type RouteResult = RouterOutput & { mocked: boolean; callId: string }

export async function routeScene(args: RouteArgs): Promise<RouteResult> {
  const { sceneId, vantage } = args
  const modelId = CORPUS_CONFIG.routerModelId
  const artifact = await db.artifact.findFirst({
    where: { sceneId, OR: [{ vantage }, { vantage: null, surface: vantage }], isReference: false, excludeFromExport: false, blobUrl: { not: null } },
    orderBy: { uploadedAt: 'asc' },
  })
  if (!artifact?.blobUrl) throw new Error(`router: no ${vantage} capture for scene ${sceneId}`)
  const content: ContentPart[] = [{ type: 'image', image: imageInput(artifact.blobUrl) }, { type: 'text', text: ROUTER_USER_TEXT }]

  const mocked = willMock(modelId)
  const mockOutput: RouterOutput | null = mocked
    ? await (async () => {
        const rows = await db.gtItem.findMany({ where: { sceneId }, orderBy: { order: 'asc' }, select: { dish: true, name: true, tag: true } })
        const names = mockRouterNames(rows)
        return { dish_names: names.length ? names : ['unknown dish'], dishware: [] }
      })()
    : null

  const { output, callId, mocked: wasMocked } = await runLlm<RouterOutput>({
    runner: 'router',
    modelId,
    promptVersion: ROUTER_PROMPT_VERSION,
    subjectRef: `${args.runId ? `run:${args.runId}|` : ''}scene:${sceneId}|vantage:${vantage}`,
    system: ROUTER_SYSTEM,
    messages: [{ role: 'user', content }],
    schema: routerSchema,
    temperature: 0,
    mock: () => mockOutput ?? { dish_names: ['unknown dish'], dishware: [] },
  })
  return { ...routerSchema.parse(output), mocked: wasMocked, callId }
}
