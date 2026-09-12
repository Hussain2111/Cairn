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

## The three ideas worth understanding

**Done-when is mandatory.** Every stage needs a written, checkable completion condition before you can work in it. Not "improve the parser" — "every token type has a passing test and the fuzzer runs clean for 10k inputs." It's what stops a stage expanding forever, and the app refuses to let you tick into a stage without one.

**Locked stages stay visible.** You can read the whole plan; you just can't work ahead. There's a manual force-unlock for when real life goes out of order, and a force-complete for when a stage is good enough — both are recorded as overrides so the weekly review can be honest about them.

**A thread is active or it is done.** There is no archive and no soft delete. Marking a thread done keeps its history and takes it off Today; deleting it deletes it, with undo as the only way back. Archiving was a way of keeping something around without deciding about it, and the deciding is the point.

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
| Pratt parsing, not recursive descent — the precedence table is the spec.
### Expressions
- Precedence climbing @2h https://craftinginterpreters.com/parsing-expressions.html
```

| Marker | Means |
| --- | --- |
| `# Name (type)` | Thread. Type is `project`, `study`, `pipeline`, `habit` or `reading`; defaults to `project`. |
| `## Title` | Stage. |
| `> text` | That stage's done-when. **Required.** Consecutive `>` lines join into one sentence. |
| `### Title` | Step. |
| `- Task` | Task. `-`, `*`, `+` or `1.` all work. |
| `\| note` | A note on whatever line is directly above it — thread, stage, step or task. Consecutive `\|` lines join into one. |
| `@45m` | Optional estimate. `@2h`, `@1h30m` and `@90` also parse. |
| `^2026-09-01` | Optional due date. |
| a URL | Lifted out of the title onto that record's links, labelled with its host. `[label](url)` keeps the label as the title. |

The dialog has a **Copy the prompt for a chat** button. The loop is: describe your project to a chat, paste its answer into Cairn, confirm.

The parser is deliberately strict, because the failure that matters isn't a rejected import — it's one that quietly created four of your six stages and you notice three weeks later:

- **Every line must classify.** An unrecognised line is a blocking error with its line number and the offending text. Nothing is skipped.
- **Counts are self-checked.** Markers found in the text must equal records produced, or the parser refuses rather than passing quietly.
- **A stage with no done-when blocks the import** and names itself. Chats omit it constantly, and such a stage would be unstartable anyway.
- **Duplicates are never created by accident.** A thread name you already have gets the new stages appended to it; stage titles that clash are listed before you commit.
- **Anything inferred is reported, one line per decision** — a step invented to hold loose tasks, a URL moved out of a title, a note bound to the line above it. Each names its line, and the extracted links and notes are shown in the preview so they can be read before they land. A tally ("3 links moved") would not let you check any of them.
- **A `|` line with nothing above it is an error**, like every other orphaned line. Notes and links do not create records, so they are outside the count self-check — but a `|` line is its own kind and is never counted as a task.

Nothing is written until you confirm, and the whole import is one undo.

## Everything else

**Question banks** — SQL, LeetCode, GRE. Each attempt records the date, whether you solved it unaided, minutes taken, and what you hesitated on. That last field is the one worth re-reading.

**Notes** — a text field on every thread, stage, step, task, book and gym session. There is no separate Notes tab: notes belong to the thing they are about, and a second place to write meant two places to look.

**Pipelines** — applications and outreach, with the resume version you sent, next actions, and a flag for anything that hasn't moved in a fortnight. Applications can be **imported from a spreadsheet** — see below.

**Time blocking** — plan the day, record what actually happened, see the weekly distribution. A block points at an *activity*: any thread, or one of the standing areas — the gym, practice problems, reading, applications — so a week adds up to a week rather than to the part that happened to be a project.

A plan and a record of what happened are two separate blocks with a status, not two time pairs on one. That is what they actually are: an intention written in the morning and an account written afterwards. A block that was never planned can still be logged, a plan that was abandoned stays visible as a plan, and one button turns a plan into the record of having done it. The form does not ask for a date — prev/next already answered that.

