/* interpret.v3 prompt blocks (REBUILD-SPEC §4.1). Pure: parses the markdown
   prompt file into its six `## Block N` sections, hashes each, and builds the
   system + user text for one (condition, vantage) — so the runner sends bytes
   whose hashes are asserted identical across conditions for blocks 1–4.

   Sent blocks per condition (interpret.v3.md header):
     image_only     blocks 1–4; blocks 5–6 EMPTY; image; no situation line
     image_context  blocks 1–4; block 5 filled from the context provider; block 6 rules; image; situation line
     context_only   blocks 1–3; block 4 = the `none` line; blocks 5–6 filled; NO image; situation line
   Block 4 as sent is the ONE vantage line (identical wording per vantage
   across conditions). Hashes are sha256 hex of the sent text; an empty block
   hashes to null so "block 5/6 empty" is visible in the stamp.
   NOTE: relative imports only (no db) so vitest loads it without stubs. */
import { createHash } from 'crypto'

export type Condition = 'image_only' | 'image_context' | 'context_only'
export type Vantage = 'phone' | 'glasses' | 'tripod'
export type VantageOrNone = Vantage | 'none'

export const BLOCK_KEYS = ['block1', 'block2', 'block3', 'block4', 'block5', 'block6'] as const
export type BlockKey = (typeof BLOCK_KEYS)[number]

export type PromptBlocks = {
  /** raw body text of each `## Block N` section, trimmed */
  blocks: Record<BlockKey, string>
  /** the `## User template` fenced body */
  userTemplate: string
  /** sha256 of each SOURCE block (static per prompt file; stored on the run) */
  sourceHashes: Record<BlockKey, string>
  /** vantage → capture-context line (block 4 bullets, without the backticked key) */
  vantageLines: Record<VantageOrNone, string>
}

export const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

const BLOCK_RE = /^## Block (\d) — [^\n]*\n([\s\S]*?)(?=^## |\s*$(?![\s\S]))/gm

/** Parse the prompt markdown into blocks 1–6 + the user template. Throws when a block is missing. */
export function parsePromptBlocks(markdown: string): PromptBlocks {
  const blocks = {} as Record<BlockKey, string>
  for (const m of markdown.matchAll(BLOCK_RE)) {
    const n = Number(m[1])
    if (n >= 1 && n <= 6) blocks[`block${n}` as BlockKey] = m[2].trim()
  }
  for (const k of BLOCK_KEYS) if (!(k in blocks)) throw new Error(`interpret prompt: missing ## ${k}`)

  const ut = markdown.match(/^## User template[^\n]*\n([\s\S]*?)(?=^## |\s*$(?![\s\S]))/m)
  if (!ut) throw new Error('interpret prompt: missing ## User template')
  const fence = ut[1].match(/```[^\n]*\n([\s\S]*?)```/)
  const userTemplate = (fence ? fence[1] : ut[1]).trim()

  const vantageLines = {} as Record<VantageOrNone, string>
  for (const m of blocks.block4.matchAll(/^- `(\w+)`:\s*(.+)$/gm)) {
    vantageLines[m[1] as VantageOrNone] = m[2].trim()
  }
  for (const v of ['phone', 'glasses', 'tripod', 'none'] as const) {
    if (!vantageLines[v]) throw new Error(`interpret prompt: block 4 has no line for vantage ${v}`)
  }

  const sourceHashes = {} as Record<BlockKey, string>
  for (const k of BLOCK_KEYS) sourceHashes[k] = sha256(blocks[k])
  return { blocks, userTemplate, sourceHashes, vantageLines }
}

/** Strip the fenced ``` wrapper block 5 carries in the source file and
    interpolate the three context slots. The `←` annotations are removed. */
function renderBlock5(block5: string, ctx: ContextFill): string {
  const fence = block5.match(/```[^\n]*\n([\s\S]*?)```/)
  const body = (fence ? fence[1] : block5)
    .split('\n')
    .map((line) => line.replace(/\s*←.*$/, ''))
    .join('\n')
    .trim()
  return body
    .replace('{{DISH_CARDS}}', ctx.dishCards.trim() || '(no dish cards retrieved)')
    .replace('{{HABIT_PROFILE}}', ctx.habitProfile.trim() || '(no habit profile)')
    .replace('{{DISHWARE}}', ctx.dishware.trim() || '(no registered dishware)')
}

export type ContextFill = { dishCards: string; habitProfile: string; dishware: string }

export type Situation = { weekday: string; localTime: string; homeOrAway: 'home' | 'away' }

export type BuildPromptArgs = {
  blocks: PromptBlocks
  condition: Condition
  /** the capture vantage; ignored (forced to `none`) for context_only */
  vantage: Vantage | null
  situation: Situation
  context?: ContextFill
  /** text note for the `<text_note>` slot; the study sends 'none' */
  textNote?: string
}

export type BuiltPrompt = {
  system: string
  user: string
  /** the six blocks exactly as sent ('' when empty) */
  sent: Record<BlockKey, string>
  /** sha256 of each sent block; null when the block was empty */
  hashes: Record<BlockKey, string | null>
  vantageSent: VantageOrNone
  includesImage: boolean
}

/** Build the system + user text for one call. Blocks 1–3 are the system
    prompt; block 4 (one line), the situation line, the text note and blocks
    5–6 fill the user template. */
export function buildInterpretPrompt(args: BuildPromptArgs): BuiltPrompt {
  const { blocks, condition } = args
  const vantageSent: VantageOrNone = condition === 'context_only' ? 'none' : (args.vantage ?? 'none')
  if (condition !== 'context_only' && !args.vantage) throw new Error(`${condition} needs a vantage`)
  const withContext = condition !== 'image_only'
  const ctx: ContextFill = args.context ?? { dishCards: '', habitProfile: '', dishware: '' }

  const sent: Record<BlockKey, string> = {
    block1: blocks.blocks.block1,
    block2: blocks.blocks.block2,
    block3: blocks.blocks.block3,
    block4: blocks.vantageLines[vantageSent],
    block5: withContext ? renderBlock5(blocks.blocks.block5, ctx) : '',
    block6: withContext ? blocks.blocks.block6 : '',
  }

  const system = [sent.block1, sent.block2, sent.block3].join('\n\n')

  const situationLine = withContext
    ? `<situation>${args.situation.weekday} ${args.situation.localTime} · ${args.situation.homeOrAway}</situation>`
    : ''
  const user = blocks.userTemplate
    .split('\n')
    .map((line) => {
      if (line.includes('<situation>')) return situationLine
      if (line.includes('{{BLOCK_5}}')) return sent.block5
      if (line.includes('{{BLOCK_6}}')) return sent.block6
      return line
        .replace('{{VANTAGE}}', vantageSent)
        .replace('{{VANTAGE_DESCRIPTION}}', sent.block4)
        .replace('{{TEXT_OR_NONE}}', args.textNote?.trim() || 'none')
        .replace(/\s*←.*$/, '')
    })
    .filter((line) => line !== '')
    .join('\n')

  const hashes = {} as Record<BlockKey, string | null>
  for (const k of BLOCK_KEYS) hashes[k] = sent[k] === '' ? null : sha256(sent[k])

  return { system, user, sent, hashes, vantageSent, includesImage: condition !== 'context_only' }
}

/** One hash over the six block hashes, in order — the `prompt_hash` export column. */
export function combinedPromptHash(hashes: Record<BlockKey, string | null>): string {
  return sha256(BLOCK_KEYS.map((k) => `${k}:${hashes[k] ?? ''}`).join('|'))
}
