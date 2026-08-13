# Cairn — a personal roadmap tool that hides the plan

**Repo:** github.com/Hussain2111/Cairn · **Live:** hussain2111.github.io/Cairn
**Stack:** vanilla JS (ES modules), no framework, no build step, `localStorage`, GitHub Pages
**Scale:** ~10,300 lines of source, ~5,300 lines of test, 265 unit tests + 86 end-to-end, 8 schema versions

---

## The problem

Executive-function support, built for one user. You look at something large, register how large it is, and do something else — not because the work is hard, but because nothing in front of you is small enough to start. Most task managers make that worse: they show everything at once and leave the decomposition to you at exactly the moment you're least able to do it.

Cairn takes the decomposition up front, when you're thinking clearly, then hides almost all of it. A thread splits into stages, stages into steps, steps into tasks. **Only tasks are checkable.** Stages stay locked until the one before them completes — visible, so the whole map is readable, but not workable. The home screen shows one line per thread: the next unblocked task, and nothing else.

This is the constraint the entire codebase is organised around, and most of the interesting decisions come from defending it.

## Architecture

Two layers with a hard rule between them: **`src/core/` never touches the DOM, `src/app/` never contains logic.** Every rule worth testing lives in core and is tested in Node with no browser.

```
src/core/   4,600 LOC   threads, dates, srs, timeblocks, gym, pipelines,
                        outline (parser), schema, migrations, validate,
                        csv + xlsx (readers), app-import
src/app/    1,150 LOC   store (persistence, undo, multi-tab), ui (elements,
                        dialogs, toasts), main (routing, render, banners)
src/app/views 4,600 LOC one module per screen, all pure render functions
styles/     2,200 LOC   three files: tokens, base, components
```

Rendering is deliberately primitive: a view exports `render(ctx)` returning a DOM node, and any state change rebuilds the whole view. No virtual DOM, no reactivity, no framework. That is a real trade-off and it cost me twice — see below.

## The decisions worth talking about

### 1. Unlock state is derived, never stored

The obvious design stores `locked: true` on each stage. I store two override flags (`forceUnlocked`, `forceCompleted`) and recompute everything else — completion, locking, progress — on every read from the tasks themselves.

The payoff is that **reordering stages is free and cannot corrupt anything.** Move a stage and its status recomputes from its new position; there is no cached flag left behind to contradict the tree later. With stored state, reordering means invalidating a graph of dependent flags, which is the kind of thing that works for six months and then silently unlocks someone's whole plan.

The subtlety: unlocking checks *only the immediate predecessor*, not "all preceding stages." That's what stops force-unlock double-counting — if stage 2 is force-unlocked and finished while stage 1 is still open, stage 3 unlocks on stage 2's own completion, and nothing changes when stage 1 later completes.

There's a related invariant that took a bug to find: a stage with no tasks is never automatically complete. Otherwise a row of empty placeholder stages unlocks the entire thread at once — precisely the failure the tool exists to prevent.

### 2. A versioned schema with a migration chain, and a rule about deletion

Persisted state carries `schemaVersion`; loading or importing runs it forward through a chain of pure `v(n) → v(n+1)` functions, each returning both the new state and **a human-readable list of what it changed**, which surfaces in the import report.

Eight versions so far, and the rule I imposed on myself is the interesting part: **when a field is removed, the data in it must go somewhere or be reported by name.** Concretely —

- Removing the generic habit model turned each non-gym habit into a note carrying its full log of dates, rather than deleting a year of records.
- Removing gym equipment/cues/drop-reasons gathered them into one archive note.
- Removing session-level fields (warm-up, slot, skipped exercises) folded each into that session's free-text note, where the same information would be written today.
- Removing the standalone Notes feature folded attached notes into the thread/stage/step/task they belonged to; standalone ones had nowhere to go, so the migration **reproduces their full text in the import report** rather than dropping a count.

This produced a genuinely awkward moment worth being honest about: a v4 file migrating to v8 creates archive notes in one step and removes the notes collection in a later one. Migrations are pure steps and must not rewrite history, so I let it happen and made the later step print the text it was destroying. Ugly, but louder than a silent deletion.

### 3. The import validator's contract

Import either succeeds with state you can trust, or fails with an explanation. It never half-loads.

- **Structural problems are fatal**: a collection that isn't an array, a duplicate id, an unknown schema version. The file is refused and nothing is touched.
- **Field-level problems are repaired and reported individually**: an impossible due date is cleared, an unknown thread type falls back, a numeric title is coerced.
- **No record is ever dropped silently.** A gym session referencing a deleted exercise keeps its sets and renders as "Removed exercise." A pain record with no location is filed as "unspecified" rather than discarded.

