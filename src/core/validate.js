// The import validator.
//
// Contract: an import either succeeds with a state you can trust, or it fails
// with an explanation. It never half-loads, and it never silently drops
// records. Anything repairable is repaired and *reported* as a warning;
// anything not repairable is a hard error and the import is refused.

import {
  SCHEMA_VERSION,
  COLLECTIONS,
  THREAD_TYPES,
  BANKS,
  DIFFICULTIES,
  APPLICATION_STATUSES,
  READING_STATUSES,
  THREAD_STATUSES,
  MUSCLE_GROUPS,
  MUSCLES,
  EXERCISE_STATUSES,
  PAIN_TIMING,
  MISS_CAUSES,
  deepClone,
} from './schema.js';
import { muscleGroup } from './schema.js';
import { isValidISODate, isValidTime } from './dates.js';
import { BLOCK_STATUSES } from './timeblocks.js';
import { parseActivity, activityThreadId } from './activities.js';
import { migrate, backfillDefaults } from './migrations.js';

class Report {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.notes = [];
  }
  error(path, message) {
    this.errors.push({ path, message });
  }
  warn(path, message) {
    this.warnings.push({ path, message });
  }
  note(message) {
    this.notes.push(message);
  }
  get ok() {
    return this.errors.length === 0;
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function requireArray(state, key, report) {
  if (state[key] === undefined) return true; // backfilled later, reported there
  if (!Array.isArray(state[key])) {
    report.error(key, `expected an array, found ${Array.isArray(state[key]) ? 'array' : typeof state[key]}`);
    return false;
  }
  return true;
}

function fixString(container, key, path, report, { fallback = '' } = {}) {
  if (container[key] === undefined || container[key] === null) {
    container[key] = fallback;
    return;
  }
  if (typeof container[key] !== 'string') {
    report.warn(path, `expected text, found ${typeof container[key]} — coerced`);
    container[key] = String(container[key]);
  }
}

function fixDate(container, key, path, report, { allowNull = true } = {}) {
  const value = container[key];
  if (value === undefined || value === null || value === '') {
    container[key] = allowNull ? null : null;
    return;
  }
  if (typeof value === 'string' && isValidISODate(value.slice(0, 10)) && value.length > 10) {
    // A timestamp where a date was expected: keep the calendar day.
    report.warn(path, `"${value}" is a timestamp — kept the local date part`);
    container[key] = value.slice(0, 10);
    return;
  }
  if (!isValidISODate(value)) {
    report.warn(path, `"${value}" is not a valid YYYY-MM-DD date — cleared`);
    container[key] = null;
  }
}

function fixEnum(container, key, allowed, path, report, fallback) {
  if (!allowed.includes(container[key])) {
    report.warn(path, `"${container[key]}" is not one of ${allowed.join(', ')} — set to "${fallback}"`);
    container[key] = fallback;
  }
}

function fixArray(container, key, path, report) {
  if (container[key] === undefined || container[key] === null) {
    container[key] = [];
    return;
  }
  if (!Array.isArray(container[key])) {
    report.warn(path, 'expected a list — replaced with an empty list');
    container[key] = [];
  }
}

/** A count, a weight or a duration: a non-negative number, or nothing at all. */
function positiveOrNull(value, path, report) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    report.warn(path, `"${value}" is not a usable number — cleared`);
    return null;
  }
  return n;
}

function fixLinks(container, path, report) {
  fixArray(container, 'links', `${path}.links`, report);
  container.links = container.links.filter((link, i) => {
    if (!isObject(link)) {
      report.warn(`${path}.links[${i}]`, 'not an object — removed');
      return false;
    }
    fixString(link, 'url', `${path}.links[${i}].url`, report);
    fixString(link, 'label', `${path}.links[${i}].label`, report);
    if (!link.id) link.id = `lnk_${Math.random().toString(36).slice(2, 10)}`;
    if (!link.url) {
      report.warn(`${path}.links[${i}]`, 'link has no URL — removed');
      return false;
    }
    return true;
  });
}

