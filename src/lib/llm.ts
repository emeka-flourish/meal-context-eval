import { randomUUID } from 'crypto'
/* Unified LLM runner core (§5B) — LangChain SDK.
   Owner audit 2026-08-18: production traces via LangChain ChatOpenAI +
   SystemMessage/HumanMessage + LangChainTracer callbacks, which yields typed
   LLM runs in LangSmith (system turn visible, model shown, Playground works).
   The AI-SDK path produced a chain-wrapping-llm shape without Playground.
   So this module now invokes models exactly the way production does:
     model.invoke([SystemMessage, HumanMessage], { callbacks: [tracer] })
   Structured output uses withStructuredOutput (still one ChatModel LLM run).

   Every call: ledger row in llm_call BEFORE output is trusted; 3x exponential
   retry; mock mode per-provider when the key is absent (auto-switches to real
   when the key appears — no code change). Frozen-config stamping: modelId +
   promptVersion are passed in from env-read config and recorded on both the
   ledger row and the output row. The local ledger stays authoritative. */
import { ChatOpenAI } from '@langchain/openai'
import { ChatAnthropic } from '@langchain/anthropic'
import { ChatGoogleGenerativeAI } from '@langchain/google-genai'
import { SystemMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { LangChainTracer } from '@langchain/core/tracers/tracer_langchain'
import { z } from 'zod'
import { db } from './db'
import type { Runner } from '@/generated/prisma/client'

type Provider = 'openai' | 'anthropic' | 'google'

export function providerFor(modelId: string): Provider {
  if (/^(gpt|o\d|whisper|chatgpt)/i.test(modelId)) return 'openai'
  if (/^claude/i.test(modelId)) return 'anthropic'
  if (/^gemini/i.test(modelId)) return 'google'
  throw new Error(`cannot infer provider for model: ${modelId}`)
}

const KEY_ENV: Record<Provider, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_AI_API_KEY',
}

export function keyPresent(modelId: string): boolean {
  return Boolean(process.env[KEY_ENV[providerFor(modelId)]])
}

/** MOCK_LLM=1 forces mock mode even when provider keys are present — the
    guard for unattended builds/tests where no paid call may happen. */
export function mockForced(): boolean {
  return process.env.MOCK_LLM === '1'
}

/** True when a call to this model would be mocked (forced or key absent). */
export function willMock(modelId: string): boolean {
  return mockForced() || !keyPresent(modelId)
}

// Like production: the model is invoked DIRECTLY (no withStructuredOutput
// RunnableSequence — that buries the ChatModel run under parser/lambda chains
// and hides Playground). Structured output is requested at the provider level
// (OpenAI json_schema response format; Gemini responseSchema; Anthropic via a
// forced tool) and validated afterwards with the zod schema.
// gpt-5.1 rejects 'minimal' (supported: none|low|medium|high) — verified 2026-08-18
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high'

function chatModel(
  modelId: string,
  schema?: z.ZodTypeAny,
  reasoningEffort?: ReasoningEffort,
  temperature?: number,
  maxTokens?: number,
): BaseChatModel {
  const jsonSchema = schema ? (z.toJSONSchema(schema) as Record<string, unknown>) : undefined
  // Pinned runners (matcher, classifier) ask for temperature 0; only sent when
  // given — OpenAI reasoning models reject an explicit temperature.
  const temp = typeof temperature === 'number' ? { temperature } : {}
  // Output budget. Anthropic's SDK default (1024) truncates a full plate decomposition
  // mid-JSON → forced-tool args come back partial ("plates: undefined", 6/8 live calls on
  // 2026-09-17). Generous by default; runners may lower it.
  const maxOut = typeof maxTokens === 'number' ? maxTokens : 8192
  switch (providerFor(modelId)) {
    case 'openai': {
      // reasoning_effort via modelKwargs — same mechanism as production's
      // createLLMAndMessages. Owner audit 2026-08-18: the trigger pin SAID
      // 'minimal' but nothing was ever sent, so the model used its default.
      const modelKwargs: Record<string, unknown> = {}
      if (jsonSchema) {
        modelKwargs.response_format = {
          type: 'json_schema',
          json_schema: { name: 'output', schema: jsonSchema, strict: false },
        }
      }
      if (reasoningEffort) modelKwargs.reasoning_effort = reasoningEffort
      const m = new ChatOpenAI({
        model: modelId,
        apiKey: process.env.OPENAI_API_KEY,
        ...temp,
        ...(Object.keys(modelKwargs).length > 0 ? { modelKwargs } : {}),
      })
      return m
    }
    case 'anthropic': {
      const m = new ChatAnthropic({ model: modelId, apiKey: process.env.ANTHROPIC_API_KEY, maxTokens: maxOut, ...temp })
      if (jsonSchema) {
        // forced tool call = Anthropic's structured-output mechanism; still a
        // single ChatAnthropic LLM run
        return m.bindTools(
          [{ name: 'output', description: 'Return the structured result.', input_schema: jsonSchema }],
          { tool_choice: { type: 'tool', name: 'output' } },
        ) as unknown as BaseChatModel
      }
      return m
    }
    case 'google': {
      return new ChatGoogleGenerativeAI({
        model: modelId,
        apiKey: process.env.GOOGLE_AI_API_KEY,
        maxOutputTokens: maxOut,
        ...temp,
        ...(jsonSchema ? { json: true } : {}),
      })
    }
  }
}

