/* Drive a Run from the terminal — the same driver the Run screen uses
   (src/lib/ui/run-driver.ts), against a running console:

     pnpm tsx scripts/run.ts --run <id> [--concurrency 4] [--only-failed]
     pnpm tsx scripts/run.ts --create --label first-run --meal-set all_valid [--conditions image_only,image_context,context_only] [--models id|family|tier,…] [--concurrency 4]

   Base URL: RUN_BASE (default http://localhost:3000). Auth: AUTH_SECRET from
   the environment (the process env wins over .env) → POST /api/login → the
   cg_auth cookie is kept in memory only. Neither the secret nor the cookie is
   ever printed.

   --meal-set  all_valid (default) | pilot (the dates in PILOT_DATES=YYYY-MM-DD,…) |
               dates:YYYY-MM-DD,… | scenes:<id>,…
   --models    omitted = the server's default roster (CONFIG.roster);
               "id|family|tier" entries, family inferred from the id when omitted.
   --only-failed  drive only the cells that carry a failed item (and what they
               blocked); without it every item not yet done is driven (resume).

   Prints a progress line every 10 settled items and a final summary read
   back from GET /api/runs/:id (the DB witness). Exit 1 if any item failed,
   was blocked, or the driver stopped on a fatal error. */
import 'dotenv/config'
import { driveRun, failedKeys, formatElapsed, onlyKeys, postResultFromResponse, type DriverItem, type PostResult } from '../src/lib/ui/run-driver'

const PILOT_DATES = (process.env.PILOT_DATES ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const CONDITIONS = new Set(['image_only', 'image_context', 'context_only'])

type Args = {
  run?: string
  create: boolean
  label?: string
  contextVersionId?: string
  mealSet: string
  conditions?: string[]
  models?: { id: string; family: string; tier: string }[]
  concurrency: number
  onlyFailed: boolean
}

function usage(msg?: string): never {
  if (msg) console.error(`error: ${msg}`)
  console.error(
    [
      'usage:',
      '  pnpm tsx scripts/run.ts --run <id> [--concurrency 4] [--only-failed]',
      '  pnpm tsx scripts/run.ts --create --label <label> --meal-set pilot|all_valid|dates:…|scenes:… [--conditions a,b] [--models id|family|tier,…] [--concurrency 4]',
    ].join('\n'),
  )
  process.exit(2)
}

function familyOf(id: string): string {
  if (/^claude/i.test(id)) return 'anthropic'
  if (/^gemini/i.test(id)) return 'google'
  return 'openai'
}

export function parseArgs(argv: string[]): Args {
  const out: Args = { create: false, mealSet: 'all_valid', concurrency: 4, onlyFailed: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => {
      const v = argv[++i]
      if (v === undefined || v.startsWith('--')) usage(`${a} needs a value`)
      return v
    }
    switch (a) {
      case '--run':
        out.run = next()
        break
      case '--create':
        out.create = true
        break
      case '--label':
        out.label = next()
        break
      case '--meal-set':
        out.mealSet = next()
        break
      case '--conditions':
        out.conditions = next()
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        for (const c of out.conditions) if (!CONDITIONS.has(c)) usage(`unknown condition ${c}`)
        break
      case '--context-version':
        out.contextVersionId = next()
        break
      case '--models':
        out.models = next()
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
          .map((e) => {
            const [id, family, tier] = e.split('|').map((s) => s.trim())
            return { id, family: family || familyOf(id), tier: tier === 'cheap' ? 'cheap' : 'frontier' }
          })
        break
      case '--concurrency': {
        const n = Number.parseInt(next(), 10)
        if (!Number.isFinite(n) || n < 1) usage('--concurrency must be a positive integer')
        out.concurrency = n
        break
      }
      case '--only-failed':
        out.onlyFailed = true
        break
      case '-h':
      case '--help':
        usage()
        break
      default:
        usage(`unknown argument ${a}`)
    }
  }
  if (out.create === Boolean(out.run)) usage('pass exactly one of --run <id> or --create')
  if (out.create && !out.label?.trim()) usage('--create needs --label')
  return out
}

export function mealSetOf(spec: string): { kind: 'all_valid' } | { kind: 'dates'; dates: string[] } | { kind: 'scenes'; sceneIds: string[] } {
  if (spec === 'pilot') {
    if (PILOT_DATES.length === 0) usage('--meal-set pilot needs PILOT_DATES=YYYY-MM-DD,… in the environment')
    return { kind: 'dates', dates: PILOT_DATES }
  }
  if (spec === 'all_valid') return { kind: 'all_valid' }
  if (spec.startsWith('dates:')) {
    const dates = spec
      .slice(6)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    for (const d of dates) if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) usage(`bad date ${d}`)
    if (dates.length === 0) usage('dates: needs at least one date')
    return { kind: 'dates', dates }
  }
  if (spec.startsWith('scenes:')) {
    const sceneIds = spec
      .slice(7)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (sceneIds.length === 0) usage('scenes: needs at least one id')
    return { kind: 'scenes', sceneIds }
  }
  return usage(`unknown meal set ${spec}`)
}

/* ---- http ------------------------------------------------------------------- */
type Client = { get: (path: string) => Promise<Response>; post: (path: string, body: unknown) => Promise<Response> }

async function login(base: string): Promise<Client> {
  const secret = process.env.AUTH_SECRET
  if (!secret) usage('AUTH_SECRET is not set in the environment')
  const res = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret }) })
  if (!res.ok) throw new Error(`login failed: HTTP ${res.status} (is AUTH_SECRET the one the server on ${base} runs with?)`)
  const setCookies: string[] =
    typeof (res.headers as { getSetCookie?: () => string[] }).getSetCookie === 'function'
      ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : [res.headers.get('set-cookie') ?? '']
  const m = setCookies.map((c) => /cg_auth=([^;]+)/.exec(c)).find(Boolean)
  if (!m) throw new Error('login succeeded but no cg_auth cookie was returned')
  const cookie = `cg_auth=${m[1]}`
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' }
  return {
    get: (path) => fetch(`${base}${path}`, { headers }),
    post: (path, body) => fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }),
  }
}