function validateThreads(state, report, seenIds) {
  state.threads = state.threads.filter((thread, ti) => {
    const path = `threads[${ti}]`;
    if (!isObject(thread)) {
      report.error(path, 'thread is not an object');
      return true;
    }
    if (!thread.id) {
      report.warn(path, 'thread had no id — one was generated');
      thread.id = `thr_recovered_${ti}`;
    }
    if (seenIds.has(thread.id)) {
      report.error(path, `duplicate id "${thread.id}"`);
    }
    seenIds.add(thread.id);
    fixString(thread, 'name', `${path}.name`, report, { fallback: 'Untitled thread' });
    if (!thread.name.trim()) thread.name = 'Untitled thread';
    fixString(thread, 'description', `${path}.description`, report);
    fixString(thread, 'notes', `${path}.notes`, report);
    fixEnum(thread, 'type', THREAD_TYPES, `${path}.type`, report, 'project');
    fixEnum(thread, 'status', THREAD_STATUSES, `${path}.status`, report, 'active');
    fixLinks(thread, path, report);
    fixArray(thread, 'stages', `${path}.stages`, report);

    thread.stages = thread.stages.filter((stage, si) => {
      const sPath = `${path}.stages[${si}]`;
      if (!isObject(stage)) {
        report.error(sPath, 'stage is not an object');
        return true;
      }
      if (!stage.id) stage.id = `stage_recovered_${ti}_${si}`;
      fixString(stage, 'title', `${sPath}.title`, report, { fallback: 'Untitled stage' });
      fixString(stage, 'doneWhen', `${sPath}.doneWhen`, report);
      fixString(stage, 'notes', `${sPath}.notes`, report);
      stage.forceUnlocked = !!stage.forceUnlocked;
      stage.forceCompleted = !!stage.forceCompleted;
      if (stage.forceCompletedAt === undefined) stage.forceCompletedAt = null;
      fixLinks(stage, sPath, report);
      fixArray(stage, 'steps', `${sPath}.steps`, report);

      stage.steps = stage.steps.filter((step, pi) => {
        const pPath = `${sPath}.steps[${pi}]`;
        if (!isObject(step)) {
          report.error(pPath, 'step is not an object');
          return true;
        }
        if (!step.id) step.id = `step_recovered_${ti}_${si}_${pi}`;
        fixString(step, 'title', `${pPath}.title`, report, { fallback: 'Untitled step' });
        fixString(step, 'notes', `${pPath}.notes`, report);
        fixLinks(step, pPath, report);
        fixArray(step, 'tasks', `${pPath}.tasks`, report);

        step.tasks = step.tasks.filter((task, xi) => {
          const tPath = `${pPath}.tasks[${xi}]`;
          if (!isObject(task)) {
            report.error(tPath, 'task is not an object');
            return true;
          }
          if (!task.id) task.id = `task_recovered_${ti}_${si}_${pi}_${xi}`;
          fixString(task, 'title', `${tPath}.title`, report, { fallback: 'Untitled task' });
          fixString(task, 'notes', `${tPath}.notes`, report);
          task.done = !!task.done;
          if (task.done && !task.doneAt) {
            report.warn(tPath, 'task is done but has no completion date — weekly reviews will not count it');
          }
          if (!task.done && task.doneAt) {
            report.warn(tPath, 'task is not done but carried a completion date — cleared');
            task.doneAt = null;
          }
          fixDate(task, 'due', `${tPath}.due`, report);
          if (task.estimateMinutes !== null && task.estimateMinutes !== undefined) {
            const n = Number(task.estimateMinutes);
            if (!Number.isFinite(n) || n < 0) {
              report.warn(tPath, 'invalid time estimate — cleared');
              task.estimateMinutes = null;
            } else {
              task.estimateMinutes = n;
            }
          } else {
            task.estimateMinutes = null;
          }
          fixLinks(task, tPath, report);
          return true;
        });
        return true;
      });
      return true;
    });
    return true;
  });
}

