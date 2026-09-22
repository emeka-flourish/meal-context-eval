# Examples — a small, fully synthetic dataset

Everything in this folder is invented. It shows the file formats; it is not data from the study.
**There are no photos here.** The instrument evaluates how models read *your* meal photos, so you
add your own images (see the main README, "Bring your own data").

| File | What it is | Copy to |
|---|---|---|
| `notes/all-notes.md` | Two invented days, four meals, in the notes format the importer reads | `data/notes/all-notes.md` |
| `notes/ground-truth-clarified.json` | The same meals as a hand-curated food list, with `hidden` flags | `data/notes/ground-truth-clarified.json` |
| `corpus/meals-example.jsonl` | 26 invented logged meals (January 2026), one JSON record per line | `data/corpus/history/meals.jsonl` |

To try the pipeline end to end without spending anything, leave the provider keys empty (or set
`MOCK_LLM=1`): every model call is then replaced by a deterministic mock. You still need photos in
`data/captures/2026-03-02/…` and `data/captures/2026-03-03/…` named as the README describes — any
JPEGs will do for a dry run. Set `CORPUS_CUTOFF_EXCLUSIVE=2026-03-02` so the January history loads
and nothing from the capture days can leak into the context.

The deterministic notes parser (used in mock mode) is rough; with an OpenAI key the model structurer
reads free-form notes much better, and the curated JSON bypasses both.
