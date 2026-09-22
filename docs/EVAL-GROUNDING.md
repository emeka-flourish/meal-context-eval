# Evaluation grounding — how the literature scores image-to-nutrition, and what that means for our metric set
*Web-researched companion to METRICS.md and UNDERSTANDING-SCORE-CASES.md. Every claim carries a link; where only an abstract or a secondary source was reachable, it says so. Nothing in this file changes the metric docs; it recommends what should.*

## 0. Summary of the verdict

The field reports **per-dish (per-meal) MAE in absolute units, MAE as a percent of the mean (Nutrition5k), or MAPE**, plus **Pearson r** and increasingly **Bland–Altman bias and limits of agreement**, for **calories, mass, protein, fat, carbohydrate**. Recognition is scored with **set precision / recall / F1 over ingredients** (Recipe1M-style, or embedding-matched as in JFB). Nobody weights ingredients by importance tags, nobody grades per-item quantity with a bounded ratio, and only one 2025 benchmark (JFB) publishes a composite "overall score" — and it does so as a geometric mean of separately-reported components. Our ID/QT/US family is therefore **non-standard but defensible as a labeled product metric**, provided the standard numbers are reported first and in the standard form. Section 6 gives the exact final set.

## 1. What the canonical benchmarks report, at what level

| Work | Ground truth | Unit of analysis | Error metric(s) | Quantities | Weights items? |
|---|---|---|---|---|---|
| **Im2Calories** (Meyers et al., ICCV 2015) | Nutritionist-computed calories per image on MenuMatch (646 images, 41 items, 3 restaurants) | Per meal image | Mean error and mean absolute error in kcal (Table 2: their best 152.95 ± 15.61 kcal MAE vs MenuMatch 232.0); food recognition top-1 on Food-101 (79%); multi-label mAP on MenuMatch (81.4%); segmentation IoU; volume absolute error in ml per meal (Fig. 8, NFood-3d) | kcal; volume | No |
| **Nutrition5k** (Thames et al., CVPR 2021) | Weighed per-ingredient mass, USDA-derived nutrients, ~5k cafeteria plates | Per dish | MAE in absolute units **and as % of the mean ground truth** (Eq. 1). 2D direct: 70.6 kcal (26.1%), mass 40.4 g (18.8%), fat 34.2%, carb 31.9%, protein 29.5%; volume-assisted best: 41.3 kcal (16.5%); portion-independent per-gram model 9.5%. Human comparison: 16 amateurs 53% and 4 nutritionists 41% mean percent error on total mass over 10 plates | kcal, mass, protein, fat, carb | No. No ingredient-recognition metric is reported at all |
| **goFOOD** (Lu et al., Sensors 2020) | MADiMa (80 meals, 234 items, weighed) and a fast-food set | Per meal, with per-item recognition | Volume MARE 19%; segmentation F-score; recognition top-1/top-3; **median absolute error with IQR** (74.9 kcal vs dietitians 180 kcal; CHO 7.2 g vs 27 g); Pearson r 0.87–0.89 | kcal, CHO, protein, fat, volume | No |
| **goFOOD free-living** (2023) | Dietitian 24-h recall (not weighed) | Per participant-day | MAPE (kcal 27.4%, CHO 31.3%, protein 39.2%, fat 43.2%); Bland–Altman | kcal + macros | No |
| **Snap-n-Eat** (Zhang et al., JDST 2015) | ~2,000 annotated images, 15 categories | Per item | Recognition accuracy >85%; portion by pixel counting, no independent portion validation reported in the abstract (full text not accessed) | category; calories derived | No |
| **DietCam** (He, Kong, Tan, IEEE JBHI 2016) | 15,262 images, 55 food types | Per item | Classification accuracy (the earlier 2012 system: ~84% on regular-shape foods); no calorie validation in the abstract (full text not accessed) | category | No |
| **EgoDiet** (npj Digital Medicine 2024) | **Weighed food records** (pre/post weight difference) | Per food item per eating episode, consumed grams | **MAPE** with 95% CI (Study A 31.9% vs dietitians 40.1%; Study B 28.0% vs 24HR 32.5%); MAE in g (PortionNet 33.8 g); Bland–Altman; t-tests; recognition as frame- and scenario-level accuracy. **Undetected items were excluded from the portion error** | grams | No |
| **DietGlance** (Jiang et al., ACM Trans. Computing for Healthcare 2025) | Crowd-worker judgment of LLM descriptions vs images; nutrient truth from 144 meal sessions / 33 participants | Per meal | Food identification **F1 0.972** (P 0.957, R 0.989), where crowd workers counted correct / visible / described items; nutrient **MAPE** (energy 9.13%, protein 11.7%, fat 12.8%, carb 10.05%); no direct portion metric | item set; kcal + macros + micros | No |
| **NutriBench** (text, 2024–25) | Human-verified macros for 11,857 meal descriptions | Per meal | **MAE (g)**, **Acc@7.5 g** (within ±7.5 g carbohydrate, justified by insulin ratios), answer rate; downstream glucose-simulation TIR/TBR | carbs (and macros in v2) | No |
| **ACETADA LMM benchmark** (arXiv 2507.07048, 2025) | 806 before-meal images, controlled feeding, dietitian-verified | Per meal | **MAE and MAPE** for kcal and macros; no recognition metric | kcal + macros | No |
| **Tanabe & Yanai** (Nutrients 2025) incl. **FoodLMM** numbers | Nutrition5k | Per dish | MAE, MAPE, Pearson r (e.g. FoodLMM 67.3 kcal / 26.6%; LLaVA-13B-FT 64.3 kcal / 39.8% / r 0.934) | kcal | No |
| **JFB — January Food Benchmark** (arXiv 2508.09966, 2025) | 1,000 real user photos, human-validated name/ingredients/quantities/macros | Per meal | Meal-name cosine similarity; ingredient **P/R/F1** with embedding matching (Hungarian assignment, cosine ≥ 0.75); macro **WMAPE** = Σ\|A−P\| / ΣA over four macros; cost and latency; **Overall Score = 100 × Π S_k^{w_k}** with weights [0.15 meal, 0.40 ingredients, 0.25 macros, 0.10 cost, 0.10 latency] | item set; kcal + macros | Not by importance; macros implicitly weighted by magnitude via WMAPE |

