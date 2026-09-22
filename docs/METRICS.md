# Metrics — one page
*Three levels, each downstream of the last. A standard sibling metric is printed beside ours where it costs nothing. Literature grounding and citations: EVAL-GROUNDING.md. Tagging rules: TAG-GUIDE.md. Persona decisions: PERSONA-DECISIONS.md.*

**Units.** Photo scene (photo × vantage × condition × model) → meal (pooled items) → day (summed meals, same photo set both sides) → study (mean over meals, 95% bootstrap CI; condition differences paired). Split by routine vs novel meals.

**Ground truth per item.** as-served grams (required for core and secondary; optional for garnish and spice), basis (weighed / estimated / converted), tag per TAG-GUIDE.md: core 1.0 · secondary 0.5 · garnish 0.1 · spice 0.05 · ignore 0 (salt, pepper, water, ALL beverages, ice, inedible parts — dropped on both sides). A model pre-fills tags; the person who ate the meal confirms. Hidden-fat check on every roasted / fried / sautéed dish makes oils explicit in the truth. **Hidden flag:** an item is marked `hidden` when it cannot be seen in a photo of the served plate — it is under or inside other food, it is absorbed cooking fat, a dissolved sweetener, or a seasoning. Hidden items are scored like any other; Level 1 additionally reports recall separately for hidden and visible items (hidden-ingredient recall), which is where personal context is expected to help most.

**Scene validity (exclusion rules, counted in the inventory table).** A photo scene enters the run only if (a) every study camera captured it (default: phone and glasses; see `STUDY_VANTAGES`), (b) the photos show the same plates ("same scene" check, pre-filled, confirmed by hand), and (c) it has ground-truth notes. Excluded scenes are counted by reason.

**Match table per photo (the matcher is blind: it sees only truth items and predicted items, never camera, condition, or model).** each GT item ↔ prediction or none; identity: exact 1 · substitute 0.5 · wrong/missed 0; many-to-one pairs compare grams to the sum, one-to-many gives each truth item the group grade; unpaired predictions = invented, tagged by the same rules; model-flagged "inferred" changes nothing (an inferred item absent from the truth is invented); wrong pairing = missed + invented; drink predictions dropped, not invented. Wrong pairings are fixed by hand on screen; the override rate is published.

## Level 1 — Understanding (the headline: two numbers, never averaged)

Symbols: i over truth items with weight w_i, grams g_i, identity id_i, estimate e_i; j over invented items with weight w_j, estimate e_j; p_j = 1.0 for invented core/secondary, 0.5 for invented garnish/spice.

- **Recognized** = Σ_i w_i·id_i / Σ_i w_i — gross importance-weighted share seen, mass-blind.
- **Invented** = Σ_j w_j / Σ_i w_i — phantom importance relative to the true plate; can exceed 1.
- **Net recognition** = [ Σ_i w_i·id_i − Σ_j p_j·w_j ] / Σ_i w_i, floored at 0 — what the chart plots; the identity Net = Recognized − Σ p_j·w_j / Σ w_i holds at every aggregation level, so bars can show Recognized with the invented deduction hatched.
- **Quantity** = Σ_i g_i·grade_i / ( Σ_i g_i + Σ_j e_j ), grade_i = min(e_i, g_i) / max(e_i, g_i) (= 1 − balanced relative error; Törnqvist 1985, Miyazaki 1994, via Tofallis 2015); missed and wrong = 0; substitutes graded normally (the name is charged once, in Recognized); items without truth grams excluded. Missed mass (numerator at 0) and invented mass (denominator, no credit) are mirrors. Dish and meal = same sums over more items.
- **Standard siblings, printed beside:** ingredient precision / recall / F1 on exact-or-synonym matches (substitutes = FP + FN, many-to-one counted once); per-item mass MAE (g) and MAPE on matched weighed items (missed excluded, coverage stated); MSA and SSPB from the same ratios (Morley 2018).
- **Sensitivity lines:** Quantity with substitutes excluded; Net with p = 1.0 everywhere.
- **Report:** one figure, two panels with identical layout — Net recognition and Quantity by camera × condition, 95% CI, context-only as a line; one table with Recognized, Invented, Net, Quantity, F1, mass error; both split routine vs novel. Context gain per component = paired within-meal difference. Headline reads as two sentences, one per panel.

## Level 2 — Nutrients (comparability anchor)
**Five nutrients, equal standing:** kcal, protein g, fat g, carbohydrate g, fiber g.

