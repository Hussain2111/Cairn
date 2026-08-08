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

**Morning: open Today.** Everything that wants you is on one screen — the next task in each thread, questions due for review, pipeline items that have gone quiet, your time blocks, habits you haven't logged. Pick one thing from "Up next" and start.

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

**Time blocking** — plan the day against threads, record what actually happened, see the weekly distribution. Planned versus actual is usually the surprising part.

**Habits and reading** — weekly targets and a consistency history; title, position, status. No points, no levels, no streak trophies.

**Search** — across everything, including what you hesitated on.

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

Everything lives in `localStorage` under `cairn.state`, in this browser, on this device. No account, no server, no telemetry. Nothing is ever sent anywhere — which also means **sharing the app's URL shares the app, not your data**; anyone who opens it gets an empty Cairn.

**It does not sync.** Your laptop and your phone are independent copies. To move between them: Settings → **Export JSON**, get the file across, Settings → **Import**. Use *Import and merge* if you've added things on both sides — it keeps both and skips records it already has.

**Export periodically.** Clearing site data deletes everything. Safari also evicts `localStorage` after about a week of not visiting the site.

Capacity is not a practical concern: twelve heavy threads with ~1,700 tasks, 300 questions with 1,200 attempts, hundreds of notes and applications and two years of habit logs comes to about 1.2 MB — roughly a quarter of a typical 5 MB budget. Settings shows the live figure, warns at 80%, and if a write is ever refused your change stays on screen with a prompt to export rather than being lost.

**Import validates before it touches anything.** Structural problems (a collection that isn't an array, a duplicate id, an unknown schema version) refuse the file with an explanation. Field-level problems (an impossible due date, an unknown thread type) are repaired and reported individually. No record is ever dropped silently, older files migrate forward automatically, and an import is undoable like anything else.

## Dates

Every calendar date comes from local time, never `toISOString()`. A review due today doesn't flip at UTC midnight, streaks don't shift for anyone west of Greenwich, and date arithmetic survives daylight saving. There are tests for each of those.

## Keyboard

`t` Today · `r` Threads · `q` Questions · `p` Pipelines · `w` Weekly review · `/` Search · `a` add a task · `x` tick the focused task · `j`/`k` move between tasks · `e` export · `⌘Z`/`Ctrl+Z` undo · `?` the full list

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

**Unit tests** cover logic, not interface: stage unlocking including reordering and force-unlock, progress rollup, the spaced-repetition scheduler including resets and retirement, stall detection, weekly streaks, pipeline needs-action rules, local-time date arithmetic, persistence with undo/quota/multi-tab conflicts, the outline parser against adversarial input, and the import validator against malformed files.

**End-to-end tests** cover the flows that matter: completing a stage unlocks the next and only the next; a failed attempt schedules correctly and appears in the queue on the right day; export then import round-trips exactly. Plus the edge cases — a due task inside a locked stage staying out of "needs action", archiving instead of deleting completed work, force-completion being recorded, a full storage quota, a second tab writing, and the narrow-screen layout.

The e2e suite downloads its own Chromium. If your machine already has one:

```bash
CHROMIUM_PATH=/path/to/chromium npm run test:e2e
```

## Stack and deployment

Vanilla HTML, CSS and JavaScript as ES modules. No framework, no build step, no runtime dependencies. A service worker caches the shell so it works offline once loaded.

Push to `main`; `.github/workflows/pages.yml` runs both suites and then publishes the repository root to GitHub Pages. Pages must be set to **Source: GitHub Actions** — with any other source the deploy job fails before running a step.

## Notes

Built for one person, deliberately. No multi-user, no sync, no sharing — adding them would cost the things that make it fast.

## Licence

MIT
