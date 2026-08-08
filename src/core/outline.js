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
//     thread type -- is reported as a warning you see before committing.
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
//
// Bullets may be -, * or +, or numbered (1. / 1)). Surrounding ** ** is
// stripped from titles. A fenced code block wrapping the whole paste is
// ignored, since chat output usually arrives inside one.

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
### Expressions
- Precedence climbing @2h
- Unary operators
`;

const FENCE = /^\s*```/;
const THREAD = /^#(?!#)\s*(.+)$/;
const STAGE = /^##(?!#)\s*(.+)$/;
const STEP = /^###(?!#)\s*(.+)$/;
const DONE_WHEN = /^>\s?(.*)$/;
const BULLET = /^[-*+]\s+(.+)$/;
const NUMBERED = /^\d+[.)]\s+(.+)$/;
const TYPE_SUFFIX = /^(.*?)\s*\(([^()]+)\)\s*$/;

/** Strip markdown emphasis and stray backticks from a title. */
function cleanTitle(raw) {
  return String(raw)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .trim();
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
      let name = cleanTitle(threadMatch[1]);
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

      thread = { name, type, stages: [], line: lineNo };
      threads.push(thread);
      stage = null;
      step = null;
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
      const title = cleanTitle(stepMatch[1]);
      if (!title) {
        report.error(lineNo, 'This step has no title.', line);
        continue;
      }
      step = { title, tasks: [], line: lineNo };
      stage.steps.push(step);
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
      const title = cleanTitle(stageMatch[1]);
      if (!title) {
        report.error(lineNo, 'This stage has no title.', line);
        continue;
      }
      if (thread.stages.some((s) => s.title.toLowerCase() === title.toLowerCase())) {
        report.error(lineNo, `"${title}" appears twice in "${thread.name}". Give them distinct titles.`, line);
        continue;
      }
      stage = { title, doneWhen: '', steps: [], line: lineNo };
      thread.stages.push(stage);
      step = null;
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
      step.tasks.push({ title, estimateMinutes: estimate.minutes, due: due.due, line: lineNo });
      continue;
    }

    // --- anything else is refused, never ignored --------------------------
    report.error(
      lineNo,
      'This line does not match the outline format. Expected # thread, ## stage, > done-when, ### step, or - task.',
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
  for (const thread of threads) {
    stages += thread.stages.length;
    for (const stage of thread.stages) {
      steps += stage.steps.length;
      for (const step of stage.steps) {
        if (step.implicit) implicitSteps += 1;
        tasks += step.tasks.length;
      }
    }
  }
  return { threads: threads.length, stages, steps, tasks, implicitSteps };
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
