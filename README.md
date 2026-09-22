# meal-context-eval

An instrument for measuring how well AI vision models understand a photo of a meal — and how much
it helps to also tell the model about the person eating it. You photograph your meals with a phone
and (optionally) smart glasses, weigh what you eat, and the tool asks a set of models what is on
each plate under three conditions: photo only, photo plus your personal context, and context with
no photo at all. It then scores every answer against your weighed ground truth on three levels:
did the model see the food, how wrong are the nutrients, and would the error change practical advice.

Author: Emeka Ugwu. Licence: MIT. Companion to a write-up on phone vs smart-glasses meal photos, with
and without personal context (see `CITATION.cff`).

**My photos, notes and personal context are not included. Bring your own.** Everything under
`examples/` and in the tests is invented.

## The question it answers

1. How much of a plate does a model recognise from a photo alone, and how close are its grams?
2. How much does personal context (the dishes you usually eat, your habits, your dishware) add?
3. Does a first-person smart-glasses photo do as well as a deliberate phone photo?
4. Do the errors matter — do they change nutrient totals or the advice an app would give?

## The pipeline, in words

```
router  →  interpret  →  match  →  classify  →  score
```

- **router** (only when context is used): a cheap vision model names the dishes in the photo so the
  right *dish cards* from your history can be looked up. It never sees the ground truth.
- **interpret** (the step under test): the model being evaluated lists plates → dishes → ingredients
  with grams. The prompt is identical across conditions except for the context block.
- **match** (blind): one pinned model pairs your weighed items with the predicted items, grading
  each pair exact / substitute / wrong. It does not know which model, camera or condition it is judging.
- **classify** (blind): one pinned model flags FODMAP load, fried and spicy on both the truth and
  the prediction, for the persona decisions.
- **score** (arithmetic only): Level 1 understanding, Level 2 nutrients (USDA FoodData Central),
  Level 3 decisions.

One *cell* = one scene × one camera × one condition × one model. Details: `docs/PIPELINE.md`.
Formulas: `docs/METRICS.md`. Tagging rules: `docs/TAG-GUIDE.md`. Context layer: `docs/CORPUS.md`.
Literature grounding: `docs/EVAL-GROUNDING.md`. Persona rules: `docs/PERSONA-DECISIONS.md`.

## Quick start

Requirements: Node 20+, pnpm, a local PostgreSQL.

```bash
createdb meal_context_eval                       # any database name; put it in DATABASE_URL
cp .env.example .env                       # then edit .env
pnpm install
pnpm prisma migrate deploy                 # creates the tables
pnpm prisma generate
pnpm dev                                   # http://localhost:3000 — log in with AUTH_SECRET
```

Environment variables (all in `.env.example`):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `AUTH_SECRET` | the single-user password for the console |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_AI_API_KEY` | model providers. A missing key puts that provider in deterministic **mock mode**; `MOCK_LLM=1` forces mock mode everywhere, so you can try the whole flow at no cost |
| `FDC_API_KEY` | free USDA FoodData Central key, for nutrient lookups |
| `VANTAGE_DATA_DIR` | your private data folder (default `./data`, git-ignored) |
| `CORPUS_CUTOFF_EXCLUSIVE` | first day of your test captures; meal history on or after it is refused |

Checks: `pnpm test`, `pnpm typecheck`, `pnpm lint`.

## Bring your own data

Everything you bring lives in one folder outside git (`./data` by default):

```
data/
  captures/<YYYY-MM-DD>/<phone|glasses>/<meal>-img<N>.jpg
  notes/all-notes.md                      (or notes/<YYYY-MM-DD>.md)
  notes/ground-truth-clarified.json       (optional, hand-curated truth)
  corpus/history/meals.jsonl  or  meals.csv
```

The in-app **How to** page walks through the same steps.

### 1. Photos

`<meal>` is `breakfast`, `lunch`, `dinner` or `snack`; `<N>` is the photo number within the meal.
The phone and glasses photos of the same plate share the same number — that pair is one **scene**.
JPG and HEIC both work. Unsorted photos can go in `captures/_unsorted/`; the importer groups them by
capture time and you place the rest by hand on the Intake page.

```bash
pnpm tsx scripts/import-captures.ts            # dry run: shows the plan
pnpm tsx scripts/import-captures.ts --commit
```

### 2. Notes (the ground truth)

Weigh what you eat and write it down. One heading per day, per meal, per photo, then one block per plate:

```
Mar 2

