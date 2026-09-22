-- AlterTable
ALTER TABLE "Decomposition" ADD COLUMN     "surface" "Surface";

-- Backfill: existing pipeline rows inherit their artifact's surface
UPDATE "Decomposition" d SET "surface" = a."surface"
FROM "Artifact" a WHERE d."artifactId" = a.id AND d."source" = 'pipeline';

-- Constraint updated: pipeline rows are per-(meal,surface); GT/silver carry neither
ALTER TABLE "Decomposition" DROP CONSTRAINT IF EXISTS "decomposition_source_artifact_check";
ALTER TABLE "Decomposition" ADD CONSTRAINT "decomposition_source_shape_check"
  CHECK (
    ("source" = 'pipeline' AND "surface" IS NOT NULL)
    OR ("source" IN ('gt', 'silver_assist') AND "artifactId" IS NULL AND "surface" IS NULL)
  );