Weeks run **Sunday to Saturday**, everywhere and without exception — targets, streaks, the weekly review, the time distribution. It is one constant in `src/core/dates.js`; nothing else takes a week-start argument, so the figures cannot disagree with each other.

## The gym

Sessions, not check-marks — *that you went* is not the useful part.

The tab records what was lifted and what hurt. Everything that did not serve one of those was taken out — including, latterly, a per-exercise progression chart that looked useful and never got opened.

A session records the date, start and end, and the exercises: sets, reps, weight, and a free-text note per exercise. That note is where "good pump", "no tension in the target muscle" and "first two sets locking out at the top" go; it is deliberately not a dropdown, because the useful notes are sentences. A second note covers the session as a whole — the warm-up, what was skipped, why it was short. A sentence records all of that better than a set of fields did.

Entry is built for a phone between sets. Picking an exercise fills in the sets you did last time and **Repeat set** copies the row above, so most sessions are the last one with two numbers changed. A bodyweight movement records reps and leaves the weight empty.

**Logging an exercise is two steps**: pick the muscle group, then the exercise. The second list is only that group's, with the ones you have actually logged first and most-recent-first within them — the exercise you are adding is nearly always one you added last week. There is a "+ New" option at the bottom that asks for a name and nothing else, because the group was answered one step ago.

**A warm-up is its own section**, separate from the exercise list: which movements, and for how long. It draws from its own library of mobility and activation drills, which is where cat-cow belongs — it was under "core" before, which made that group a mix of things to train and things to do first.

Times are hour-and-minute. Seconds are neither offered by the picker nor stored.

### The exercise library

Exercises are things you maintain, not free text typed per session. Each carries a name, a status, and **what it trains at two levels**: a broad group for display, and the specific muscle underneath it.

| Group | Muscles |
| --- | --- |
| Chest | upper chest, mid chest, lower chest |
| Back | lats, traps, rhomboids, lower back |
| Shoulders | front delts, side delts, rear delts |
| Arms | biceps, triceps, forearms |
| Legs | quads, hamstrings, glutes, calves, adductors |
| Core | abs, obliques |

"Back" is true of a lat pulldown, a shrug and a good morning, and being true of all three is exactly what made it useless for deciding what to do today.

**The specific muscle can be left unset**, and that is a real state rather than a defect: it means nothing has guessed. The library lists those at the top and keeps asking, because an exercise with no specific muscle is missing from the body diagram entirely.

### The body diagram

Two figures, front and back, with every specific muscle as a selectable region. Selecting a region picks that muscle; picking from the list highlights the region. They are two views of one selection, not a picture beside a form.

The figures are built from rectangles and ellipses rather than traced anatomy. That is a decision, not a shortcut: this has to show *which region is selected*, not teach anatomy. Accurate paths would be a large hand-authoring job, would carry a licensing question if taken from anywhere, and would be harder to keep legible at thumbnail size in two themes.

A muscle appears on the figure where you can actually see it — lats and glutes on the back, chest and quads on the front — and is **absent** from the other rather than drawn greyed. The two figures together cover the body once. Every region is focusable and activates on Enter or Space; selecting one does not rebuild the SVG, so the focus ring stays where it was.

**Dropping never rewrites history.** The exercise leaves the picker and stays in every session that used it, with its sets exactly as they were. Deleting one that has been used is refused and offered as a drop instead. Renaming propagates, because a rename is a correction — which is the point of sessions storing the id rather than the name.

### The views

- **This week against target** — done, target, still to do, days left, and a strip of the days you trained on.
- **Pain** — below.
- **History** — every session, reopenable.

### Pain

A structured record, not a note. The only question worth asking of it — *does this recur across different exercises, or is it isolated to one?* — cannot be answered by reading paragraphs. One is about the body, the other is about the movement, and they lead to opposite actions.

