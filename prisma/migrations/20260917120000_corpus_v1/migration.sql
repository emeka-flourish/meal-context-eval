-- corpus_v1 (2026-09-17, docs/CORPUS.md §1/§3; REBUILD-SPEC §3.2 / §4.3)
--   * CorpusMeal / CorpusDish / CorpusIngredient — the loaded meal-history export
--   * CorpusAnnotation — Agree / Fix / Exclude trail from the Corpus screen
--   * ContextVersion / DishCard / Dishware — the distilled context layer
--   * Runner enum gains distill / router (additive). Nothing existing changed.
--   Generated with `prisma migrate diff` (the shadow DB cannot replay the
--   pre-existing runs_and_conditions → intake_v2 ordering); applied via
--   `prisma migrate deploy`.

-- CreateEnum
CREATE TYPE "CorpusTier" AS ENUM ('corrected', 'confirmed', 'unconfirmed');

-- CreateEnum
CREATE TYPE "GramsSource" AS ENUM ('app_estimate', 'unit_table', 'none');

-- CreateEnum
CREATE TYPE "PortionClass" AS ENUM ('small', 'usual', 'large');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Runner" ADD VALUE 'distill';
ALTER TYPE "Runner" ADD VALUE 'router';

-- CreateTable
CREATE TABLE "CorpusMeal" (
    "id" TEXT NOT NULL,
    "sourceMealId" TEXT NOT NULL,
    "localDate" DATE NOT NULL,
    "localTime" TEXT NOT NULL,
    "slot" "MealType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "servingSize" TEXT,
    "portionClassPrefill" "PortionClass" NOT NULL,
    "imageFile" TEXT,
    "imageSha256" TEXT,
    "tier" "CorpusTier" NOT NULL DEFAULT 'unconfirmed',
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorpusMeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorpusDish" (
    "id" TEXT NOT NULL,
    "mealId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "preparation" TEXT,
    "servingSize" TEXT,
    "order" INTEGER NOT NULL,

    CONSTRAINT "CorpusDish_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorpusIngredient" (
    "id" TEXT NOT NULL,
    "dishId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DOUBLE PRECISION,
    "unit" TEXT,
    "notes" TEXT,
    "gramsEst" DOUBLE PRECISION,
    "gramsSource" "GramsSource" NOT NULL DEFAULT 'none',
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CorpusIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorpusAnnotation" (
    "id" TEXT NOT NULL,
    "mealId" TEXT NOT NULL,
    "dishId" TEXT,
    "portionClass" "PortionClass",
    "agreed" BOOLEAN NOT NULL DEFAULT false,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "editedJson" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorpusAnnotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContextVersion" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "corpusHash" TEXT NOT NULL,
    "cardCount" INTEGER NOT NULL,
    "habitProfile" TEXT,
    "config" JSONB NOT NULL,

    CONSTRAINT "ContextVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DishCard" (
    "id" TEXT NOT NULL,
    "contextVersionId" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "aliases" TEXT[],
    "instanceCount" INTEGER NOT NULL,
    "lastSeen" DATE NOT NULL,
    "portionClassMix" JSONB NOT NULL,
    "priorGrams" DOUBLE PRECISION,
    "ingredients" JSONB NOT NULL,
    "features" JSONB NOT NULL,
    "tierMix" JSONB NOT NULL,

    CONSTRAINT "DishCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dishware" (
    "id" TEXT NOT NULL,
    "contextVersionId" TEXT,
    "name" TEXT NOT NULL,
    "capacityMl" DOUBLE PRECISION,
    "capacityG" DOUBLE PRECISION,
    "usedFor" TEXT,
    "photo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dishware_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CorpusMeal_sourceMealId_key" ON "CorpusMeal"("sourceMealId");

-- CreateIndex
CREATE INDEX "CorpusMeal_localDate_idx" ON "CorpusMeal"("localDate");

-- CreateIndex
CREATE INDEX "CorpusDish_mealId_idx" ON "CorpusDish"("mealId");

-- CreateIndex
CREATE INDEX "CorpusIngredient_dishId_idx" ON "CorpusIngredient"("dishId");

-- CreateIndex
CREATE INDEX "CorpusAnnotation_mealId_idx" ON "CorpusAnnotation"("mealId");

-- CreateIndex
CREATE INDEX "DishCard_contextVersionId_idx" ON "DishCard"("contextVersionId");

-- CreateIndex
CREATE INDEX "Dishware_contextVersionId_idx" ON "Dishware"("contextVersionId");

-- AddForeignKey
ALTER TABLE "CorpusDish" ADD CONSTRAINT "CorpusDish_mealId_fkey" FOREIGN KEY ("mealId") REFERENCES "CorpusMeal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorpusIngredient" ADD CONSTRAINT "CorpusIngredient_dishId_fkey" FOREIGN KEY ("dishId") REFERENCES "CorpusDish"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorpusAnnotation" ADD CONSTRAINT "CorpusAnnotation_mealId_fkey" FOREIGN KEY ("mealId") REFERENCES "CorpusMeal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorpusAnnotation" ADD CONSTRAINT "CorpusAnnotation_dishId_fkey" FOREIGN KEY ("dishId") REFERENCES "CorpusDish"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DishCard" ADD CONSTRAINT "DishCard_contextVersionId_fkey" FOREIGN KEY ("contextVersionId") REFERENCES "ContextVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dishware" ADD CONSTRAINT "Dishware_contextVersionId_fkey" FOREIGN KEY ("contextVersionId") REFERENCES "ContextVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
