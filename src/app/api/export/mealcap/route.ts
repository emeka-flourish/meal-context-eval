import { NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { db } from '@/lib/db'
import { getMediaPath } from '@/lib/storage'
import { ZipWriter } from '@/lib/zip'
import { toCsv } from '@/lib/csv'
import { buildFlatRows, FLAT_COLUMNS } from '@/lib/flat'
import { CONFIG } from '@/lib/config'

// GET /api/export/mealcap — the full study bundle as a streamed ZIP (store
// method, src/lib/zip.ts — no new deps):
//   /images/<mealId>-<surface>-<n>.<ext>  non-excluded, non-reference images
//   /gt/<mealId>.json                     GT payloads + method/tier metadata
//   /scores.csv                           the analysis flat file
//   /README.md                            bundle description + frozen config
// Hygiene invariant 4: excludeFromExport artifacts never enter the bundle.

export const dynamic = 'force-dynamic'

const IMAGE_EXT = /\.(jpe?g|png|webp|heic)$/i

async function artifactBytes(blobUrl: string): Promise<Uint8Array | null> {
  try {
    if (blobUrl.startsWith('/api/media/')) {
      // Dev: file lives under .data/media
      const buf = await readFile(getMediaPath(blobUrl.replace('/api/media/', '')))
      return new Uint8Array(buf)
    }
    const res = await fetch(blobUrl)
    if (!res.ok) return null
    return new Uint8Array(await res.arrayBuffer())
  } catch {
    return null
  }
}

export async function GET() {
  const meals = await db.meal.findMany({
    orderBy: { eatenAt: 'asc' },
    include: {
      artifacts: { where: { excludeFromExport: false, isReference: false } },
      decompositions: {
        where: { source: { in: ['gt', 'silver_assist'] } },
        orderBy: { createdAt: 'desc' },
        include: { nutrientCalcs: { orderBy: { createdAt: 'desc' }, take: 1 } },
      },
    },
  })
  const flatRows = await buildFlatRows()

  const encoder = new TextEncoder()
  const zip = new ZipWriter()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const put = (chunks: Uint8Array[]) => chunks.forEach((c) => controller.enqueue(c))

      // /images — one file per non-excluded, non-reference image artifact
      for (const meal of meals) {
        const perSurface = new Map<string, number>()
        for (const a of meal.artifacts) {
          if (!a.blobUrl || !IMAGE_EXT.test(a.blobUrl)) continue
          const bytes = await artifactBytes(a.blobUrl)
          if (!bytes) continue
          const n = (perSurface.get(a.surface) ?? 0) + 1
          perSurface.set(a.surface, n)
          const ext = a.blobUrl.match(IMAGE_EXT)?.[0].toLowerCase() ?? '.jpg'
          put(zip.add(`images/${meal.id}-${a.surface}-${n}${ext}`, bytes, a.uploadedAt))
        }
      }

      // /gt — GT payloads (decomposition + method/tier + nutrient calc)
      for (const meal of meals) {
        const gt = meal.decompositions[0]
        if (!gt) continue
        const doc = {
          mealId: meal.id,
          eatenAt: meal.eatenAt.toISOString(),
          gtTier: meal.gtTier,
          source: gt.source,
          gtMethod: gt.gtMethod,
          plateTotalGrams: gt.plateTotalGrams,
          lockedAt: gt.lockedAt?.toISOString() ?? null,
          payload: gt.payload,
          nutrientCalc: gt.nutrientCalcs[0] ?? null,
        }
        put(zip.add(`gt/${meal.id}.json`, encoder.encode(JSON.stringify(doc, null, 2))))
      }

      // /scores.csv — the analysis flat file
      put(zip.add('scores.csv', encoder.encode(toCsv(flatRows, FLAT_COLUMNS))))

      // /README.md — bundle description + frozen engine versions
      const readme = `# mealcap — Capture Gap study bundle

Export bundle of the Capture Gap n-of-1 study (single-subject meal-capture
surface comparison).

- Generated: ${new Date().toISOString()}
- Contents: /images (capture photos, excluded artifacts omitted per hygiene
  invariant 4), /gt (ground-truth decompositions), /scores.csv (one row per
  meal×surface; flip and APE computed at export from raw scores).

## Frozen engine versions

| Runner | Model | Version |
| --- | --- | --- |
| pipeline | ${CONFIG.pipeline.modelId} | ${CONFIG.pipeline.promptVersion} |
| trigger | ${CONFIG.trigger.modelId} | ${CONFIG.trigger.engineVersion} |
| judge | ${CONFIG.judge.modelId} | ${CONFIG.judge.guidelineVersion} |
| silver assist | ${CONFIG.silver.modelId} | — |
| insights | ${CONFIG.insights.modelId} | ${CONFIG.insights.promptVersion} |
| transcribe | ${CONFIG.transcribe.modelId} | — |
| nutrients | FoodData Central | ${CONFIG.fdc.dbVersion} |

## Cite

Capture Gap: an n-of-1 study of meal-capture surfaces and downstream
decision fidelity. Owner study, ${new Date().getFullYear()}.
`
      put(zip.add('README.md', encoder.encode(readme)))
      controller.enqueue(zip.finish())
      controller.close()
    },
  })

  const stamp = new Date().toISOString().slice(0, 10)
  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="mealcap-${stamp}.zip"`,
    },
  })
}
