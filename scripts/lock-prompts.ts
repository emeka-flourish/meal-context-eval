/* Write prompts/PROMPTS.lock.json from the prompts as they are right now.
   Run only after giving a changed prompt a NEW version name (see src/lib/prompt-lock.ts). */
import { writeFileSync } from 'fs'
import { computePromptLock, LOCK_PATH } from '@/lib/prompt-lock'

const entries = computePromptLock()
writeFileSync(LOCK_PATH, JSON.stringify({ lockedAt: new Date().toISOString().slice(0, 10), entries }, null, 2) + '\n')
for (const e of entries) console.log(`${e.promptVersion.padEnd(24)} ${e.sha256.slice(0, 12)}  ${e.stage}`)
console.log(`→ ${LOCK_PATH}`)
process.exit(0)
