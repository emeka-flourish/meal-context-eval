'use client'
import { CONDITION_COLOR, CONDITION_LABEL } from '@/lib/ui/results-format'
import type { KcalBiasRow } from '@/lib/ui/results-types'

/* Signed kcal bias per camera (METRICS.md Level 2 "Report"): one dumbbell
   per vantage, image only → with context, zero line, thin 95 % CI whiskers.
   Inline SVG. */

const W = 560
const ROW_H = 36
const PAD_TOP = 26
const PAD_BOTTOM = 26
const X0 = 70
const X1 = W - 20

export default function KcalBiasDumbbell({ rows }: { rows: KcalBiasRow[] }) {
  if (rows.length === 0) return <span className="text-ink-faint">no kcal cells yet</span>
  const H = PAD_TOP + rows.length * ROW_H + PAD_BOTTOM
  let ext = 25
  for (const r of rows) {
    for (const a of [r.imageOnly, r.withContext]) {
      if (!a || a.mean === null) continue
      ext = Math.max(ext, Math.abs(a.mean), ...(a.ci ? a.ci.map(Math.abs) : []))
    }
  }
  ext = Math.ceil(ext / 10) * 10
  const xOf = (v: number) => X0 + ((v + ext) / (2 * ext)) * (X1 - X0)
  const ticks = [-ext, -ext / 2, 0, ext / 2, ext]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Signed kcal bias per camera, image only to with context" className="max-w-full">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={xOf(t)} x2={xOf(t)} y1={PAD_TOP - 8} y2={H - PAD_BOTTOM + 4} stroke={t === 0 ? 'var(--line-strong)' : '#eeede8'} strokeWidth={t === 0 ? 1.5 : 1} />
          <text x={xOf(t)} y={H - PAD_BOTTOM + 16} textAnchor="middle" fontSize="11" fill="var(--ink-faint)" fontFamily="var(--font-mono), monospace">
            {t > 0 ? '+' : ''}
            {t}%
          </text>
        </g>
      ))}
      {rows.map((r, i) => {
        const y = PAD_TOP + i * ROW_H + ROW_H / 2
        const a = r.imageOnly && r.imageOnly.mean !== null ? r.imageOnly : null
        const b = r.withContext && r.withContext.mean !== null ? r.withContext : null
        return (
          <g key={r.vantage}>
            <text x={X0 - 12} y={y + 4} textAnchor="end" fontSize="12" fill="var(--ink-muted)" fontFamily="var(--font-sans), sans-serif">
              {r.vantage}
            </text>
            {a && b && <line x1={xOf(a.mean!)} x2={xOf(b.mean!)} y1={y} y2={y} stroke="var(--line-strong)" strokeWidth="3" />}
            {[
              { agg: a, color: CONDITION_COLOR.image_only, label: CONDITION_LABEL.image_only, dy: -7 },
              { agg: b, color: CONDITION_COLOR.image_context, label: CONDITION_LABEL.image_context, dy: 7 },
            ].map(({ agg, color, label, dy }) =>
              agg && agg.mean !== null ? (
                <g key={label}>
                  <title>
                    {r.vantage} · {label} · {agg.mean > 0 ? '+' : ''}
                    {agg.mean.toFixed(0)}%{agg.ci ? ` [${agg.ci[0].toFixed(0)}, ${agg.ci[1].toFixed(0)}]` : ''} · n={agg.n}
                  </title>
                  {agg.ci && <line x1={xOf(agg.ci[0])} x2={xOf(agg.ci[1])} y1={y + dy} y2={y + dy} stroke={color} strokeWidth="1" opacity="0.7" />}
                  <circle cx={xOf(agg.mean)} cy={y} r="6" fill={color} stroke="#fff" strokeWidth="1.5" />
                </g>
              ) : null,
            )}
            {a && a.mean !== null && (
              <text x={xOf(a.mean)} y={y - 11} textAnchor="middle" fontSize="10" fill="var(--ink)" fontFamily="var(--font-mono), monospace">
                {a.mean > 0 ? '+' : ''}
                {a.mean.toFixed(0)}%
              </text>
            )}
            {b && b.mean !== null && (
              <text x={xOf(b.mean)} y={y + 19} textAnchor="middle" fontSize="10" fill="var(--ink)" fontFamily="var(--font-mono), monospace">
                {b.mean > 0 ? '+' : ''}
                {b.mean.toFixed(0)}%
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
