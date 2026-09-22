'use client'
import { useId } from 'react'
import type { Aggregate } from '@/lib/scoring/aggregate'
import { LEGACY_RUN_VANTAGES, type Vantage } from '@/lib/ui/format'
import { CONDITION_COLOR, CONDITION_LABEL } from '@/lib/ui/results-format'
import type { Condition, Level1Figure as FigureData } from '@/lib/ui/results-types'

/* The headline figure (METRICS.md Level 1 "Report"; mockup Main.dc.html):
   two panels with identical layout — Net recognition | Quantity — vantage
   on the x-axis, one bar per condition. Left panel: Recognized is the full
   bar height with the invented deduction hatched down to Net; the whisker is
   the 95 % CI of Net. Right panel: Quantity with its CI. Context-only as a
   dashed line across. Hand-written inline SVG (no chart library). */

const W = 560
const H = 260
const Y0 = 230 // baseline
const Y1 = 16 // value 1
const X_LEFT = 40
const BAR_W = 50
const BAR_GAP = 12
/** bar-group centres, spread evenly over the plot width for however many cameras the run has */
const groupCenters = (n: number) => Array.from({ length: n }, (_, i) => X_LEFT + ((W - X_LEFT) * (i + 0.5)) / Math.max(1, n))

const yOf = (v: number) => Y0 - Math.max(0, Math.min(1, v)) * (Y0 - Y1)

type PanelProps = {
  title: string
  subtitle: string
  figure: FigureData
  metric: 'net' | 'quantity'
  compact?: boolean
  /** cameras of the run, in column order */
  vantages?: Vantage[]
}

export function Level1Panel({ title, subtitle, figure, metric, compact, vantages = LEGACY_RUN_VANTAGES }: PanelProps) {
  const centers = groupCenters(vantages.length)
  const hatchId = useId().replace(/:/g, '')
  const conditions = [...new Set(figure.bars.map((b) => b.condition))] as Condition[]
  const k = Math.max(1, conditions.length)
  const groupW = k * BAR_W + (k - 1) * BAR_GAP
  const ctx = figure.contextOnly ? figure.contextOnly[metric] : null

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <b>{title}</b>
      <span className="text-[12px] text-ink-muted">{subtitle}</span>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={compact ? 380 : W}
        height={compact ? Math.round((H * 380) / W) : H}
        role="img"
        aria-label={`${title} by camera and condition`}
        className="max-w-full"
      >
        <defs>
          <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--paper)" strokeWidth="3" />
          </pattern>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={X_LEFT} x2={W} y1={yOf(v)} y2={yOf(v)} stroke={v === 0 ? 'var(--line-strong)' : '#eeede8'} />
            <text x={X_LEFT - 6} y={yOf(v) + 4} textAnchor="end" fontSize="11" fill="var(--ink-faint)" fontFamily="var(--font-mono), monospace">
              {v}
            </text>
          </g>
        ))}
        {vantages.map((vantage, gi) => {
          const cx = centers[gi]
          const x0 = cx - groupW / 2
          return (
            <g key={vantage}>
              {conditions.map((condition, ci) => {
                const bar = figure.bars.find((b) => b.vantage === vantage && b.condition === condition)
                const x = x0 + ci * (BAR_W + BAR_GAP)
                if (!bar) {
                  return (
                    <text key={condition} x={x + BAR_W / 2} y={Y0 - 6} textAnchor="middle" fontSize="10" fill="var(--ink-faint)">
                      —
                    </text>
                  )
                }
                const value: Aggregate = bar[metric]
                if (value.mean === null) return null
                const full = metric === 'net' ? (bar.recognized.mean ?? value.mean) : value.mean
                const yTop = yOf(full)
                const yVal = yOf(value.mean)
                const lo = value.ci ? yOf(value.ci[1]) : yVal
                const hi = value.ci ? yOf(value.ci[0]) : yVal
                return (
                  <g key={condition}>
                    <title>
                      {vantage} · {CONDITION_LABEL[condition]} · {metric} {value.mean.toFixed(2)}
                      {value.ci ? ` [${value.ci[0].toFixed(2)}, ${value.ci[1].toFixed(2)}]` : ''} · n={bar.n}
                    </title>
                    <rect x={x} y={yTop} width={BAR_W} height={Y0 - yTop} rx="4" fill={CONDITION_COLOR[condition]} />
                    {metric === 'net' && yVal > yTop && <rect x={x} y={yTop} width={BAR_W} height={yVal - yTop} fill={`url(#${hatchId})`} />}
                    <line x1={x + BAR_W / 2} x2={x + BAR_W / 2} y1={lo} y2={hi} stroke="var(--ink)" strokeWidth="1.5" />
                    <text x={x + BAR_W / 2} y={lo - 5} textAnchor="middle" fontSize="11" fontFamily="var(--font-mono), monospace" fill="var(--ink)">
                      {value.mean.toFixed(2)}
                    </text>
                  </g>
                )
              })}
              <text x={cx} y={252} textAnchor="middle" fontSize="12" fill="var(--ink-muted)" fontFamily="var(--font-sans), sans-serif">
                {vantage}
              </text>
            </g>
          )
        })}
        {ctx && ctx.mean !== null && (
          <g>
            <title>
              context only · {metric} {ctx.mean.toFixed(2)}
              {ctx.ci ? ` [${ctx.ci[0].toFixed(2)}, ${ctx.ci[1].toFixed(2)}]` : ''} · n={figure.contextOnly!.n}
            </title>
            <line x1={X_LEFT} x2={W} y1={yOf(ctx.mean)} y2={yOf(ctx.mean)} stroke={CONDITION_COLOR.context_only} strokeWidth="2" strokeDasharray="6 5" />
            {/* label sits above the line, or below it when the line is near the top (keeps clear of the bar labels) */}
            <text x={W - 4} y={yOf(ctx.mean) < 44 ? yOf(ctx.mean) + 14 : yOf(ctx.mean) - 6} textAnchor="end" fontSize="11" fill="var(--ink)" fontFamily="var(--font-sans), sans-serif">
              context only, no image · {ctx.mean.toFixed(2)}
            </text>
          </g>
        )}
      </svg>
    </div>
  )
}

export default function Level1Figure({ figure, compact, vantages }: { figure: FigureData; compact?: boolean; vantages?: Vantage[] }) {
  return (
    <div className={compact ? 'flex gap-4' : 'flex gap-7'}>
      <Level1Panel title="Net recognition" subtitle="importance-weighted share recognized, minus invented (0–1)" figure={figure} metric="net" compact={compact} vantages={vantages} />
      <Level1Panel title="Quantity" subtitle="mass-weighted closeness of grams (0–1)" figure={figure} metric="quantity" compact={compact} vantages={vantages} />
    </div>
  )
}

export function ConditionLegend({ conditions }: { conditions: Condition[] }) {
  return (
    <span className="ml-auto flex items-center gap-1.5">
      {conditions.map((c) => (
        <span key={c} className="chip">
          <span className="inline-block size-2 rounded-[2px]" style={{ background: CONDITION_COLOR[c] }} />
          {CONDITION_LABEL[c]}
        </span>
      ))}
    </span>
  )
}
