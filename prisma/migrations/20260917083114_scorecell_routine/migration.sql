-- scorecell_routine (2026-09-17, CORPUS.md §5 / METRICS.md "split by routine vs novel")
--   ScoreCell.routine Boolean? — the scene's routine/novel flag, computed at
--   score time against Run.config.contextVersionId (null when the run has none).
--   Append-only; nothing existing changed.

-- AlterTable
ALTER TABLE "ScoreCell" ADD COLUMN     "routine" BOOLEAN;
