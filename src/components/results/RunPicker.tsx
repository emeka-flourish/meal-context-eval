'use client'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { dayShort } from '@/lib/ui/format'

/* Run picker for the Results header (the AppShell run pill is a placeholder;
   the run lives in `?run=`). Reads GET /api/runs rows. */
export type RunRow = {
  id: string
  label: string
  createdAt: string
  status: string
  summary: { scenes: number; cells: number; models: { id: string; family: string; tier: string }[]; conditions: string[] }
}

export default function RunPicker({ runs, value, onChange }: { runs: RunRow[]; value: string | null; onChange: (id: string) => void }) {
  return (
    <span className="flex items-center gap-2 text-ink-muted">
      Run
      <Select value={value ?? undefined} onValueChange={onChange}>
        <SelectTrigger size="sm" className="h-7 gap-1.5 bg-white px-2.5 font-mono text-[12px] text-ink" aria-label="Run">
          <SelectValue placeholder="pick a run" />
        </SelectTrigger>
        <SelectContent>
          {runs.map((r) => (
            <SelectItem key={r.id} value={r.id} className="text-[12px]">
              <span className="font-mono">{r.label}</span>
              <span className="text-ink-faint">
                · {dayShort(r.createdAt.slice(0, 10))} · {r.summary.scenes} scenes · {r.status}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </span>
  )
}