**LLM/VLM photo-estimation studies 2024–2026** converge on the same grammar:

- O'Hara et al., *Nutrients* 2025 (ChatGPT-4, 114 NANS meal images, weighed truth): identification **precision 93.0 / recall 84.6 / F1 88.6**; nutrient **% difference**, Spearman r 0.29–0.83, Wilcoxon, **cross-classification exact agreement 33–58%**, ICC vs 7 dietitians (energy 0.56).
- Fridolfsson et al., *Curr Dev Nutr* 2025 (ChatGPT-4o, Claude 3.5, Gemini 1.5; 52 weighed photos): **MAPE** (energy 35.8 / 35.8 / 64.2%), Pearson r, **Bland–Altman bias and LoA**, and **regression slope of bias on portion size** (−0.23 to −0.50, i.e., underestimation grows with portion).
- Rodríguez-Jiménez et al., *Nutrients* 2025 (ChatGPT-5, 195 dishes, 4 context scenarios): primary endpoint **MAE kcal**, secondary MedAE, RMSE, MAPE, MedAPE, IQR of absolute errors, bootstrap CIs (image-only all-source MAE 123 kcal, MAPE 30.5%; the dietitian-weighed home subset 75 kcal / 20.1%); no Bland–Altman, no identification metric.
- Isobe et al., *Nutrients* 2026 (10 AI tools vs 10 dietitians, 15 weighed hospital meals): Pearson r, **mean bias %**, MAE, **% within ±10%**, Bland–Altman per nutrient (lipid bias +23.6 to +52.3%).
- Lo, Qiu et al., *IEEE JBHI* 2024 (GPT-4V, weighed African foods): recognition **accuracy/precision/recall/F1 by exact match** (F1 83.6 → 93.3% with cuisine prompt), portion **MAE in g** (54.6 g vs humans 43.6 g), Pearson r 0.78, nutrient MAE per item and per episode.
- The **ChatGPT image-only MAPE ≈ 30–36%** cluster is where METRICS.md's "≈35% kcal error" anchor actually comes from; it is **not** the best published photo-based work. Nutrition5k's own models sit at 16.5–26.1% MAE-of-mean on their test split, and DietGlance reports 9% energy MAPE on its own meals. The anchor sentence in METRICS.md should be re-attributed.

