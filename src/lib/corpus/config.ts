/* Pinned models for the context layer (CORPUS.md §3/§4). Read from env at
   load and recorded on every ContextVersion.config / retrieval log, so a
   later env change never rewrites what an old version was built with. */
export const CORPUS_CONFIG = {
  /** "same dish?" merge confirm + habit-profile writer (distillation) */
  distillModelId: process.env.DISTILL_MODEL_ID ?? 'gpt-5.1',
  /** image → 3–5 plausible dish names + visible dishware (retrieval router; cheap vision model) */
  routerModelId: process.env.ROUTER_MODEL_ID ?? 'gpt-5.4-mini-2026-03-17', // Gemini structured output dropped `dish_names` on 27/27 live calls (2026-09-17)
  /** embedding model for the cascade's third tier (OpenAI embeddings API) */
  embedModelId: process.env.EMBED_MODEL_ID ?? 'text-embedding-3-small',
  /** cascade thresholds (CORPUS.md §4; the embedding threshold is set in the pilot) */
  tokenOverlapMin: Number(process.env.RETRIEVAL_TOKEN_OVERLAP_MIN ?? 0.6),
  embedCosineMin: Number(process.env.RETRIEVAL_EMBED_COSINE_MIN ?? 0.5),
  topK: 3,
  /** routine rule (CORPUS.md §5): a card counts as routine when instanceCount ≥ this */
  routineMinInstances: 3,
} as const
