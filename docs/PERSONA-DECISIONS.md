# Persona Decisions — a rule-computable "decision agreement" metric
*Design note behind Level 3 of METRICS.md (decisions per persona). Sources are linked inline; every threshold that is not lifted from a guideline is labelled **(proposal)**. METRICS.md records which of these decisions the instrument actually computes (the IBS and GLP-1 sets; beverage-dependent decisions were dropped); the GERD set is kept here as a worked design only.*

## 0. What this adds

An earlier design measured consequence with an LLM scoring engine: a 1–10 "trigger" score on the ground truth and on each estimate, with a flip counted when the score crossed a band. Such scores jitter, read quantities loosely, and a flip cannot be attributed to an identification error versus a gram error. This document defines a deterministic alternative — **decision agreement**.

A **decision** is a binary or 3-level judgement an app would make about one meal, computed by one function `decide(decomposition, nutrients) → {value, margin, explanation}` on GT and on the estimate. **Agreement** = equal values. Everything is arithmetic over the decomposition (dishes → ingredients with grams + preparation) and the per-ingredient USDA nutrients the instrument already derives.

## 1. Personas

| Persona | Definition used here | Anchoring guidance |
|---|---|---|
| **P1 GERD** | Moderate reflux/heartburn/bloating; no allergies or confirmed personal triggers. | [ACG 2022 (Katz et al.)](https://pmc.ncbi.nlm.nih.gov/articles/PMC8754510/): avoid trigger foods (coffee, chocolate, carbonated, spicy, acidic, high-fat) and late meals — conditional, low evidence. [Fox 2007](https://www.cghjournal.org/article/S1542-3565(06)01303-6/fulltext): calorie density drives acid exposure, fat share drives symptom frequency. |
| **P2 IBS-M** | Mixed subtype, so motility triggers (fat, caffeine, capsaicin) and fermentation load both apply; low-FODMAP evidence is not subtype-specific. | [ACG 2021 (Lacy et al.)](https://journals.lww.com/ajg/fulltext/2021/01000/acg_clinical_guideline__management_of_irritable.11.aspx): limited low-FODMAP trial (conditional, very low). [Varney 2017 / Monash](https://onlinelibrary.wiley.com/doi/10.1111/jgh.13698) cut-offs. [NICE CG61](https://www.nice.org.uk/guidance/cg61/chapter/Recommendations): regular meals, ≤3 cups tea/coffee/day, reduce alcohol and fizzy drinks. [BDA 2016](https://doi.org/10.1111/jhn.12385): modify fat if suspected. |
| **P3 GLP-1** | Adult on semaglutide/tirzepatide in dose escalation; nausea, early fullness, lean-mass preservation. | [Almandoz 2024](https://onlinelibrary.wiley.com/doi/10.1002/oby.24067): smaller meals, stop before full, avoid high-fat/spicy/alcohol/carbonated. [2025 ACLM/ASN/OMA/TOS advisory](https://ajcn.nutrition.org/article/S0002-9165(25)00240-0/fulltext): protein 1.2–1.6 g/kg/day in active weight loss. [Gorgojo-Martínez 2022](https://www.mdpi.com/2077-0383/12/1/145) consensus; [Wharton 2022](https://dom-pubs.onlinelibrary.wiley.com/doi/10.1111/dom.14551): nausea 43.9% vs 16.1% placebo. |

All of this guidance is conditional/low-evidence, which is acceptable here: the metric asks whether the *estimate* yields the *same* app decision as GT, not whether the decision is clinically optimal. Thresholds need only be fixed, sensible, and declared.

## 2. Shared building blocks

Per meal (sum over the meal's photo scenes, per METRICS.md levels):

- `kcal, fat_g, protein_g, carb_g, fiber_g` — Σ over ingredients of grams × USDA per-100 g values. Beverages included.
- `mass_g` — Σ grams over all ingredients including beverages (the study's directly measured quantity).
- `fat_share` = 9·fat_g / kcal.
- `class(ingredient)` — deterministic lookup against the ingredient-class table in §5, applied to the normalised ingredient name (`normalizeIngredientName` in `fdc.ts`) plus the `preparation` field.
- `contributors(nutrient, k)` — top-k ingredients by contribution, used only for explanation text.

Two decisions are shared across personas and computed once:

**D-FAT High-fat meal.** *Definition:* fat share high enough that a GERD/IBS/GLP-1 app would warn. *Inputs:* `fat_g`, `kcal` (quantity matters). *Threshold:* `fat_share ≥ 0.40 AND fat_g ≥ 15` **(proposal)**. Fox 2007 found more reflux symptoms on a 50% than a 25% fat arm; 40% sits between them; the 15 g floor stops a 90 kcal handful of nuts from flagging. No guideline gives a per-meal number — ACG, NICE, BDA and Almandoz say "high-fat" without one, and [Monash](https://www.monashfodmap.com/blog/does-fat-play-role-in-management-of-ibs/) states no threshold exists. *Driver:* quantity — a plate's fat share hangs on a few items (oil, cheese, fatty cuts) whose grams are hard to see; secondarily preparation identification (fried vs grilled) when oil is not itemised. *Explanation:* "High-fat meal: {fat_g} g fat = {fat_share}% of {kcal} kcal (limit 40%). Mostly {contributors(fat,2)}." *Computability:* rule-based, with the §5 oil-imputation rule for fried items.

**D-LARGE Large meal.** *Definition:* large enough that "eat smaller meals" applies. *Inputs:* `kcal` (P1, P2) or `mass_g` (P3); quantity is the whole decision. *Threshold:* P1/P2 `kcal ≥ 750` **(proposal)** — midpoint of Fox 2007's 500 vs 1000 kcal arms (more acid exposure at 1000); TLESR rate rises linearly with gastric volume ([Scheffer 2002](https://pubmed.ncbi.nlm.nih.gov/12464087/)). P3 `mass_g ≥ 500` **(proposal)** — early fullness is volumetric; Almandoz and Gorgojo-Martínez say "smaller meals" with no number. *Driver:* quantity; a systematic 20% gram under-estimate moves many meals across this line. *Explanation:* "Large meal: {kcal} kcal (limit 750) / {mass_g} g (limit 500). Largest: {contributors(kcal|mass,2)}." *Computability:* rule-based.

## 3. Decisions per persona

### P1 GERD

| ID | Decision | Inputs | Threshold & source | Driver | Rule-computable? |
|---|---|---|---|---|---|
| G1 | High-fat meal | = D-FAT | see §2 | quantity | yes |
| G2 | Large meal | = D-LARGE (kcal) | see §2 | quantity | yes |
| G3 | Acidic or spicy irritant present | ingredients of class `acidic` or `spicy`; grams ≥ 10 g solid / ≥ 30 ml liquid **(proposal floor)** | presence per ACG 2022 "spicy/acidic" trigger foods (no dose); capsaicin provokes abdominal burning and a trend to more heartburn in NERD patients ([red chili in NERD, *J Neurogastroenterol Motil* 2021](https://pubmed.ncbi.nlm.nih.gov/33291700/)). Acidic = ingredient pH ≤ 4.6, the FDA acidified-food boundary ([21 CFR 114](https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-114)) **(proposal as GERD threshold)** | identification | mostly; spicy needs a model fallback when chili is not itemised (§5) |
| G4 | LES-relaxant present | ingredients of class `chocolate`, `caffeine`, `alcohol`, `mint`, `carbonated`; any quantity ≥ 5 g / ≥ 30 ml **(proposal floor)** | presence per ACG 2022 (coffee, chocolate, carbonated); alcohol reduction "limited evidence"; peppermint is a traditional LES relaxant listed in the same guideline family | identification | yes |
| G5 | Meal flagged (composite) | G1 ∨ G2 ∨ G3 ∨ G4 | — | mixed | yes |

*Explanations* G3/G4: "{Class} present: {ingredient} ({grams} g)." listing each hit; G5 concatenates the fired sub-rules in order G3, G4, G1, G2 (irritants first).

### P2 IBS-M

| ID | Decision | Inputs | Threshold & source | Driver | Rule-computable? |
|---|---|---|---|---|---|
| I1 | FODMAP light (green / amber / red) | for each high-FODMAP ingredient: grams vs its Monash amber and red serve sizes; per family *f* a stacking index `S_f = Σ grams_i / green_max_i` | **red** if any ingredient ≥ its red serve, or any `S_f ≥ 2` **(proposal)**; **amber** if any ingredient ≥ its amber serve, or any `S_f ≥ 1` with ≥ 2 contributing ingredients **(proposal)**; else **green**. Monash sets cut-offs per typical serve — oligosaccharides < 0.30 g (grains/pulses/nuts) or < 0.20 g (fruit/veg/other), excess fructose < 0.15 g, lactose < 1.0 g, polyols < 0.40 g total or < 0.20 g single ([Varney 2017](https://onlinelibrary.wiley.com/doi/10.1111/jgh.13698)) — and states that more than one green serve per sitting is allowed and that stacking across families counts ([Monash stacking](https://www.monashfodmap.com/blog/fodmap-stacking-explained/)). Because USDA has no FODMAP fields, the rule uses **serve-size ratios** from a per-ingredient table (§5), not grams of FODMAP. | both: identification (onion, garlic, wheat, dairy hidden in dishes) and quantity (serve size is the whole Monash system) | yes, given the table |
| I2 | High-fat meal | = D-FAT | NICE/BDA "modify fat if suspected"; 44–51% of IBS patients attribute symptoms to fatty food (Monash) | quantity | yes |
| I3 | Large meal | = D-LARGE (kcal) | NICE CG61 "not eating too much at once"; exaggerated gastrocolic response | quantity | yes |
| I4 | Non-FODMAP irritant present | classes `caffeine` (≥ 1 cup-equivalent ≈ 200 ml coffee or 80 mg caffeine), `alcohol` (any beverage), `carbonated` (≥ 100 ml), `spicy` (≥ 10 g) **(proposal floors)** | NICE CG61 (tea/coffee ≤ 3 cups/day; reduce alcohol and fizzy drinks) — a per-day limit, so per meal we test presence of one cup-equivalent; capsaicin induces pain/burning in IBS-D ([Gonlachanvit 2009](https://pubmed.ncbi.nlm.nih.gov/18647268/)); Monash lists coffee, alcohol, carbonation, spicy as non-FODMAP triggers with no numeric limits ([caffeine](https://www.monashfodmap.com/blog/does-caffeine-affect-ibs-symptoms/)) | identification | mostly; spicy fallback as G3 |
| I5 | Meal flagged (composite) | I1 = red ∨ I2 ∨ I3 ∨ I4 | — | mixed | yes |

*Explanation* I1: "FODMAP {light}: {ingredient} {grams} g is over its {amber|red} serve ({serve} g, {family})" per hit; for stacking: "{family} stacked across {n} foods ({S_f:.1f} green serves)."

### P3 GLP-1

| ID | Decision | Inputs | Threshold & source | Driver | Rule-computable? |
|---|---|---|---|---|---|
| L1 | Protein adequate | `protein_g` (quantity matters) | `protein_g ≥ 25` for breakfast/lunch/dinner; `≥ 10` for snacks **(proposal)**. Per-meal MPS plateaus ≈ 0.40 g/kg in older adults, 0.24 g/kg in young ([Moore 2015](https://doi.org/10.1093/gerona/glu103); [Schoenfeld & Aragon 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC5828430/)) → 25–30 g for a 70 kg adult; the daily 1.2–1.6 g/kg target (AJCN advisory) split over 3–4 eating occasions gives the same range. | quantity (grams of the protein item) with an identification component (missing the chicken entirely) | yes |
| L2 | High-fat meal | = D-FAT | Almandoz 2024: "avoid … high-fat foods"; fat slows gastric emptying further ([Gentilcore 2006](https://pubmed.ncbi.nlm.nih.gov/16537685/)) | quantity | yes |
| L3 | Large meal | = D-LARGE (**mass**, ≥ 500 g) | Almandoz 2024, Gorgojo-Martínez 2022: smaller meals, stop before full | quantity — the purest test of the study's gram accuracy | yes |
| L4 | Nausea irritant present | preparation = `fried`/`deep-fried` on any item ≥ 30 g, or classes `spicy`, `alcohol`, `carbonated` at the I4 floors **(proposal)** | Almandoz 2024 (high-fat, spicy, alcohol, carbonated); STEP trial counselling (smaller, lower-fat meals better tolerated) | identification (preparation and beverage recognition) | mostly; fried detection needs a model fallback when `preparation` is empty |

*Explanations:* L1 "Protein {protein_g} g (target 25 g): {contributors(protein,2)}." L3 "Meal mass {mass_g} g (limit 500 g)." L4 "{ingredient} is {fried|spicy|alcohol|carbonated} — may worsen nausea." A fiber-adequacy decision (≥ 7 g/meal, constipation affects ~24% on semaglutide per Wharton 2022) was considered and left out: USDA fiber for mixed dishes is too noisy to headline.

P1 and P2 have five decisions, P3 four; D-FAT and D-LARGE(kcal) are shared, so the distinct set is 10 functions.

## 4. Rule-based decisions vs an LLM scoring engine as the measured metric

| | Rule-based decisions (this doc) | LLM scoring engine (1–10 score per meal and profile) |
|---|---|---|
| Determinism | identical output for identical input | stochastic; scores jitter between runs; model deprecation breaks reproducibility |
| Attribution | every disagreement traces to a nutrient or class → identification vs quantity | a flip is a black box; "more of a trigger scores higher" with no gram→score mapping |
| Margin | continuous margin per meal | only |Δscore| |
| Coverage | only what the class table encodes; "is this spicy" needs a fallback | reads free text; handles combinations ("fat + acid") and severity |
| Product fidelity | a stylised app | closer to what a shipped product does |
| Personas | any persona is a threshold set | needs a profile and prompt per persona |
| Cost | zero | one call per (cell, persona) |

**Decision taken.** Decision agreement is the measured Level 3 metric; the scoring engine was removed from the instrument. The claim under test is whether camera and context change *what an app would tell the user*; a deterministic, margin-aware decision set answers that with attribution.

## 5. Ingredient-class table (for a deterministic classifier)

Classification runs on the normalised ingredient name and `preparation`. Lists are seeds for the study's ingredient universe; a model is used only where marked. Beverages are ingredients with `unit: ml`.

| Class | Used by | Membership rule / seed list | Quantity rule | Needs a model? |
|---|---|---|---|---|
| `fodmap.fructan` | I1 | wheat/rye/barley products (bread, pasta, couscous, noodles), onion and garlic in all forms incl. powder, leek, shallot, artichoke, inulin/chicory | Monash amber/red serve per food (`fodmap_serves.csv`, hand-built from the Monash app for the study's ingredients; licensed → private data dir, schema + synthetic example in repo) | no |
| `fodmap.gos` | I1 | lentils, chickpeas, beans, soy beans, cashews, pistachios | same | no |
| `fodmap.lactose` | I1 | milk, yogurt, ice cream, soft cheese (ricotta, cottage), cream, custard; hard cheese and butter excluded | same | no |
| `fodmap.fructose` | I1 | apple, pear, mango, watermelon, honey, HFCS, agave, asparagus, sugar snap peas | same | no |
| `fodmap.sorbitol` / `fodmap.mannitol` | I1 | apple, pear, stone fruit, blackberries / mushrooms, cauliflower, celery, sweet potato (large serve) | same | no |
| `fat.source` | D-FAT (explanations only) | oils, butter, ghee, lard, mayonnaise, cream, cheese, bacon, sausage, fatty cuts, nuts, avocado | via USDA fat | no |
| `prep.fried` | L4, oil imputation for D-FAT | `preparation ∈ {fried, deep-fried, pan-fried, battered}`; name tokens `fried`, `crispy`, `tempura`, `fritter`, `chips/fries`, `puff-puff`, `akara` | item ≥ 30 g | **fallback:** if `preparation` is empty and no oil is itemised, a fixed pinned prompt classifies fried/not (logged). Oil imputation: fried with no oil item → add 8 g oil per 100 g **(proposal; applied identically to GT and estimate)** |
| `acidic` | G3 | citrus fruit and juice, tomato and tomato products (sauce, paste, ketchup), vinegar, pickles, wine, pineapple, most berries; fermented dairy (yogurt, sour cream) excluded despite pH ≈ 4.5 | ≥ 10 g / 30 ml | no; pH ≤ 4.6 reference values from published FDA/USDA pH tables |
| `spicy` | G3, I4, L4 | chili in any form (fresh, dried, flakes, powder, cayenne, scotch bonnet, habanero), hot sauce, pepper-soup spice, chili-bearing pastes (harissa, sriracha, gochujang, curry paste); black pepper excluded | ≥ 10 g chili-bearing ingredient, or any concentrate | **fallback:** when no chili is itemised (e.g. "jollof rice" with unlisted pepper) a fixed prompt returns `spicy: yes/no` from dish name + ingredients; fallback frequency is published |
| `caffeine` | G4, I4 | coffee, espresso, black/green tea, matcha, cola, energy drinks, dark chocolate (≥ 30 g) | 1 cup-equivalent ≈ 200 ml brewed coffee / 250 ml tea / 330 ml cola | no |
| `chocolate` | G4 | cocoa, chocolate, chocolate spread/desserts | ≥ 5 g | no |
| `alcohol` | G4, I4, L4 | beer, wine, spirits, cocktails; cooking wine/beer in a cooked dish excluded | any beverage serving (≥ 30 ml) | no |
| `mint` | G4 | peppermint, spearmint, mint tea, mint candies/gum | ≥ 5 g / any tea | no |
| `carbonated` | G4, I4, L4 | soda, sparkling water, tonic, beer, kombucha | ≥ 100 ml | no |
| `protein.source` | L1 (explanations) | meats, fish, eggs, dairy, legumes, tofu | via USDA protein | no |

Unclassified ingredients still contribute nutrients. Classification is versioned like the alias tables (`class_version` in the run config) and applied to GT and estimates with the same version.

## 6. Reporting

Per **decision × vantage × condition × model × persona**, over meals in the run (photo → meal aggregation first, since decisions are per meal):

1. **Agreement rate** = share of meals where `decide(estimate) = decide(GT)`, 90% bootstrap intervals over meals, paired differences between conditions (as METRICS.md).
2. **Base rate, balanced agreement, κ.** Publish the GT positive rate per decision (if GT never flags, agreement is trivially high), balanced agreement (mean over GT-positive and GT-negative meals) and Cohen's κ. For I1 (3-level): exact and "within one light".
3. **Direction.** Disagreements split into false alarms and misses, so a vantage's signed gram bias shows as a pattern.
4. **Margin to threshold.** For threshold decisions (D-FAT, D-LARGE, L1, I1's `S_f`) record `margin = (value − threshold) / threshold` for GT and estimate. Publish the GT margin distribution (how many meals sit within ±15% of the line, where any estimator looks unstable), agreement by |GT margin| bucket (≤ 15%, 15–40%, > 40%), and `margin_est − margin_gt` as the decision-relevant view of quantity error. For presence decisions the margin is the deciding ingredient's grams relative to its floor.
5. **Attribution.** Each disagreement is tagged `identification` (deciding ingredient missed or invented in the match table) or `quantity` (present on both sides, grams push it over) — from the match table, no judgement.
6. **Threshold sensitivity.** Sweep each proposal threshold ±25% and publish the agreement curve as a small multiple.
7. **Composites** (G5, I5) are reported last.

Export adds per result cell and persona: `dec_<id>_gt, dec_<id>_est, dec_<id>_agree, dec_<id>_margin_gt, dec_<id>_margin_est, dec_<id>_driver, class_version`. Day scope shows a row per fired decision with its rule explanation; the Study-scope metric switcher gains "decision agreement" with a decision picker.

## 7. Open points for anyone adopting these rules

- Review the (proposal) thresholds: fat 40%/15 g, 750 kcal, 500 g mass, protein 25 g/10 g, presence floors, stacking `S_f` 1/2, oil imputation 8 g/100 g.
- A hand-built FODMAP serve table must live in your private data dir (Monash data is licensed; repo ships schema + synthetic example).
- Whether the spicy/fried model fallback is acceptable in a "rule-computable" metric (fires only when the decomposition is silent; frequency published).
- P2 is IBS-M; if IBS-D is preferred only I4's framing changes.

## Sources

- Katz PO et al. ACG Clinical Guideline for the Diagnosis and Management of GERD. *Am J Gastroenterol* 2022. https://pmc.ncbi.nlm.nih.gov/articles/PMC8754510/
- Fox M et al. The effects of dietary fat and calorie density on esophageal acid exposure and reflux symptoms. *Clin Gastroenterol Hepatol* 2007;5:439–444. https://www.cghjournal.org/article/S1542-3565(06)01303-6/fulltext
- Pehl C et al. Effect of low and high fat meals on LES motility and reflux in healthy subjects. *Am J Gastroenterol* 1999. https://journals.lww.com/ajg/abstract/10.1111/j.1572-0241.1999.01064.x
- Scheffer RC et al. Elicitation of TLOSRs in response to gastric distension and meal ingestion. *Neurogastroenterol Motil* 2002. https://pubmed.ncbi.nlm.nih.gov/12464087/
- Acute effects of red chili on gastric accommodation and upper GI symptoms in healthy volunteers and GERD patients. *J Neurogastroenterol Motil* 2021. https://pubmed.ncbi.nlm.nih.gov/33291700/
- FDA, 21 CFR Part 114 Acidified Foods (pH 4.6 boundary). https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-114
- Varney J et al. FODMAPs: food composition, defining cutoff values and international application. *J Gastroenterol Hepatol* 2017;32(S1):53–61. https://onlinelibrary.wiley.com/doi/10.1111/jgh.13698
- Monash FODMAP. FODMAP stacking explained. https://www.monashfodmap.com/blog/fodmap-stacking-explained/ · Non-FODMAP dietary triggers. https://www.monashfodmap.com/blog/non-fodmap-dietary-triggers-of-ibs-symptoms/ · Dietary fat and IBS. https://www.monashfodmap.com/blog/does-fat-play-role-in-management-of-ibs/ · Caffeine and IBS. https://www.monashfodmap.com/blog/does-caffeine-affect-ibs-symptoms/
- NICE CG61. Irritable bowel syndrome in adults: diagnosis and management — recommendations. https://www.nice.org.uk/guidance/cg61/chapter/Recommendations
- Lacy BE et al. ACG Clinical Guideline: Management of IBS. *Am J Gastroenterol* 2021. https://journals.lww.com/ajg/fulltext/2021/01000/acg_clinical_guideline__management_of_irritable.11.aspx
- McKenzie YA et al. BDA evidence-based guidelines for the dietary management of IBS in adults (2016 update). *J Hum Nutr Diet* 2016. https://doi.org/10.1111/jhn.12385
- Gonlachanvit S et al. Effects of chili on postprandial GI symptoms in IBS-D. *Neurogastroenterol Motil* 2009. https://pubmed.ncbi.nlm.nih.gov/18647268/
- Almandoz JP et al. Nutritional considerations with antiobesity medications. *Obesity* 2024. https://onlinelibrary.wiley.com/doi/10.1002/oby.24067
- ACLM/ASN/OMA/TOS joint advisory. Nutritional priorities to support GLP-1 therapy for obesity. *Am J Clin Nutr* 2025. https://ajcn.nutrition.org/article/S0002-9165(25)00240-0/fulltext
- Gorgojo-Martínez JJ et al. Clinical recommendations to manage GI adverse events in patients treated with GLP-1 RAs: multidisciplinary expert consensus. *J Clin Med* 2023;12:145. https://www.mdpi.com/2077-0383/12/1/145
- Wharton S et al. GI tolerability of once-weekly semaglutide 2.4 mg (STEP 1–3). *Diabetes Obes Metab* 2022. https://dom-pubs.onlinelibrary.wiley.com/doi/10.1111/dom.14551
- Moore DR et al. Protein ingestion to stimulate myofibrillar protein synthesis requires greater relative protein intakes in older vs younger men. *J Gerontol A* 2015. https://doi.org/10.1093/gerona/glu103
- Schoenfeld BJ, Aragon AA. How much protein can the body use in a single meal? *JISSN* 2018. https://pmc.ncbi.nlm.nih.gov/articles/PMC5828430/
- Gentilcore D et al. Effects of fat on gastric emptying of and the glycemic, insulin, and incretin responses to a carbohydrate meal in type 2 diabetes. *JCEM* 2006. https://pubmed.ncbi.nlm.nih.gov/16537685/

*Access note (2026-09-16): PMC, PubMed, LWW and AJCN full texts were CAPTCHA- or paywall-blocked from this environment; guideline wording and trial numbers above were taken from abstracts and published summaries and should be spot-checked against the full texts before the post cites them.*