So pain records a location, the exercise, whether it happened during or after, and the date. It is logged from inside the session, at the point it happens. The view groups by location, lists every exercise and date attached to each one, and says explicitly when a location has hurt on two or more distinct exercises. Exportable on its own as a dated CSV or markdown table.

## Getting applications in without retyping them

**Pipelines → Import spreadsheet.** A CSV or an XLSX becomes applications, with the same contract the outline importer has: everything is shown before anything is written.

**Your headers are yours.** "Company Name", "Position", "Where I found it" — Cairn reads the header row, proposes a mapping, and marks the loose matches as *guessed*. Every field has a dropdown pointing at whichever column you say, and the preview updates as you change them. Company and role are required, because they are what identifies an application; the import stays disabled until both are pointed at something.

**Nothing is dropped in silence.** A row with the wrong number of cells is kept and reported by line number. A row with neither a company nor a role is listed with its contents, so you can see what it was. Every repair is named: a status Cairn does not have becomes "applied" *and* the original wording goes into the notes; an unrecognised source becomes "other" the same way.

**An ambiguous date is refused rather than guessed.** `03/04/2026` is the third of April in most of the world and the fourth of March in the United States. Cairn will not pick one — it reports the row and tells you to format that column as `YYYY-MM-DD`. `25/12/2026` is read, because 25 cannot be a month. In an XLSX, dates are read from the cell's *number format* rather than by looking at the number: a date in a spreadsheet is a count of days since 1899-12-30 that happens to render as a date, and guessing would silently turn one into another.

**Duplicates are detected, against the app and against the file.** Same company and role, or same link. Matching rows are shown as "already here" and left out, so importing the same sheet twice does not double your pipeline.

Nothing is written until you press Import, and the whole import is one undo.

**There is no Google Sheets button**, and the dialog says why rather than leaving you to wonder: connecting to Sheets needs a server to hold OAuth credentials, and Cairn has no server. Fetching a published sheet cross-origin is fragile enough that it would break without warning. Sheets exports to CSV in two clicks, which this reads.

## Questions, and what you take from them

Three banks — SQL, LeetCode, GRE — one scheduler, one place. There was a separate GRE tab that scheduled study days as well as logging problems; GregMat's plans already schedule the days, so the programme went and only the logging is left. Logging questions in two places was one place too many.

### The extraction

Every question, on every bank, carries four fields:

1. What it gave and what it asked, in your own words, one line
2. What you did
3. Where it broke — or, if you got it right, what the faster route was
4. **The portable move**, roughly six words

The fourth is the point, and it is the only one with a rule attached: **once you have started an extraction, you cannot save it without one.** It has to be about problems in general, not about that one — the form says so, with a good example and a bad one. If you cannot write it, the extraction has not happened.

Started, rather than always: a question can be added before it has been attempted, and an empty extraction on an unattempted question is the honest state. What is refused is the half-done one — three fields describing a mistake and no rule taken from it.

It is offered the moment it can actually be written, which is straight after a miss. Offered, not imposed: the toast that reports the miss carries an **Extract** button. A dialog that opens itself on every wrong answer stops being a prompt and becomes a toll.

The move then reads on the question's own row, and on the review card when the question comes back — so what you take from a question is in front of you the next time you meet it.

Correct answers are logged too. A right answer reached the slow way is a miss you did not notice.

## Reading

A list. Cairn does not open books.

Each one is a title, an author and a status — **reading**, **want to read**, **finished** — plus three optional fields: the page you are on, a rating out of five once you have finished, and notes.

There used to be a PDF importer and a reader here: covers rendered from the first page, bookmarks, a page-turning interface, the file bytes in IndexedDB and a vendored PDF engine to drive it. It went, because reading does not happen on a laptop. What it cost while it existed — an export that could not contain your library, books showing as "no file on this device" after restoring a backup on another machine, a storage budget to explain — all of that went with it.

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

