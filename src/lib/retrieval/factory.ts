/* Provider factory: the run's config decides the context layer.
   Run.config.contextVersionId set → DbContextProvider on that version;
   absent → NullContextProvider (blocks 5/6 sent with empty slots, as today).
   One provider per run id is cached so the cards load once per process.

   WIRING (one line, not applied here — interpret.ts is owned elsewhere):
     src/runners/interpret.ts, in runInterpret():
       const provider = args.contextProvider ?? new NullContextProvider()
     becomes
       const provider = args.contextProvider ?? (await contextProviderForRun(runId))
   (or equivalently in src/app/api/run-item/route.ts:
       result = await runInterpret({ ...c, contextProvider: await contextProviderForRun(c.runId) })) */
import { db } from '../db'
import { NullContextProvider, type ContextProvider } from '@/runners/interpret'
import { DbContextProvider } from './provider'

const cache = new Map<string, Promise<ContextProvider>>()

export function contextVersionIdOf(config: unknown): string | null {
  const c = config as { contextVersionId?: unknown } | null
  return c && typeof c.contextVersionId === 'string' && c.contextVersionId ? c.contextVersionId : null
}

export async function contextProviderForRun(runId: string): Promise<ContextProvider> {
  let p = cache.get(runId)
  if (!p) {
    p = (async () => {
      const run = await db.run.findUnique({ where: { id: runId }, select: { config: true } })
      const id = contextVersionIdOf(run?.config)
      const rv = (run?.config as { retrievalVersion?: string } | null)?.retrievalVersion === 'v2' ? 'v2' : 'v1'
      return id ? new DbContextProvider(id, runId, rv) : new NullContextProvider()
    })()
    cache.set(runId, p)
  }
  return p
}

export function contextProviderFor(contextVersionId: string | null, runId?: string): ContextProvider {
  return contextVersionId ? new DbContextProvider(contextVersionId, runId) : new NullContextProvider()
}
