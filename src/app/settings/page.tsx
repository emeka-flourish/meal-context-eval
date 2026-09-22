'use client'
import { useCallback, useEffect, useState } from 'react'

/* Settings & status — env checks, frozen config display, LLM spend, exports,
   backup. Read-only except the backup button: config is frozen (invariant 3)
   and changes only via env + redeploy. */

type Status = {
  db: { ok: boolean; error: string | null }
  env: Record<string, boolean>
  config: Record<string, Record<string, string | string[]>>
  progress?: {
    meals: number
    gold: number
    silver: number
    unrated: number
    pendingGt: number
    captures: number
    scoredCaptures: number
    goldTarget: number
    judgeHuman: number
    judgeTotal: number
    judgeHumanTarget: number
    insightScored: number
    insightTotal: number
    latencyBySurface: Record<string, number>
  }
  spend: {
    runner: string
    calls: number
    errors: number
    costUsd: number
    tokensIn: number
    tokensOut: number
  }[]
  totals: { calls: number; errors: number; costUsd: number }
  now: string
}

const TABLES = [
  'meal',
  'artifact',
  'decomposition',
  'nutrient_calc',
  'judge_score',
  'trigger_result',
  'insight',
  'insight_score',
  'latency_trial',
  'field_note',
  'llm_call',
]

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border p-2">
      <p className="text-[11px] uppercase tracking-wide opacity-60">{label}</p>
      <p className="text-base font-semibold">{value}</p>
      {sub && <p className="text-[11px] opacity-50">{sub}</p>}
    </div>
  )
}

