-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('home', 'restaurant', 'host', 'travel', 'other');

-- CreateEnum
CREATE TYPE "GtTier" AS ENUM ('pending', 'gold', 'silver', 'unrated');

-- CreateEnum
CREATE TYPE "Suppression" AS ENUM ('none', 'skipped', 'delayed', 'modified');

-- CreateEnum
CREATE TYPE "Surface" AS ENUM ('phone', 'glasses', 'fixed', 'manual_text', 'manual_audio');

-- CreateEnum
CREATE TYPE "DecompositionSource" AS ENUM ('pipeline', 'gt', 'silver_assist');

-- CreateEnum
CREATE TYPE "GtMethod" AS ENUM ('weighed_components', 'weighed_meal_described', 'attested_description');

-- CreateEnum
CREATE TYPE "Band" AS ENUM ('low', 'moderate', 'high');

-- CreateEnum
CREATE TYPE "ProfileCode" AS ENUM ('P1', 'P2', 'P3');

-- CreateEnum
CREATE TYPE "Arm" AS ENUM ('A', 'B', 'C', 'D', 'E');

-- CreateEnum
CREATE TYPE "InputKind" AS ENUM ('estimated', 'gt');

-- CreateEnum
CREATE TYPE "Rater" AS ENUM ('self', 'ext1', 'ext2');

-- CreateEnum
CREATE TYPE "FieldNoteTag" AS ENUM ('platform', 'social', 'build', 'meta_rollout', 'other');

-- CreateEnum
CREATE TYPE "CustomFoodOrigin" AS ENUM ('llm_drafted', 'manual');

-- CreateEnum
CREATE TYPE "Runner" AS ENUM ('pipeline', 'judge', 'silver_assist', 'trigger', 'insights', 'transcribe', 'gt_assist', 'custom_food_draft');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('ok', 'error', 'retry');

