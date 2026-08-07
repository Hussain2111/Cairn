# Cairn
**A personal roadmap tool. Break every thread into stages that unlock in sequence, and always see the next small thing.**

[Live app](https://Hussain2111.github.io/cairn/) · [Report an issue](../../issues)

---

## Why

Large tasks get avoided when the next concrete step isn't visible. You look at a project, register how big it is, and do something else — not because it's hard, but because nothing in front of you is small enough to start.

Most task managers make this worse. They show you everything at once and leave the decomposition to you, at exactly the moment you're least willing to do it.

**Next** inverts that. You break a thread into stages before you begin, each stage into steps, each step into tasks. Only tasks are checkable. Stages stay locked until the one before them is finished, so the map is always visible but only one part of it is ever live. The home screen shows one thing per thread: the next unblocked task, and nothing else.

The second idea is that practice without repetition doesn't stick. Anything you learn once and never retrieve is gone. So the question banks aren't checklists — they're a scheduler that decides when you see a question again, and keeps deciding until you can answer it cold.

## Concepts

**Threads** are the areas of your life — a software project, exam prep, a job hunt, a habit. Each thread is a tree.

**Stages → Steps → Tasks.** Three levels. Tasks are the only thing you tick; steps and stages complete themselves when their children do.

**Sequential unlocking.** A stage is locked until its predecessor completes. Locked stages stay visible and greyed — you can see where you're going, you just can't work there yet. A manual override exists for when reality doesn't cooperate.

**Done-when.** Every stage requires a written completion condition before it can be started. It's the thing that stops a stage expanding indefinitely, and it's mandatory by design.

## Features

**Today** — the next unblocked task in every thread, the questions due for review, anything in a pipeline needing action, today's time blocks, and habits not yet logged.

**Threads** — the tree view, with progress rolled up from tasks through steps to stages. Links and notes attach at any level.

**Question banks** — SQL, LeetCode and GRE, with spaced repetition on a 0 / 2 / 7 / 21-day schedule. A failed or aided attempt resets the interval chain; a question retires only when solved unaided at the final interval. Every attempt records what you hesitated on, which over time is more useful than the score.

**Notes** — markdown pages, attachable to anything, with templates for daily logs, stage retrospectives, question write-ups and weekly reviews.

**Pipelines** — job applications and outreach, tracked with next actions, and a flag for anything that hasn't moved.

**Time blocking** — plan the day against threads, record what actually happened, and see the weekly distribution of hours. Planned versus actual is usually the surprising part.

**Weekly review** — generated from your own data rather than memory, and exportable as markdown.

**Stall detection** — any thread with no completed task in fourteen days is surfaced. Threads die quietly otherwise.

## Stack

Vanilla HTML, CSS and JavaScript, no build step. The whole app is static files, which keeps deployment to GitHub Pages trivial and means it still works with no network once loaded.

State lives in `localStorage` with a versioned schema and a migration path. There is no account, no server and no telemetry — the data never leaves the browser. Export and import are first-class so you own your data as a file.

## Getting started

```bash
git clone https://github.com/USERNAME/next.git
cd next
```

Open `index.html` in a browser, or serve it locally:

```bash
npx serve .
```

## Testing

```bash
npm install
npm test          # unit tests — unlocking, progress rollup, scheduler, validators
npm run test:e2e  # Playwright end-to-end
```

Unit tests cover the logic rather than the interface: stage unlocking including reordering and force-unlock, progress rollup, the spaced-repetition scheduler including resets and retirement, stall detection, and the import validator against malformed input.

End-to-end tests cover the flows that matter: completing a stage unlocks the next, a failed attempt schedules correctly and appears in the review queue on the right day, and export then import round-trips state exactly.

## Deployment

Push to `main`. GitHub Pages serves from the repository root — no build, no pipeline.

## Data

Everything is in `localStorage` under a versioned key. Use **Export** to write a JSON backup; **Import** validates the schema, reports problems clearly, and never silently drops data.

Clearing your browser's site data will delete everything. Export periodically.

## Status

- [ ] Data model, persistence, schema versioning, export and import
- [ ] Threads, stages, steps, tasks, unlocking, tree view
- [ ] Today
- [ ] Question banks and the scheduler
- [ ] Notes and templates
- [ ] Application and outreach pipelines
- [ ] Time blocking
- [ ] Weekly review, stall detection, search
- [ ] Habits and reading

## Notes

Built for one person, on purpose. There's no multi-user support, no sync and no sharing, and adding them would compromise the things that make it fast to use.

## License

MIT
