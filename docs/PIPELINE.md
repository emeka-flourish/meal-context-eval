# The inference pipeline, step by step

This describes exactly what happens to one photo, which model is called at each step, which
prompt it gets, and what is locked. Formulas are in `docs/METRICS.md`; the context layer is in
`docs/CORPUS.md`.

## 1. The unit of work: a cell

A **scene** is one moment at the table, photographed by each study camera (by default the phone
and the smart glasses; `STUDY_VANTAGES` changes the list — a third `tripod` view is supported).
A **cell** is one question put to one model: *this scene, this camera, this condition, this model*.

With two cameras, each scene produces 5 cells per model:

- 2 × **image only** (one per camera): the model sees the photo and nothing else about you.
- 2 × **image + context** (one per camera): the model sees the photo plus dish cards,
  your habit summary and your dishware.
- 1 × **context only**: no photo at all. The model gets the day, the time, and your usual
  dishes for that meal slot. This is the "how far does history alone get you" baseline.

With 6 models that is 30 cells per scene; with 2 models, 10.

## 2. What happens inside one cell

```
router → interpret → match → classify → score
(context  (the model   (blind   (blind    (arithmetic,
 lookup)   under test)  pairing) flags)    no model)
```

### Step 0 (once per scene and camera, only for image + context): the router

- **Why it exists:** to pick which dish cards to show, we first need a guess at what is on the plate.
- **Model:** a cheap, fast vision model (`ROUTER_MODEL_ID`), temperature 0.
- **Prompt:** `router.v2` (in `src/runners/router.ts`). The router is given the person's own dish
  names (from the context version, never from the ground truth) and picks from them first; plates
  that match nothing get a short generic name. It also lists visible dishware. (`router.v1`, which
  names dishes without the vocabulary, is kept and selectable with `RETRIEVAL_VERSION=v1`.)
- **Then, no model involved:** each name is looked up in your dish cards by a three-tier cascade:
  (1) exact name or alias, (2) at least 60% word overlap, (3) embedding similarity ≥ 0.5.
  The best cards are kept (up to 5 under retrieval v2, 3 under v1).
- **Context only** skips the router (there is no photo). It takes the 3 cards you most often
  eat in that meal slot (slot share × how many times logged).
- The ground truth is never consulted here. Retrieval sees only the photo.

### Step 1: interpret (the step under test)

- **Model:** the roster model for this cell. This is the ONLY step where the study models
  differ. Temperature is the provider default, because some reasoning models reject an
  explicit temperature and all models should be treated the same.
- **Prompt:** `prompts/interpret.v4.md`, built from six blocks:
  1. Role and task. 2. Output schema. 3. Estimation rules. 4. Situation (weekday, local time,
  home or away, which camera). These four are **byte-for-byte identical** across conditions.
  5. Context (dish cards, habit summary, dishware). 6. Rules for using context.
  Blocks 5 and 6 are **empty** in image only, so the only difference between the two image
  conditions is the context itself. The hash of every block that was sent is saved on the
  decomposition row, so this is checkable after the fact.
- **Output:** plates → dishes → ingredients, each with grams, state (cooked/raw/dry/as served),
  preparation, confidence, and an `inferred` flag for things it cannot see (oil, salt).
  Plus an `uncertain` list. Drinks are dropped.
- The model never sees your notes or the ground truth.

### Step 2: match (blind judge of "did it find the food")

- **Model:** one pinned model (`MATCHER_MODEL_ID`), temperature 0. The same model for every cell,
  so it cannot favour anyone.
- **Prompt:** `prompts/match.v3.md`. Input is two lists only: your weighed items and the
  predicted items. It does not know which model, camera or condition produced the prediction.
- **Output:** a match table. Each truth item is paired with zero, one or several predictions
  and graded `exact` (1.0), `substitute` (0.5) or `wrong` (0). Unpaired predictions are listed
  as invented with a tag (core / secondary / garnish / spice / ignore). Code then caps the tag
  of small invented items (for example under 14 g of oil can never be more than a garnish).
- You can override any row by hand in Results → Meal → match review. Overrides are kept
  separately from the model's judgement, and the override rate is reported.

### Step 3: classify (blind input to the persona decisions)

- **Model:** one pinned model (`CLASSIFIER_MODEL_ID`), temperature 0. **Prompt:** `prompts/classify.v1.md`.
- Runs twice per cell: once on the truth ingredient lines, once on the predicted lines. It
  sees only ingredient lines, never which side it is reading.
- **Output:** FODMAP load (low / moderate / high), fried yes/no with grams, spicy yes/no.

### Step 4: score (no model, arithmetic only)

- Nutrients: every truth item and predicted item is looked up in USDA FoodData Central
  (free; every pick is cached so the same name always resolves the same way). If USDA has no
  match, a fallback model estimate is drafted (`nutrient-estimate.v1`, temperature 0) and saved
  as a **pending custom food** for you to approve.
- Level 1 (recognized / invented / net / quantity, plus hidden-ingredient recall for items
  flagged `hidden`), Level 2 (kcal, protein, fat, carb, fiber errors) and Level 3 (six persona
  decisions) are computed from the match table, the nutrient lookups and the two classifications.

