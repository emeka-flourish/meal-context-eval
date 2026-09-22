'use client'
import { useRef, useState } from 'react'

/* Arm-A manual entry: a typed meal description (app-style text log). Records
   typingSecs from first focus → save (RQ1 manual-effort measure). Used both
   on the Days slot (creates the meal) and the meal page (adds to a meal). */
export default function ManualNoteForm({
  onSave,
  onCancel,
  saving,
}: {
  onSave: (text: string, typingSecs: number | null) => Promise<void> | void
  onCancel: () => void
  saving?: boolean
}) {
  const [text, setText] = useState('')
  const focusedAt = useRef<number | null>(null)

  return (
    <div className="space-y-2 rounded border border-dashed p-2 text-sm">
      <p className="text-xs opacity-70">
        Typed meal description (manual arm) — write it like your normal food log.
      </p>
      <textarea
        value={text}
        autoFocus
        onFocus={() => {
          if (focusedAt.current === null) focusedAt.current = Date.now()
        }}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. 'Dinner: roast chicken leg, about a cup and a half of fried rice with mixed veg, a handful of sautéed green beans'"
        rows={3}
        className="w-full rounded border p-2 text-base"
      />
      <div className="flex gap-2">
        <button
          disabled={!text.trim() || saving}
          onClick={() => {
            const secs =
              focusedAt.current !== null
                ? Math.round((Date.now() - focusedAt.current) / 1000)
                : null
            onSave(text.trim(), secs)
          }}
          className="rounded bg-black px-3 py-1.5 text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {saving ? 'Saving…' : 'Save note'}
        </button>
        <button onClick={onCancel} className="rounded border px-3 py-1.5">
          Cancel
        </button>
      </div>
    </div>
  )
}