/** Extract the structured payload from a raw model message regardless of
    provider mechanism (JSON text, or a forced tool call). */
function extractStructured(res: { content: unknown; tool_calls?: { args?: unknown }[] }): unknown {
  if (Array.isArray(res.tool_calls) && res.tool_calls.length > 0) {
    const args = res.tool_calls[0].args
    // a truncated/empty forced tool call → fall through to the text body (may hold the JSON)
    if (args && typeof args === 'object' && Object.keys(args as object).length > 0) return args
  }
  const text =
    typeof res.content === 'string'
      ? res.content
      : (res.content as { type?: string; text?: string }[])
          .map((p) => (p.type === 'text' ? (p.text ?? '') : ''))
          .join('')
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  return JSON.parse(trimmed)
}

// One tracer per process (production caches per project group the same way).
let tracer: LangChainTracer | null = null
function getTracer(): LangChainTracer | null {
  if (!process.env.LANGSMITH_API_KEY) return null
  if (!tracer) {
    tracer = new LangChainTracer({
      projectName: process.env.LANGSMITH_PROJECT ?? 'capture-gap-study',
    })
  }
  return tracer
}
/** LangChainTracer posts in the background; a serverless route can finish
    before the batch lands. Await the client's pending batches (serverless-safe;
    production's long-lived server never needed this). */
async function flushTraces(t: LangChainTracer | null): Promise<void> {
  const client = (t as unknown as { client?: { awaitPendingTraceBatches?: () => Promise<void> } })?.client
  await client?.awaitPendingTraceBatches?.().catch(() => undefined)
}

// Rough $/1M tokens (in, out) for cost ESTIMATES on the ledger — not billing.
const PRICES: [RegExp, [number, number]][] = [
  [/^gpt-5/i, [1.25, 10]],
  [/^gpt-4/i, [2.5, 10]],
  [/^claude.*(opus)/i, [15, 75]],
  [/^claude/i, [3, 15]],
  [/^gemini.*pro/i, [1.25, 10]],
  [/^gemini/i, [0.3, 2.5]],
]
function estimateCost(modelId: string, tokensIn: number, tokensOut: number): number {
  const [, [pin, pout]] = PRICES.find(([re]) => re.test(modelId)) ?? [null, [2, 8]]
  return (tokensIn * pin + tokensOut * pout) / 1_000_000
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…[clipped]' : s
}

/** Content part accepted by runLlm — text, or an image (URL or bytes). */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; image: URL | Uint8Array | Buffer; mimeType?: string }

export type LlmMessage = { role: 'user'; content: string | ContentPart[] }

// JSON.stringify replacer: drop binary image payloads from the ledger record.
function textOnly(_key: string, value: unknown): unknown {
  if (value instanceof Uint8Array || value instanceof URL) return '[image]'
  if (typeof value === 'object' && value !== null && 'type' in value) {
    const v = value as { type?: string }
    if (v.type === 'image') return { type: 'image', image: '[image]' }
  }
  return value
}

/** Convert our neutral message shape into LangChain messages (system first),
    exactly as production's createLLMAndMessages does. */
