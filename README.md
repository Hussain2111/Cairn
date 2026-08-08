# Cairn

**A personal roadmap tool. Break every thread into stages that unlock in sequence, and always see the next small thing.**

[Live app](https://hussain2111.github.io/Cairn/) · [Report an issue](../../issues)

---

## Why

Large tasks get avoided when the next concrete step isn't visible. You look at a project, register how big it is, and do something else — not because it's hard, but because nothing in front of you is small enough to start.

Most task managers make this worse. They show you everything at once and leave the decomposition to you, at exactly the moment you're least willing to do it.

Cairn inverts that. You break a thread into stages before you begin, each stage into steps, each step into tasks. Only tasks are checkable. Stages stay locked until the one before them is finished, so the map is always visible but only one part of it is ever live. The home screen shows one thing per thread: the next unblocked task, and nothing else.

The second idea is that practice without repetition doesn't stick. Anything you learn once and never retrieve is gone. So the question banks aren't checklists — they're a scheduler that decides when you see a question again, and keeps deciding until you can answer it cold.

## Concepts

**Threads** are the areas of your life — a software project, exam prep, a job hunt, a habit. Each thread is a tree.

**Stages → Steps → Tasks.** Three levels. Tasks are the only thing you tick; steps and stages complete themselves when their children do.

**Sequential unlocking.** A stage is locked until its predecessor completes. Locked stages stay visible and greyed — you can see where you're going, you just can't work there yet. A manual override exists for when reality doesn't cooperate.

**Done-when.** Every stage requires a written completion condition before it can be started. It's the thing that stops a stage expanding indefinitely, and it's mandatory by design.

Completion and unlocking are *derived* on every read, never stored. That is what makes reordering safe: move a stage and its state recomputes from its new position, with nothing stale left behind.

## Features

**Today** — the next unblocked task in every thread, the questions due for review, anything in a pipeline needing action, today's time blocks, and habits not yet logged. When a thread has nothing startable, the line says why — no done-when written, no tasks in the open stage, everything ahead locked — rather than going blank.

**Threads** — the tree view, with progress rolled up from tasks through steps to stages. Links and notes attach at any level.

**Import outline** — paste a plan drafted anywhere (including a chat) and it becomes threads, stages, steps and tasks. See below.

**Question banks** — SQL, LeetCode and GRE, with spaced repetition on a 0 / 2 / 7 / 21-day schedule. A failed or aided attempt resets the interval chain; a question retires only when solved unaided at the final interval. Every attempt records what you hesitated on, which over time is more useful than the score.

**Notes** — markdown pages, attachable to anything, with templates for daily logs, stage retrospectives, question write-ups, application records and weekly reviews. You can write your own templates too.

**Pipelines** — job applications and outreach, tracked with next actions, and a flag for anything that hasn't moved in a fortnight.

**Time blocking** — plan the day against threads, record what actually happened, and see the weekly distribution of hours. Planned versus actual is usually the surprising part.

**Weekly review** — generated from your own data rather than memory, and exportable as markdown.

**Stall detection** — any thread with no completed task in fourteen days is surfaced. Threads die quietly otherwise.

**Search** — across tasks, stages, notes, questions, applications, outreach and reading, including what you hesitated on.

## Scheduling rules, in full

The scheduler is the part it's worth being precise about.

- Intervals are day offsets: **0, 2, 7, 21** by default, configurable in Settings.
- A new question is due the day you add it.
- An **unaided** attempt advances one step along the chain.
- A **failed or aided** attempt resets to the start. Since the first interval is zero days, a reset question is due again the same day — that is intended, not an off-by-one.
- **Hesitation** does not reset the chain, but it does block retirement. At the final interval, an unaided-but-hesitant solve re-schedules at that same final interval instead of retiring.
- A question **retires** when it is solved unaided, with no hesitation recorded, at the final interval.

The attempt dialog states what the scheduler will do *before* you commit to it.

## Importing an outline

Typing a whole project in a dialog at a time is the fastest way to not use this tool. **Threads → Import outline** takes a plain-text plan instead:

```
# Compiler project (project)

## Lexer
> every token type has a passing test and the fuzzer runs clean for 10k inputs
### Numbers
- Integer literals @45m
- Float literals ^2026-09-01
### Strings
- Escapes

## Parser
> the grammar round-trips every fixture in tests/fixtures
### Expressions
- Precedence climbing @2h
```

`#` thread (type in brackets, defaults to project) · `##` stage · `>` its done-when · `###` step · `-` task, with `@45m` for an estimate and `^YYYY-MM-DD` for a due date. Bullets can be `-`, `*`, `+` or numbered, and a code fence wrapped around the whole paste is ignored.

The dialog has a **Copy the prompt for a chat** button, so the loop is: describe the project to a chat, paste the answer in, confirm.

The parser is deliberately strict, because the failure that matters is not a rejected import — it is an import that quietly created four of your six stages:

- **Every line must classify.** An unrecognised line is a blocking error carrying its line number and the offending text. Nothing is skipped.
- **Counts are self-checked.** Markers found in the text must equal records produced; a mismatch refuses the import rather than passing quietly.
- **Done-when is mandatory.** A stage without one blocks the import and names itself. A chat will omit it constantly, and such a stage would be unstartable anyway.
- **Duplicates are surfaced, never created by accident.** A thread name you already have appends its stages to that thread instead of making a second one; stage titles that already exist there are called out before you commit.
- **Anything inferred is reported.** Tasks written directly under a stage get a step called "Tasks" — allowed, but shown as a warning in the preview.

Nothing is written until you confirm, and the whole import is a single undoable step.

## Dates

Every calendar date in Cairn comes from local time, never `toISOString()`. A review due today does not flip at UTC midnight, streaks don't shift for anyone west of Greenwich, and date arithmetic survives daylight-saving transitions. There are tests for each of those.

## Stack

Vanilla HTML, CSS and JavaScript as ES modules. No framework, no build step, no dependencies at runtime. The whole app is static files, which keeps deployment to GitHub Pages trivial, and a service worker caches the shell so it keeps working with no network.

State lives in `localStorage` with a versioned schema and a migration path. There is no account, no server and no telemetry — the data never leaves the browser. Export and import are first-class so you own your data as a file.

## Getting started

ES modules need a real origin, so serve the directory rather than opening `index.html` from the filesystem:

```bash
git clone https://github.com/hussain2111/Cairn.git
cd Cairn
npm start          # http://127.0.0.1:4321
```

`npm start` runs a small dependency-free static server (`scripts/serve.mjs`); `npx serve .` or any other static server works just as well.

## Testing

```bash
npm install
npm test           # unit tests — no browser needed
npm run test:e2e   # Playwright end-to-end
npm run test:all   # both
```

**Unit tests** cover the logic rather than the interface: stage unlocking including reordering and force-unlock, progress rollup from tasks upward, the spaced-repetition scheduler including resets, hesitation and retirement, stall detection, weekly streaks and consistency, pipeline needs-action rules, local-time date arithmetic, persistence with undo/quota/multi-tab conflicts, the outline parser against malformed and adversarial input, and the import validator.

**End-to-end tests** cover the flows that matter: completing a stage unlocks the next and only the next; a failed attempt schedules correctly and appears in the review queue on the right day; export then import round-trips state exactly. Plus the edge cases — a due task inside a locked stage staying out of "needs action", archiving instead of deleting completed work, force-completion being recorded, a full storage quota, a second tab writing, and the narrow-screen layout.

The e2e suite downloads Chromium on first run. If your machine already has one, point at it:

```bash
CHROMIUM_PATH=/path/to/chromium npm run test:e2e
```

## Deployment

Push to `main`. `.github/workflows/pages.yml` runs both test suites and then publishes the repository root to GitHub Pages — no build, no bundler. Enable Pages with **Source: GitHub Actions** in the repository settings once, and that's the whole pipeline.

## Data

Everything is in `localStorage` under `cairn.state`, carrying a `schemaVersion`.

**Export** writes a JSON backup. **Import** validates before it touches anything: structural problems (a collection that isn't an array, a duplicate id, an unknown schema version) refuse the import outright with an explanation, while field-level problems (an impossible due date, an unknown thread type, a title that isn't a string) are repaired and reported. No record is ever dropped silently, and an import is undoable like anything else.

Older files migrate forward automatically, and the report tells you what the migration changed.

Clearing your browser's site data will delete everything. Export periodically — Cairn warns you before storage fills up, and again if a write is ever refused.

## Keyboard

`t` Today · `r` Threads · `q` Questions · `p` Pipelines · `w` Weekly review · `/` Search · `a` add a task · `x` tick the focused task · `j`/`k` move between tasks · `e` export · `⌘Z`/`Ctrl+Z` undo · `?` the full list.

## Status

- [x] Data model, persistence, schema versioning, export and import
- [x] Threads, stages, steps, tasks, unlocking, tree view
- [x] Today
- [x] Question banks and the scheduler
- [x] Notes and templates
- [x] Application and outreach pipelines
- [x] Time blocking
- [x] Weekly review, stall detection, search
- [x] Habits and reading

## Notes

Built for one person, on purpose. There's no multi-user support, no sync and no sharing, and adding them would compromise the things that make it fast to use.

## License

MIT
