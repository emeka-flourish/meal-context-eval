'use client'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/* Segmented control from the mockups (`.seg` in globals.css). A disabled
   option renders greyed with a tooltip saying why. */
export type SegOption<T extends string> = { id: T; label: string; disabled?: boolean; why?: string }

export default function Seg<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: T
  options: SegOption<T>[]
  onChange: (v: T) => void
  ariaLabel: string
  className?: string
}) {
  return (
    <span className={['seg', className].filter(Boolean).join(' ')} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => {
        const btn = (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            data-on={value === o.id ? 'true' : 'false'}
            disabled={o.disabled}
            aria-disabled={o.disabled}
            onClick={() => !o.disabled && onChange(o.id)}
            className={o.disabled ? 'cursor-not-allowed text-ink-faint' : undefined}
          >
            {o.label}
          </button>
        )
        if (!o.disabled || !o.why) return btn
        return (
          <Tooltip key={o.id}>
            <TooltipTrigger asChild>
              <span className="inline-flex">{btn}</span>
            </TooltipTrigger>
            <TooltipContent>{o.why}</TooltipContent>
          </Tooltip>
        )
      })}
    </span>
  )
}