function toLangChain(system: string | undefined, messages: LlmMessage[]): BaseMessage[] {
  const out: BaseMessage[] = []
  if (system) out.push(new SystemMessage(system))
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push(new HumanMessage(m.content))
      continue
    }
    const parts = m.content.map((p) => {
      if (p.type === 'text') return { type: 'text' as const, text: p.text }
      const url =
        p.image instanceof URL
          ? p.image.toString()
          : `data:${p.mimeType ?? 'image/jpeg'};base64,${Buffer.from(p.image).toString('base64')}`
      return { type: 'image_url' as const, image_url: { url, detail: 'high' } }
    })
    out.push(new HumanMessage({ content: parts }))
  }
  return out
}

export type LlmCallArgs<T> = {
  runner: Runner
  modelId: string
  promptVersion?: string
  subjectRef?: string
  system?: string
  messages: LlmMessage[]
  schema?: z.ZodType<T> // present => structured output; else plain text (T=string)
  reasoningEffort?: ReasoningEffort // OpenAI reasoning models; recorded in metadata
  temperature?: number // pinned runners send 0; omitted = provider default
  maxTokens?: number // output budget; default 8192 (Anthropic's SDK default 1024 truncates decompositions)
  mock: () => T // deterministic result when the provider key is absent (or MOCK_LLM=1)
  maxRetries?: number
}

export type LlmResult<T> = {
  output: T
  callId: string
  mocked: boolean
  latencyMs: number
}

type UsageLike = { input_tokens?: number; output_tokens?: number }

/** Validate structured output with two deterministic repairs, in order:
 *  1. a single-key wrapper — Claude Opus 5 returned {"parameters": {...}} (also
 *     "paramaters", "parameter_name") around the real object in ~4/5 forced-tool
 *     replies; the inner object is parsed instead;
 *  2. a missing array — Haiku 4.5 omitted an empty `uncertain: []`; filled with
 *     [] only when the object already carries at least one expected top-level
 *     key (so a wrapper is never "repaired" into an empty decomposition).
 *  Anything else throws so the caller retries. */
export function parseLenient<T>(schema: z.ZodType<T>, raw: unknown): T {
  const first = schema.safeParse(raw)
  if (first.success) return first.data
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const keys = Object.keys(raw as object)
    const inner = keys.length === 1 ? (raw as Record<string, unknown>)[keys[0]] : undefined
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
      const unwrapped = schema.safeParse(inner)
      if (unwrapped.success) return unwrapped.data
      const expected = topLevelKeys(schema)
      if (expected.length && Object.keys(inner as object).some((k) => expected.includes(k))) return parseLenient(schema, inner)
    }
    const expected = topLevelKeys(schema)
    if (expected.length && !keys.some((k) => expected.includes(k))) throw first.error
  }
  const missingArrays = first.error.issues.filter(
    (i) => i.code === 'invalid_type' && (i as { expected?: string }).expected === 'array' && i.path.length > 0,
  )
  if (missingArrays.length === 0 || missingArrays.length !== first.error.issues.length) throw first.error
  const patched = structuredClone(raw) as Record<string, unknown>
  for (const issue of missingArrays) {
    let node: unknown = patched
    for (const key of issue.path.slice(0, -1)) node = (node as Record<PropertyKey, unknown>)?.[key as PropertyKey]
    const leaf = issue.path[issue.path.length - 1] as PropertyKey
    if (node && typeof node === 'object' && (node as Record<PropertyKey, unknown>)[leaf] === undefined) (node as Record<PropertyKey, unknown>)[leaf] = []
  }
  return schema.parse(patched)
}

/** Top-level property names of an object schema ([] when the schema is not an object). */
function topLevelKeys(schema: z.ZodTypeAny): string[] {
  const shape = (schema as { shape?: Record<string, unknown> }).shape ?? (schema as { def?: { shape?: Record<string, unknown> } }).def?.shape
  return shape && typeof shape === 'object' ? Object.keys(shape) : []
}

