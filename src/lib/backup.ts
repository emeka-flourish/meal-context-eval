// Full-database JSON dump, shared by POST /api/backup and scripts/backup.ts.
// A backup is an operational artifact, not an export bundle — hygiene
// invariant 4 (excludeFromExport) applies to EXPORTS; backups keep everything
// so the study database can be restored bit-for-bit.

import type { PrismaClient } from '../generated/prisma/client'

export async function dumpAllTables(db: PrismaClient) {
  const [
    meal,
    artifact,
    decomposition,
    gtCorrection,
    nutrientCalc,
    judgeScore,
    triggerResult,
    conditionProfile,
    insight,
    insightScore,
    latencyTrial,
    fieldNote,
    raterToken,
    customFood,
    fdcAlias,
    fdcSearchCache,
    llmCall,
  ] = await Promise.all([
    db.meal.findMany(),
    db.artifact.findMany(),
    db.decomposition.findMany(),
    db.gtCorrection.findMany(),
    db.nutrientCalc.findMany(),
    db.judgeScore.findMany(),
    db.triggerResult.findMany(),
    db.conditionProfile.findMany(),
    db.insight.findMany(),
    db.insightScore.findMany(),
    db.latencyTrial.findMany(),
    db.fieldNote.findMany(),
    db.raterToken.findMany(),
    db.customFood.findMany(),
    db.fdcAlias.findMany(),
    db.fdcSearchCache.findMany(),
    db.llmCall.findMany(),
  ])
  return {
    generatedAt: new Date().toISOString(),
    tables: {
      meal,
      artifact,
      decomposition,
      gtCorrection,
      nutrientCalc,
      judgeScore,
      triggerResult,
      conditionProfile,
      insight,
      insightScore,
      latencyTrial,
      fieldNote,
      raterToken,
      customFood,
      fdcAlias,
      fdcSearchCache,
      llmCall,
    },
  }
}

/** Filesystem-safe timestamp for backup filenames. */
export function backupStamp(d = new Date()): string {
  return d.toISOString().replace(/:/g, '-').replace(/\..+$/, '')
}
