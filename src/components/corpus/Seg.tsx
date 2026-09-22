'use client'
import { cn } from 'cn'

/* Segmented control from the mockups (`.seg` in globals.css): one button per
   option, the active one carries data-on. Generic over the option value. */
export default function Seg<T extends string>({
  value,
  options,
  onChange,
  className,
  disabled,
  ariaLabel,
}: {
  value: T
  options: { value: T; label: string; title?: string }[]
  onChange: (v: T) => void
  className?: string
  disabled?: boolean
  ariaLabel?: string
}) {
  return (
    <span className={cn('seg', disabled && 'opacity-60', className)} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          data-on={o.value === value}
          title={o.title}
          disabled={disabled}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </span>
  )
}
