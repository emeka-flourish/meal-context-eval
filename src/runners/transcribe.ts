/* Transcription runner (§5B) — audio artifact → transcript via OpenAI Whisper
   REST. runLlm covers text/vision generation only, so this runner writes its
   own llm_call ledger row (BEFORE the transcript is trusted), following the
   llm.ts pattern: mock when the key is absent, status ok/error, latencyMs. */
import { readFileSync } from 'fs'
import { join } from 'path'
import { db } from '../lib/db'
import { traceable } from 'langsmith/traceable'
import { CONFIG } from '../lib/config'
import type { Artifact } from '../generated/prisma/client'

const AUDIO_EXT = /\.(m4a|mp3|wav|webm|ogg|oga|flac|mpga|mpeg|mp4)$/i

function isAudioArtifact(artifact: Artifact): boolean {
  // The manual_audio surface left the enum with intake v2 (2026-09-16); an
  // audio file extension on the blob key/URL is the only signal.
  const path = artifact.blobUrl?.split('?')[0]
  return Boolean(path && AUDIO_EXT.test(path))
}

/** Local-dev media URLs (/api/media/...) load bytes from disk; public blob
    URLs are fetched. */
async function audioBytes(blobUrl: string): Promise<Uint8Array<ArrayBuffer>> {
  if (blobUrl.startsWith('/api/media/')) {
    // Copy into a fresh ArrayBuffer-backed view (Buffer may be pool-backed).
    return new Uint8Array(
      readFileSync(join(process.cwd(), '.data/media', blobUrl.replace('/api/media/', ''))),
    )
  }
  const res = await fetch(blobUrl)
  if (!res.ok) throw new Error(`audio fetch failed: ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

export async function transcribeArtifact(
  artifact: Artifact,
): Promise<{ transcript: string; mocked: boolean }> {
  // Idempotent (QA P1-7): an existing transcript is final — never re-bill
  // Whisper or overwrite ('finished work is never redone').
  if (artifact.transcript != null) {
    return { transcript: artifact.transcript, mocked: false }
  }
  if (!isAudioArtifact(artifact)) throw new Error('transcribe: artifact is not audio')
  const modelId = CONFIG.transcribe.modelId
  const started = Date.now()

  if (!process.env.OPENAI_API_KEY) {
    // Mock mode (auto-switches to real when the key appears — no code change).
    const transcript = '[MOCK] transcription unavailable — no key'
    await db.llmCall.create({
      data: {
        runner: 'transcribe',
        modelId: `${modelId} [MOCK]`,
        subjectRef: `artifact:${artifact.id}`,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: Date.now() - started,
        costUsdEst: 0,
        status: 'ok',
      },
    })
    await db.artifact.update({ where: { id: artifact.id }, data: { transcript } })
    return { transcript, mocked: true }
  }

  try {
    if (!artifact.blobUrl) throw new Error('transcribe: artifact has no blobUrl')
    const bytes = await audioBytes(artifact.blobUrl)
    const filename = artifact.blobUrl.split('/').pop()?.split('?')[0] || 'audio.m4a'
    const form = new FormData()
    form.append('file', new Blob([bytes]), filename)
    form.append('model', modelId)
    form.append('response_format', 'verbose_json') // includes duration (secs)

    // Traced like every other model call (owner: "fix it everywhere") — the
    // raw REST call bypasses the AI SDK, so wrap it in a LangSmith traceable.
    const whisper = traceable(
      async (input: { model: string; filename: string; bytes: number }) => {
        const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
          body: form,
        })
        if (!res.ok) {
          throw new Error(`whisper ${res.status}: ${(await res.text()).slice(0, 500)}`)
        }
        void input
        return (await res.json()) as { text: string; duration?: number }
      },
      {
        name: `transcribe · ${modelId}`,
        run_type: 'llm',
        project_name: process.env.LANGSMITH_PROJECT ?? 'capture-gap-study',
        metadata: { runner: 'transcribe', modelId, provider: 'openai', subjectRef: `artifact:${artifact.id}` },
      },
    )
    const json = await whisper({ model: modelId, filename, bytes: bytes.byteLength })
    const latencyMs = Date.now() - started
    const durationSecs =
      typeof json.duration === 'number' && json.duration > 0 ? json.duration : null

    // Ledger row before the transcript is trusted. Whisper bills per minute
    // (~$0.006/min) — token counts don't apply.
    await db.llmCall.create({
      data: {
        runner: 'transcribe',
        modelId,
        subjectRef: `artifact:${artifact.id}`,
        latencyMs,
        costUsdEst: durationSecs === null ? null : (durationSecs / 60) * 0.006,
        status: 'ok',
      },
    })
    await db.artifact.update({
      where: { id: artifact.id },
      data: {
        transcript: json.text,
        ...(durationSecs === null ? {} : { audioDurationSecs: durationSecs }),
      },
    })
    return { transcript: json.text, mocked: false }
  } catch (e) {
    await db.llmCall.create({
      data: {
        runner: 'transcribe',
        modelId,
        subjectRef: `artifact:${artifact.id}`,
        latencyMs: Date.now() - started,
        status: 'error',
        error: String((e as Error)?.message ?? e).slice(0, 2000),
      },
    })
    throw e
  }
}
