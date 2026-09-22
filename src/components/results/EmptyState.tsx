import Link from 'next/link'

/* Every empty state on Results says what to do next (REBUILD-SPEC §3.4 /
   task item 5): a title, one sentence, and the link that resolves it. */
export default function EmptyState({
  title,
  body,
  action,
  compact,
}: {
  title: string
  body?: React.ReactNode
  action?: { href: string; label: string }
  compact?: boolean
}) {
  return (
    <div
      className={[
        'flex flex-col items-start gap-1.5 rounded-[10px] border border-dashed border-line-strong bg-white text-ink-muted',
        compact ? 'px-4 py-3' : 'px-6 py-8',
      ].join(' ')}
      role="status"
    >
      <b className="text-ink">{title}</b>
      {body && <span>{body}</span>}
      {action && (
        <Link href={action.href} className="mt-1 rounded-md border border-line-strong bg-white px-3 py-1.5 font-medium text-ink no-underline hover:bg-tint">
          {action.label}
        </Link>
      )}
    </div>
  )
}
