/* Seed: one invented fixture meal (no image) so a fresh database is not empty. Idempotent. */
import 'dotenv/config'
import { readFileSync } from 'fs'
import { join } from 'path'
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
})

const FIXTURE_MEAL_ID = '00000000-0000-4000-8000-00000000f1x1'

async function main() {
  const existing = await db.meal.findUnique({ where: { id: FIXTURE_MEAL_ID } })
  if (existing) {
    console.log('Fixture meal already seeded.')
    return
  }

  const fixtureMeal = JSON.parse(
    readFileSync(join(__dirname, '../fixtures/fixture-meal.json'), 'utf-8'),
  )

  const meal = await db.meal.create({
    data: {
      id: FIXTURE_MEAL_ID,
      eatenAt: new Date('2026-01-05T19:30:00Z'),
      locationType: 'home',
      gtTier: 'gold',
      notes: 'FIXTURE — invented meal: soft polenta + lentil stew',
    },
  })

  const surfaces = ['phone', 'glasses', 'tripod'] as const
  for (const surface of surfaces) {
    const artifact = await db.artifact.create({
      data: {
        mealId: meal.id,
        surface,
        blobUrl: null, // fixture has no real image
        exifTakenAt: new Date('2026-01-05T19:28:00Z'),
      },
    })
    await db.decomposition.create({
      data: {
        mealId: meal.id,
        artifactId: artifact.id,
        source: 'pipeline',
        payload: fixtureMeal.pipeline_decomposition,
        modelId: 'fixture-stub',
        promptVersion: 'pipeline.v0-fixture',
        lockedAt: new Date(), // GT lock satisfied for the fixture
      },
    })
  }

  await db.decomposition.create({
    data: {
      mealId: meal.id,
      artifactId: null,
      source: 'gt',
      payload: fixtureMeal.gt_decomposition,
      gtMethod: 'weighed_components',
      plateTotalGrams: 560,
      lockedAt: new Date(),
    },
  })

  console.log('Seeded fixture meal with 3 locked pipeline decompositions and gold GT.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
