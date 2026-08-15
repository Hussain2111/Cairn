// The outline parser: plain text in, thread/stage/step/task tree out.
//
// This exists so a plan drafted in a chat can be pasted straight into Cairn
// rather than typed in a dialog at a time. It is deliberately strict, because
// the failure mode that matters is not "the import was rejected" -- it is "the
// import silently created three of the five stages and I did not notice for a
// week".
//
// The rules that follow from that:
//
//   * Every non-blank line must classify into a known kind. Anything the
//     grammar does not recognise is a hard error carrying its line number and
//     the offending text. Nothing is ever skipped.
//   * Anything the parser decides for you -- an implicit step, a defaulted
//     thread type, a URL moved out of a title, a note bound to the line above
//     it -- is reported as a warning you see before committing, one per
//     decision rather than as a tally.
//   * Counts are self-checked: the markers found in the raw text must equal the
//     records produced. A mismatch is an internal error, surfaced loudly.
//
// Grammar:
//
//   # Thread name (type)      thread; type optional, defaults to project
//   ## Stage title            stage
//   > done when ...           the preceding stage's done-when (required)
//   ### Step title            step
//   - Task title @45m ^2026-09-01    task, optional estimate and due date
//   | a note                  note on whatever line precedes it
//
// Bullets may be -, * or +, or numbered (1. / 1)). Surrounding ** ** is
// stripped from titles. A fenced code block wrapping the whole paste is
// ignored, since chat output usually arrives inside one.
//
// A URL written into any title is lifted out of it and onto that record's
// links. A `|` line attaches to the thread, stage, step or task above it, and
// consecutive `|` lines are one note. Both are decisions the parser makes for
// you, so both are reported line by line and shown in the preview.

import { THREAD_TYPES } from './schema.js';
import { isValidISODate } from './dates.js';

export const OUTLINE_EXAMPLE = `# Compiler project (project)

## Lexer
> every token type has a passing test and the fuzzer runs clean for 10k inputs
### Numbers
- Integer literals @45m
- Float literals ^2026-09-01
- Hex and binary
### Strings
- Escapes and unicode

## Parser
> the grammar round-trips every fixture in tests/fixtures
| Pratt parsing, not recursive descent — the precedence table is the spec.
### Expressions
- Precedence climbing @2h https://craftinginterpreters.com/parsing-expressions.html
- Unary operators
`;