**Conversion.** Both sides converted independently (no pairing): truth items as confirmed, predicted items as the model listed them — so an invented item adds nutrients, a missed one removes them, a substitute is looked up under the predicted name. One lookup chain, identical on both sides: normalize → alias memory → scored database search (head-noun match, derivative foods rejected) → custom entry → flagged estimate; every item stores its entry and a source tag (fdc / custom / estimate). **State-matched** entries (cooked vs dry, recorded on truth items by the structurer, carried by the predicted name on the estimate side). **Composite dishes** with one weight and named components: equal split across components, unless a known recipe gives proportions (recorded as such); never split by the estimate's proportions. **Custom entries** (regional dishes and stews the database does not carry): drafted by a model with a cited source where one exists, approved by hand once in the approval queue, frozen and versioned per run, used on both sides; predicted names that fail to resolve after a run go through the same queue before scoring. **Drinks** excluded on both sides (stated as a limitation). Items → dish → scene → meal → day; day sums use only valid scenes, identical on both sides, labeled partial if any scene is excluded.

**Metrics** per nutrient, per meal and per day, per camera × condition × model, 95% bootstrap CI over meals; context gain = paired within-meal difference on absolute % error:
- MAE in real units (kcal, g) and as % of mean(truth) (Nutrition5k form)
- MAPE and median APE
- signed bias = mean (est − truth)/truth, with CI
- count of meals within ±20% and within ±10%
- instrument: share of truth kcal and of estimate kcal resolved through custom or estimated entries

**Anchors under each table:** Nutrition5k dish-level kcal MAE ≈ 16–26% of mean; 2025 LLM image-only photo studies ≈ 30–40% MAPE (EVAL-GROUNDING.md §1).
**Not done:** Bland–Altman limits, correlation, day tertiles (EVAL-GROUNDING.md §6; not meaningful for a single participant).
**Report:** one table per nutrient (rows camera × condition, five metric columns, anchors beneath); one dumbbell chart of signed kcal bias per camera, image only → with context, zero line.

## Level 3 — Decisions per persona (consequence)
**Two synthetic personas: IBS and GLP-1 therapy.** Six decisions per meal, identical rules on truth and estimate; agreement = same answer.

| Decision | How decided | Threshold (declared, proposal) |
|---|---|---|
| FODMAP load: low / moderate / high (Monash green / amber / red kept in the export and classifier output) | pinned classifier model, blind, temperature 0, given the ingredient list + grams and the written rule (Monash serve logic: any ingredient over its red serve → red; over amber, or one family stacked to a full serve across ≥ 2 foods → amber; else green); returns light, deciding ingredients, one-line reason | as written in PERSONA-DECISIONS.md I1 |
| High-fat meal | code, from Level 2: fat ≥ 40% of kcal AND ≥ 15 g | PERSONA-DECISIONS.md D-FAT |
| Large meal (IBS) | code, from Level 2: kcal ≥ 750 | PERSONA-DECISIONS.md D-LARGE |
| Protein adequate (GLP-1) | code, from Level 2: protein ≥ 25 g at a main meal, ≥ 10 g at a snack | PERSONA-DECISIONS.md L1 |
| Large meal by mass (GLP-1) | code, from Level 1 grams: total mass ≥ 500 g — the one decision that tests measured grams with no lookup | PERSONA-DECISIONS.md L3 |
| Nausea irritant present (GLP-1) | same classifier as FODMAP light: any fried item ≥ 30 g, or a spicy (chili-bearing) item | PERSONA-DECISIONS.md L4, drinks removed |

Dropped: beverage-dependent decisions (caffeine, alcohol, carbonation — drinks are outside the study); hand-built FODMAP serve tables (the classifier substitutes; a replicator may swap in their own table). Stated limitation: the classifier's absolute accuracy vs a dietitian is unknown; because the metric is agreement between two runs of the same classifier, systematic quirks cancel and only inconsistency matters — **self-consistency** is measured by re-running the classifier on a 20% sample and reported.

**Reported** per decision × camera × condition × model, over meals, 95% CI, paired context gain: agreement rate; base rate (truth positives); direction of disagreements (false alarm vs miss); margin to threshold for the numeric decisions (and "within one light" for FODMAP); attribution of each disagreement to identification or quantity from the match table. Not reported: κ, balanced agreement, threshold sweeps (notebook only).

## Instrument numbers (published with results)
n photos / meals / days; weighed share of GT per meal; matcher override rate; retrieval hit rate; unverifiable count; model IDs, prompt hashes, alias + corpus versions; cost and latency per photo.

## Export columns (one row per result cell)
`run, date, slot, photo, vantage, condition, model_family, model_tier, model_id, routine, found, invented, quantity, us, f1_ing, mass_mae_g, mass_mape, kcal_gt, kcal_est, prot_gt, prot_est, fat_gt, fat_est, carb_gt, carb_est, fiber_gt, fiber_est, retrieval_hit, weighed_share, override_n, cost_usd, latency_s, prompt_hash, alias_version, corpus_version` + `dec_<persona>_<k>_gt / _est / _margin` per decision.
