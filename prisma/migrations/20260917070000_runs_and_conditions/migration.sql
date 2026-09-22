-- runs_and_conditions (2026-09-17, REBUILD-SPEC §1 / §4 / §7; METRICS.md rev 8.2)
--   * Run (config snapshot) + RunItemError (failed cells visible + retryable)
--   * Decomposition gains the v2 result-cell key: runId, sceneId, vantage (NULL for
--     context_only), condition, promptBlockHashes, contextUsed, llmCallId, and a real
--     unique (runId, sceneId, vantage, condition, modelId, source). Legacy rows keep
--     NULLs in the new columns (Postgres treats NULLs as distinct in the unique index).
--   * MatchTable (blind matcher output + overrides), Classification (Level 3 classifier
--     per side), ScoreCell (Level 1/2/3 per cell). Nothing dropped; legacy tables stay.
--   * Runner enum gains interpret / matcher / classifier.
--   * decomposition_source_shape_check (per_surface_pipeline) relaxed: a run-scoped
--     pipeline row (runId NOT NULL) keys on `vantage` and keeps `surface` NULL, so the
--     legacy per-(meal, surface) readers never pick it up. Non-run rows unchanged.

-- CreateEnum
CREATE TYPE "Condition" AS ENUM ('image_only', 'image_context', 'context_only');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('created', 'running', 'done', 'failed');

-- CreateEnum
CREATE TYPE "ClassificationSide" AS ENUM ('truth', 'estimate');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Runner" ADD VALUE IF NOT EXISTS 'interpret';
ALTER TYPE "Runner" ADD VALUE IF NOT EXISTS 'matcher';
ALTER TYPE "Runner" ADD VALUE IF NOT EXISTS 'classifier';

-- AlterTable
ALTER TABLE "Decomposition" ADD COLUMN     "condition" "Condition",
ADD COLUMN     "contextUsed" JSONB,
ADD COLUMN     "llmCallId" TEXT,
ADD COLUMN     "promptBlockHashes" JSONB,
ADD COLUMN     "runId" TEXT,
ADD COLUMN     "sceneId" TEXT,
ADD COLUMN     "vantage" "Surface";

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "config" JSONB NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'created',

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunItemError" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "error" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RunItemError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchTable" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "decompositionId" TEXT NOT NULL,
    "rows" JSONB NOT NULL,
    "invented" JSONB NOT NULL,
    "droppedDrinks" JSONB NOT NULL,
    "overrides" JSONB NOT NULL,
    "matcherModelId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatchTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Classification" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "side" "ClassificationSide" NOT NULL,
    "decompositionId" TEXT,
    "payload" JSONB NOT NULL,
    "classifierModelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Classification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreCell" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "vantage" "Surface",
    "condition" "Condition" NOT NULL,
    "modelId" TEXT NOT NULL,
    "level1" JSONB NOT NULL,
    "level2" JSONB NOT NULL,
    "level3" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScoreCell_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RunItemError_runId_kind_key_key" ON "RunItemError"("runId", "kind", "key");

-- CreateIndex
CREATE UNIQUE INDEX "MatchTable_decompositionId_key" ON "MatchTable"("decompositionId");

-- CreateIndex
CREATE INDEX "MatchTable_runId_sceneId_idx" ON "MatchTable"("runId", "sceneId");

-- CreateIndex
CREATE INDEX "Classification_runId_sceneId_idx" ON "Classification"("runId", "sceneId");

-- CreateIndex
CREATE UNIQUE INDEX "Classification_runId_sceneId_side_decompositionId_key" ON "Classification"("runId", "sceneId", "side", "decompositionId");

-- CreateIndex
CREATE INDEX "ScoreCell_runId_sceneId_idx" ON "ScoreCell"("runId", "sceneId");

-- CreateIndex
CREATE UNIQUE INDEX "ScoreCell_runId_sceneId_vantage_condition_modelId_key" ON "ScoreCell"("runId", "sceneId", "vantage", "condition", "modelId");

-- CreateIndex
CREATE INDEX "Decomposition_runId_sceneId_idx" ON "Decomposition"("runId", "sceneId");

-- CreateIndex
CREATE UNIQUE INDEX "Decomposition_runId_sceneId_vantage_condition_modelId_sourc_key" ON "Decomposition"("runId", "sceneId", "vantage", "condition", "modelId", "source");

-- AddForeignKey
ALTER TABLE "RunItemError" ADD CONSTRAINT "RunItemError_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decomposition" ADD CONSTRAINT "Decomposition_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decomposition" ADD CONSTRAINT "Decomposition_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "PhotoScene"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchTable" ADD CONSTRAINT "MatchTable_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchTable" ADD CONSTRAINT "MatchTable_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "PhotoScene"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchTable" ADD CONSTRAINT "MatchTable_decompositionId_fkey" FOREIGN KEY ("decompositionId") REFERENCES "Decomposition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Classification" ADD CONSTRAINT "Classification_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Classification" ADD CONSTRAINT "Classification_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "PhotoScene"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Classification" ADD CONSTRAINT "Classification_decompositionId_fkey" FOREIGN KEY ("decompositionId") REFERENCES "Decomposition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreCell" ADD CONSTRAINT "ScoreCell_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreCell" ADD CONSTRAINT "ScoreCell_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "PhotoScene"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Relax the v1 shape check: v2 result cells (runId set) carry vantage, not surface.
ALTER TABLE "Decomposition" DROP CONSTRAINT IF EXISTS "decomposition_source_shape_check";
ALTER TABLE "Decomposition" ADD CONSTRAINT "decomposition_source_shape_check"
  CHECK (
    ("source" = 'pipeline' AND ("surface" IS NOT NULL OR "runId" IS NOT NULL))
    OR ("source" IN ('gt', 'silver_assist') AND "artifactId" IS NULL AND "surface" IS NULL)
  );
