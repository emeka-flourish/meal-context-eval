'use client'
import { Lock } from 'lucide-react'

/* "Settings locked into this run": one inspectable line per setting. Each line
   opens to show the full value (whole fingerprint, the instruction text, the
   full list). Used for the New-run form (what WILL be locked) and for a saved
   run (what WAS locked, read from its saved settings). */

export type LockedRow = {
  key: string
  /** plain-English name of the setting */
  name: string
  /** the short value shown on the closed line */
  value: string
  /** what it is, in a sentence */
  about: string
  /** full values shown when the line is opened */
  details?: { label: string; value: string; mono?: boolean }[]
  /** long text (the instruction file) shown in a scrolling box */
  text?: string | null
}

export const WHY_LOCKED = 'These are saved with the run the moment it is created and never change afterwards, so results from different runs stay comparable. To change one, create a new run.'

export default function LockedSettings({ title, rows }: { title: string; rows: LockedRow[] | null }) {
  return (
    <section aria-label={title}>
      <div className="flex items-center gap-1.5 font-medium">
        <Lock className="size-3.5 text-ink-muted" aria-hidden />
        {title}
      </div>
      <p className="mt-0.5 text-[11px] leading-snug text-ink-muted">{WHY_LOCKED} Click a line to see the full value.</p>
      <div className="mt-1.5 overflow-hidden rounded-md border border-line">
        {!rows && <div className="px-2 py-1.5 text-xs text-ink-faint">Loading…</div>}
        {rows?.map((r) => (
          <details key={r.key} className="group border-b border-line-soft last:border-b-0">
            <summary className="flex cursor-pointer list-none items-baseline gap-2 px-2 py-1.5 text-xs hover:bg-rail">
              <span className="w-3 shrink-0 text-ink-faint group-open:rotate-90">›</span>
              <span className="shrink-0 text-ink-muted">{r.name}</span>
              <span className="ml-auto min-w-0 truncate text-right font-mono text-[11px]">{r.value}</span>
            </summary>
            <div className="flex flex-col gap-1.5 bg-rail px-2 pb-2 pl-7 pt-1 text-[11px]">
              <div className="text-ink-muted">{r.about}</div>
              {r.details?.map((d) => (
                <div key={d.label}>
                  <span className="text-ink-muted">{d.label}: </span>
                  <span className={d.mono ? 'break-all font-mono' : ''}>{d.value}</span>
                </div>
              ))}
              {r.text && <pre className="max-h-[240px] overflow-auto whitespace-pre-wrap rounded border border-line bg-white p-2 font-mono text-[10.5px] leading-[1.5]">{r.text}</pre>}
            </div>
          </details>
        ))}
      </div>
    </section>
  )
}

const short = (hash: string | null | undefined) => (hash ? `${hash.slice(0, 8)}…` : 'no fingerprint')

const CONDITION_NAME: Record<string, string> = {
  image_only: 'Photo only',
  image_context: 'Photo plus your context',
  context_only: 'Your context only, no photo',
}

const ABOUT = {
  interpret: 'The exact wording of the instructions every tested model receives when it reads a photo. The fingerprint is a code computed from the text: if one character changes, the fingerprint changes.',
  matcher: 'A separate, fixed model pairs each food the tested model named with the foods in your notes. It never sees the photo or which model it is checking.',
  classifier: 'A separate, fixed model turns a food list into the practical decisions of Level 3 (for example “high-fat meal”), for the model’s answer and for your notes alike.',
  context: 'The version of “what the models may know about you”, built on the Corpus tab. Used only when the model is given your context.',
  cameras: 'Which cameras are asked for every photo scene.',
  conditions: 'What the tested model is given for each reading.',
  alias: 'The version of the list that maps food names to nutrient entries, used to work out calories and nutrients.',
}

type PromptRef = { version: string; hash: string | null; text: string | null }