const FENCE = /^\s*```/;
const THREAD = /^#(?!#)\s*(.+)$/;
const STAGE = /^##(?!#)\s*(.+)$/;
const STEP = /^###(?!#)\s*(.+)$/;
const DONE_WHEN = /^>\s?(.*)$/;
const BULLET = /^[-*+]\s+(.+)$/;
const NUMBERED = /^\d+[.)]\s+(.+)$/;
const NOTE = /^\|\s?(.*)$/;
const TYPE_SUFFIX = /^(.*?)\s*\(([^()]+)\)\s*$/;

/** Strip markdown emphasis and stray backticks from a title. */
function cleanTitle(raw) {
  return String(raw)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .trim();
}

// Trailing punctuation is almost always the sentence's, not the URL's, so a
// closing bracket, comma or full stop is left behind rather than linked.
const BARE_URL = /(^|\s)(https?:\/\/[^\s<>]+?)(?=[).,;:!?'"]*(?:\s|$))/g;
const MARKDOWN_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;

/**
 * The host of a URL, used to label a bare link.
 *
 * A link rendered as its full URL is unreadable in a row of tags, and "the
 * link" tells you nothing when there are two. The host is the shortest thing
 * that distinguishes them and needs no judgement to derive.
 */
export function hostLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * URLs written into a title.
 *
 * The model has always had a `links` array on every record and the editor has
 * always been able to fill it; only the parser could not. Nothing new is asked
 * of the writer for this — a URL sitting in a line is unambiguous — so it is
 * lifted out of the title and onto the record, and the title reads as a title
 * again. A markdown link keeps its text as the label; a bare one is labelled
 * with its host.
 */
function extractLinks(text) {
  const links = [];
  let out = String(text);

  out = out.replace(MARKDOWN_LINK, (_match, label, url) => {
    links.push({ url, label: label.trim() });
    // The label stays in the title: it is what the task is called.
    return ` ${label.trim()} `;
  });

  out = out.replace(BARE_URL, (_match, lead, url) => {
    links.push({ url, label: hostLabel(url) });
    return lead;
  });

  return {
    // Removing a URL from mid-sentence leaves the punctuation that followed it
    // hanging on a space: "Check , then move on".
    text: out.replace(/\s{2,}/g, ' ').replace(/\s+([).,;:!?])/g, '$1').trim(),
    links,
  };
}

/** `@45m`, `@2h`, `@1h30m`, `@90` → minutes. Returns null when absent. */
function extractEstimate(text) {
  const match = text.match(/(^|\s)@(\d+h)?(\d+m)?(\d+)?(?=\s|$)/);
  if (!match) return { text, minutes: null };
  const [, , hours, mins, bare] = match;
  if (!hours && !mins && !bare) return { text, minutes: null };
  let total = 0;
  if (hours) total += parseInt(hours, 10) * 60;
  if (mins) total += parseInt(mins, 10);
  if (!hours && !mins && bare) total += parseInt(bare, 10);
  return { text: text.replace(match[0], ' ').trim(), minutes: total > 0 ? total : null };
}

/** `^2026-09-01` → due date. Returns `invalid` when it looks like a date but is not one. */
function extractDue(text) {
  const match = text.match(/(^|\s)\^(\S+)(?=\s|$)/);
  if (!match) return { text, due: null, invalid: null };
  const candidate = match[2];
  const stripped = text.replace(match[0], ' ').trim();
  if (!isValidISODate(candidate)) return { text: stripped, due: null, invalid: candidate };
  return { text: stripped, due: candidate, invalid: null };
}

/**
 * Pull the links out of a title and report each one by line.
 *
 * Reported individually rather than as a tally: moving text out of a title is
 * a decision the parser made, and the doctrine at the top of this file is that
 * every such decision is visible before it is committed. A count at the end
 * ("3 links moved") does not let you check any of them.
 */
function titleWithLinks(raw, lineNo, report, line) {
  const { text, links } = extractLinks(raw);
  for (const link of links) {
    report.warn(
      lineNo,
      `The URL ${link.url} was moved out of the title and attached as a link${link.label ? ` labelled "${link.label}"` : ''}.`,
      line,
    );
  }
  return { text, links };
}

class Report {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }
  error(line, message, text = '') {
    this.errors.push({ line, message, text });
  }
  warn(line, message, text = '') {
    this.warnings.push({ line, message, text });
  }
}

/**
 * Parse an outline.
 *
 * @param {string} source
 * @returns {{ok:boolean, threads:Array, errors:Array, warnings:Array, stats:object}}
 */
export function parseOutline(source) {
  const report = new Report();
  const threads = [];
  const lines = String(source ?? '').split('\n');

  // Marker tallies taken from the raw text, checked against the tree at the end.
  const seen = { threads: 0, stages: 0, steps: 0, tasks: 0 };

  let thread = null;
  let stage = null;
  let step = null;
  // The record a `|` line would attach to: whatever was last created, at any
  // level. Tracked separately from thread/stage/step because those are the
  // *open containers*, and a note belongs to the last thing written, not to
  // the container it happens to sit in.
  let last = null;
  let inFence = false;
  let sawAnyContent = false;

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const raw = lines[i];
    const line = raw.trim();

    if (FENCE.test(raw)) {
      // A chat usually wraps its answer in a fence; treat it as packaging.
      inFence = !inFence;
      continue;
    }
    if (!line) continue;

    // --- thread ---------------------------------------------------------
    const threadMatch = line.match(THREAD);
    if (threadMatch) {
      sawAnyContent = true;
      seen.threads += 1;
      const threadLinked = titleWithLinks(threadMatch[1], lineNo, report, line);
      let name = cleanTitle(threadLinked.text);
      let type = 'project';

      const typed = name.match(TYPE_SUFFIX);
      if (typed) {
        const candidate = typed[2].trim().toLowerCase();
        if (THREAD_TYPES.includes(candidate)) {
          name = cleanTitle(typed[1]);
          type = candidate;
        } else {
          report.error(
            lineNo,
            `"${typed[2].trim()}" is not a thread type. Use one of: ${THREAD_TYPES.join(', ')}.`,
            line,
          );
          name = cleanTitle(typed[1]);
        }
      }

      if (!name) {
        report.error(lineNo, 'This thread has no name.', line);
        continue;
      }
      if (threads.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
        report.error(lineNo, `"${name}" appears twice in this outline. Give them distinct names.`, line);
        continue;
      }

      thread = { name, type, stages: [], links: threadLinked.links, notes: '', line: lineNo };
      threads.push(thread);
      stage = null;
      step = null;
      last = thread;
      continue;
    }

    // --- step (checked before stage: ### also matches ##) ----------------
    const stepMatch = line.match(STEP);
    if (stepMatch) {
      sawAnyContent = true;
      seen.steps += 1;
      if (!stage) {
        report.error(lineNo, 'A step needs a stage above it (a ## line).', line);
        continue;
      }
      const stepLinked = titleWithLinks(stepMatch[1], lineNo, report, line);
      const title = cleanTitle(stepLinked.text);
      if (!title) {
        report.error(lineNo, 'This step has no title.', line);
        continue;
      }
      step = { title, tasks: [], links: stepLinked.links, notes: '', line: lineNo };
      stage.steps.push(step);
      last = step;
      continue;
    }

    // --- stage ------------------------------------------------------------
    const stageMatch = line.match(STAGE);
    if (stageMatch) {
      sawAnyContent = true;
      seen.stages += 1;
      if (!thread) {
        report.error(lineNo, 'A stage needs a thread above it (a # line).', line);
        continue;
      }
      const stageLinked = titleWithLinks(stageMatch[1], lineNo, report, line);
      const title = cleanTitle(stageLinked.text);
      if (!title) {
        report.error(lineNo, 'This stage has no title.', line);
        continue;
      }
      if (thread.stages.some((s) => s.title.toLowerCase() === title.toLowerCase())) {
        report.error(lineNo, `"${title}" appears twice in "${thread.name}". Give them distinct titles.`, line);
        continue;
      }
      stage = { title, doneWhen: '', steps: [], links: stageLinked.links, notes: '', line: lineNo };
      thread.stages.push(stage);
      step = null;
      last = stage;
      continue;
    }

    // --- done-when --------------------------------------------------------
    const doneWhenMatch = line.match(DONE_WHEN);
    if (doneWhenMatch) {
      sawAnyContent = true;
      if (!stage) {
        report.error(lineNo, 'A done-when needs a stage above it (a ## line).', line);
        continue;
      }
      const text = doneWhenMatch[1].trim();
      if (!text) {
        report.error(lineNo, 'This done-when is empty.', line);
        continue;
      }
      // Consecutive > lines are one wrapped sentence.
      stage.doneWhen = stage.doneWhen ? `${stage.doneWhen} ${text}` : text;
      continue;
    }

    // --- task -------------------------------------------------------------
    const taskMatch = line.match(BULLET) || line.match(NUMBERED);
    if (taskMatch) {
      sawAnyContent = true;
      seen.tasks += 1;
      if (!stage) {
        report.error(lineNo, 'A task needs a stage above it (a ## line).', line);
        continue;
      }
      if (!step) {
        // Tasks written straight under a stage are common and unambiguous, so
        // they are accepted -- but the invented step is reported, never silent.
        step = { title: 'Tasks', tasks: [], line: lineNo, implicit: true };
        stage.steps.push(step);
        report.warn(lineNo, `Tasks sat directly under "${stage.title}", so a step called "Tasks" was created to hold them.`, line);
      }

      let text = taskMatch[1];
      // Links come out first: a URL can contain an "@" or a "^", and pulling
      // it clear means neither marker can be read out of the middle of one.
      const linked = titleWithLinks(text, lineNo, report, line);
      text = linked.text;
      const estimate = extractEstimate(text);
      text = estimate.text;
      const due = extractDue(text);
      text = due.text;
      if (due.invalid) {
        report.error(lineNo, `"^${due.invalid}" is not a valid date. Use ^YYYY-MM-DD.`, line);
        continue;
      }

      const title = cleanTitle(text);
      if (!title) {
        report.error(lineNo, 'This task has no title.', line);
        continue;
      }
      const task = {
        title,
        estimateMinutes: estimate.minutes,
        due: due.due,
        links: linked.links,
        notes: '',
        line: lineNo,
      };
      step.tasks.push(task);
      last = task;
      continue;
    }

    // --- note -------------------------------------------------------------
    // Attaches to whatever was written last, at any level. That is the only
    // rule that needs no thought while writing: put the note under the thing
    // it is about.
    const noteMatch = line.match(NOTE);
    if (noteMatch) {
      sawAnyContent = true;
      if (!last) {
        report.error(lineNo, 'A note needs something above it to attach to.', line);
        continue;
      }
      const text = noteMatch[1].trim();
      if (!text) {
        report.error(lineNo, 'This note is empty.', line);
        continue;
      }
      // Consecutive | lines are one note, the same way consecutive > lines are
      // one done-when.
      const joined = last.notes ? `${last.notes} ${text}` : text;
      if (!last.notes) {
        report.warn(lineNo, `This note was attached to "${last.title ?? last.name}".`, line);
      }
      last.notes = joined;
      continue;
    }

    // --- anything else is refused, never ignored --------------------------
    report.error(
      lineNo,
      'This line does not match the outline format. Expected # thread, ## stage, > done-when, ### step, - task, or | note.',
      line,
    );
  }

  if (!sawAnyContent) {
    report.error(0, 'There is nothing to import — the outline is empty.');
  }

  // --- rules that need the whole tree ------------------------------------
  for (const t of threads) {
    if (!t.stages.length) {
      report.error(t.line, `"${t.name}" has no stages. A thread with no stages has nothing to work on.`, '');
    }
    for (const s of t.stages) {
      if (!s.doneWhen.trim()) {
        report.error(
          s.line,
          `"${s.title}" has no done-when. Add a "> ..." line under it saying what finished looks like.`,
          '',
        );
      }
      const taskCount = s.steps.reduce((sum, p) => sum + p.tasks.length, 0);
      if (!taskCount) {
        report.warn(s.line, `"${s.title}" has no tasks. It will show as needing to be broken down.`, '');
      }
    }
  }

  const stats = countTree(threads);

  // --- the self-check ----------------------------------------------------
  // Every marker in the text became a record, or was rejected with an error.
  // If those two numbers disagree the parser dropped something, and that is
  // never allowed to pass quietly.
  //
  // Notes and links are deliberately outside this check: they do not create
  // records, they annotate them. A `|` line in particular must never be
  // counted as a task — it is its own kind now, and tallying it as a bullet
  // would make the check fail on every outline that uses one.
  if (report.errors.length === 0) {
    const mismatches = [];
    for (const key of ['threads', 'stages', 'steps', 'tasks']) {
      const produced = key === 'steps' ? stats.steps - stats.implicitSteps : stats[key];
      if (produced !== seen[key]) {
        mismatches.push(`${key}: found ${seen[key]} in the text but produced ${produced}`);
      }
    }
    if (mismatches.length) {
      report.error(0, `The parser lost something and refused to continue (${mismatches.join('; ')}). Please report this.`);
    }
  }

  return {
    ok: report.errors.length === 0,
    threads,
    errors: report.errors,
    warnings: report.warnings,
    stats,
  };
}

export function countTree(threads) {
  let stages = 0;
  let steps = 0;
  let tasks = 0;
  let implicitSteps = 0;
  let links = 0;
  let notes = 0;

  const annotations = (record) => {
    links += (record.links ?? []).length;
    if (record.notes) notes += 1;
  };

  for (const thread of threads) {
    annotations(thread);
    stages += thread.stages.length;
    for (const stage of thread.stages) {
      annotations(stage);
      steps += stage.steps.length;
      for (const step of stage.steps) {
        annotations(step);
        if (step.implicit) implicitSteps += 1;
        tasks += step.tasks.length;
        for (const task of step.tasks) annotations(task);
      }
    }
  }
  return { threads: threads.length, stages, steps, tasks, implicitSteps, links, notes };
}

/**
 * Decide how each parsed thread lands against what already exists.
 * A name that is already in use appends its stages to that thread rather than
 * creating a second one with the same name.
 */
export function planImport(parsed, state) {
  return parsed.threads.map((thread) => {
    const existing = (state?.threads ?? []).find(
      (t) => t.name.trim().toLowerCase() === thread.name.trim().toLowerCase(),
    );
    if (!existing) return { thread, action: 'create', existing: null, clashes: [] };

    // Stage titles already present in the target thread would be confusing
    // duplicates, so they are called out before anything is written.
    const have = new Set(existing.stages.map((s) => s.title.trim().toLowerCase()));
    const clashes = thread.stages.filter((s) => have.has(s.title.trim().toLowerCase())).map((s) => s.title);
    return { thread, action: 'append', existing, clashes };
  });
}
