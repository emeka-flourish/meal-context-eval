import { readFileSync } from 'fs'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ db: {} }))

import { computePromptLock, LOCK_PATH, type LockEntry } from './prompt-lock'

describe('prompt lock', () => {
  const locked = (JSON.parse(readFileSync(LOCK_PATH, 'utf-8')) as { entries: LockEntry[] }).entries
  const now = computePromptLock()

  it('covers every pipeline stage', () => {
    expect(now.map((e) => e.stage)).toEqual(locked.map((e) => e.stage))
  })

  for (const entry of now) {
    it(`${entry.stage}: ${entry.promptVersion} is byte-identical to the lock, same model, same temperature`, () => {
      const was = locked.find((l) => l.stage === entry.stage)
      // A failure here means a LOCKED prompt, model or temperature changed. Do not re-lock over it:
      // save the new text under a new version name, point the config at it, then `pnpm lock:prompts`.
      expect(entry).toEqual(was)
    })
  }
})
