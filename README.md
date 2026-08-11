# Cairn

**Never see a large thing without also seeing the next small thing inside it.**

[Open Cairn](https://hussain2111.github.io/Cairn/)

---

## The problem this solves

You look at something big, register how big it is, and do something else. Not because it's hard — because nothing in front of you is small enough to start.

Most task managers make that worse. They show you everything at once and leave the breaking-down to you, at exactly the moment you're least willing to do it.

Cairn takes the decomposition *up front*, when you're thinking clearly, and then hides almost all of it. You split a thread into stages before you begin, each stage into steps, each step into tasks. Only tasks are checkable. Stages stay locked until the one before them is done — visible, so you can see the whole map, but not workable. The home screen shows one line per thread: the next unblocked task, and nothing else.

The second thing it solves: you learn something once, never retrieve it, and it's gone. So the question banks aren't checklists. They're a scheduler that decides when you see a question again, and keeps deciding until you can answer it cold.

## Using it day to day

**Morning: open Today.** Everything that wants you is on one screen — the next task in each thread, questions due for review, pipeline items that have gone quiet, your time blocks, where the gym week stands. Pick one thing from "Up next" and start.

**When you finish something, tick it.** That's the only write the tool really needs from you. Steps and stages complete themselves. When a stage closes, the next one unlocks and says so.

**When a thread has nothing startable, Today tells you why** — no done-when written, no tasks in the open stage, everything ahead locked — with a button to the fix. It never just goes blank.

**Friday: open the Weekly review.** It's generated, not written. What completed, what didn't move, what you hesitated on, where the hours actually went. Copy it as markdown if you want it elsewhere.

**When something has been quiet for two weeks, Cairn says so** on Today and in the sidebar. That's the failure mode this tool exists to catch: threads dying silently while you feel busy.

## The three ideas worth understanding

**Done-when is mandatory.** Every stage needs a written, checkable completion condition before you can work in it. Not "improve the parser" — "every token type has a passing test and the fuzzer runs clean for 10k inputs." It's what stops a stage expanding forever, and the app refuses to let you tick into a stage without one.

**Locked stages stay visible.** You can read the whole plan; you just can't work ahead. There's a manual force-unlock for when real life goes out of order, and a force-complete for when a stage is good enough — both are recorded as overrides so the weekly review can be honest about them.

**Unlock state is derived, never stored.** Completion and locking are recomputed from the tasks on every read. That's why reordering stages is safe: move one and everything recomputes from its new position, with no stale flag left behind to lie to you later.

## Getting a plan in without typing it

**Threads → Import outline.** Paste a plan written in plain text and it becomes threads, stages, steps and tasks:

```
# Compiler project (project)

## Lexer
> every token type has a passing test and the fuzzer runs clean for 10k inputs
### Numbers
- Integer literals @45m
- Float literals ^2026-09-01
### Strings
- Escapes and unicode

## Parser
> the grammar round-trips every fixture in tests/fixtures
### Expressions
- Precedence climbing @2h
```

| Marker | Means |
| --- | --- |
| `# Name (type)` | Thread. Type is `project`, `study`, `pipeline`, `habit` or `reading`; defaults to `project`. |
| `## Title` | Stage. |
| `> text` | That stage's done-when. **Required.** Consecutive `>` lines join into one sentence. |
| `### Title` | Step. |
| `- Task` | Task. `-`, `*`, `+` or `1.` all work. |
| `@45m` | Optional estimate. `@2h`, `@1h30m` and `@90` also parse. |
| `^2026-09-01` | Optional due date. |

The dialog has a **Copy the prompt for a chat** button. The loop is: describe your project to a chat, paste its answer into Cairn, confirm.

The parser is deliberately strict, because the failure that matters isn't a rejected import — it's one that quietly created four of your six stages and you notice three weeks later:

- **Every line must classify.** An unrecognised line is a blocking error with its line number and the offending text. Nothing is skipped.
- **Counts are self-checked.** Markers found in the text must equal records produced, or the parser refuses rather than passing quietly.
- **A stage with no done-when blocks the import** and names itself. Chats omit it constantly, and such a stage would be unstartable anyway.
- **Duplicates are never created by accident.** A thread name you already have gets the new stages appended to it; stage titles that clash are listed before you commit.
- **Anything inferred is reported** — tasks written straight under a stage get a step called "Tasks", shown as a warning in the preview.

Nothing is written until you confirm, and the whole import is one undo.

## Everything else

**Question banks** — SQL, LeetCode, GRE. Each attempt records the date, whether you solved it unaided, minutes taken, and what you hesitated on. That last field is the one worth re-reading.

**Notes** — markdown, attachable to any thread, stage, step or task, with templates for daily logs, stage retrospectives, question write-ups, application records and weekly reviews. Write your own too.

**Pipelines** — applications and outreach, with the resume version you sent, next actions, and a flag for anything that hasn't moved in a fortnight.

**Time blocking** — plan the day, record what actually happened, see the weekly distribution. A block points at an *activity*: any thread, or one of the standing areas — the gym, GRE, practice problems, reading, applications — so a week adds up to a week rather than to the part that happened to be a project.

A plan and a record of what happened are two separate blocks with a status, not two time pairs on one. That is what they actually are: an intention written in the morning and an account written afterwards. A block that was never planned can still be logged, a plan that was abandoned stays visible as a plan, and one button turns a plan into the record of having done it. The form does not ask for a date — prev/next already answered that.

**Search** — across everything: tasks, notes, what you hesitated on, chess lessons, bookmark notes.

Weeks run **Sunday to Saturday**, everywhere and without exception — targets, streaks, muscle coverage, the weekly review, the time distribution. It is one constant in `src/core/dates.js`; nothing else takes a week-start argument, so the figures cannot disagree with each other.

## The gym

Sessions, not check-marks — *that you went* is not the useful part.

A session records the date, start and end, whether you warmed up and for how long, and the exercises: sets, reps, weight, and a free-text note per exercise. That note is where "good pump", "no tension in the target muscle" and "first two sets locking out at the top" go; it is deliberately not a dropdown, because the useful notes are sentences.

Entry is built for a phone between sets. Picking an exercise fills in the sets you did last time, **Repeat set** copies the row above, and the next slot in your A/B rotation arrives already chosen. Most sessions are the last one with two numbers changed.

**A partial session is the normal case**, not an error state. What was skipped sits beside what was done, with a reason — machine occupied, ran out of time, pain, chose not to. A substitution keeps both halves: what was meant to happen and what actually did.

### The exercise library

Exercises are things you maintain, not free text typed per session. Each carries a primary muscle and secondaries, an equipment type — cable, machine, Smith, dumbbell, barbell, bodyweight — a status, and cues that surface automatically the moment you log it.

**Equipment is not cosmetic.** A cable or machine variant can work where the free-weight version of the same movement does not, and the preference view counts that rather than leaving it to be rediscovered every few months: sets done per kind, how many you kept, and how many you dropped *for pain* specifically.

**Dropping asks why**, and keeps disliked, painful and unavailable apart. They are three different problems and lead to three different actions — find a variant, see someone about it, change gym — so they are never collapsed into one "retired". Dropping never rewrites history: the exercise leaves the picker and stays in every session that used it. Deleting one that has been used is refused. Renaming propagates, because a rename is a correction.

### The views

- **This week against target** — done, planned, still to do, days left. It says so when the maths no longer works.
- **Muscle coverage** — the one that decides what today's session should be. The cells with nothing in them are the answer. Direct work is counted apart from assistance: three pressing days do not make an arms day.
- **Gaps** — muscle groups whose only exercises are dropped or untried. A group stops being trained without anything ever announcing it, unless something does.
- **Progression** — one exercise over time. A bodyweight movement is tracked by reps, since there is no load to plot.
- **Pain** — below.
- **History** — every session, reopenable.

### Pain

A structured record, not a note. The only question worth asking of it — *does this recur across different exercises, or is it isolated to one?* — cannot be answered by reading paragraphs. One is about the body, the other is about the movement, and they lead to opposite actions.

So pain records a location, the exercise, whether it happened during or after, and the date. The view groups by location and says explicitly when a location has hurt on two or more distinct exercises. Exportable on its own as a dated CSV or markdown table.

### Bringing in an existing logbook

**Gym → Import logbook** takes a paste of the markdown log you have been keeping and extracts the library table, the dated sessions with their durations and warm-ups, the sets in whatever notation you used (`3×10`, `10, 10, 8 @ 40kg`, `12 @ bw`), what was skipped and why, the per-exercise feedback, the pain table, the cues and the dropped list.

It is lenient where the outline parser is strict — the source is a year of handwriting and there is no second copy — but honest in the same way. Every line either becomes part of a record or is **reported by number and verbatim** as something it could not interpret. Anything it guessed, like reading "chest" off the name "cable fly", is marked as a guess and correctable in the preview. Nothing is written until you commit, and the whole import is one undo.

## GRE

A fixed daily programme with an end date, which is why it does not fit the thread model and has its own tab.

**Every day is a set of blocks** — retrieval, concept, deliberate problems, timed, vocab, verbal, log consolidation — each with a duration and rules about when it appears. Retrieval is always drawn first and does not appear until day four, because there is nothing to retrieve before then. Vocab runs every single day, checkpoint days included. Blocks that carry a topic show *today's assigned topic*, not a generic label. A checkpoint day replaces the normal shape, keeping only what runs every day.

**None of that plan is in the source.** Which days exist, which phase each belongs to, which blocks run when and each day's topics are pasted in and live in your data — a programme with an end date will be rewritten, and a plan compiled into the code cannot be. The block definitions themselves are a template you can edit.

**Phases have gates:** a module number that has to be reached by a given day. Progress shows against it, and a gate whose day has passed unmet is flagged as **missed** rather than softened into "behind" — missing one is the signal to change the plan, not to push on.

### The problem log

Four fields per problem:

1. What it gave and what it asked, in your own words, one line
2. What you did
3. Where it broke — or, if you got it right, what the faster route was
4. **The portable move**, roughly six words

Field four is mandatory. An entry without it is not saved, with an explanation rather than a silent allowance: if you cannot write it, the extraction did not happen. It has to be a rule about problems in general, not about that one — the form says so, with one good example and one bad one.

Correct answers are logged too. A right answer reached the slow way is a miss you did not notice.

### Retrieval

Each entry schedules a cold re-attempt at +3 days and again at +10, using the same spaced-repetition scheduler as the question banks with a different interval chain. **The queue shows you the problem reference and nothing else** — not what you wrote about it — until you record a result. Anything else is recognition, not retrieval.

### The audit

Not a score. Two numbers:

- **The share of misses caused by concept gaps, per phase**, so early phases can be set against later ones. The share is of misses rather than of everything logged, since correct answers are in the log too and would dilute it.
- **Portable moves that fired again** — a move written for one problem applying to a later, unseen one. When you log an entry, the form asks whether an earlier move applied here and links the two. That count, over time, is the real output of the whole thing, so it sits at the top of the page.

Plus a daily streak for the vocab block, since it is the one that breaks if skipped, and a countdown of days left in the window.

## Chess

A row per game — date, colour, result, where, opponent rating, link, opening — and one required field: **what went wrong, or what you learned**. One line. A game logged without it isn't logged, and the editor won't save it.

That field is the whole point. Over fifty games the lines cluster, and the clusters are the study list — the same mechanism as the hesitation notes on the question banks. The **Lessons** page collects every line in one place and counts the terms that turn up in more than one game, so five separate notes about hanging a piece read as one problem.

There is no board, no engine, no move-by-move analysis and no PGN import. Chess.com and Lichess already do all of that better.

## Reading

Drop in a PDF and read it here.

Cairn reads the title, author and page count out of the file, falls back to the filename when the metadata is empty — which it usually is — and says which fields it guessed so you can correct them before anything is saved. The first page is rendered as a cover, and the library is a shelf of covers rather than a list of rows.

Opening a book opens it in the app at the last page you were on. Page navigation, jump to a page, arrow keys, and the position saves on every turn. **Bookmarks** take an optional note and list per book, and each one jumps back to its page. Books you only own on paper can still be tracked by hand.

**Where the bytes live.** PDFs are far too large for `localStorage`, so the files go in IndexedDB and the record — title, position, bookmarks — stays in the main store with everything else. The consequence is stated wherever it matters rather than discovered later:

- **A JSON export does not contain your PDFs.** It carries the shelf, your place in every book and every bookmark. It does not carry hundreds of megabytes of files. Reading → Storage has **Save every book file** for getting those back out; the two together are the whole library.
- After importing a backup on another device, books show as **"no file on this device"** with a button to find the PDF again. Reattaching restores the reader with your place and bookmarks untouched.
- Reading → Storage shows what the library is using and what share of the browser's allowance that is. If an import would exceed it, the import is refused with an explanation and **nothing is added** — no half-shelved book with no file behind it.

## How the scheduler works

Worth being precise about, since it decides your review queue.

- Intervals are day offsets: **0, 2, 7, 21** by default, configurable in Settings.
- A new question is due the day you add it.
- An **unaided** attempt advances one step along the chain.
- A **failed or aided** attempt resets to the start. The first interval is zero days, so a reset question is due again the same day — intended, not an off-by-one.
- **Hesitation** doesn't reset the chain, but it blocks retirement. At the final interval an unaided-but-hesitant solve reschedules at that same interval instead of retiring.
- A question **retires** when solved unaided, with no hesitation recorded, at the final interval.

The attempt dialog tells you what the scheduler will do *before* you commit to it.

## Your data

Everything except book files lives in `localStorage` under `cairn.state`, in this browser, on this device. The PDFs live in IndexedDB under `cairn.books`. No account, no server, no telemetry. Nothing is ever sent anywhere — which also means **sharing the app's URL shares the app, not your data**; anyone who opens it gets an empty Cairn.

**It does not sync.** Your laptop and your phone are independent copies. To move between them: Settings → **Export JSON**, get the file across, Settings → **Import**. Use *Import and merge* if you've added things on both sides — it keeps both and skips records it already has.

**Export periodically.** Clearing site data deletes everything. Safari also evicts `localStorage` after about a week of not visiting the site.

Capacity is not a practical concern *for the records*: twelve heavy threads with ~1,700 tasks, 300 questions with 1,200 attempts, hundreds of notes and applications and two years of habit logs comes to about 1.2 MB — roughly a quarter of a typical 5 MB budget. Settings shows the live figure, warns at 80%, and if a write is ever refused your change stays on screen with a prompt to export rather than being lost. Book files are the exception and are measured separately, in Reading → Storage.

**Import validates before it touches anything.** Structural problems (a collection that isn't an array, a duplicate id, an unknown schema version) refuse the file with an explanation. Field-level problems (an impossible due date, an unknown thread type) are repaired and reported individually. No record is ever dropped silently, older files migrate forward automatically, and an import is undoable like anything else.

## Dates

Every calendar date comes from local time, never `toISOString()`. A review due today doesn't flip at UTC midnight, streaks don't shift for anyone west of Greenwich, and date arithmetic survives daylight saving. There are tests for each of those.

## Keyboard

`t` Today · `r` Threads · `q` Questions · `p` Pipelines · `w` Weekly review · `/` Search · `a` add a task · `x` tick the focused task · `j`/`k` move between tasks · `e` export · `⌘Z`/`Ctrl+Z` undo · `?` the full list

In the reader, `←`/`→` turn the page.

## Running it yourself

ES modules need a real origin, so serve the directory rather than opening `index.html` from disk:

```bash
git clone https://github.com/Hussain2111/Cairn.git
cd Cairn
npm start          # http://127.0.0.1:4321
```

Note that `127.0.0.1:4321` and the published site are different origins, so they hold **separate data**.

## Tests

```bash
npm install
npm test           # unit — no browser needed
npm run test:e2e   # Playwright
npm run test:all
```

**Unit tests** cover logic, not interface: stage unlocking including reordering and force-unlock, progress rollup, the spaced-repetition scheduler including resets and retirement, stall detection, pipeline needs-action rules, local-time date arithmetic and the Sunday week boundary, planned-versus-logged time blocks and the activity model, gym coverage, gaps, equipment preference and pain grouping, the logbook parser against every set notation it claims to read, GRE day shapes, gates, cold retrieval and the portable-move count, chess scoring and lesson clustering, reading positions and filename parsing, persistence with undo/quota/multi-tab conflicts, the outline parser against adversarial input, and the import validator against malformed files.

**End-to-end tests** cover the flows that matter: completing a stage unlocks the next and only the next; a failed attempt schedules correctly and appears in the queue on the right day; export then import round-trips exactly; a gym session records what was done and lights up only the muscles it trained; a GRE entry cannot be saved without its portable move, and the retrieval queue stays cold until a result is recorded; a chess game cannot be logged without its lesson line; a PDF imports, opens at the last page, and keeps its bookmarks across a reload. Plus the edge cases — a due task inside a locked stage staying out of "needs action", a dropped exercise leaving old sessions intact, a book whose file is missing, archiving instead of deleting, a full storage quota, a second tab writing, and the narrow-screen layout.

The reading tests use two PDF fixtures in `tests/e2e/fixtures`, generated by `npm run fixtures` — one that declares a title and author, and one that declares nothing, which is the case the importer actually has to handle.

The e2e suite downloads its own Chromium. If your machine already has one:

```bash
CHROMIUM_PATH=/path/to/chromium npm run test:e2e
```

## Stack and deployment

Vanilla HTML, CSS and JavaScript as ES modules. No framework, no build step, no runtime dependencies beyond one vendored library: [pdf.js](https://mozilla.github.io/pdf.js/) lives in `vendor/pdfjs` because the site blocks external hosts and a CDN is not an option. It is Apache-2.0, which is compatible with this project's MIT licence; `vendor/pdfjs/README.md` records the version, what was taken and why, and how to update it. It is loaded on demand, so opening Cairn without opening a book never downloads it.

A service worker caches the shell so it works offline once loaded.

Push to `main`; `.github/workflows/pages.yml` runs both suites and then publishes the repository root to GitHub Pages. Pages must be set to **Source: GitHub Actions** — with any other source the deploy job fails before running a step.

## Notes

Built for one person, deliberately. No multi-user, no sync, no sharing — adding them would cost the things that make it fast.

## Licence

MIT