export async function runLlm<T>(args: LlmCallArgs<T>): Promise<LlmResult<T>> {
  const started = Date.now()
  // MOCK_LLM=1 wins over a present key: no paid call can leave this process.
  const mocked = willMock(args.modelId)

  if (mocked) {
    const output = args.mock()
    const call = await db.llmCall.create({
      data: {
        runner: args.runner,
        modelId: `${args.modelId} [MOCK]`,
        promptVersion: args.promptVersion,
        subjectRef: args.subjectRef,
        outputRef: clip(JSON.stringify(output), 20_000),
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: Date.now() - started,
        costUsdEst: 0,
        status: 'ok',
      },
    })
    return { output, callId: call.id, mocked: true, latencyMs: Date.now() - started }
  }

  const lcMessages = toLangChain(args.system, args.messages)
  const tracerInst = getTracer()
  // Run name/metadata as production does via callbacks + config: the LLM run
  // is named by runner + model so it's identifiable in the run list.
  const invokeConfig = {
    callbacks: tracerInst ? [tracerInst] : undefined,
    runName: `${args.runner} · ${args.modelId}`,
    metadata: {
      runner: args.runner,
      modelId: args.modelId,
      provider: providerFor(args.modelId),
      promptVersion: args.promptVersion ?? null,
      subjectRef: args.subjectRef ?? null,
      reasoningEffort: args.reasoningEffort ?? null,
      temperature: args.temperature ?? null,
    },
    tags: [args.runner, args.modelId],
  }

  const maxRetries = args.maxRetries ?? 3
  let lastError: Error | null = null
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
    const t0 = Date.now()
    // The LangChain root-run id is chosen here so the ledger row can point at its
    // LangSmith trace (LlmCall.traceId); one id per attempt.
    const traceId = randomUUID()
    try {
      let output: T
      let tokensIn = 0
      let tokensOut = 0
      const model = chatModel(args.modelId, args.schema, args.reasoningEffort, args.temperature, args.maxTokens)
      if (args.schema) {
        // production pattern: model.invoke directly, parse + validate ourselves
        const res = await model.invoke(lcMessages, { ...invokeConfig, runId: traceId })
        const raw = extractStructured(res as { content: unknown; tool_calls?: { args?: unknown }[] })
        output = parseLenient(args.schema, raw)
        const u = (res as { usage_metadata?: UsageLike }).usage_metadata
        tokensIn = u?.input_tokens ?? 0
        tokensOut = u?.output_tokens ?? 0
      } else {
        const res = await model.invoke(lcMessages, { ...invokeConfig, runId: traceId })
        const text =
          typeof res.content === 'string'
            ? res.content
            : (res.content as { type?: string; text?: string }[])
                .map((p) => (p.type === 'text' ? (p.text ?? '') : ''))
                .join('')
        output = text as T
        const u = (res as { usage_metadata?: UsageLike }).usage_metadata
        tokensIn = u?.input_tokens ?? 0
        tokensOut = u?.output_tokens ?? 0
      }
      const latencyMs = Date.now() - t0
      // Ensure the trace is delivered before the request ends (serverless-safe).
      await flushTraces(tracerInst)
      const call = await db.llmCall.create({
        data: {
          runner: args.runner,
          modelId: args.modelId,
          promptVersion: args.promptVersion,
          subjectRef: args.subjectRef,
          traceId: tracerInst ? traceId : null,
          // Local audit trail (§5B): system + messages + output survive even
          // without LangSmith. Images redacted to '[image]'.
          inputRef: clip(
            JSON.stringify({ system: args.system ?? null, messages: args.messages }, textOnly),
            8_000,
          ),
          outputRef: clip(JSON.stringify(output), 20_000),
          tokensIn,
          tokensOut,
          latencyMs,
          costUsdEst: estimateCost(args.modelId, tokensIn, tokensOut),
          status: 'ok',
        },
      })
      return { output, callId: call.id, mocked: false, latencyMs }
    } catch (e) {
      lastError = e as Error
      await db.llmCall.create({
        data: {
          runner: args.runner,
          modelId: args.modelId,
          promptVersion: args.promptVersion,
          subjectRef: args.subjectRef,
          traceId: tracerInst ? traceId : null,
          latencyMs: Date.now() - t0,
          status: attempt < maxRetries - 1 ? 'retry' : 'error',
          error: String(lastError?.message ?? lastError).slice(0, 2000),
        },
      })
    }
  }
  throw lastError ?? new Error('llm call failed')
}
