/* Prompt lock (docs/PIPELINE.md §5). Every prompt the study pipeline sends is
   listed here with the sha256 of its exact text, the pinned model and the
   sampling setting. `prompts/PROMPTS.lock.json` is the committed snapshot;
   src/lib/prompt-lock.test.ts fails when the two differ. To change a prompt:
   copy it to a NEW version (interpret.v4.md, 'router.v2', …), point the config
   at it, then `pnpm lock:prompts`. A locked version's text never changes. */
import { readFileSync } from 'fs'
import { join } from 'path'
import { CONFIG } from './config'
import { CORPUS_CONFIG } from './corpus/config'
import { parsePromptBlocks, sha256 } from './prompt-blocks'
import { ROUTER_PROMPT_VERSION, ROUTER_SYSTEM, ROUTER_USER_TEXT, ROUTER_V2_PROMPT_VERSION, ROUTER_V2_SYSTEM } from '@/runners/router'
import { DISTILL_CONFIRM_SYSTEM, DISTILL_CONFIRM_VERSION, HABIT_PROFILE_SYSTEM, HABIT_PROFILE_VERSION } from '@/runners/distill'
import { GT_STRUCTURE_PROMPT_VERSION, buildSystemPrompt } from '@/runners/gtStructure'
import { NUTRIENT_ESTIMATE_MODEL_ID, NUTRIENT_ESTIMATE_PROMPT_VERSION } from '@/runners/nutrientEstimate'

export type LockEntry = {
  stage: string
  when: 'per cell' | 'per scene' | 'on demand' | 'corpus build' | 'intake'
  promptVersion: string
  source: string
  sha256: string
  blocks?: Record<string, string>
  model: string
  temperature: 0 | 'provider default'
}

const file = (version: string) => readFileSync(join(process.cwd(), 'prompts', `${version}.md`), 'utf-8')

export function computePromptLock(): LockEntry[] {
  const interpret = file(CONFIG.interpret.promptVersion)
  return [
    { stage: 'router', when: 'per scene', promptVersion: ROUTER_PROMPT_VERSION, source: 'src/runners/router.ts', sha256: sha256(`${ROUTER_SYSTEM}\n---\n${ROUTER_USER_TEXT}`), model: CORPUS_CONFIG.routerModelId, temperature: 0 },
    { stage: 'router (retrieval v2: picks from the person\'s dish names)', when: 'per scene', promptVersion: ROUTER_V2_PROMPT_VERSION, source: 'src/runners/router.ts', sha256: sha256(`${ROUTER_V2_SYSTEM}\n---\n${ROUTER_USER_TEXT}`), model: CORPUS_CONFIG.routerModelId, temperature: 0 },
    {
      stage: 'interpret',
      when: 'per cell',
      promptVersion: CONFIG.interpret.promptVersion,
      source: `prompts/${CONFIG.interpret.promptVersion}.md`,
      sha256: sha256(interpret),
      blocks: parsePromptBlocks(interpret).sourceHashes as Record<string, string>,
      model: `roster: ${CONFIG.roster.map((m) => m.id).join(', ')}`,
      temperature: 'provider default',
    },
    { stage: 'matcher', when: 'per cell', promptVersion: CONFIG.matcher.promptVersion, source: `prompts/${CONFIG.matcher.promptVersion}.md`, sha256: sha256(file(CONFIG.matcher.promptVersion)), model: CONFIG.matcher.modelId, temperature: 0 },
    { stage: 'classifier', when: 'per cell', promptVersion: CONFIG.classifier.promptVersion, source: `prompts/${CONFIG.classifier.promptVersion}.md`, sha256: sha256(file(CONFIG.classifier.promptVersion)), model: CONFIG.classifier.modelId, temperature: 0 },
    { stage: 'nutrient estimate (fallback)', when: 'on demand', promptVersion: NUTRIENT_ESTIMATE_PROMPT_VERSION, source: `prompts/${NUTRIENT_ESTIMATE_PROMPT_VERSION}.md`, sha256: sha256(file(NUTRIENT_ESTIMATE_PROMPT_VERSION)), model: NUTRIENT_ESTIMATE_MODEL_ID, temperature: 0 },
    { stage: 'ground-truth structurer', when: 'intake', promptVersion: GT_STRUCTURE_PROMPT_VERSION, source: 'docs/TAG-GUIDE.md + src/runners/gtStructure.ts', sha256: sha256(buildSystemPrompt()), model: CONFIG.gtStructure.modelId, temperature: 'provider default' },
    { stage: 'distill: same-dish check', when: 'corpus build', promptVersion: DISTILL_CONFIRM_VERSION, source: 'src/runners/distill.ts', sha256: sha256(DISTILL_CONFIRM_SYSTEM), model: CORPUS_CONFIG.distillModelId, temperature: 0 },
    { stage: 'distill: habit profile', when: 'corpus build', promptVersion: HABIT_PROFILE_VERSION, source: 'src/runners/distill.ts', sha256: sha256(HABIT_PROFILE_SYSTEM), model: CORPUS_CONFIG.distillModelId, temperature: 'provider default' },
  ]
}

export const LOCK_PATH = join(process.cwd(), 'prompts', 'PROMPTS.lock.json')
