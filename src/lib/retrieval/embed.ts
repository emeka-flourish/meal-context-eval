/* Embedding tier of the cascade (CORPUS.md §4). Real: the pinned OpenAI
   embedding model through LangChain (same SDK family as lib/llm.ts). Mock
   (MOCK_LLM=1 or no OPENAI_API_KEY): null → the cascade falls back to token
   Jaccard, deterministic and free. Vectors are cached per process by text. */
import { OpenAIEmbeddings } from '@langchain/openai'
import { mockForced } from '../llm'
import { CORPUS_CONFIG } from '../corpus/config'
import type { Embedder } from './cascade'

const cache = new Map<string, number[]>()
let client: OpenAIEmbeddings | null = null

export function embeddingsAvailable(): boolean {
  return !mockForced() && Boolean(process.env.OPENAI_API_KEY)
}

/** null when embeddings would be mocked — callers pass `embed: undefined` to the cascade. */
export function makeEmbedder(modelId = CORPUS_CONFIG.embedModelId): Embedder | null {
  if (!embeddingsAvailable()) return null
  if (!client) client = new OpenAIEmbeddings({ model: modelId, apiKey: process.env.OPENAI_API_KEY })
  return async (texts: string[]) => {
    const out: number[][] = new Array(texts.length)
    const todo: { i: number; text: string }[] = []
    texts.forEach((text, i) => {
      const v = cache.get(text)
      if (v) out[i] = v
      else todo.push({ i, text })
    })
    if (todo.length) {
      const vecs = await client!.embedDocuments(todo.map((t) => t.text))
      todo.forEach((t, k) => {
        cache.set(t.text, vecs[k])
        out[t.i] = vecs[k]
      })
    }
    return out
  }
}