function validateQuestions(state, report) {
  state.questions = state.questions.filter((q, i) => {
    const path = `questions[${i}]`;
    if (!isObject(q)) {
      report.error(path, 'question is not an object');
      return true;
    }
    if (!q.id) q.id = `q_recovered_${i}`;
    fixEnum(q, 'bank', BANKS, `${path}.bank`, report, 'sql');
    fixString(q, 'title', `${path}.title`, report, { fallback: 'Untitled question' });
    fixString(q, 'url', `${path}.url`, report);
    fixString(q, 'notes', `${path}.notes`, report);
    fixEnum(q, 'difficulty', DIFFICULTIES, `${path}.difficulty`, report, 'medium');
    fixArray(q, 'tags', `${path}.tags`, report);
    q.tags = q.tags.map(String);
    if (!isObject(q.fields)) q.fields = {};
    fixArray(q, 'attempts', `${path}.attempts`, report);
    q.attempts = q.attempts.filter((a, ai) => {
      const aPath = `${path}.attempts[${ai}]`;
      if (!isObject(a)) {
        report.error(aPath, 'attempt is not an object');
        return true;
      }
      if (!a.id) a.id = `att_recovered_${i}_${ai}`;
      if (!isValidISODate(a.date)) {
        report.warn(aPath, `attempt date "${a.date}" is invalid — the attempt is kept but will not appear in weekly reviews`);
        a.date = null;
      }
      a.unaided = !!a.unaided;
      fixString(a, 'hesitation', `${aPath}.hesitation`, report);
      const mins = Number(a.minutes);
      a.minutes = Number.isFinite(mins) && mins >= 0 ? mins : null;
      return true;
    });
    if (!Number.isInteger(q.intervalIndex) || q.intervalIndex < 0) {
      report.warn(`${path}.intervalIndex`, `"${q.intervalIndex}" is not a valid position in the interval chain — reset to the start`);
      q.intervalIndex = 0;
    }
    // The four-field extraction. Every bank carries one; an empty one is the
    // normal state for a question that has not been attempted yet.
    if (!isObject(q.extraction)) q.extraction = {};
    for (const key of ['gave', 'did', 'broke', 'portable']) {
      fixString(q.extraction, key, `${path}.extraction.${key}`, report);
    }
    if (q.extraction.cause !== null && q.extraction.cause !== undefined && q.extraction.cause !== '') {
      fixEnum(q.extraction, 'cause', MISS_CAUSES, `${path}.extraction.cause`, report, 'concept');
    } else {
      q.extraction.cause = null;
    }
    // Reported rather than repaired: only the person who solved it can write
    // the portable move, and inventing one would be worse than an empty field.
    const started = ['gave', 'did', 'broke'].some((k) => q.extraction[k].trim());
    if (started && !q.extraction.portable.trim()) {
      report.warn(`${path}.extraction`, 'has an extraction with no portable move — the rule is the point of the format, so this one is unfinished');
    }

    q.retired = !!q.retired;
    fixDate(q, 'dueDate', `${path}.dueDate`, report);
    fixDate(q, 'retiredAt', `${path}.retiredAt`, report);
    if (!q.retired && !q.dueDate) {
      report.warn(path, 'active question had no due date — scheduled for today');
      q.dueDate = null; // the store re-schedules on load
    }
    return true;
  });
}

function validatePipelines(state, report) {
  state.applications = state.applications.filter((app, i) => {
    const path = `applications[${i}]`;
    if (!isObject(app)) {
      report.error(path, 'application is not an object');
      return true;
    }
    if (!app.id) app.id = `app_recovered_${i}`;
    for (const key of ['company', 'role', 'source', 'url', 'resumeVersion', 'referral', 'nextAction', 'notes']) {
      fixString(app, key, `${path}.${key}`, report);
    }
    fixEnum(app, 'status', APPLICATION_STATUSES, `${path}.status`, report, 'applied');
    fixDate(app, 'dateApplied', `${path}.dateApplied`, report);
    fixDate(app, 'nextActionDate', `${path}.nextActionDate`, report);
    fixDate(app, 'lastMovedAt', `${path}.lastMovedAt`, report);
    return true;
  });

  state.outreach = state.outreach.filter((item, i) => {
    const path = `outreach[${i}]`;
    if (!isObject(item)) {
      report.error(path, 'outreach entry is not an object');
      return true;
    }
    if (!item.id) item.id = `out_recovered_${i}`;
    for (const key of ['name', 'company', 'role', 'channel', 'url', 'notes']) {
      fixString(item, key, `${path}.${key}`, report);
    }
    item.replied = !!item.replied;
    fixDate(item, 'dateContacted', `${path}.dateContacted`, report);
    fixDate(item, 'followUpDate', `${path}.followUpDate`, report);
    fixDate(item, 'lastMovedAt', `${path}.lastMovedAt`, report);
    return true;
  });
}

