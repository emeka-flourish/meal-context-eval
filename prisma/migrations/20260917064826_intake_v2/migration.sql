-- intake_v2 (2026-09-16, REBUILD-SPEC §1/§5/§7)
--   * Surface enum: `fixed` → `tripod`; `manual_text` / `manual_audio` dropped
--     (the manual arm left the study). Existing `fixed` rows are migrated;
--     manual rows are refused loudly (delete or reassign them first — none
--     exist locally 2026-09-16).
--   * PhotoScene (scene k of a meal, validity + same-scene confirmation, verbatim notes)
--   * GtItem (per-scene ground-truth items, TAG-GUIDE tags, basis, state)
--   * Artifact: vantage (v2 name of surface, backfilled), vantageGuessed,
--     sceneId, sourcePath (unique — per-file idempotency), sha256

-- Guard: refuse to migrate if any row still carries a manual surface.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n FROM "Artifact" WHERE "surface"::text IN ('manual_text', 'manual_audio');
  IF n > 0 THEN
    RAISE EXCEPTION 'intake_v2: % Artifact row(s) still carry a manual surface — delete or reassign them before migrating', n;
  END IF;
  SELECT count(*) INTO n FROM "Decomposition" WHERE "surface"::text IN ('manual_text', 'manual_audio');
  IF n > 0 THEN
    RAISE EXCEPTION 'intake_v2: % Decomposition row(s) still carry a manual surface — delete or reassign them before migrating', n;
  END IF;
  SELECT count(*) INTO n FROM "LatencyTrial" WHERE "surface"::text IN ('manual_text', 'manual_audio');
  IF n > 0 THEN
    RAISE EXCEPTION 'intake_v2: % LatencyTrial row(s) still carry a manual surface — delete them before migrating', n;
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "GtBasis" AS ENUM ('weighed', 'estimated', 'converted');

-- CreateEnum
CREATE TYPE "GtTag" AS ENUM ('core', 'secondary', 'garnish', 'spice', 'ignore');

-- AlterEnum
ALTER TYPE "Runner" ADD VALUE 'gt_structure';

-- AlterEnum: Surface (fixed → tripod, manual values removed)
CREATE TYPE "Surface_new" AS ENUM ('phone', 'glasses', 'tripod');
ALTER TABLE "Artifact" ALTER COLUMN "surface" TYPE "Surface_new"
  USING (CASE WHEN "surface"::text = 'fixed' THEN 'tripod' ELSE "surface"::text END)::"Surface_new";
ALTER TABLE "Decomposition" ALTER COLUMN "surface" TYPE "Surface_new"
  USING (CASE WHEN "surface"::text = 'fixed' THEN 'tripod' ELSE "surface"::text END)::"Surface_new";
ALTER TABLE "LatencyTrial" ALTER COLUMN "surface" TYPE "Surface_new"
  USING (CASE WHEN "surface"::text = 'fixed' THEN 'tripod' ELSE "surface"::text END)::"Surface_new";
ALTER TYPE "Surface" RENAME TO "Surface_old";
ALTER TYPE "Surface_new" RENAME TO "Surface";
DROP TYPE "Surface_old";

-- AlterTable
ALTER TABLE "Artifact" ADD COLUMN     "sceneId" TEXT,
ADD COLUMN     "sha256" TEXT,
ADD COLUMN     "sourcePath" TEXT,
ADD COLUMN     "vantage" "Surface",
ADD COLUMN     "vantageGuessed" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: vantage is the v2 name of surface
UPDATE "Artifact" SET "vantage" = "surface";

-- CreateTable
CREATE TABLE "PhotoScene" (
    "id" TEXT NOT NULL,
    "mealId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "valid" BOOLEAN NOT NULL DEFAULT false,
    "exclusionReason" TEXT,
    "sameSceneConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhotoScene_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GtItem" (
    "id" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "dish" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "grams" DOUBLE PRECISION,
    "basis" "GtBasis",
    "tag" "GtTag" NOT NULL,
    "state" TEXT,
    "componentsNote" TEXT,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GtItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PhotoScene_mealId_index_key" ON "PhotoScene"("mealId", "index");

-- CreateIndex
CREATE INDEX "GtItem_sceneId_idx" ON "GtItem"("sceneId");

-- CreateIndex
CREATE UNIQUE INDEX "Artifact_sourcePath_key" ON "Artifact"("sourcePath");

-- CreateIndex
CREATE INDEX "Artifact_sceneId_idx" ON "Artifact"("sceneId");

-- AddForeignKey
ALTER TABLE "PhotoScene" ADD CONSTRAINT "PhotoScene_mealId_fkey" FOREIGN KEY ("mealId") REFERENCES "Meal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GtItem" ADD CONSTRAINT "GtItem_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "PhotoScene"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Artifact" ADD CONSTRAINT "Artifact_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "PhotoScene"("id") ON DELETE SET NULL ON UPDATE CASCADE;
