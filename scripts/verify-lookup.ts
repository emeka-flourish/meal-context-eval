/* Maintenance script: resolve every GtItem name (+ its real components)
   through the Level 2 lookup chain (src/lib/nutrient-lookup.ts) and print
   what each name resolved to — chosen description, per-100 g, source — with
   counts by source and the unresolved / unavailable lists.

     pnpm tsx scripts/verify-lookup.ts                # full chain (FDC → LLM estimate)
     pnpm tsx scripts/verify-lookup.ts --no-estimate  # FDC only: audit coverage before spending LLM calls
     pnpm tsx scripts/verify-lookup.ts --reset        # purge FdcSearchCache + FDC-only aliases first
                                                      # (custom-food aliases and CustomFood rows are kept)
     pnpm tsx scripts/verify-lookup.ts --reset-aliases # re-pick from the CACHED lists (no API calls):
                                                      # use after a picker change

   Uses the real FDC key from .env (rate limit 1000/h; each new query is one
   request, cached forever afterwards). Never prints env values. */
import 'dotenv/config'
import { db } from '../src/lib/db'
import { normalizeIngredientName, type FdcMatch } from '../src/lib/fdc'
import { parseComponents } from '../src/lib/truth-items'
import { buildNutrientLookup, resolveLookupItem, type LookupItem, type ResolveOutcome } from '../src/lib/nutrient-lookup'

const args = new Set(process.argv.slice(2))
const RESET = args.has('--reset')
const RESET_ALIASES = args.has('--reset-aliases')
const ESTIMATE = !args.has('--no-estimate')

const PREP_WORDS = /\b(fried|grilled|baked|roasted|boiled|saut[ée]ed|steamed|scrambled|poached|toasted)\b/i

type Wanted = LookupItem & { tags: Set<string>; via: Set<string>; n: number }

const r1 = (n: number) => Math.round(n * 10) / 10
const pad = (s: string, w: number) => (s.length >= w ? s : s + ' '.repeat(w - s.length))

