-- AlterTable
ALTER TABLE "TriggerResult" ALTER COLUMN "overallScore" SET DATA TYPE DOUBLE PRECISION;

-- Backfill: recover the raw fractional score from the stored engine payload
UPDATE "TriggerResult"
SET "overallScore" = COALESCE((payload->>'overallTriggerScore')::float, "overallScore");