Everything lives in `localStorage` under `cairn.state`, in this browser, on this device — or, if you run the [desktop app](#running-it-as-a-desktop-app), in that app's own data directory. No account, no server, no telemetry. Nothing is ever sent anywhere — which also means **sharing the app's URL shares the app, not your data**; anyone who opens it gets an empty Cairn.

**It does not sync.** Your laptop and your phone are independent copies. To move between them: Settings → **Export JSON**, get the file across, Settings → **Import**. Use *Import and merge* if you've added things on both sides — it keeps both and skips records it already has.

**Export periodically.** Clearing site data deletes everything. Safari also evicts `localStorage` after about a week of not visiting the site.

Capacity is not a practical concern: twelve heavy threads with ~1,700 tasks, 300 questions with 1,200 attempts, hundreds of applications and two years of gym sessions comes to about 1.2 MB — roughly a quarter of a typical 5 MB budget. Settings shows the live figure, warns at 80%, and if a write is ever refused your change stays on screen with a prompt to export rather than being lost.

**Import validates before it touches anything.** Structural problems (a collection that isn't an array, a duplicate id, an unknown schema version) refuse the file with an explanation. Field-level problems (an impossible due date, an unknown thread type) are repaired and reported individually. No record is ever dropped silently, older files migrate forward automatically, and an import is undoable like anything else.

## Dates

Every calendar date comes from local time, never `toISOString()`. A review due today doesn't flip at UTC midnight, streaks don't shift for anyone west of Greenwich, and date arithmetic survives daylight saving. There are tests for each of those.

## Keyboard

`⌘Z`/`Ctrl+Z` undo · `⇧⌘Z`/`Ctrl+Y` redo.

That is the whole list. There was a set of single-key navigation shortcuts and a `?` cheat sheet to remember them by; they went, because a shortcut you have to look up is slower than the link it replaces. Undo stayed: it is not a shortcut for something on screen, it is the only way to reverse a destructive action.

## Running it yourself

ES modules need a real origin, so serve the directory rather than opening `index.html` from disk:

```bash
git clone https://github.com/Hussain2111/Cairn.git
cd Cairn
npm start          # http://127.0.0.1:4321
```

Note that `127.0.0.1:4321` and the published site are different origins, so they hold **separate data**.

## Running it as a desktop app

Same app, its own window, its own icon in the dock. No tab, no address bar, and nothing that disappears when you close the browser.

```bash
npm install
npm run desktop          # run it from source
```

To build an installer:

```bash
npm run desktop:dist     # .dmg on macOS, .exe on Windows, .AppImage on Linux -> dist/
npm run desktop:pack     # unpacked build, faster, for checking a change
```

Each platform builds its own installer only — run it on the machine you want the app on. Nothing is code-signed, so the first launch wants the usual right-click → Open on macOS, or **More info → Run anyway** on Windows.

**Getting your existing data in.** The desktop app is a different origin from the website, so it opens empty — the same way your laptop and your phone are independent copies. In the browser: Settings → **Export JSON**. In the desktop app: Settings → **Import**. After that the two are separate stores; pick one and stay there, or move files across the way you would between devices.

Where the desktop copy lives:

| Platform | Directory |
| --- | --- |
| macOS | `~/Library/Application Support/Cairn` |
| Windows | `%APPDATA%\Cairn` |
| Linux | `~/.config/Cairn` |

Export is still the backup. That directory is not one to hand-edit.

### What the shell does

The app itself is unchanged — the desktop build serves the same files that GitHub Pages does. The shell is `desktop/main.js`, and its decisions are worth knowing:

**Files are served over a `cairn://` scheme, not `file://`.** `file://` has an opaque origin, which means no `localStorage` — and `localStorage` is the entire database. A registered standard scheme gives a stable origin, `cairn://app`, that does not change across app updates, reinstalls or install paths, so yesterday's data is still there tomorrow. It keeps ES modules working too, which `file://` does not.

**One window.** Two windows over one store would trip the app's own *another tab has changed this data* banner — which exists for browser tabs a shell cannot control, and here simply need not happen. Launching Cairn again focuses the window you already have.

**Links leave.** A reading link, a job posting on a pipeline record, a docs page on a task — anything that is not the app opens in your real browser rather than trapping you in a window with no address bar.

**The window remembers where it was,** and refuses to reopen off-screen after a monitor is unplugged.

**The Edit menu has no Undo item, on purpose.** `⌘Z` is Cairn's undo: the only way back from a deleted thread, not just a typo. A menu accelerator is consumed by the menu before the page ever sees the key, so claiming `⌘Z` there would quietly downgrade app undo to text-field undo. Leaving it off keeps the desktop app behaving exactly like the browser one.

The renderer gets no preload script and no Node access; it is the same untrusted web app it is on Pages. `scripts/assets.mjs` holds the path resolution the dev server and the shell share, traversal guard included, and it is unit-tested.

The app icon is generated from the same shapes as `favicon.svg` by `npm run desktop:icon` — the repo has no image dependency, and four rounded rectangles and a circle did not seem worth adding one for.

## Tests

```bash
npm install
npm test           # unit — no browser needed
npm run test:e2e   # Playwright
npm run test:all
```

**Unit tests** cover logic, not interface: stage unlocking including reordering and which stages a move locks or unlocks, progress rollup, the spaced-repetition scheduler including resets and retirement, pipeline needs-action rules, local-time date arithmetic and the Sunday week boundary, planned-versus-logged time blocks and the activity model, gym weeks, session totals, the two-level muscle taxonomy, the group-narrowed exercise picker and pain grouping, every schema migration including each field folded into a note rather than dropped, the CSV reader against quoted newlines and ragged rows, the XLSX reader against a real ZIP including date-formatted cells, header mapping and duplicate detection, persistence with undo/quota/multi-tab conflicts, the outline parser against adversarial input, and the import validator against malformed files.

**End-to-end tests** cover the flows that matter: completing a stage unlocks the next and only the next; ticking a task below the fold leaves the page where it was, while navigating still starts at the top; moving a stage names the stages it locked; a failed attempt schedules correctly and appears in the queue on the right day; an extraction cannot be half-written; export then import round-trips exactly; a gym session records what was done and the week counts it against the target; the exercise picker narrows by group and offers what was logged most recently; the body diagram and the muscle list stay in step and both work from the keyboard; a spreadsheet of applications is mapped, corrected, previewed and imported, with duplicates left out. Plus the edge cases — a due task inside a locked stage staying out of "needs action", a dropped exercise leaving old sessions intact, a completed task reading as done rather than overdue, a file that is not really a spreadsheet, a full storage quota, a second tab writing, and the narrow-screen layout.

The e2e suite downloads its own Chromium. If your machine already has one:

```bash
CHROMIUM_PATH=/path/to/chromium npm run test:e2e
```

## Stack and deployment

Vanilla HTML, CSS and JavaScript as ES modules. No framework, no build step, no runtime dependencies beyond one vendored library: [fflate](https://github.com/101arrowz/fflate) lives in `vendor/fflate` because an `.xlsx` file is a ZIP archive and DEFLATE is not something to hand-roll. It is MIT, compatible with this project's licence, and `vendor/fflate/README.md` records the version, what was taken and why. It is loaded only when a spreadsheet is imported.

A service worker caches the shell so it works offline once loaded. The desktop build wraps those same files in [Electron](https://www.electronjs.org/) — about two hundred lines in `desktop/`, packaged by `electron-builder`. It registers no service worker, because every asset is already local.

Push to `main`; `.github/workflows/pages.yml` runs both suites and then publishes the repository root to GitHub Pages. Pages must be set to **Source: GitHub Actions** — with any other source the deploy job fails before running a step.

## Scope

Built for one person, deliberately. No multi-user, no sync, no sharing — adding them would cost the things that make it fast.

## Licence

MIT
