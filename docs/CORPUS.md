# Corpus — from a meal-history export to the context layer
*Source of record for the corpus loader, the annotation screen, distillation, retrieval, and the routine/novel rule. Companion to METRICS.md and PIPELINE.md.*

## 0. What you bring
A history of meals you logged **before** your test captures, from any meal-logging app or spreadsheet, as either

- `data/corpus/history/meals.jsonl` — one JSON meal record per line, or
- a CSV passed with `--csv` (default `data/corpus/history/meals.csv`).

**CSV columns** (header row required): `meal_id, name, description, meal_type, serving_size, is_confirmed, local_date, local_time, image_url, dishes`.

- `meal_type`: Breakfast / Lunch / Dinner / Snack. `serving_size`: SNACK / SMALL / STANDARD / LARGE / EXTRA_LARGE. `local_date`: YYYY-MM-DD. `local_time`: a local timestamp or HH:MM. `is_confirmed`: true/false. Empty cells or the literal `NULL` mean "no value".
- `dishes` is a JSON array: `[{"name": "...", "description": "...", "preparation": "...", "serving_size": "STANDARD", "ingredients": [{"name": "...", "amount": 140, "unit": "g", "notes": null}]}]`.

**JSONL fields** (same content, camelCase): `mealId, name, description, mealTypeName, estimatedServingSize, summaryDateInUserTime (YYYY-MM-DD), timestampInUserTimezone, isConfirmed, imageUrl, imageFile, imageSha256, dishes[{dishId, name, description, preparation, estimatedServingSize, ingredients[{name, amount, unit, notes}]}]`. These field names come from the app the instrument was first built against; they are kept as they are so the loader and its tests stay stable. A synthetic example of both formats is in `examples/corpus/`.

Optional photos of logged meals go in `data/corpus/history/images/<meal_id>.<ext>`; set `imageFile` to the file name. They are only shown on the review screen.

## 1. Loader → `CorpusMeal` / `CorpusDish` / `CorpusIngredient`
| Field | From |
|---|---|
| `sourceMealId`, `localDate`, `localTime`, `slot` (from `meal_type`) | export |
| `name`, `description` | export |
| `servingSize` → **portionClassPrefill**: SNACK/SMALL → small, STANDARD → usual, LARGE/EXTRA_LARGE → large | export |
| `imageFile`, `imageSha256` | export (optional) |
| `tier`: `corrected` (you annotated it) · `confirmed` (`is_confirmed`) · `unconfirmed` | export + annotation |
| `CorpusDish { name, description, preparation, servingSize }` · `CorpusIngredient { name, amount, unit, notes, gramsEst }` | `dishes` JSON; `gramsEst` = unit table (src/lib/units.ts) applied to amount+unit, `null` if unconvertible; a prior, never a truth value |
Idempotent by `sourceMealId`. **Cutoff:** the loader refuses the whole file if any meal is dated on or after `CORPUS_CUTOFF_EXCLUSIVE` (set it to the first day of your test captures) — the models must never be given the answers.

## 2. Annotation (Corpus screen)
One meal per screen: photo, dishes with ingredients, **portion class per dish** prefilled from `servingSize` (small / usual / large). Actions: Agree (→ `corrected`), Fix (edit dish name, ingredients, portion class; then Agree), Exclude (out of distillation), Skip. Queue order: "Pilot dishes first" = meals whose dish names fuzzy-match dishes in the valid study scenes' ground truth, then frequency. Grams are never asked. Drinks ignored.

## 3. Distillation → `ContextVersion { id, label, createdAt, corpusHash, cardCount }`
- **Entity resolution**: normalize dish names, propose merges by name/ingredient overlap, confirm each candidate pair with a pinned model ("same dish?"), seed aliases from the name variants. Output `DishCard { canonicalName, aliases[], instanceCount, lastSeen, portionClassMix, priorGrams, ingredients [{name, inclusionRate, medianGramsEst}], features {homeShare, slotMix}, tierMix }`. Weighting by tier: corrected 1.0, confirmed 0.7, unconfirmed 0.5.
- **Habit summary**: 5–8 notable findings written by a pinned model from card-level statistics (never from raw meals), editable text, stored on the version.
- **Dishware**: `Dishware { name, capacityMl, capacityG?, usedFor, photo? }`, entered by hand, versioned with the context.

## 4. Retrieval (`ContextProvider` for image_context / context_only)
Router call (image → dish names + visible dishware; context_only uses the meal slot instead) → cascade: normalize → exact alias → token overlap ≥ 0.6 → embedding cosine ≥ 0.5 → no match. Top-k (k=3) cards + habit summary + dishware are rendered into Block 5 of the interpret prompt. `{hit, cardsRetrieved, method}` is logged on the decomposition (`contextUsed`).

## 5. Routine vs novel (analysis-time, from truth)
A study scene is **routine** if any core ground-truth item matches (same cascade, on the truth names) a DishCard with `instanceCount ≥ 3`; else novel. A property of the scene, identical across conditions.