783 lines of validator for a single-user app is disproportionate on paper. It's the reason I trust the export as a backup format, which is the only backup that exists.

### 4. A deliberately strict parser, and why

`Threads → Import outline` accepts a plain-text plan (drafted anywhere, including by a chat) and turns it into threads, stages, steps and tasks. 433 lines, hand-written, no parser library.

It is strict on purpose. The failure that matters isn't a rejected import — it's one that quietly creates four of your six stages and you notice three weeks later. So: every line must classify or the import is blocked with the line number and offending text; **marker counts are self-checked against records produced**, and a mismatch refuses rather than passing quietly; a stage with no done-when blocks the import and names itself; and everything inferred (an invented step, a URL lifted out of a title) is reported in the preview before you commit.

### 5. Ambiguity is refused, not guessed

The spreadsheet importer reads CSV and XLSX into job applications. Two decisions I'd defend anywhere:

`03/04/2026` is the 3rd of April in most of the world and the 4th of March in the US. Cairn **refuses it**, reports the row, and tells you to reformat the column. `25/12/2026` is read, because 25 can't be a month. A silently wrong application date is worse than a reported one.

In XLSX, a date isn't text — it's a count of days since 1899-12-30 that *renders* as a date because of the format applied to it. So I read `xl/styles.xml`, resolve each cell's number format, and treat a cell as a date only when the format says so. Looking at the number and guessing would turn a headcount of 46238 into August 2026.

(Excel's epoch is 1899-12-30, not 1900-01-01, because the format deliberately reproduces a Lotus 1-2-3 bug that treated 1900 as a leap year. There's a test asserting that.)

### 6. Local time, everywhere, without exception

Every calendar date comes from local-time construction, never `toISOString()`. A review due today doesn't flip at UTC midnight; streaks don't shift for anyone west of Greenwich; arithmetic survives daylight saving. Weeks run Sunday–Saturday from **one constant** — nothing takes a week-start argument, so no two figures in the app can disagree about what week it is.

## Two bugs that taught me something

**Rebuilding the view on every change destroys scroll position.** Ticking a task below the fold threw the page to the top, which made long threads unusable. The tempting fix — patch the checkbox in place — means duplicating every derived counter the tick affects (step count, stage meter, thread progress, up-next, and stage unlocking), five places to drift out of sync. Instead I made scrolling-to-top conditional on *arriving at a different view*; a re-render of the view you're on restores position and focus. That fixed the whole class — add, edit, delete — rather than one button.

**Then the focus restoration ticked a task nobody asked to tick.** I restored focus by the control's index within its row. Ticking a task adds a button to that row, so the index now pointed at a checkbox — and the keystroke still in flight activated it. Index is exactly what a re-render changes. Restoring by the control's accessible name fixed it, and controls with no stable name are simply not restored: losing a focus ring is cheap, pressing the wrong button is not.

## Testing

265 unit tests covering logic only — stage unlocking including reorder and force-unlock, the spaced-repetition scheduler including resets and retirement, local-time arithmetic, every schema migration including each folded field, both spreadsheet readers, the outline parser against adversarial input, the validator against malformed files.

86 Playwright tests covering flows: completing a stage unlocks the next *and only the next*; ticking below the fold doesn't scroll; a failed attempt reschedules to the right day; export/import round-trips exactly; a spreadsheet is mapped, corrected, previewed and imported with duplicates excluded. Plus the edge cases — full storage quota, a second tab writing, unreadable stored data, the narrow-screen layout.

CI runs both suites and only then publishes to Pages.

## Constraints I accepted

No backend, so no sync: laptop and phone are independent copies moved by JSON export/import, with a merge mode that keeps both sides. No accounts, no telemetry, nothing leaves the browser. `localStorage` caps at ~5MB, which is fine for records (a heavy year is ~1.2MB) and was *not* fine for the PDF reader I built and later removed.

## What I'd change

The whole-view re-render is the weakest thing here. It's why the scroll bug existed at all, and at some point a thread gets large enough that rebuilding it per keystroke is felt. I'd keep the derived-state model — that part earned itself — and put a minimal keyed diff underneath the render, rather than reach for a framework.

I'd also stop building features I don't use. Across the last three sessions I deleted a chess log, a PDF reader with a vendored engine and IndexedDB store, a GRE scheduling programme, a standalone notes system with templates, a search index, and a keyboard-shortcut layer — roughly a third of the app. Each deletion needed a migration to avoid losing data. The lesson isn't "delete more", it's that the cost of a feature is paid twice, and the second payment is larger.
