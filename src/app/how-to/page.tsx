import Link from 'next/link'

export const metadata = { title: 'How to · Vantage' }

/* How to (one page, a short section per tab) for someone bringing their own
   data. Formats are taken from docs/CORPUS.md,
   scripts/import-*.ts and the README. Every example here is made up. */

const SECTIONS = [
  { id: 'before', label: 'Before you start' },
  { id: 'intake', label: '1 · Intake' },
  { id: 'corpus', label: '2 · Corpus' },
  { id: 'run', label: '3 · Run' },
  { id: 'results', label: '4 · Results' },
]

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-lg border border-line-soft bg-rail p-3 font-mono text-xs leading-[1.6] text-ink">{children}</pre>
}

function Section({ id, title, lead, children }: { id: string; title: string; lead: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 rounded-[10px] border border-line bg-white px-6 py-5">
      <h2 className="text-lg font-semibold tracking-[-0.01em]">{title}</h2>
      <p className="mt-1 text-ink-muted">{lead}</p>
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </section>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">{n}</span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h3 className="font-semibold">{title}</h3>
        {children}
      </div>
    </div>
  )
}

export default function HowToPage() {
  return (
    <main className="min-w-0 flex-1 overflow-y-auto px-6 pb-24 pt-5">
      <div className="mx-auto flex max-w-[980px] flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.01em]">How to use Vantage with your own data</h1>
          <p className="mt-1 text-ink-muted">
            Vantage compares how well different models understand a meal from a <b>phone</b> photo and from a <b>smart-glasses</b> photo of the same plate. You bring photos and notes, the models read the photos, and the Results tab shows how close they got. Work through the four tabs from left to right.
          </p>
          <nav className="mt-3 flex flex-wrap gap-1.5" aria-label="On this page">
            {SECTIONS.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="chip hover:border-brand hover:text-brand">
                {s.label}
              </a>
            ))}
          </nav>
        </div>

        <Section id="before" title="Before you start" lead="Two ideas and one folder.">
          <ul className="flex list-disc flex-col gap-1.5 pl-5">
            <li>
              A <b>photo scene</b> is one plate of food photographed by both cameras at the same moment. A meal can have more than one (first serving, second serving). The study only uses a scene when it has a phone photo, a glasses photo, your notes, and your confirmation that both photos show the same food.
            </li>
            <li>
              Your <b>notes</b> are the truth the models are measured against: what was on the plate and how many grams each item weighed.
            </li>
            <li>
              Everything you bring lives in one <b>data folder</b> on this computer, outside the code, so private photos are never published. The importers below are small commands you run in the Terminal app from the repository folder. Each one first shows what it <i>would</i> do; add <span className="font-mono">--commit</span> to really do it.
            </li>
          </ul>
          <Code>{`data/
  captures/        your meal photos (see Intake)
  notes/           your notes        (see Intake)
  corpus/          your past meal log (see Corpus)`}</Code>
        </Section>

        <Section id="intake" title="1 · Intake — photos and notes" lead="Get every meal into the console: photos placed by day, meal and camera, notes attached, food list saved.">
          <Step n={1} title="Put your photos in the captures folder">
            <p>The surest way is one folder per day, one folder per camera inside it, and a file name that starts with the meal and the photo number:</p>
            <Code>{`captures/<YYYY-MM-DD>/<phone|glasses>/<meal>-img<N>-….jpg

captures/
  2026-03-02/
    phone/
      breakfast-img1-phone.jpg
      lunch-img1-phone.jpg
      lunch-img2-phone.jpg      ← second plate of the same lunch
    glasses/
      breakfast-img1-glasses.jpg
      lunch-img1-glasses.jpg
      lunch-img2-glasses.jpg
  _unsorted/                    ← photos you have not sorted`}</Code>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-ink-muted">
              <li>
                <b className="text-ink">&lt;meal&gt;</b> is one of <span className="font-mono">breakfast</span>, <span className="font-mono">lunch</span>, <span className="font-mono">dinner</span>, <span className="font-mono">snack</span>. <b className="text-ink">&lt;N&gt;</b> is the photo number within that meal; the phone and glasses photos of the same plate share the same number. Anything after that in the name is ignored. JPG and HEIC both work.
              </li>
              <li>
                <b className="text-ink">_unsorted/</b> is for photos you would rather not sort by hand. The importer groups them by the time they were taken (photos within ten minutes of each other become one scene) and guesses the camera. Whatever it cannot place confidently shows up under <b className="text-ink">Unsorted photos</b> at the top of the Intake page, where you assign it to a meal yourself.
              </li>
              <li>
                A folder named <span className="font-mono">_excluded</span> inside a day keeps photos on record but out of the study. Older days may also have a <span className="font-mono">tripod</span> folder; those photos are shown but no longer needed.
              </li>
            </ul>
          </Step>
          <Step n={2} title="Import the photos">
            <Code>{`pnpm tsx scripts/import-captures.ts                      # shows the plan, changes nothing
pnpm tsx scripts/import-captures.ts --commit             # imports
pnpm tsx scripts/import-captures.ts --only 2026-03-02 --commit   # one day only`}</Code>
            <p className="text-ink-muted">Running it again is safe: photos already imported are skipped.</p>
          </Step>
          <Step n={3} title="Write your notes in one file">
            <p>
              Save them as <span className="font-mono">data/notes/all-notes.md</span> (or one file per day, <span className="font-mono">data/notes/2026-03-02.md</span>). Use a heading for the day, the meal and the photo, then one block per plate with numbered items and their grams:
            </p>
            <Code>{`# Mar 2

## Lunch

### Photo 1:
Plate 1 - Chicken and rice
1. Grilled chicken thigh, skin on - 142 g - salt, paprika
2. White rice, cooked - 180 g
3. Olive oil used for cooking - 8 g

Plate 2 - Side salad
1. Cucumber - 60 g
2. Cherry tomatoes - 45 g

### Photo 2:
Plate 1 - Second helping of rice
1. White rice, cooked - 95 g`}</Code>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-ink-muted">
              <li>
                The day can be written <span className="font-mono">Mar 2</span>, <span className="font-mono">March 2</span> or <span className="font-mono">2026-03-02</span>. The meal is Breakfast, Lunch, Dinner or Snack. <span className="font-mono">Photo 1</span> matches the photos named <span className="font-mono">…-img1-…</span>. If a meal has only one photo you can leave the photo line out.
              </li>
              <li>Weigh what you can and write the grams. If you estimated, say so (“about 30 g”). Mention cooking fat — it is easy to forget and matters a lot. Drinks are never recorded.</li>
              <li>Your words are kept exactly as written; you can also paste or edit notes per photo directly on the Intake page.</li>
            </ul>
          </Step>
          <Step n={4} title="Import the notes">
            <Code>{`pnpm tsx scripts/import-notes.ts                 # preview
pnpm tsx scripts/import-notes.ts --commit        # attach notes and draft the food lists`}</Code>
            <p className="text-ink-muted">
              The importer attaches each block to its photo scene and drafts a structured <b className="text-ink">food list</b> (dish, item, grams, how it was measured). It never overwrites a food list you already saved. If you prefer to write the food list yourself, put it in <span className="font-mono">data/notes/ground-truth-clarified.json</span> and run <span className="font-mono">pnpm tsx scripts/import-gt-json.ts --commit</span>.
            </p>
          </Step>
          <Step n={5} title="Check each day on the Intake page">
            <p>
              Open <Link href="/intake" className="text-brand underline underline-offset-2">Intake</Link>, pick a day in the calendar, and work through the meal cards. Every photo scene shows one status; when it needs you it shows one button (for example “Yes, same food”). Click any photo to see it full screen. “Remove” on a photo sends it back to Unsorted photos — nothing is ever deleted. Select a meal to read its notes and to check and save its food list underneath. A scene is done when it says <b>Ready for the study</b>.
            </p>
          </Step>
        </Section>

        <Section id="corpus" title="2 · Corpus — what the models may know about you" lead="Optional. Your past meal log becomes “context”: a summary of dishes you eat often, given to the models in the “photo plus context” condition.">
          <Step n={1} title="Export your past meals as a CSV file">
            <p>
              Put it in <span className="font-mono">data/corpus/history/</span>. One row per meal, with these columns:
            </p>
            <Code>{`meal_id, name, description, meal_type, serving_size, is_confirmed,
local_date, local_time, image_url, dishes

dishes is a JSON list, for example:
[{"name":"Chicken and rice","serving_size":"STANDARD",
  "ingredients":[{"name":"chicken thigh","amount":140,"unit":"g"},
                 {"name":"white rice","amount":180,"unit":"g"}]}]`}</Code>
            <p className="text-ink-muted">
              Only meals from <b className="text-ink">before</b> the study days may be in it — the models must not see the answers. The loader refuses the whole file if it finds a meal dated on or after the first study day.
            </p>
          </Step>
          <Step n={2} title="Load it">
            <Code>{`pnpm tsx scripts/load-corpus.ts --csv path/to/your-export.csv            # preview
pnpm tsx scripts/load-corpus.ts --csv path/to/your-export.csv --commit   # load`}</Code>
          </Step>
          <Step n={3} title="Review, then build the context">
            <p>
              On the <Link href="/corpus" className="text-brand underline underline-offset-2">Corpus</Link> page, the review queue shows one past meal at a time: agree, fix or exclude it, and pick a portion size (small, usual, large). You do not need to review everything. Then press <b>Build context</b>. Each build gets a version name, and every run records which version it used.
            </p>
          </Step>
        </Section>

        <Section id="run" title="3 · Run — ask the models" lead="A run sends every ready photo scene to the models you choose and scores the answers against your notes.">
          <Step n={1} title="Fill in the New run form">
            <ul className="flex list-disc flex-col gap-1 pl-5">
              <li>
                <b>Name</b> — anything that helps you find it later.
              </li>
              <li>
                <b>Period</b> — the first and last day to include. Only scenes that are “Ready for the study” count; the form tells you how many that is.
              </li>
              <li>
                <b>What the model is given</b> — the photo alone, the photo plus your context, or the context alone with no photo (a baseline: how far would a model get by only knowing your habits?).
              </li>
              <li>
                <b>Models</b> — tick the ones you want. More models means more calls and more cost.
              </li>
            </ul>
          </Step>
          <Step n={2} title="Check the estimate and start">
            <p>
              The form shows about how many model calls the run makes and what it should cost, with the sum spelled out. Press <b>Start run</b> and <b>leave the browser tab open</b> — the tab is what sends the work. You can pause, stop and continue later; finished work is never repeated. Failed squares can be re-run on their own.
            </p>
          </Step>
          <Step n={3} title="Why some settings are locked">
            <p>
              The exact wording of the instructions given to the models, the helper models that do the matching and the decision checks, the context version and the cameras are saved into the run when it is created. They cannot change afterwards, so two runs can always be compared fairly. To change one of them, create a new run.
            </p>
          </Step>
        </Section>

        <Section id="results" title="4 · Results — read the answers" lead="Choose a run at the top, then look at the whole study, one day, or one meal.">
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>
              <b>Level 1 · Understanding.</b> Did the model see what was on the plate? <i>Recognised</i> is the share of your food it named, <i>invented</i> is food it named that was not there, <i>net</i> is recognised minus invented, and <i>quantity</i> is how close its grams were. All run from 0 to 1; higher is better, except invented.
            </li>
            <li>
              <b>Level 2 · Nutrients.</b> How far off were calories, protein, fat, carbohydrate and fibre, as a percentage. Lower is better. “Bias” shows whether the model tends to guess too high (+) or too low (−).
            </li>
            <li>
              <b>Level 3 · Decisions.</b> Would the model’s answer lead to the same practical advice as the truth — for example “this is a high-fat meal”? Shown as the number and share of photo scenes where the decision matches.
            </li>
            <li>
              <b>Colours.</b> Green with a circle is good, amber with a triangle is worth watching, red with a square is poor. The number is always printed and the limits are listed under each table.
            </li>
            <li>
              <b>Comparing cameras.</b> Each table has one column per camera, so you can read phone against glasses directly. “Context gain” is how much the same meal improved when the model was also given your context.
            </li>
            <li>
              <b>Day and Meal views.</b> Pick a day in the calendar to see its meals; open one meal to see, item by item, what the model said next to what you wrote, and to correct a pairing the matcher got wrong.
            </li>
          </ul>
        </Section>
      </div>
    </main>
  )
}