-- CreateTable
CREATE TABLE "Meal" (
    "id" TEXT NOT NULL,
    "eatenAt" TIMESTAMP(3) NOT NULL,
    "locationType" "LocationType" NOT NULL DEFAULT 'home',
    "gtTier" "GtTier" NOT NULL DEFAULT 'pending',
    "forgot" BOOLEAN NOT NULL DEFAULT false,
    "suppression" "Suppression" NOT NULL DEFAULT 'none',
    "suppressionSetting" TEXT,
    "suppressionCompanions" TEXT,
    "suppressionReason" TEXT,
    "notes" TEXT,
    "sameFoodAsMealId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL,
    "mealId" TEXT NOT NULL,
    "surface" "Surface" NOT NULL,
    "blobUrl" TEXT,
    "exifTakenAt" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "transcript" TEXT,
    "audioDurationSecs" DOUBLE PRECISION,
    "typingSecs" DOUBLE PRECISION,
    "captureTimeSampleSecs" DOUBLE PRECISION,
    "excludeFromExport" BOOLEAN NOT NULL DEFAULT false,
    "isReference" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Artifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decomposition" (
    "id" TEXT NOT NULL,
    "mealId" TEXT NOT NULL,
    "artifactId" TEXT,
    "source" "DecompositionSource" NOT NULL,
    "payload" JSONB NOT NULL,
    "modelId" TEXT,
    "promptVersion" TEXT,
    "lockedAt" TIMESTAMP(3),
    "gtMethod" "GtMethod",
    "plateTotalGrams" DOUBLE PRECISION,
    "gtAmendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Decomposition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GtCorrection" (
    "id" TEXT NOT NULL,
    "decompositionId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT NOT NULL,
    "payloadBefore" JSONB NOT NULL,

    CONSTRAINT "GtCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NutrientCalc" (
    "id" TEXT NOT NULL,
    "decompositionId" TEXT NOT NULL,
    "kcal" DOUBLE PRECISION NOT NULL,
    "proteinG" DOUBLE PRECISION NOT NULL,
    "carbsG" DOUBLE PRECISION NOT NULL,
    "fatG" DOUBLE PRECISION NOT NULL,
    "fdcMappings" JSONB NOT NULL,
    "dbVersion" TEXT NOT NULL,
    "manualOverrides" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NutrientCalc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JudgeScore" (
    "id" TEXT NOT NULL,
    "gtDecompositionId" TEXT NOT NULL,
    "evalDecompositionId" TEXT NOT NULL,
    "guidelineVersion" TEXT NOT NULL,
    "judgeModelId" TEXT NOT NULL,
    "componentRecall" DOUBLE PRECISION NOT NULL,
    "componentPrecision" DOUBLE PRECISION NOT NULL,
    "quantityScore" DOUBLE PRECISION NOT NULL,
    "preparationScore" DOUBLE PRECISION NOT NULL,
    "overall0100" DOUBLE PRECISION NOT NULL,
    "rationale" TEXT NOT NULL,
    "humanOverall0100" DOUBLE PRECISION,
    "humanNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JudgeScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriggerResult" (
    "id" TEXT NOT NULL,
    "decompositionId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "overallScore" INTEGER NOT NULL,
    "band" "Band" NOT NULL,
    "payload" JSONB NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TriggerResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConditionProfile" (
    "id" TEXT NOT NULL,
    "code" "ProfileCode" NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "docRef" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ConditionProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Insight" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "arm" "Arm" NOT NULL,
    "inputKind" "InputKind" NOT NULL,
    "text" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "shuffleKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Insight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsightScore" (
    "id" TEXT NOT NULL,
    "insightId" TEXT NOT NULL,
    "rater" "Rater" NOT NULL,
    "rubric" JSONB NOT NULL,
    "scoredBlind" BOOLEAN NOT NULL,
    "revealedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsightScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LatencyTrial" (
    "id" TEXT NOT NULL,
    "surface" "Surface" NOT NULL,
    "trialNo" INTEGER NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "availableAt" TIMESTAMP(3) NOT NULL,
    "conditions" TEXT NOT NULL,

    CONSTRAINT "LatencyTrial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FieldNote" (
    "id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tag" "FieldNoteTag" NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "FieldNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RaterToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "rater" "Rater" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RaterToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFood" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[],
    "per100g" JSONB NOT NULL,
    "origin" "CustomFoodOrigin" NOT NULL,
    "draftReasoning" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalNotes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomFood_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FdcAlias" (
    "id" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "fdcId" INTEGER,
    "customFoodId" TEXT,
    "per100gCache" JSONB,
    "pickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FdcAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FdcSearchCache" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "results" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FdcSearchCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmCall" (
    "id" TEXT NOT NULL,
    "traceId" TEXT,
    "runId" TEXT,
    "runner" "Runner" NOT NULL,
    "modelId" TEXT NOT NULL,
    "promptVersion" TEXT,
    "subjectRef" TEXT,
    "inputRef" TEXT,
    "outputRef" TEXT,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "latencyMs" INTEGER,
    "costUsdEst" DOUBLE PRECISION,
    "status" "CallStatus" NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Meal_eatenAt_idx" ON "Meal"("eatenAt");

-- CreateIndex
CREATE INDEX "Artifact_mealId_idx" ON "Artifact"("mealId");

-- CreateIndex
CREATE INDEX "Decomposition_mealId_idx" ON "Decomposition"("mealId");

-- CreateIndex
CREATE INDEX "NutrientCalc_decompositionId_idx" ON "NutrientCalc"("decompositionId");

-- CreateIndex
CREATE INDEX "TriggerResult_decompositionId_idx" ON "TriggerResult"("decompositionId");

-- CreateIndex
CREATE UNIQUE INDEX "ConditionProfile_code_version_key" ON "ConditionProfile"("code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "InsightScore_insightId_rater_key" ON "InsightScore"("insightId", "rater");

-- CreateIndex
CREATE UNIQUE INDEX "RaterToken_tokenHash_key" ON "RaterToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "FdcAlias_normalizedName_key" ON "FdcAlias"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "FdcSearchCache_query_key" ON "FdcSearchCache"("query");

-- CreateIndex
CREATE INDEX "LlmCall_runner_createdAt_idx" ON "LlmCall"("runner", "createdAt");

-- CreateIndex
CREATE INDEX "LlmCall_subjectRef_idx" ON "LlmCall"("subjectRef");

-- AddForeignKey
ALTER TABLE "Meal" ADD CONSTRAINT "Meal_sameFoodAsMealId_fkey" FOREIGN KEY ("sameFoodAsMealId") REFERENCES "Meal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_mealId_fkey" FOREIGN KEY ("mealId") REFERENCES "Meal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decomposition" ADD CONSTRAINT "Decomposition_mealId_fkey" FOREIGN KEY ("mealId") REFERENCES "Meal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decomposition" ADD CONSTRAINT "Decomposition_artifactId_fkey" FOREIGN KEY ("artifactId") REFERENCES "Artifact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GtCorrection" ADD CONSTRAINT "GtCorrection_decompositionId_fkey" FOREIGN KEY ("decompositionId") REFERENCES "Decomposition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NutrientCalc" ADD CONSTRAINT "NutrientCalc_decompositionId_fkey" FOREIGN KEY ("decompositionId") REFERENCES "Decomposition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudgeScore" ADD CONSTRAINT "JudgeScore_gtDecompositionId_fkey" FOREIGN KEY ("gtDecompositionId") REFERENCES "Decomposition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudgeScore" ADD CONSTRAINT "JudgeScore_evalDecompositionId_fkey" FOREIGN KEY ("evalDecompositionId") REFERENCES "Decomposition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriggerResult" ADD CONSTRAINT "TriggerResult_decompositionId_fkey" FOREIGN KEY ("decompositionId") REFERENCES "Decomposition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TriggerResult" ADD CONSTRAINT "TriggerResult_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "ConditionProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsightScore" ADD CONSTRAINT "InsightScore_insightId_fkey" FOREIGN KEY ("insightId") REFERENCES "Insight"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FdcAlias" ADD CONSTRAINT "FdcAlias_customFoodId_fkey" FOREIGN KEY ("customFoodId") REFERENCES "CustomFood"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- PLAN.md §5: pipeline rows must reference their artifact; GT/silver rows must not.
ALTER TABLE "Decomposition" ADD CONSTRAINT "decomposition_source_artifact_check"
  CHECK (
    ("source" = 'pipeline' AND "artifactId" IS NOT NULL)
    OR ("source" IN ('gt', 'silver_assist') AND "artifactId" IS NULL)
  );
