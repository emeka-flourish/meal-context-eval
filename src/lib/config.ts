/* Frozen study config (invariant 3): read from env, stamped onto every
   generated row. Changing env mid-study never mutates old rows — they carry
   the stamp they were created with. */

export const CONFIG = {
  pipeline: {
    modelId: process.env.PIPELINE_MODEL_ID ?? 'gpt-5.1',
    promptVersion: process.env.PIPELINE_PROMPT_VERSION ?? 'pipeline.v2-draft',
  },
  trigger: {
    modelId: process.env.TRIGGER_MODEL_ID ?? 'gpt-5.1',
    engineVersion: process.env.TRIGGER_ENGINE_VERSION ?? 'irritant_scoring_v2@gpt-5.1-low',
    // Owner ruling B6 said 'minimal', but gpt-5.1 rejects it (supports
    // none|low|medium|high — verified 2026-08-18). 'low' is the nearest;
    // PENDING OWNER RULING — see DECISIONS.md #60. Whatever is chosen is
    // actually SENT (previously nothing was sent at all).
    reasoningEffort: (process.env.TRIGGER_REASONING_EFFORT ?? 'low') as 'none' | 'low' | 'medium' | 'high',
  },
  judge: {
    modelId: process.env.JUDGE_MODEL_ID ?? 'claude-sonnet-5',
    guidelineVersion: process.env.JUDGE_GUIDELINE_VERSION ?? 'judge-guidelines.v1-draft',
  },
  silver: {
    modelId: process.env.SILVER_MODEL_ID ?? 'gemini-2.5-pro',
  },
  // Intake v2 GT structurer (Notes prose → tagged GtItems); pinned per run
  // (REBUILD-SPEC §4.5). Mock = deterministic parser when the key is absent.
  gtStructure: {
    modelId: process.env.GT_STRUCTURE_MODEL_ID ?? 'gpt-5.1', // Gemini structured output dropped the items array (2026-09-17); OpenAI strict mode honors the schema
  },
  insights: {
    modelId: process.env.INSIGHTS_MODEL_ID ?? 'gpt-5.1',
    promptVersion: process.env.INSIGHTS_PROMPT_VERSION ?? 'insights.v2-draft',
  },
  transcribe: {
    modelId: process.env.TRANSCRIBE_MODEL_ID ?? 'whisper-1',
  },
  fdc: {
    dbVersion: process.env.FDC_DB_VERSION ?? 'FDC-2026',
  },
  // Exploratory engines (protocol's secondary engine comparison): run only on
  // meals with saved GT; rows always labeled; never in primary analysis.
  exploratory: {
    modelIds: (process.env.EXPLORATORY_MODEL_IDS ?? 'claude-opus-5,gemini-3.7-flash')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
  // ---- v2 run pipeline (REBUILD-SPEC §4, METRICS rev 8.2) ----------------------
  // interpret.v3 is block-structured; the hash of every SENT block is stamped
  // on each decomposition and the source-file block hashes on the run.
  interpret: {
    promptVersion: process.env.INTERPRET_PROMPT_VERSION ?? 'interpret.v4',
  },
  // Blind matcher: pinned model, temperature 0, sees only truth + predicted items.
  matcher: {
    modelId: process.env.MATCHER_MODEL_ID ?? 'gpt-5.1',
    promptVersion: process.env.MATCHER_PROMPT_VERSION ?? 'match.v3',
  },
  // Level 3 classifier: pinned model, temperature 0, blind (ingredient lines only).
  classifier: {
    modelId: process.env.CLASSIFIER_MODEL_ID ?? 'gpt-5.1',
    promptVersion: process.env.CLASSIFIER_PROMPT_VERSION ?? 'classify.v1',
  },
  // Default model roster for a new run (REBUILD-SPEC §4.5): frontier per
  // family; exact ids are pinned into Run.config at creation. Override with
  // ROSTER="id|family|tier,id|family|tier".
  roster: parseRoster(
    process.env.ROSTER ??
      // Pinned 2026-09-17 from each provider's live model list (exact/dated ids; no rolling aliases).
      // frontier = best stable non-preview vision model per family; cheap = the small tier for H7.
      'gpt-5.5-2026-04-23|openai|frontier,gpt-5.4-mini-2026-03-17|openai|cheap,' +
      'claude-opus-5|anthropic|frontier,claude-haiku-4-5-20251001|anthropic|cheap,' +
      'gemini-3.8-flash|google|frontier,gemini-3.5-flash-lite|google|cheap',
  ),
  // Context-layer + alias versions recorded on every run (instrument numbers).
  versions: {
    corpus: process.env.CORPUS_VERSION ?? 'none',
    alias: process.env.ALIAS_VERSION ?? 'fdc-alias.v1',
  },
} as const

export type RosterModel = { id: string; family: 'openai' | 'anthropic' | 'google'; tier: 'frontier' | 'cheap' }

/** "id|family|tier,id|family|tier" → roster entries; family inferred from the
    id prefix when omitted, tier defaults to frontier. */
export function parseRoster(spec: string): RosterModel[] {
  const out: RosterModel[] = []
  for (const raw of spec.split(',')) {
    const entry = raw.trim()
    if (!entry) continue
    const [id, family, tier] = entry.split('|').map((s) => s.trim())
    const fam = (family || familyForModel(id)) as RosterModel['family']
    out.push({ id, family: fam, tier: tier === 'cheap' ? 'cheap' : 'frontier' })
  }
  return out
}

export function familyForModel(modelId: string): RosterModel['family'] {
  if (/^claude/i.test(modelId)) return 'anthropic'
  if (/^gemini/i.test(modelId)) return 'google'
  return 'openai'
}

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const promptCache = new Map<string, string>()

/** Load a versioned prompt file from /prompts by its version stamp. */
export function loadPrompt(version: string): string {
  const cached = promptCache.get(version)
  if (cached) return cached
  const live = join(process.cwd(), 'prompts', `${version}.md`)
  // prompts the study no longer uses live in prompts/deprecated/ (old runners still read them)
  const text = readFileSync(existsSync(live) ? live : join(process.cwd(), 'prompts', 'deprecated', `${version}.md`), 'utf-8')
  promptCache.set(version, text)
  return text
}

/** Extract the `## System` section of a prompt file (to first following `## `). */
export function systemSection(promptFile: string): string {
  const m = promptFile.match(/## System[^\n]*\n([\s\S]*?)(?=\n## |$)/)
  if (!m) throw new Error('prompt file has no ## System section')
  return m[1].trim()
}
