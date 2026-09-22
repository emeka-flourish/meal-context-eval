-- One insight per (day, arm, variant, persona) — duplicates flow straight
-- into the blind-scoring queue (QA P0-3).
CREATE UNIQUE INDEX "Insight_date_arm_inputKind_profileId_key"
  ON "Insight"("date", "arm", "inputKind", "profileId");