async function descriptionFor(ref: string | undefined, cache: FdcMatch[][]): Promise<string> {
  if (!ref) return ''
  if (ref.startsWith('fdc:')) {
    const id = Number(ref.slice(4))
    for (const list of cache) {
      const m = list.find((x) => x.fdcId === id)
      if (m) return `${m.description} [${m.dataType}]`
    }
    return `fdcId ${id} (not in search cache)`
  }
  if (ref.startsWith('custom:')) {
    const row = await db.customFood.findUnique({ where: { id: ref.slice(7) } })
    return row ? `${row.name} [custom · ${row.origin}${row.approvedAt ? ' · approved' : ' · PENDING approval'}]` : ref
  }
  return ref
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
  console.log(`mode: ${ESTIMATE ? 'full chain (fdc → estimate)' : 'fdc only (--no-estimate)'} · FDC key ${process.env.FDC_API_KEY ? 'present' : 'ABSENT (mock matches)'} · MOCK_LLM=${process.env.MOCK_LLM ?? ''}`)

  if (RESET) {
    const cache = await db.fdcSearchCache.deleteMany({})
    const aliases = await db.fdcAlias.deleteMany({ where: { customFoodId: null } })
    console.log(`--reset: deleted ${cache.count} FdcSearchCache rows and ${aliases.count} FDC-only aliases (custom aliases kept)`)
  } else if (RESET_ALIASES) {
    const aliases = await db.fdcAlias.deleteMany({ where: { customFoodId: null } })
    console.log(`--reset-aliases: deleted ${aliases.count} FDC-only aliases; search cache kept (${await db.fdcSearchCache.count()} rows)`)
  }

  const rows = await db.gtItem.findMany({ orderBy: [{ sceneId: 'asc' }, { order: 'asc' }] })
  const wanted = new Map<string, Wanted>()
  const add = (name: string, state: string | undefined, prep: string | undefined, tag: string, via: string) => {
    const key = `${normalizeIngredientName(name)}|${state ?? ''}`
    const w = wanted.get(key) ?? { name: normalizeIngredientName(name), state, prep, tags: new Set<string>(), via: new Set<string>(), n: 0 }
    w.n++
    w.tags.add(tag)
    w.via.add(via)
    if (!w.prep && prep) w.prep = prep
    wanted.set(key, w)
  }
  let composites = 0
  for (const it of rows) {
    if (it.tag === 'ignore') continue
    const comps = parseComponents(it.componentsNote)
    const state = it.state ?? undefined
    if (comps) {
      composites++
      for (const c of comps) add(c, state, undefined, it.tag, `component of "${it.name}"`)
      continue
    }
    const prep = it.componentsNote?.match(PREP_WORDS)?.[1]?.toLowerCase().replace('é', 'e')
    add(it.name, state, prep, it.tag, 'item')
  }
  console.log(`gt items: ${rows.length} · non-ignore: ${rows.filter((r) => r.tag !== 'ignore').length} · composites expanded: ${composites} · distinct (name, state) to resolve: ${wanted.size}\n`)

  const counts: Record<string, number> = { fdc: 0, custom: 0, estimate: 0, unresolved: 0, unavailable: 0 }
  const steps: Record<string, number> = {}
  const unresolved: string[] = []
  const unavailable: string[] = []
  const zeros: string[] = []
  const coreMissing: string[] = []
  const lines: string[] = []

  for (const [, w] of wanted) {
    const out: ResolveOutcome = await resolveLookupItem({ name: w.name, state: w.state, prep: w.prep }, { estimate: ESTIMATE })
    const label = `${pad(w.name + (w.state ? ` [${w.state}]` : '') + (w.prep ? ` {${w.prep}}` : ''), 34)} ${pad([...w.tags].join('/'), 9)}`
    if (out.status === 'resolved') {
      counts[out.entry.source]++
      steps[out.step] = (steps[out.step] ?? 0) + 1
      const cacheLists = out.entry.description ? [] : (await db.fdcSearchCache.findMany()).map((c) => c.results as FdcMatch[])
      const desc = out.entry.description ? `${out.entry.description}${out.entry.ref?.startsWith('fdc:') ? '' : ''}` : await descriptionFor(out.entry.ref, cacheLists)
      const e = out.entry
      const nums = `${pad(String(r1(e.kcal)), 6)} kcal  P ${pad(String(r1(e.protein)), 5)} F ${pad(String(r1(e.fat)), 5)} C ${pad(String(r1(e.carb)), 5)} Fib ${pad(String(r1(e.fiber)), 4)}`
      lines.push(`${label} → ${pad(e.source, 8)} ${pad(out.step, 8)} ${nums} · ${desc}${out.query ? `  (query: "${out.query}")` : ''}  ${e.ref ?? ''}`)
      if (e.kcal === 0 && e.protein === 0 && e.fat === 0 && e.carb === 0) zeros.push(w.name)
    } else if (out.status === 'unavailable') {
      counts.unavailable++
      unavailable.push(w.name)
      lines.push(`${label} → UNAVAILABLE ${out.error.message}`)
      if (w.tags.has('core') || w.tags.has('secondary')) coreMissing.push(w.name)
    } else {
      counts.unresolved++
      unresolved.push(w.name)
      lines.push(`${label} → UNRESOLVED  (queries tried: ${out.queries.map((q) => `"${q}"`).join(', ')})`)
      if (w.tags.has('core') || w.tags.has('secondary')) coreMissing.push(w.name)
    }
    console.log(lines[lines.length - 1])
  }

  console.log('\n— summary —')
  console.log(`by source: fdc=${counts.fdc} custom=${counts.custom} estimate=${counts.estimate} · unresolved=${counts.unresolved} unavailable=${counts.unavailable}`)
  console.log(`by step:   ${Object.entries(steps).map(([k, v]) => `${k}=${v}`).join(' ')}`)
  console.log(`unresolved:  ${unresolved.length ? unresolved.join(', ') : '(none)'}`)
  console.log(`unavailable: ${unavailable.length ? unavailable.join(', ') : '(none)'}`)
  console.log(`all-zero rows: ${zeros.length ? zeros.join(', ') : '(none)'}`)
  console.log(`core/secondary not resolved: ${coreMissing.length ? coreMissing.join(', ') : '(none)'}`)

  // sanity: the build the scorer uses reports the same sets
  const build = await buildNutrientLookup(
    [...wanted.values()].map((w) => ({ name: w.name, state: w.state, prep: w.prep })),
    { estimate: ESTIMATE },
  )
  console.log(`buildNutrientLookup: resolved=${Object.keys(build.resolved).length} unresolved=${build.unresolved.length} unavailable=${build.unavailable.length}`)
  console.log(`db: aliases=${await db.fdcAlias.count()} searchCache=${await db.fdcSearchCache.count()} customFoods=${await db.customFood.count()} (pending approval: ${await db.customFood.count({ where: { approvedAt: null } })})`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