Two field-level observations: (i) Nutrition5k, the reference benchmark, **does not evaluate ingredient recognition at all** — it evaluates dish-level nutrients; (ii) the JMIR 2024 scoping review of 84 image-based studies (abstract only accessed) found most systems validated on energy and macronutrients, with no standardized protocol — which is exactly why JFB (2025) positions itself as fixing "the lack of standardized evaluation methodologies."

## 2. How recognition is scored, and precedents for weighting and hallucination penalties

**Standard scoring.** Single-label datasets (Food-101, UEC-Food256) use top-1/top-5 accuracy (Im2Calories: 79% top-1 on Food-101). Multi-label ingredient prediction on Recipe1M (Salvador et al., *Inverse Cooking*, CVPR 2019) reports **IoU and F1 over ingredient sets, computed from TP/FP/FN accumulated over the whole split** (Pascal-VOC convention), over a 1,488-ingredient vocabulary after synonym merging (TFset: IoU 32.1, F1 48.6). Pixel-level work (FoodSeg103, 104 ingredient classes) uses **mIoU** (~52% state of the art). VLM-era work scores ingredient lists by **P/R/F1 with exact match** (Lo/Qiu 2024), **embedding match with a tuned threshold** (JFB), or **human/crowd judgment of each described item** (DietGlance, O'Hara).

**Importance- or nutrient-weighted recognition.** No precedent for the core/secondary/garnish/spice scheme was found. The closest are: (a) **Expert-Weighted Recall** in Romero-Tapiador et al. (arXiv 2504.06925, FoodNExTDB), which weights each ground-truth label by the fraction of the seven annotators who assigned it — weighting by *annotator agreement*, not by dietary importance; (b) JFB's **WMAPE**, which weights nutrient errors by the nutrient's magnitude (a mass/energy weighting of quantity error, not of recognition). Nutrition5k's human study asked raters for per-ingredient masses but scored total-dish mass. So importance weighting of *recognition* is ours alone.

**Hallucination penalties.** The image-captioning field has a direct precedent: **CHAIR** (Rohrbach et al., EMNLP 2018) — CHAIR_i = hallucinated object mentions / all mentions, CHAIR_s = captions with ≥1 hallucinated object / all captions — motivated by the finding that standard metrics "do not always" penalize hallucination. In food: any P/R/F1 scheme penalizes invented ingredients through **precision** (JFB explicitly tunes its match threshold to avoid over-matching "butter" to "oil"); EWR gives unmatched predictions zero weight but has **no explicit precision term**; EgoDiet **excluded undetected items** from portion error, i.e. the opposite bias. So the standard way to report invented items is a precision figure (or a CHAIR-style hallucination rate), not a subtracted penalty inside a weighted recall.

## 3. What dietary-assessment validation expects

The nutrition-epidemiology tradition validates a new instrument against **weighed food records** (item level) or **doubly labelled water** (total energy, group level), and reports multiple complementary statistics because each answers a different facet of validity. Lombard et al. (*Nutrition Journal* 2015) reviewed the practice and proposed thresholds: **correlation** (association at individual level; ≥0.50 good, 0.20–0.49 acceptable), **paired t-test / Wilcoxon** (group-level agreement), **percent difference** (0–10% good, 11–20% acceptable, >20% poor), **cross-classification into tertiles** (≥50% same tertile and ≤10% opposite tertile), **weighted kappa** (≥0.61 good), and **Bland–Altman** (presence, direction and extent of bias at group level, with 95% limits of agreement = mean difference ± 1.96 SD). Their conclusion is that one to three tests are insufficient. Kirkpatrick et al. (*J Acad Nutr Diet* 2019, abstract only) add that validity and reliability evidence "should be interpreted in combination" and that recovery biomarkers are the reference of choice for self-report; the same review discussion notes caution in using r as evidence of agreement. Bland & Altman (1999) also cover the case relevant to us: when the difference scales with magnitude, **log-transform and report limits of agreement as ratios**.

Applied examples in technology-assisted assessment: Whitton et al. (*AJCN* 2024, controlled feeding, n = 152) report **mean % error with 95% CI** per method (mFR-TA 1.3%, IA-24HR 15.0%), Bland–Altman LoA (~±50% for ASA24/Intake24, within 30% for mFR-TA), and **% within 800 kJ of truth**. Serra et al. (*Front Nutr* 2023) validated the SNAQ photo app against DLW with bias (−330 kcal/d), LoA (−1,504 to +845 kcal/d), R², and **Goldberg cut-offs for misreporting**.

What a nutrition scientist expects, in order: (1) group-level bias with CI (signed % error), (2) Bland–Altman plot with LoA and a test for proportional bias, (3) individual-level association (r or ICC) **and** individual-level agreement (cross-classification or % within a tolerance), (4) per-nutrient results in absolute units, (5) the n of meals/days and how ground truth was obtained (weighed share).

## 4. Ratio-type error metrics: MAPE, sMAPE, log accuracy ratio, and our min/max grade

- **MAPE asymmetry.** Tofallis (*JORS* 2015) shows MAPE is asymmetric because under-prediction is bounded (≤100%) while over-prediction is unbounded, so selecting or fitting on MAPE "systematically selects those whose predictions are too low." Hyndman & Athanasopoulos (FPP3) make the same point and add the near-zero denominator problem.
- **sMAPE** (Armstrong) divides by the mean of actual and forecast; FPP3 notes it can still be unstable near zero and Hyndman & Koehler (2006) "recommend that the sMAPE not be used." (Hyndman's blog post on the corrected direction of the asymmetry could not be fetched; FPP3 text used instead.)
- **Log accuracy ratio** ln(pred/actual). Tofallis: symmetric under interchange, additive, and least squares on it predicts the geometric mean. Morley, Brito & Welling (*Space Weather* 2018; full text not accessible, definitions taken from secondary citations and the OSTI/ADS abstracts) derive two reporting statistics: **median symmetric accuracy** MSA = 100·(exp(median\|ln Q\|) − 1) and **symmetric signed percentage bias** SSPB = 100·sgn(M)·(exp\|M\| − 1), M = median ln Q. Bland–Altman on log scale (§3) is the same idea in the medical-statistics dialect.
- **Bounded ratio accuracy.** Tofallis reproduces Törnqvist et al.'s (1985) list of ten relative-change measures, which includes **(f−g)/max(f,g)** and (f−g)/min(f,g); these appeared in software cost estimation as the *inverted balanced relative error* and *balanced relative error* (Miyazaki et al. 1991/1994). Our grade = min/max = 1 − \|est−gt\|/max(est,gt) is therefore exactly **1 − \|inverted balanced relative error\|**: a known, symmetric, bounded measure, but one Törnqvist rejected for lacking additivity and that has no footprint in nutrition or forecasting practice. Chen, Twycross & Garibaldi (*PLOS ONE* 2017) propose a different bounded measure, BRAE = \|e\|/(\|e\|+\|e*\|) against a benchmark, again symmetric and in [0,1]. 
- **Honest status:** MAPE (and MAE, and Nutrition5k's MAE-of-mean) is the standard in this field despite its known bias; log-ratio statistics are the statistically preferred alternative and have a nutrition-adjacent home in log-scale Bland–Altman; a min/max grade has precedent as a measure but no precedent as a *reporting* metric. It is fine as a product score if its identity is stated and if a log-ratio or MAPE companion is published for comparability.

## 5. LLM-as-judge in food-logging evaluation

Precedent exists but is thin and mostly on the *advice* side: DietGlance used GPT-4 to grade dietary suggestions on 1–5 scales (relevance, coherence, fluency) while using crowd workers, not an LLM, to judge whether described items matched the image. NutriBench, ACETADA, Fridolfsson, O'Hara, Isobe and Rodríguez-Jiménez all use deterministic ground truth with no LLM judgment. JFB replaces a judge with a **tuned embedding matcher validated against human similarity ratings** (r = 0.82 for text-embedding-3-small). A 2026 FoodBench-QA entry uses Gemini as a *semantic refinement* layer for ingredient-to-database matching rather than as a grader. General critiques of LLM-as-judge (Zheng et al., NeurIPS 2023; follow-ups on position, verbosity and self-enhancement bias) apply directly: a model judging whether "trout" matches "salmon" or whether "roasted vegetables" covers four separately listed items may be lenient toward its own family's output. The field's answer is either human/crowd adjudication or a fixed, published matcher with a validation number — which is what METRICS.md's "matcher override rate" already gestures at. The right form is: publish the matcher's agreement with human adjudication on a held-out slice, and freeze the matcher prompt hash per run.

## 6. Critique of our metric set, and the recommended reporting set

### 6a. What a nutrition-informatics researcher would say

- **Nonstandard:** ID/QT/US have no counterpart in the validation literature; reviewers will ask for MAPE/MAE and Bland–Altman before reading further. The 0.5 substitute credit, 0.5 invented penalty and the importance weights are judgment calls that must be published as sensitivity, not baked into the headline.
- **Insist on:** signed % error with CI per nutrient (group bias), Bland–Altman bias and LoA per nutrient at meal level (log-scale if proportional bias appears — Fridolfsson found it does), Pearson/Spearman r, **% within ±10% and ±20%** (Lombard's percent-difference bands; Isobe's ±10%), cross-classification into tertiles for day-level energy, and the weighed share of ground truth. Report n meals, n days, n photos and the CI method (our 90% bootstrap is fine but should be stated once, and 95% is the convention).
- **Missing:** per-nutrient MAE in absolute units (kcal, g) — METRICS.md only lists % errors; dish-level calorie MAPE as a separate line (our meal-level pooling hides per-dish spread); a **bias-vs-portion-size slope** (the most robust LLM finding across 2025 studies); fiber promoted from "secondary" to reported, because the GERD/IBS personas depend on it.
- **Over-engineered:** the combined US score; day-level partial-day rules; kcal-weighted QT as a switch rather than simply reporting nutrient error directly (which already is the kcal-weighted quantity error).

### 6b. What a food-computing ML researcher would say

- **Nonstandard:** importance-weighted recall with a subtracted invented term. They would want plain **ingredient precision, recall and F1** (macro over meals and micro over items) and a **hallucination rate** (CHAIR-style: invented items / predicted items; meals with ≥1 invented core/secondary item). The appendix "F1 at ingredient and dish level" should be promoted to a primary table.
- **Insist on:** a documented matching rule (exact / synonym / substitute) with the matcher's agreement against human adjudication; results split by routine vs novel and by vantage exactly as planned; Nutrition5k-style **MAE as % of mean** so numbers can be placed next to Thames et al. and Tanabe & Yanai; cost and latency per photo (JFB reports them).
- **Missing:** per-item mass MAE in grams (EgoDiet, Lo/Qiu report it); a statement of how missed items enter quantity error (EgoDiet excluded them; we score them 0 — both are defensible, ours is stricter, it must be said).
- **Over-engineered:** four importance tiers when two (major / minor) would carry the same signal; the min/max grade when \|ln ratio\| is one line away and gives MSA/SSPB for free.
- **Internal inconsistency to fix:** METRICS.md still defines QT with the log grade zeroed at 2× while UNDERSTANDING-SCORE-CASES.md (rev 2) defines grade = min/max. One definition must win, and the "≈35% best published" anchor must be re-attributed to the LLM studies (§1).

### 6c. Recommended final reporting set

**Tier A — standard metrics, standard form (primary, for comparability).** All at meal level unless stated; also at day level for energy; 95% bootstrap CIs; split by vantage × condition × model, and routine vs novel.

| Metric | Definition | Reported for |
|---|---|---|
| MAE | (1/N) Σ \|est − gt\| in kcal or g | kcal, protein, fat, carb, fiber; also **total mass (g)** |
| MAE% of mean | MAE / mean(gt) × 100 (Nutrition5k form) | same |
| MAPE | (1/N) Σ \|est − gt\| / gt × 100, with MedAPE alongside | same |
| Signed bias | (1/N) Σ (est − gt)/gt × 100 with CI (group-level over/under) | same |
| Bland–Altman | mean difference and LoA = bias ± 1.96 SD; on ln scale (ratio LoA) if difference correlates with magnitude; report the bias-on-size slope | kcal, macros |
| Association | Pearson r (and Spearman) est vs gt | kcal, macros |
| Tolerance accuracy | % of meals with \|est − gt\|/gt ≤ 10% and ≤ 20% (Lombard bands); for carbs also **Acc@7.5 g** (NutriBench) | kcal, macros |
| Cross-classification | % of days in same tertile / opposite tertile of energy | kcal (day) |
| Ingredient recognition | precision, recall, F1 per meal (macro) and pooled TP/FP/FN (micro, Recipe1M convention); matching rule = exact or curated-synonym, substitutes counted as FP+FN in this table | item sets |
| Hallucination rate | invented items / predicted items (CHAIR_i analogue); % meals with ≥1 invented core/secondary item (CHAIR_s analogue) | item sets |
| Per-item mass error | MAE g and MAPE over matched items (state that missed items are excluded here, as in EgoDiet) | grams |
| Instrument | n photos/meals/days, weighed share, matcher agreement with human adjudication, model IDs, prompt hashes, cost and latency per photo | — |

**Tier B — product-oriented secondary (clearly labeled "understanding score; non-standard").** Keep, with these fixes:

- **ID** as defined, but publish alongside it the unweighted F1 from Tier A, and move the invented term out into the hallucination rate; if the subtracted penalty stays, label ID "importance-weighted recall minus invented-item penalty" so its identity is explicit. Publish sensitivity for substitute credit ∈ {0, 0.5} and invented penalty ∈ {0.5, 1.0}.
- **QT**: pick one grade and state it as a known measure. If min/max is kept: "grade_i = min(est,gt)/max(est,gt) = 1 − \|inverted balanced relative error\| (Miyazaki et al. 1994; Törnqvist et al. 1985 via Tofallis 2015)", mass-weighted, missed items = 0. In the same table report the log-ratio companions, which cost nothing: **MSA** = 100·(exp(median\|ln(est/gt)\|) − 1) and **SSPB** = 100·sgn(M)·(exp\|M\| − 1) over matched items (Morley et al. 2018).
- **US** = 100·(0.5·ID + 0.5·QT) only in charts; note that JFB uses a geometric mean, which punishes a zero component, and state why arithmetic was chosen.
- **Persona decision agreement** (Family 3) is a legitimate downstream-utility metric with precedent in NutriBench's glucose-simulation endpoint; report agreement rate and margin to threshold as planned.

Reporting rule: Tier A tables come first in any results screen or export; Tier B follows with its label. This keeps the study citable against Nutrition5k, the 2025 LLM studies and JFB, while preserving the product signal the understanding score was designed for.

## Sources

Full text accessed unless marked.

- Meyers et al., *Im2Calories*, ICCV 2015 — [Google Research PDF](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/44321.pdf); [CVF abstract](https://openaccess.thecvf.com/content_iccv_2015/html/Meyers_Im2Calories_Towards_an_ICCV_2015_paper.html)
- Thames et al., *Nutrition5k*, CVPR 2021 — [arXiv 2103.03375](https://arxiv.org/abs/2103.03375); [dataset README](https://github.com/google-research-datasets/Nutrition5k/blob/main/README.md)
- Lu et al., *goFOOD*, Sensors 2020 — [PMC7436102](https://pmc.ncbi.nlm.nih.gov/articles/PMC7436102/); free-living 2023 study — [PMC10490087](https://pmc.ncbi.nlm.nih.gov/articles/PMC10490087/)
- Zhang et al., *Snap-n-Eat*, J Diabetes Sci Technol 2015 — [PubMed abstract](https://pubmed.ncbi.nlm.nih.gov/25901024/) (abstract only)
- He, Kong, Tan, *DietCam multiview*, IEEE JBHI 2016 — [PubMed abstract](https://pubmed.ncbi.nlm.nih.gov/25850095/) (abstract only); 2012 system — [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S1574119214000893) (abstract only)
- Qiu et al., *EgoDiet*, npj Digital Medicine 2024 — [Nature](https://www.nature.com/articles/s41746-024-01346-8); [PMC11621677](https://pmc.ncbi.nlm.nih.gov/articles/PMC11621677/)
- Jiang et al., *DietGlance*, ACM Trans. Computing for Healthcare 2025 — [arXiv 2502.01317](https://arxiv.org/abs/2502.01317); [ACM DL](https://dl.acm.org/doi/abs/10.1145/3797883)
- Chotwanvirat et al., JMIR 2024 scoping review — [JMIR](https://www.jmir.org/2024/1/e51432) (abstract only)
- Tanabe & Yanai, *Reasoning-driven food energy estimation*, Nutrients 2025 (FoodLMM comparison) — [PMC11990770](https://pmc.ncbi.nlm.nih.gov/articles/PMC11990770/)
- NutriBench — [arXiv 2407.12843](https://arxiv.org/html/2407.12843v2)
- ACETADA LMM benchmark — [arXiv 2507.07048](https://arxiv.org/html/2507.07048)
- January Food Benchmark (JFB) — [arXiv 2508.09966](https://arxiv.org/html/2508.09966)
- OmniFood-Bench — [arXiv 2607.08423](https://arxiv.org/html/2607.08423)
- DietAI24, Communications Medicine 2025 — [Nature](https://www.nature.com/articles/s43856-025-01159-0) (abstract/secondary only)
- O'Hara et al., ChatGPT-4 meal photographs, Nutrients 2025 — [PMC11858203](https://pmc.ncbi.nlm.nih.gov/articles/PMC11858203/)
- Fridolfsson et al., 3 LLMs, Curr Dev Nutr 2025 — [PMC12513282](https://pmc.ncbi.nlm.nih.gov/articles/PMC12513282/)
- Rodríguez-Jiménez et al., ChatGPT-5, Nutrients 2025 — [PMC12655113](https://pmc.ncbi.nlm.nih.gov/articles/PMC12655113/)
- Isobe et al., AI vs dietitians on hospital meals, Nutrients 2026 — [PMC13029357](https://pmc.ncbi.nlm.nih.gov/articles/PMC13029357/)
- Lo, Qiu et al., *Dietary Assessment with Multimodal ChatGPT*, IEEE JBHI 2024 — [arXiv 2312.08592](https://arxiv.org/abs/2312.08592)
- Salvador et al., *Inverse Cooking*, CVPR 2019 — [arXiv 1812.06164](https://arxiv.org/html/1812.06164v2)
- FoodSeg103 benchmark — [GitHub](https://github.com/LARC-CMU-SMU/FoodSeg103-Benchmark-v1); segmentation benchmarking — [ScienceDirect](https://www.sciencedirect.com/science/article/pii/S1877050925027371)
- Romero-Tapiador et al., *Are VLMs ready for dietary assessment?* (Expert-Weighted Recall) — [arXiv 2504.06925](https://arxiv.org/html/2504.06925v1)
- Rohrbach et al., *Object Hallucination in Image Captioning* (CHAIR), EMNLP 2018 — [arXiv 1809.02156](https://arxiv.org/abs/1809.02156)
- Lombard et al., Nutrition Journal 2015 — [PMC4471918](https://pmc.ncbi.nlm.nih.gov/articles/PMC4471918/)
- Kirkpatrick et al., J Acad Nutr Diet 2019 — [JAND](https://www.jandonline.org/article/S2212-2672(19)30573-8/fulltext) (abstract only)
- Bland & Altman, Stat Methods Med Res 1999 — [PubMed](https://pubmed.ncbi.nlm.nih.gov/10501650/) (abstract and secondary summaries)
- Whitton et al., AJCN 2024 feeding study — [PMC11347807](https://pmc.ncbi.nlm.nih.gov/articles/PMC11347807/)
- Serra et al., SNAQ vs doubly labelled water, Front Nutr 2023 — [PMC10556674](https://pmc.ncbi.nlm.nih.gov/articles/PMC10556674/)
- Tofallis, *A better measure of relative prediction accuracy*, JORS 2015 — [arXiv 2105.05249](https://arxiv.org/pdf/2105.05249); [Springer](https://link.springer.com/article/10.1057/jors.2014.103)
- Morley, Brito, Welling, Space Weather 2018 — [Wiley](https://agupubs.onlinelibrary.wiley.com/doi/10.1002/2017SW001669); [OSTI](https://www.osti.gov/pages/biblio/1416283) (abstract and secondary citations only)
- Hyndman & Athanasopoulos, FPP3 §5.8 (MAPE, sMAPE, MASE) — [otexts](https://otexts.com/fpp3/accuracy.html); Hyndman & Koehler 2006 — [ResearchGate](https://www.researchgate.net/publication/222665190_Another_look_at_measures_of_forecast_accuracy) (not accessed directly)
- Chen, Twycross, Garibaldi, UMBRAE, PLOS ONE 2017 — [PLOS](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0174202)
- Zheng et al., *Judging LLM-as-a-Judge*, NeurIPS 2023 — [arXiv 2306.05685](https://arxiv.org/abs/2306.05685); position-bias follow-up — [arXiv 2406.07791](https://arxiv.org/html/2406.07791v9)
- Bakar et al., *SnappyMeal* — [arXiv 2511.03907](https://arxiv.org/pdf/2511.03907)
- FoodBench-QA 2026 LLM semantic refinement — [arXiv 2604.25774](https://arxiv.org/html/2604.25774)