function validateRest(state, report) {
  state.exercises = state.exercises.filter((exercise, i) => {
    const path = `exercises[${i}]`;
    if (!isObject(exercise)) {
      report.error(path, 'exercise is not an object');
      return true;
    }
    if (!exercise.id) exercise.id = `ex_recovered_${i}`;
    fixString(exercise, 'name', `${path}.name`, report, { fallback: 'Untitled exercise' });
    if (!exercise.name.trim()) exercise.name = 'Untitled exercise';
    fixEnum(exercise, 'group', MUSCLE_GROUPS, `${path}.group`, report, 'chest');
    // A null specific muscle is a real state, not a defect: it means the
    // migration declined to guess, and the library asks for it to be set.
    if (exercise.muscle !== null && exercise.muscle !== undefined && exercise.muscle !== '') {
      fixEnum(exercise, 'muscle', MUSCLES, `${path}.muscle`, report, null);
    } else {
      exercise.muscle = null;
    }
    if (exercise.muscle && muscleGroup(exercise.muscle) !== exercise.group) {
      report.warn(path, `"${exercise.name}" is filed under ${exercise.group} but ${exercise.muscle} is a ${muscleGroup(exercise.muscle)} muscle — the muscle wins`);
      exercise.group = muscleGroup(exercise.muscle);
    }
    fixEnum(exercise, 'status', EXERCISE_STATUSES, `${path}.status`, report, 'active');
    fixArray(exercise, 'secondary', `${path}.secondary`, report);
    exercise.secondary = [...new Set(exercise.secondary
      .filter((m) => MUSCLES.includes(m))
      .filter((m) => m !== exercise.muscle))];
    return true;
  });

  state.warmups = state.warmups.filter((movement, i) => {
    const path = `warmups[${i}]`;
    if (!isObject(movement)) {
      report.error(path, 'warm-up movement is not an object');
      return true;
    }
    if (!movement.id) movement.id = `wu_recovered_${i}`;
    fixString(movement, 'name', `${path}.name`, report, { fallback: 'Untitled movement' });
    if (!movement.name.trim()) movement.name = 'Untitled movement';
    return true;
  });

  state.painRecords = state.painRecords.filter((record, i) => {
    const path = `painRecords[${i}]`;
    if (!isObject(record)) {
      report.error(path, 'pain record is not an object');
      return true;
    }
    if (!record.id) record.id = `pain_recovered_${i}`;
    fixString(record, 'location', `${path}.location`, report);
    fixString(record, 'note', `${path}.note`, report);
    fixDate(record, 'date', `${path}.date`, report);
    fixEnum(record, 'when', PAIN_TIMING, `${path}.when`, report, 'during');
    if (!record.location.trim()) {
      // Location is the axis the whole view groups on. Without it the record
      // cannot answer the one question it exists for.
      report.warn(path, 'pain was recorded without saying where — it is kept, filed under "unspecified"');
      record.location = 'unspecified';
    }
    return true;
  });

  state.gymSessions = state.gymSessions.filter((session, i) => {
    const path = `gymSessions[${i}]`;
    if (!isObject(session)) {
      report.error(path, 'gym session is not an object');
      return true;
    }
    if (!session.id) session.id = `gym_recovered_${i}`;
    fixString(session, 'notes', `${path}.notes`, report);
    fixDate(session, 'date', `${path}.date`, report);
    if (!session.date) {
      report.warn(path, 'gym session has no date — it is kept but will not count towards any week');
    }
    for (const key of ['startTime', 'endTime']) {
      // Seconds are neither entered nor stored, so a value carrying them is
      // trimmed rather than refused — the hour and minute are the real value.
      if (typeof session[key] === 'string' && /^\d{1,2}:\d{2}:/.test(session[key])) {
        report.warn(`${path}.${key}`, `"${session[key]}" carried seconds — trimmed to the minute`);
        session[key] = session[key].slice(0, 5);
      }
      if (session[key] && !isValidTime(session[key])) {
        report.warn(`${path}.${key}`, `"${session[key]}" is not a valid HH:MM time — cleared`);
        session[key] = null;
      }
    }

    if (!isObject(session.warmup)) session.warmup = { movementIds: [], minutes: null };
    fixArray(session.warmup, 'movementIds', `${path}.warmup.movementIds`, report);
    session.warmup.movementIds = session.warmup.movementIds.filter((id) => typeof id === 'string');
    session.warmup.minutes = positiveOrNull(session.warmup.minutes, `${path}.warmup.minutes`, report);

    fixArray(session, 'exercises', `${path}.exercises`, report);
    session.exercises = session.exercises.filter((entry, ei) => {
      const ePath = `${path}.exercises[${ei}]`;
      if (!isObject(entry)) {
        report.error(ePath, 'session exercise is not an object');
        return true;
      }
      if (!entry.id) entry.id = `sx_recovered_${i}_${ei}`;
      fixString(entry, 'note', `${ePath}.note`, report);
      fixArray(entry, 'sets', `${ePath}.sets`, report);
      entry.sets = entry.sets.filter((set, si) => {
        const sPath = `${ePath}.sets[${si}]`;
        if (!isObject(set)) {
          report.error(sPath, 'set is not an object');
          return true;
        }
        if (!set.id) set.id = `set_recovered_${i}_${ei}_${si}`;
        set.reps = positiveOrNull(set.reps, `${sPath}.reps`, report);
        set.weight = positiveOrNull(set.weight, `${sPath}.weight`, report);
        return true;
      });
      return true;
    });
    return true;
  });

  state.reading = state.reading.filter((book, i) => {
    const path = `reading[${i}]`;
    if (!isObject(book)) {
      report.error(path, 'reading entry is not an object');
      return true;
    }
    if (!book.id) book.id = `read_recovered_${i}`;
    fixString(book, 'title', `${path}.title`, report, { fallback: 'Untitled' });
    fixString(book, 'author', `${path}.author`, report);
    fixString(book, 'notes', `${path}.notes`, report);
    fixEnum(book, 'status', READING_STATUSES, `${path}.status`, report, 'reading');
    book.page = positiveOrNull(book.page, `${path}.page`, report);
    const rating = Number(book.rating);
    if (book.rating === null || book.rating === undefined || book.rating === '') {
      book.rating = null;
    } else if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      report.warn(`${path}.rating`, `"${book.rating}" is not a rating from 1 to 5 — cleared`);
      book.rating = null;
    } else {
      book.rating = Math.round(rating);
    }
    return true;
  });

  state.timeBlocks = state.timeBlocks.filter((block, i) => {
    const path = `timeBlocks[${i}]`;
    if (!isObject(block)) {
      report.error(path, 'time block is not an object');
      return true;
    }
    if (!block.id) block.id = `blk_recovered_${i}`;
    fixString(block, 'label', `${path}.label`, report);
    fixString(block, 'notes', `${path}.notes`, report);
    fixDate(block, 'date', `${path}.date`, report);
    fixEnum(block, 'status', BLOCK_STATUSES, `${path}.status`, report, 'planned');
    if (block.activity !== null && block.activity !== undefined) {
      if (typeof block.activity !== 'string' || parseActivity(block.activity).kind === 'none') {
        report.warn(`${path}.activity`, `"${block.activity}" is not an activity Cairn recognises — the block is kept, unassigned`);
        block.activity = null;
      }
    } else {
      block.activity = null;
    }
    for (const key of ['start', 'end']) {
      if (block[key] && !isValidTime(block[key])) {
        report.warn(`${path}.${key}`, `"${block[key]}" is not a valid HH:MM time — cleared`);
        block[key] = null;
      }
    }
    if (!block.date || !block.start || !block.end) {
      report.warn(path, 'time block is missing a date or times — it is kept but will not appear on the day view');
    }
    return true;
  });
}