export default function SettingsPage() {
  const [status, setStatus] = useState<Status | null>(null)
  const [backingUp, setBackingUp] = useState(false)
  const [backupMsg, setBackupMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/status')
    if (res.ok) setStatus(await res.json())
  }, [])
  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  async function runBackup() {
    setBackingUp(true)
    setBackupMsg(null)
    try {
      const res = await fetch('/api/backup', { method: 'POST' })
      if (!res.ok) throw new Error(`backup failed (${res.status})`)
      const saved = res.headers.get('X-Backup-Path')
      const dispo = res.headers.get('Content-Disposition') ?? ''
      const filename = dispo.match(/filename="([^"]+)"/)?.[1] ?? 'backup.json'
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      setBackupMsg(`Saved ${saved ?? filename} + downloaded.`)
    } catch (e) {
      setBackupMsg(e instanceof Error ? e.message : 'backup failed')
    } finally {
      setBackingUp(false)
    }
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4 pb-24">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Status</h1>
          <p className="text-sm opacity-60">Health, frozen config, LLM spend, exports, backup.</p>
        </div>
      </header>

      {!status ? (
        <p className="py-8 text-center text-sm opacity-60">Loading status…</p>
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60">
              Environment
            </h2>
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              <StatusItem ok={status.db.ok} label="Database ping">
                {status.db.ok ? 'connected' : (status.db.error ?? 'unreachable')}
              </StatusItem>
              {Object.entries(status.env).map(([k, ok]) => (
                <StatusItem key={k} ok={ok} label={k}>
                  {ok ? 'set' : 'missing'}
                </StatusItem>
              ))}
            </ul>
          </section>

          {status.progress && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60">Study progress</h2>
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <Stat label="gold-tier meals" value={`${status.progress.gold} / ${status.progress.goldTarget}`} sub="protocol target" />
                <Stat label="scored captures" value={String(status.progress.scoredCaptures)} sub={`${status.progress.captures} captured`} />
                <Stat label="silver · unrated · pending GT" value={`${status.progress.silver} · ${status.progress.unrated} · ${status.progress.pendingGt}`} />
                <Stat label="judge hand-scored" value={`${status.progress.judgeHuman} / ${status.progress.judgeHumanTarget}`} sub={`${status.progress.judgeTotal} machine-judged`} />
                <Stat label="insights blind-scored" value={`${status.progress.insightScored} / ${status.progress.insightTotal}`} />
                <Stat
                  label="latency trials"
                  value={['phone', 'glasses', 'tripod'].map((s) => `${s[0]}:${status.progress!.latencyBySurface[s] ?? 0}`).join(' ')}
                  sub="target 10 each"
                />
              </div>
            </section>
          )}

          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60">
              Frozen config (stamped on every generated row)
            </h2>
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-left text-sm">
                <tbody>
                  {Object.entries(status.config).map(([section, values]) =>
                    Object.entries(values).map(([key, value], i) => (
                      <tr key={`${section}.${key}`} className="border-b last:border-b-0">
                        <td className="px-3 py-1.5 font-medium opacity-70">
                          {i === 0 ? section : ''}
                        </td>
                        <td className="px-3 py-1.5">{key}</td>
                        <td className="px-3 py-1.5 font-mono text-xs">
                          {Array.isArray(value) ? value.join(', ') : String(value)}
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60">LLM spend</h2>
            <div className="overflow-x-auto rounded border">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b bg-neutral-50 dark:bg-neutral-900">
                    <th className="px-3 py-1.5">runner</th>
                    <th className="px-3 py-1.5 text-right">calls</th>
                    <th className="px-3 py-1.5 text-right">errors</th>
                    <th className="px-3 py-1.5 text-right">tokens in/out</th>
                    <th className="px-3 py-1.5 text-right">est. cost</th>
                  </tr>
                </thead>
                <tbody>
                  {status.spend.map((s) => (
                    <tr key={s.runner} className="border-b">
                      <td className="px-3 py-1.5">{s.runner}</td>
                      <td className="px-3 py-1.5 text-right">{s.calls}</td>
                      <td
                        className={`px-3 py-1.5 text-right ${s.errors > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}
                      >
                        {s.errors}
                      </td>
                      <td className="px-3 py-1.5 text-right text-xs">
                        {s.tokensIn.toLocaleString()} / {s.tokensOut.toLocaleString()}
                      </td>
                      <td className="px-3 py-1.5 text-right">${s.costUsd.toFixed(4)}</td>
                    </tr>
                  ))}
                  <tr className="font-medium">
                    <td className="px-3 py-1.5">total</td>
                    <td className="px-3 py-1.5 text-right">{status.totals.calls}</td>
                    <td className="px-3 py-1.5 text-right">{status.totals.errors}</td>
                    <td />
                    <td className="px-3 py-1.5 text-right">${status.totals.costUsd.toFixed(4)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60">Exports</h2>
            <div className="flex flex-wrap gap-2 text-sm">
              <a href="/api/export/flat" className="rounded border px-3 py-2 underline">
                Flat file (analysis CSV)
              </a>
              <a href="/api/export/mealcap" className="rounded border px-3 py-2 underline">
                mealcap bundle (.zip)
              </a>
            </div>
            <div className="flex flex-wrap gap-1.5 text-xs">
              {TABLES.map((t) => (
                <a
                  key={t}
                  href={`/api/export/table?table=${t}`}
                  className="rounded border px-2 py-1 underline"
                >
                  {t}.csv
                </a>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide opacity-60">Backup</h2>
            <button
              onClick={runBackup}
              disabled={backingUp}
              className="rounded border px-4 py-3 font-medium active:bg-neutral-100 disabled:opacity-50 dark:active:bg-neutral-900"
            >
              {backingUp ? 'Backing up…' : 'Backup database now'}
            </button>
            <p className="text-xs opacity-60">
              Full JSON dump of every table → .data/backups/ + direct download. Also available as{' '}
              <code>pnpm backup</code>.
            </p>
            {backupMsg && <p className="text-sm">{backupMsg}</p>}
          </section>
        </>
      )}
    </main>
  )
}

function StatusItem({
  ok,
  label,
  children,
}: {
  ok: boolean
  label: string
  children: React.ReactNode
}) {
  return (
    <li className="flex items-center justify-between gap-2 rounded border px-3 py-2 text-sm">
      <span className="truncate font-mono text-xs">{label}</span>
      <span
        className={`rounded px-1.5 py-0.5 text-xs ${
          ok
            ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
            : 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200'
        }`}
      >
        {children}
      </span>
    </li>
  )
}