Dinner
Photo 1:
Plate 1 - Chicken and rice:
Chicken - 142 g - salt, paprika, olive oil fried
Rice - 180 g
Plate 2 - Side salad:
Cucumber 60 g, tomatoes 45 g, one tsp olive oil
```

`pnpm tsx scripts/import-notes.ts --commit` attaches each block to its scene and drafts a structured
food list (dish, item, grams, basis weighed/estimated/converted, importance tag). You confirm or edit
every list on the Intake page. Always note cooking fat; drinks are never recorded.

### 3. Curated ground truth (optional, recommended)

If you would rather write the food list yourself, put it in `data/notes/ground-truth-clarified.json`
and run `pnpm tsx scripts/import-gt-json.ts --commit`. It replaces the items of every scene named in
the file, exactly as written, with no model in between:

```json
{ "scenes": [ { "date": "2026-03-02", "slot": "dinner", "photo": 1, "items": [
  { "dish": "Chicken and rice", "name": "chicken thigh", "grams": 142, "basis": "weighed",
    "tag": "core", "state": "cooked", "note": null },
  { "dish": "Chicken and rice", "name": "olive oil", "grams": 8, "basis": "weighed",
    "tag": "garnish", "state": null, "note": "pan-frying oil, absorbed", "hidden": true }
] } ] }
```

`tag` is `core | secondary | garnish | spice | ignore` (`docs/TAG-GUIDE.md`). `grams` may be `null`
for a meal you could not weigh; that scene then counts for recognition only.

**The `hidden` rule.** Mark an item `hidden: true` when it **cannot be seen in a photo of the served
plate**: it is under or inside other food, it is cooking fat that was absorbed, a sweetener that
dissolved, or a seasoning. Decide from the plate as served, not from what you know you cooked.
Hidden items are scored like any others, and recall is also reported separately for hidden and
visible items — this is where context is expected to help.

### 4. Personal context: dish cards + a habit summary

Context is built from a history of meals you logged **before** the test days — from any meal-logging
app or a spreadsheet — as JSONL or CSV. The expected fields are documented in `docs/CORPUS.md`
(the field names come from the app this was first built against and were kept for stability; see
`examples/corpus/meals-example.jsonl`).

```bash
pnpm tsx scripts/load-corpus.ts --csv path/to/export.csv            # dry run
pnpm tsx scripts/load-corpus.ts --csv path/to/export.csv --commit
```

On the **Corpus** page you can review past meals (agree / fix / exclude, portion class), enter your
dishware, and press **Build context**. That produces a frozen *context version*: **dish cards**
(name, aliases, how often, typical ingredients and grams, meal-slot mix) and a 5–8 line **habit
summary** written from card statistics only.


## Run

With `pnpm dev` running, use the **Run** page, or the terminal:

```bash
pnpm tsx scripts/run.ts --create --label first-run --meal-set all_valid \
  --conditions image_only,image_context,context_only \
  --models "gpt-5.5-2026-04-23|openai|frontier,claude-haiku-4-5-20251001|anthropic|cheap" \
  --context-version <contextVersionId>

pnpm tsx scripts/run.ts --run <runId>                 # resume: finished work is never repeated
pnpm tsx scripts/run.ts --run <runId> --only-failed   # retry only the failed cells
```

`--meal-set` is `all_valid`, `dates:YYYY-MM-DD,…`, `scenes:<id>,…` or `pilot` (the dates in
`PILOT_DATES`). `--models` omitted = the default roster in `src/lib/config.ts`; model ids go stale,
so set `ROSTER` to ids your providers currently serve. `RUN_BASE` points the script at the console
(default `http://localhost:3000`).

## Read the results

The **Results** page has three scopes — study, day, meal.

- **Level 1 · Understanding:** *recognised* (importance-weighted share of your food the model named),
  *invented* (food that was not there), *net*, and *quantity* (closeness of grams), each 0–1.
- **Level 2 · Nutrients:** error and signed bias for kcal, protein, fat, carbohydrate and fibre.
- **Level 3 · Decisions:** how often the model's answer leads to the same practical decision as the
  truth (high-fat meal, large meal, FODMAP load, protein adequate, …) for two synthetic personas.
- Columns compare cameras; *context gain* is the paired within-meal difference. In the meal view you
  can correct a pairing the matcher got wrong; the override rate is reported. A flat export (one row
  per cell) is available from the Results page.

## The prompt lock

Every prompt the pipeline sends, with its pinned model and temperature, is hashed into
`prompts/PROMPTS.lock.json`; `pnpm test` fails if any of them changes. To change a prompt, never
edit it in place: save the new text under a **new version name** (`interpret.v5.md`), point the
config or env var at it, run `pnpm lock:prompts`, and commit. Old runs keep the version they were made
with, and results from different versions are never mixed.

## Cost

Cost scales with `scenes × cameras × conditions × models`. Each cell makes one call to the model
under test plus small calls to the pinned matcher and classifier; context cells add one cheap router
call per scene and camera. The interpret call on a frontier vision model dominates. Before starting,
the Run form shows the number of calls and an estimate. To keep it small: start in mock mode, then
one day with one cheap model, then widen. Every call's tokens and cost are stored in the `LlmCall`
table.

## Limitations

- Built for, and so far used by, **one person**. Results describe that person's meals and kitchen;
  confidence intervals are over meals, not people.
- Ground truth is home weighing plus judgement (tags, the `hidden` flag, estimated items).
- Drinks are excluded on both sides.
- The matcher and classifier are themselves models — pinned, blind, and hand-overridable, not perfect.
- Nutrients come from USDA FoodData Central; regional dishes fall back to model-drafted entries that
  you approve, and their share of calories is reported.
- Pinned model ids will be retired by providers; update the roster and re-lock.
- The database schema and a few API routes still carry tables from an earlier version of the study
  design (single-call pipeline, judge, insights). They are unused by the pipeline above.
- Code comments cite internal design documents (`REBUILD-SPEC`, `BUILD-SPEC`, `DECISIONS.md`, a study
  protocol) that are not part of this repository; the docs listed above are the public source of record.
- Single-user, local-first. Do not expose the console to the internet as is.