function crossCheck(state, report) {
  const threadIds = new Set((state.threads ?? []).map((t) => t.id));
  const taskIds = new Set();
  for (const thread of state.threads ?? []) {
    for (const stage of thread.stages ?? []) {
      for (const step of stage.steps ?? []) {
        for (const task of step.tasks ?? []) taskIds.add(task.id);
      }
    }
  }
  for (const block of state.timeBlocks ?? []) {
    const owner = activityThreadId(block.activity);
    if (owner && !threadIds.has(owner)) {
      report.warn(`timeBlocks[${block.id}]`, 'references a thread that is not in this file — the block is kept, unassigned');
      block.activity = null;
      block.taskId = null;
    }
    if (block.taskId && !taskIds.has(block.taskId)) {
      report.warn(`timeBlocks[${block.id}]`, 'references a task that is not in this file — the block is kept, without the task link');
      block.taskId = null;
    }
  }
  const exerciseIds = new Set((state.exercises ?? []).map((e) => e.id));

  for (const session of state.gymSessions ?? []) {
    for (const entry of session.exercises ?? []) {
      if (entry.exerciseId && !exerciseIds.has(entry.exerciseId)) {
        // Kept, not dropped: the sets are the record, and the view names an
        // unknown id rather than rendering a blank row.
        report.warn(
          `gymSessions[${session.id}]`,
          'includes an exercise that is not in this file — the sets are kept and shown as "Removed exercise"',
        );
      }
    }
  }

  const warmupIds = new Set((state.warmups ?? []).map((w) => w.id));
  for (const session of state.gymSessions ?? []) {
    const ids = session.warmup?.movementIds ?? [];
    const known = ids.filter((id) => warmupIds.has(id));
    if (known.length !== ids.length) {
      report.warn(`gymSessions[${session.id}]`, 'names a warm-up movement that is not in this file — the unknown one is dropped from the session');
      session.warmup.movementIds = known;
    }
  }

  for (const record of state.painRecords ?? []) {
    if (record.exerciseId && !exerciseIds.has(record.exerciseId)) {
      report.warn(`painRecords[${record.id}]`, 'names an exercise that is not in this file — the record is kept without it');
      record.exerciseId = null;
    }
  }
}

