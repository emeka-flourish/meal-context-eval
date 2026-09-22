-- AlterTable
ALTER TABLE "Insight" ADD COLUMN     "profileId" TEXT;

-- AddForeignKey
ALTER TABLE "Insight" ADD CONSTRAINT "Insight_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "ConditionProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
