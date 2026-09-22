/* GT structurer (intake v2, REBUILD-SPEC §5 notes importer). Turns the
   verbatim Notes prose of ONE photo scene into tagged GtItem drafts:
   dish → item, grams + basis (weighed / estimated / converted), TAG-GUIDE tag,
   state (cooked / dry / raw), components note for composites, plus a list of
   QUESTIONS (hidden-fat checks, defaulted portions) that are never
   auto-answered. Drinks are dropped (TAG-GUIDE rule 11).

   System prompt = docs/TAG-GUIDE.md verbatim + the rules below + the
   household-unit table from lib/units.ts, so the model and the deterministic
   fallback share one source of numbers. Offline/mock path (no provider key)
   = parseNotesToGtItems (lib/prose-parse.ts) — permanent deterministic fallback.
   NOTE: relative imports so vitest can load this without alias config. */
import { readFileSync } from 'fs'
import { join } from 'path'
import { createHash } from 'crypto'
import { z } from 'zod'
import { runLlm } from '../lib/llm'
import { CONFIG } from '../lib/config'
import { parseNotesToGtItems, type GtItemDraft, type StructuredNotes } from '../lib/prose-parse'
import { UNIT_GRAMS, OATS_COOKED_PER_DRY, UNSTATED_COOKING_FAT_G, DEFAULT_PORTION_G } from '../lib/units'

export const GT_STRUCTURE_PROMPT_VERSION = 'gt-structure.v1'

let guideCache: string | null = null
export function tagGuideText(): string {
  if (guideCache) return guideCache
  guideCache = readFileSync(join(process.cwd(), 'docs', 'TAG-GUIDE.md'), 'utf-8')
  return guideCache
}

export function unitsTableText(): string {
  const lines: string[] = []
  for (const [food, units] of Object.entries(UNIT_GRAMS)) {
    if (food === '_default') continue
    const cells = Object.entries(units).map(([u, g]) => `${u} = ${g} g`)
    lines.push(`- ${food}: ${cells.join(', ')}`)
  }
  lines.push(`- any food, volume units: ${Object.entries(UNIT_GRAMS._default).map(([u, g]) => `${u} = ${g} g`).join(', ')}`)
  lines.push(`- dry oats → cooked with water as served: × ${OATS_COOKED_PER_DRY.toFixed(2)} (27 g dry → 175 g)`)
  lines.push(`- cooking fat with no stated amount: ${UNSTATED_COOKING_FAT_G} g estimated, garnish`)
  lines.push(
    `- no quantity at all (last resort, always a question): ${Object.entries(DEFAULT_PORTION_G)
      .map(([c, g]) => `${c} ${g} g`)
      .join(', ')}`,
  )
  return lines.join('\n')
}

const RULES = `
## Structurer rules (in addition to the tag guide above)

1. Output one item per food that carries a tag, grouped under its dish (the plate label "Plate 1 - name:" when given, otherwise the line's main food). Keep the writer's names; normalise plurals ("sweet potatoes" → "sweet potato").
2. grams are as served. A stated weight is basis "weighed" (hedged "~", "about", "est" → "estimated"). A household unit (slices, tbsp, medium egg, half an avocado) is converted with the table below, basis "estimated". A weight given in another state (dry oats) is converted to as-served, basis "converted", and the dry figure goes in components_note.
3. Every core and secondary item MUST have grams (rule 10). Garnish and spice may be null. Ignore items (salt, pepper, water, ice) are listed with tag "ignore" and no grams.
4. state: "cooked" when a cooking method applies or the item was converted to cooked; "dry" only for items eaten dry; "raw" when stated; otherwise null.
5. A composite dish weighed as a whole ("Sheet pan vegetables - 186 g - Brussels sprouts, …") is ONE item; its named components go in components_note, untagged and unweighed.
6. Hidden-fat check: for every roasted / fried / sautéed dish, if no cooking fat is listed, add a QUESTION asking whether oil was used and how much (1 tbsp ≈ 14 g). If a fat is listed without an amount, estimate ${UNSTATED_COOKING_FAT_G} g as garnish and add a QUESTION to confirm. Never invent the answer.
7. Any defaulted portion (no quantity at all) is a QUESTION naming the item and the number used.
8. Drinks (coffee, tea, juice, milk as a drink, alcohol, soda, smoothies) are never items: list them in "dropped". Water is an ignore item.
9. Never contradict the prose. Never add food that is not in the prose.

## Household-unit table (grams)
`