/**
 * Validate and migrate a parsed JSON payload.
 *
 * @param {unknown} raw  Either a JSON string or an already-parsed object.
 * @returns {{ok:boolean, state:object|null, errors:Array, warnings:Array, notes:Array, summary:object|null}}
 */
export function validateImport(raw) {
  const report = new Report();

  let parsed = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) {
      report.error('file', 'the file is empty');
      return finish(report, null);
    }
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      report.error('file', `not valid JSON — ${error.message}`);
      return finish(report, null);
    }
  }

  if (!isObject(parsed)) {
    report.error('file', `expected a JSON object at the top level, found ${Array.isArray(parsed) ? 'an array' : typeof parsed}`);
    return finish(report, null);
  }

  // Version and migration, before anything else touches the shape.
  let candidate = deepClone(parsed);
  if (candidate.schemaVersion === undefined) {
    if (Array.isArray(candidate.threads) || candidate.banks) {
      report.warn('schemaVersion', 'no schema version in the file — assuming v1 based on its shape');
      candidate.schemaVersion = 1;
    } else {
      report.error('schemaVersion', 'missing, and the file does not look like a Cairn export');
      return finish(report, null);
    }
  }

  const migrated = migrate(candidate);
  if (migrated.error) {
    report.error('schemaVersion', migrated.error);
    return finish(report, null);
  }
  candidate = migrated.state;
  for (const note of migrated.notes) report.note(note);
  if (migrated.applied.length) {
    report.note(`migrated from schema v${migrated.applied[0]} to v${SCHEMA_VERSION}`);
  }

  // Structural checks that are fatal if wrong.
  let structureOk = true;
  for (const key of COLLECTIONS) {
    if (!requireArray(candidate, key, report)) structureOk = false;
  }
  if (candidate.settings !== undefined && !isObject(candidate.settings)) {
    report.error('settings', 'expected an object');
    structureOk = false;
  }
  if (!structureOk) return finish(report, null);

  for (const note of backfillDefaults(candidate)) report.note(note);

  // Field-level repair.
  const seenIds = new Set();
  validateThreads(candidate, report, seenIds);
  validateQuestions(candidate, report);
  validatePipelines(candidate, report);
  validateRest(candidate, report);
  crossCheck(candidate, report);

  if (Array.isArray(candidate.settings?.srsIntervals)) {
    const clean = candidate.settings.srsIntervals.filter((n) => Number.isFinite(n) && n >= 0);
    if (clean.length !== candidate.settings.srsIntervals.length || !clean.length) {
      report.warn('settings.srsIntervals', 'invalid review intervals — restored the default 0 / 2 / 7 / 21 schedule');
      candidate.settings.srsIntervals = [0, 2, 7, 21];
    }
  }

  candidate.schemaVersion = SCHEMA_VERSION;
  return finish(report, report.ok ? candidate : null);
}

function finish(report, state) {
  return {
    ok: report.ok && !!state,
    state,
    errors: report.errors,
    warnings: report.warnings,
    notes: report.notes,
    summary: state ? summarise(state) : null,
  };
}

export function summarise(state) {
  let tasks = 0;
  let stages = 0;
  for (const thread of state.threads ?? []) {
    stages += (thread.stages ?? []).length;
    for (const stage of thread.stages ?? []) {
      for (const step of stage.steps ?? []) tasks += (step.tasks ?? []).length;
    }
  }
  return {
    threads: (state.threads ?? []).length,
    stages,
    tasks,
    questions: (state.questions ?? []).length,
    applications: (state.applications ?? []).length,
    outreach: (state.outreach ?? []).length,
    exercises: (state.exercises ?? []).length,
    gymSessions: (state.gymSessions ?? []).length,
    warmups: (state.warmups ?? []).length,
    painRecords: (state.painRecords ?? []).length,
    reading: (state.reading ?? []).length,
    timeBlocks: (state.timeBlocks ?? []).length,
  };
}
