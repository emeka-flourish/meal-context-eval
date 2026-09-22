import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { CONFIG } from '@/lib/config'
import { db } from '@/lib/db'
import { STUDY_VANTAGES } from '@/lib/intake'
import { promptHash as gtStructureHash, GT_STRUCTURE_PROMPT_VERSION } from '@/runners/gtStructure'

// GET /api/intake/run-defaults — what the New-run form shows before a run
// exists: the model roster (CONFIG.roster), the study cameras, and the
// settings that POST /api/runs will lock into the run (prompt files with their
// full sha256 and text, the pinned helper models, the latest context version).
// Read-only. Statically scoped to /prompts so Turbopack's output tracing stays narrow.
export const dynamic = 'force-dynamic'

function promptFile(version: string): { version: string; hash: string | null; text: string | null } {
  const p = join(process.cwd(), 'prompts', `${version}.md`)
  if (!existsSync(p)) return { version, hash: null, text: null }
  const buf = readFileSync(p)
  return { version, hash: createHash('sha256').update(buf).digest('hex'), text: buf.toString('utf-8') }
}

export async function GET() {
  const context = await db.contextVersion
    .findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true, label: true, createdAt: true, cardCount: true } })
    .catch(() => null)
  return NextResponse.json({
    roster: CONFIG.roster.map((m) => ({ id: m.id, family: m.family, tier: m.tier })),
    cameras: [...STUDY_VANTAGES],
    locked: {
      interpret: promptFile(CONFIG.interpret.promptVersion),
      matcher: { modelId: CONFIG.matcher.modelId, ...promptFile(CONFIG.matcher.promptVersion) },
      classifier: { modelId: CONFIG.classifier.modelId, ...promptFile(CONFIG.classifier.promptVersion) },
      context: context ? { id: context.id, label: context.label, createdAt: context.createdAt.toISOString(), cardCount: context.cardCount } : null,
      aliasVersion: CONFIG.versions.alias,
    },
    helpers: {
      structurer: CONFIG.gtStructure.modelId,
      structurerPrompt: { version: GT_STRUCTURE_PROMPT_VERSION, hash: gtStructureHash() },
      judge: CONFIG.judge.modelId,
    },
  })
}