export function lockedRowsFromDefaults(
  d: {
    locked: {
      interpret: PromptRef
      matcher: PromptRef & { modelId: string }
      classifier: PromptRef & { modelId: string }
      context: { id: string; label: string; createdAt: string; cardCount: number } | null
      aliasVersion: string
    }
  },
  cameras: string[],
  conditions: string[],
): LockedRow[] {
  const L = d.locked
  const usesContext = conditions.some((c) => c !== 'image_only')
  return [
    {
      key: 'interpret',
      name: 'Instructions for reading a photo',
      value: `${L.interpret.version} · ${short(L.interpret.hash)}`,
      about: ABOUT.interpret,
      details: [
        { label: 'Version', value: L.interpret.version, mono: true },
        { label: 'Full fingerprint (SHA-256)', value: L.interpret.hash ?? 'file not found', mono: true },
      ],
      text: L.interpret.text,
    },
    {
      key: 'matcher',
      name: 'Matching model',
      value: `${L.matcher.modelId} · ${L.matcher.version} · ${short(L.matcher.hash)}`,
      about: ABOUT.matcher,
      details: [
        { label: 'Model', value: L.matcher.modelId, mono: true },
        { label: 'Instructions version', value: L.matcher.version, mono: true },
        { label: 'Full fingerprint (SHA-256)', value: L.matcher.hash ?? 'file not found', mono: true },
      ],
      text: L.matcher.text,
    },
    {
      key: 'classifier',
      name: 'Decision-check model',
      value: `${L.classifier.modelId} · ${L.classifier.version} · ${short(L.classifier.hash)}`,
      about: ABOUT.classifier,
      details: [
        { label: 'Model', value: L.classifier.modelId, mono: true },
        { label: 'Instructions version', value: L.classifier.version, mono: true },
        { label: 'Full fingerprint (SHA-256)', value: L.classifier.hash ?? 'file not found', mono: true },
      ],
      text: L.classifier.text,
    },
    {
      key: 'context',
      name: 'Context version',
      value: !usesContext ? 'not used' : L.context ? L.context.label : 'none built yet',
      about: ABOUT.context,
      details: !usesContext
        ? [{ label: 'Note', value: 'Only “Photo only” is selected, so no context is given to the models.' }]
        : L.context
          ? [
              { label: 'Label', value: L.context.label },
              { label: 'Built on', value: new Date(L.context.createdAt).toLocaleString() },
              { label: 'Dishes it knows', value: String(L.context.cardCount) },
              { label: 'Identifier', value: L.context.id, mono: true },
            ]
          : [{ label: 'Note', value: 'No context has been built. Build one on the Corpus tab, or select “Photo only”.' }],
    },
    { key: 'cameras', name: 'Cameras', value: cameras.join(' and '), about: ABOUT.cameras, details: [{ label: 'Asked per scene', value: cameras.join(', ') }] },
    {
      key: 'conditions',
      name: 'What the model is given',
      value: `${conditions.length} of 3`,
      about: ABOUT.conditions,
      details: conditions.map((c, i) => ({ label: String(i + 1), value: CONDITION_NAME[c] ?? c })),
    },
    { key: 'alias', name: 'Food-name list', value: L.aliasVersion, about: ABOUT.alias, details: [{ label: 'Version', value: L.aliasVersion, mono: true }] },
  ]
}

export function lockedRowsFromConfig(c: {
  conditions: string[]
  models: { id: string; family: string; tier: string }[]
  sceneIds: string[]
  vantages?: string[]
  promptVersion?: string
  promptBlockHashes?: Record<string, string>
  matcher?: { modelId: string; promptVersion: string }
  classifier?: { modelId: string; promptVersion: string }
  contextVersionId?: string | null
  contextVersionLabel?: string | null
  aliasVersion?: string
  mealSet?: { kind: string; dates?: string[] }
}, cameras: string[]): LockedRow[] {
  const blocks = Object.entries(c.promptBlockHashes ?? {})
  return [
    {
      key: 'interpret',
      name: 'Instructions for reading a photo',
      value: `${c.promptVersion ?? 'not recorded'}${blocks[0] ? ` · ${short(blocks[0][1])}` : ''}`,
      about: `${ABOUT.interpret} The instructions have ${blocks.length || 'several'} parts; each part has its own fingerprint.`,
      details: [{ label: 'Version', value: c.promptVersion ?? 'not recorded', mono: true }, ...blocks.map(([k, h]) => ({ label: `Part ${k.replace(/\D/g, '')} fingerprint (SHA-256)`, value: h, mono: true }))],
    },
    {
      key: 'matcher',
      name: 'Matching model',
      value: c.matcher ? `${c.matcher.modelId} · ${c.matcher.promptVersion}` : 'not recorded',
      about: ABOUT.matcher,
      details: c.matcher ? [{ label: 'Model', value: c.matcher.modelId, mono: true }, { label: 'Instructions version', value: c.matcher.promptVersion, mono: true }] : [],
    },
    {
      key: 'classifier',
      name: 'Decision-check model',
      value: c.classifier ? `${c.classifier.modelId} · ${c.classifier.promptVersion}` : 'not recorded',
      about: ABOUT.classifier,
      details: c.classifier ? [{ label: 'Model', value: c.classifier.modelId, mono: true }, { label: 'Instructions version', value: c.classifier.promptVersion, mono: true }] : [],
    },
    {
      key: 'context',
      name: 'Context version',
      value: c.contextVersionLabel ?? 'not used',
      about: ABOUT.context,
      details: c.contextVersionId ? [{ label: 'Label', value: c.contextVersionLabel ?? '' }, { label: 'Identifier', value: c.contextVersionId, mono: true }] : [],
    },
    {
      key: 'cameras',
      name: 'Cameras',
      value: cameras.join(', '),
      about: ABOUT.cameras,
      details: c.vantages?.length ? [{ label: 'Asked per scene', value: cameras.join(', ') }] : [{ label: 'Note', value: 'This run was created before the tripod was dropped from the study, so it asked all three cameras.' }],
    },
    { key: 'conditions', name: 'What the model is given', value: `${c.conditions.length} of 3`, about: ABOUT.conditions, details: c.conditions.map((x, i) => ({ label: String(i + 1), value: CONDITION_NAME[x] ?? x })) },
    { key: 'models', name: 'Models tested', value: String(c.models.length), about: 'The models whose answers this run measures.', details: c.models.map((m, i) => ({ label: String(i + 1), value: m.id, mono: true })) },
    {
      key: 'scenes',
      name: 'Photo scenes',
      value: String(c.sceneIds.length),
      about: 'The ready photo scenes that existed in the chosen period when the run was created.',
      details: c.mealSet?.dates?.length ? [{ label: 'Days', value: c.mealSet.dates.join(', ') }] : [],
    },
    ...(c.aliasVersion ? [{ key: 'alias', name: 'Food-name list', value: c.aliasVersion, about: ABOUT.alias, details: [{ label: 'Version', value: c.aliasVersion, mono: true }] }] : []),
  ]
}