export function buildSystemPrompt(): string {
  return `${tagGuideText()}\n${RULES}${unitsTableText()}\n`
}

export function promptHash(): string {
  return createHash('sha256').update(buildSystemPrompt()).digest('hex').slice(0, 12)
}

const llmItem = z.object({
  dish: z.string(),
  name: z.string(),
  grams: z.number().nullable(),
  basis: z.enum(['weighed', 'estimated', 'converted']).nullable(),
  tag: z.enum(['core', 'secondary', 'garnish', 'spice', 'ignore']),
  state: z.enum(['cooked', 'dry', 'raw']).nullable(),
  components_note: z.string().nullable(),
})
const outputSchema = z.object({
  items: z.array(llmItem),
  questions: z.array(z.string()),
  dropped: z.array(z.string()),
})
type LlmOutput = z.infer<typeof outputSchema>

function toDrafts(out: LlmOutput): StructuredNotes {
  const items: GtItemDraft[] = out.items.map((i, order) => ({
    dish: i.dish,
    name: i.name,
    grams: i.grams != null && i.grams > 0 ? i.grams : null,
    basis: i.grams != null && i.grams > 0 ? (i.basis ?? 'estimated') : null,
    tag: i.tag,
    state: i.state,
    componentsNote: i.components_note,
    order,
  }))
  return { items, questions: out.questions, dropped: out.dropped }
}

function fromDrafts(s: StructuredNotes): LlmOutput {
  return {
    items: s.items.map((i) => ({
      dish: i.dish,
      name: i.name,
      grams: i.grams,
      basis: i.basis,
      tag: i.tag,
      state: i.state,
      components_note: i.componentsNote,
    })),
    questions: s.questions,
    dropped: s.dropped,
  }
}

/** Sanity pass shared by both paths: core/secondary without grams get the
    class-agnostic fallback and a question, so rule 10 always holds. */
export function enforceGramsRule(s: StructuredNotes): StructuredNotes {
  const questions = [...s.questions]
  const items = s.items.map((i) => {
    if ((i.tag === 'core' || i.tag === 'secondary') && i.grams == null) {
      questions.push(`No grams for ${i.name} ("${i.dish}") — defaulted to ${DEFAULT_PORTION_G.unknown} g; confirm.`)
      return { ...i, grams: DEFAULT_PORTION_G.unknown, basis: 'estimated' as const }
    }
    return i
  })
  return { ...s, items, questions }
}

export async function structureSceneNotes(args: {
  sceneId: string
  prose: string
}): Promise<StructuredNotes & { structurer: string; mocked: boolean; callId: string }> {
  const modelId = CONFIG.gtStructure.modelId
  const { output, mocked, callId } = await runLlm<LlmOutput>({
    runner: 'gt_structure',
    modelId,
    promptVersion: `${GT_STRUCTURE_PROMPT_VERSION}@${promptHash()}`,
    subjectRef: `scene:${args.sceneId}`,
    system: buildSystemPrompt(),
    messages: [
      {
        role: 'user',
        content: `Structure the notes for this photo into tagged ground-truth items.\n<notes>\n${args.prose}\n</notes>\nOutput the JSON object only.`,
      },
    ],
    schema: outputSchema,
    mock: () => fromDrafts(parseNotesToGtItems(args.prose)),
  })
  const structured = enforceGramsRule(toDrafts(outputSchema.parse(output)))
  return {
    ...structured,
    structurer: mocked ? 'notes-parser-v1' : modelId,
    mocked,
    callId,
  }
}