## 3. Steps that run outside a run

- **Ground-truth structurer** (`gt-structure.v1`): turns your typed notes into tagged
  items with grams. Its prompt is `docs/TAG-GUIDE.md` plus parsing rules. You can edit the
  result, or skip the model entirely and import a hand-written food list
  (`scripts/import-gt-json.ts`).
- **Distill** (context build): groups your logged meal history into dish cards. Code proposes
  merges; `distill-confirm.v1` (temperature 0) answers "same dish, yes or no" for each
  candidate pair. `habit-profile.v1` then writes the 5–8 line habit summary from card
  statistics only (never raw meals). The result is a frozen **context version**; every run
  records which version it used.

## 4. What is recorded for every model call

- A row in the local `LlmCall` table: step, model, prompt version, scene/camera/condition,
  the full text input (images replaced by `[image]`), the full output, tokens, latency, cost.
- Optionally a LangSmith trace (set `LANGSMITH_API_KEY` and `LANGSMITH_TRACING=true`), named
  `<step> · <model>`, with the same metadata; the ledger row stores the trace id.

## 5. The lock

Every prompt the pipeline sends, with its pinned model and temperature, is hashed into
`prompts/PROMPTS.lock.json`. A test (`src/lib/prompt-lock.test.ts`) fails if any prompt text,
pinned model or temperature below changes.

| step | prompt version | lives in | model | temperature | sha256 (first 12) |
|---|---|---|---|---|---|
| router | `router.v1` | src/runners/router.ts | gpt-5.4-mini-2026-03-17 | 0 | `34e5669d4d3c` |
| router (retrieval v2: picks from the person's dish names) | `router.v2` | src/runners/router.ts | gpt-5.4-mini-2026-03-17 | 0 | `356f8ad41be7` |
| interpret | `interpret.v4` | prompts/interpret.v4.md | the run roster | provider default | `f13ecd794f88` |
| matcher | `match.v3` | prompts/match.v3.md | gpt-5.1 | 0 | `2f684f677dd6` |
| classifier | `classify.v1` | prompts/classify.v1.md | gpt-5.1 | 0 | `009f29f8a14f` |
| nutrient estimate (fallback) | `nutrient-estimate.v1` | prompts/nutrient-estimate.v1.md | gpt-5.1 | 0 | `655ad2bd57bd` |
| ground-truth structurer | `gt-structure.v1` | docs/TAG-GUIDE.md + src/runners/gtStructure.ts | gpt-5.1 | provider default | `d00e6a58042b` |
| distill: same-dish check | `distill-confirm.v1` | src/runners/distill.ts | gpt-5.1 | 0 | `6f58b49c88b1` |
| distill: habit profile | `habit-profile.v1` | src/runners/distill.ts | gpt-5.1 | provider default | `76b80a9390d0` |

**How to change a locked prompt:** never edit it in place. Save the new text under a new
version name (`interpret.v5.md`, `match.v4.md`, `'router.v3'`), point the config at it
(`src/lib/config.ts` or the matching env var), run `pnpm lock:prompts`, commit. Old runs keep the
version they were made with, and results from different versions are never mixed in one table.

Note for readers of the accompanying write-up: the wording sent to the models by `router`,
`interpret`, `matcher` and `classifier` is unchanged from the study. The hashes of `match.v3` and
`nutrient-estimate.v1` differ from the study's only because a name in a non-sent header comment
was removed; `gt-structure.v1` differs because the examples table in `docs/TAG-GUIDE.md` (part of
that prompt) was replaced with invented examples for this public release.

## 6. Questions people ask

**What happens when the USDA lookup finds nothing?** Three steps, in order. (1) The name is searched
in USDA FoodData Central and the best match is picked by a scoring rule; the pick is cached.
(2) If nothing acceptable comes back, `nutrient-estimate.v1` drafts per-100 g values, names the
USDA foods it reasoned from, and saves them as a **pending custom food**. The run continues using
the draft. (3) You approve, correct or dismiss pending entries in Corpus → Review. The share of
calories that came from drafts is recorded on every cell (`level2.truth.customShare` and
`level2.est.customShare`), so it can be reported. If USDA itself is unreachable the cell FAILS and
is retried; it is never silently scored as zero.

**The classifier prompt looks like it is only about FODMAPs. What about the GLP-1 persona?** The one
classifier call returns two things: Rule A is the FODMAP load (IBS persona) and Rule B is the
"nausea irritant" flags, fried and spicy (GLP-1 persona). The other GLP-1 decisions need no model:
"protein adequate" (≥ 25 g at a main meal) and "large by mass" (≥ 500 g) are plain arithmetic on the
nutrient totals and the grams.

**What about a meal I could not weigh?** A restaurant bowl with no weights still has a truth list,
without grams (an *identity-only* scene). It counts for recognition (Level 1 recognized / invented /
net) and is skipped for quantity, nutrients and decisions. The scorer flags it (`level2.identityOnly`).