type RunDetail = {
  run: { id: string; label: string; status: string; config: { sceneIds: string[]; models: { id: string }[]; conditions: string[] } }
  items: DriverItem[]
  progress: { cells: { state: string }[]; counts: Record<string, number>; byKind: Record<string, { total: number; done: number; failed: number }> }
}

async function detail(client: Client, runId: string): Promise<RunDetail> {
  const res = await client.get(`/api/runs/${runId}`)
  const body = (await res.json().catch(() => ({}))) as RunDetail & { error?: string }
  if (!res.ok) throw new Error(body.error ?? `GET /api/runs/${runId} → HTTP ${res.status}`)
  return body
}

/* ---- main ------------------------------------------------------------------- */
async function main() {
  const args = parseArgs(process.argv.slice(2))
  const base = (process.env.RUN_BASE ?? 'http://localhost:3000').replace(/\/$/, '')
  const client = await login(base)
  console.log(`console: ${base} (authenticated)`)

  let runId = args.run as string
  if (args.create) {
    const body: Record<string, unknown> = { label: args.label!.trim(), mealSet: mealSetOf(args.mealSet) }
    if (args.conditions) body.conditions = args.conditions
    if (args.models) body.models = args.models
    if (args.contextVersionId) body.contextVersionId = args.contextVersionId
    const res = await client.post('/api/runs', body)
    const j = (await res.json().catch(() => ({}))) as { run?: { id: string; cellCount: number; config: { sceneIds: string[]; models: unknown[] } }; error?: string }
    if (!res.ok || !j.run) throw new Error(j.error ?? `POST /api/runs → HTTP ${res.status}`)
    runId = j.run.id
    console.log(`run created: ${runId} · "${args.label}" · ${j.run.config.sceneIds.length} scenes · ${j.run.config.models.length} models · ${j.run.cellCount} cells`)
  }

  const d = await detail(client, runId)
  const items = d.items
  const only = args.onlyFailed ? onlyKeys(failedKeys(items), items) : undefined
  const pending = items.filter((i) => !i.done && (only ? only(i) : true))
  console.log(
    `run ${runId} · "${d.run.label}" · status ${d.run.status} · ${d.progress.cells.length} cells · ${items.length} items (${items.filter((i) => i.done).length} done, ${items.filter((i) => i.failed).length} failed) · driving ${pending.length}${args.onlyFailed ? ' (only failed cells)' : ''} at concurrency ${args.concurrency}`,
  )
  if (pending.length === 0) {
    console.log('nothing to do')
    return 0
  }

  const post = async (item: DriverItem): Promise<PostResult> => {
    const res = await client.post('/api/run-item', { kind: item.kind, ref: item.ref })
    const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
    return postResultFromResponse(res.status, body)
  }

  let settled = 0
  const t0 = Date.now()
  const handle = driveRun(items, {
    post,
    concurrency: args.concurrency,
    only,
    onItem: (o, p) => {
      if (o.state === 'running') return
      settled++
      if (o.state === 'failed') console.log(`  ✗ ${o.item.label ?? `${o.item.kind} ${o.item.key}`}: ${o.error}`)
      if (settled % 10 === 0 || settled === pending.length) {
        console.log(`[${String(settled).padStart(String(pending.length).length)}/${pending.length}] done ${p.done} · failed ${p.failed} · blocked ${p.blocked} · running ${p.running} · ${formatElapsed(Date.now() - t0)}`)
      }
    },
  })
  const stop = () => {
    console.log('\nstopping (in-flight items finish)…')
    handle.abort()
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  const summary = await handle.done
  process.off('SIGINT', stop)
  process.off('SIGTERM', stop)

  const after = await detail(client, runId)
  const c = after.progress.counts
  console.log('')
  console.log(`driver: ${summary.stopped} in ${formatElapsed(summary.elapsedMs)} · attempted ${summary.attempted} · done ${summary.done} · failed ${summary.failed} · blocked ${summary.blocked} · skipped (already done) ${summary.skipped} · not attempted ${summary.queued}`)
  if (summary.fatal) console.log(`fatal: ${summary.fatal}`)
  console.log(`server: run ${runId} status ${after.run.status} · cells done ${c.done} · failed ${c.failed} · queued ${c.queued} · in progress ${c.interpreted + c.matched + c.classified} of ${after.progress.cells.length}`)
  const byKind = Object.entries(after.progress.byKind)
    .map(([k, v]) => `${k} ${v.done}/${v.total}${v.failed ? ` (${v.failed} failed)` : ''}`)
    .join(' · ')
  console.log(`by kind: ${byKind}`)
  const failedOut = summary.outcomes.filter((o) => o.state === 'failed')
  if (failedOut.length) {
    console.log(`failed items (${failedOut.length}):`)
    for (const o of failedOut.slice(0, 20)) console.log(`  ${o.item.label ?? `${o.item.kind} ${o.item.key}`}: ${o.error}`)
    if (failedOut.length > 20) console.log(`  … ${failedOut.length - 20} more`)
  }
  return summary.failed > 0 || summary.blocked > 0 || summary.fatal ? 1 : 0
}

if (process.argv[1] && /scripts\/run\.ts$/.test(process.argv[1])) {
  main()
    .then((code) => {
      process.exitCode = code
    })
    .catch((e) => {
      console.error(e instanceof Error ? e.message : String(e))
      process.exitCode = 1
    })
}
