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
  READING_SOURCES,
  MUSCLE_GROUPS,
  EQUIPMENT_TYPES,
  EXERCISE_STATUSES,
  DROP_REASONS,
  SKIP_REASONS,
  PAIN_TIMING,
  CHESS_COLOURS,
  CHESS_RESULTS,
  deepClone,
} from './schema.js';
import { isValidISODate, isValidTime } from './dates.js';
import { BLOCK_STATUSES } from './timeblocks.js';
import { parseActivity, activityThreadId } from './activities.js';
import { migrate, backfillDefaults } from './migrations.js';
import { builtinTemplates } from './templates.js';

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
    thread.archived = !!thread.archived;
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
  state.notes = state.notes.filter((note, i) => {
    const path = `notes[${i}]`;
    if (!isObject(note)) {
      report.error(path, 'note is not an object');
      return true;
    }
    if (!note.id) note.id = `note_recovered_${i}`;
    fixString(note, 'title', `${path}.title`, report, { fallback: 'Untitled note' });
    fixString(note, 'body', `${path}.body`, report);
    if (note.attach !== null && note.attach !== undefined && !isObject(note.attach)) {
      report.warn(`${path}.attach`, 'attachment is malformed — the note is kept as standalone');
      note.attach = null;
    }
    return true;
  });

  state.noteTemplates = state.noteTemplates.filter((tpl, i) => {
    const path = `noteTemplates[${i}]`;
    if (!isObject(tpl)) {
      report.error(path, 'template is not an object');
      return true;
    }
    if (!tpl.id) tpl.id = `tpl_recovered_${i}`;
    fixString(tpl, 'name', `${path}.name`, report, { fallback: 'Untitled template' });
    fixString(tpl, 'body', `${path}.body`, report);
    return true;
  });

  state.exercises = state.exercises.filter((exercise, i) => {
    const path = `exercises[${i}]`;
    if (!isObject(exercise)) {
      report.error(path, 'exercise is not an object');
      return true;
    }
    if (!exercise.id) exercise.id = `ex_recovered_${i}`;
    fixString(exercise, 'name', `${path}.name`, report, { fallback: 'Untitled exercise' });
    if (!exercise.name.trim()) exercise.name = 'Untitled exercise';
    fixString(exercise, 'cues', `${path}.cues`, report);
    fixString(exercise, 'dropNote', `${path}.dropNote`, report);
    fixEnum(exercise, 'muscle', MUSCLE_GROUPS, `${path}.muscle`, report, 'core');
    fixEnum(exercise, 'equipment', EQUIPMENT_TYPES, `${path}.equipment`, report, 'unspecified');
    fixEnum(exercise, 'status', EXERCISE_STATUSES, `${path}.status`, report, 'active');
    fixArray(exercise, 'secondary', `${path}.secondary`, report);
    exercise.secondary = [...new Set(exercise.secondary
      .filter((m) => MUSCLE_GROUPS.includes(m))
      .filter((m) => m !== exercise.muscle))];
    if (exercise.status === 'dropped') {
      if (exercise.dropReason !== null && !DROP_REASONS.includes(exercise.dropReason)) {
        report.warn(`${path}.dropReason`, `"${exercise.dropReason}" is not one of ${DROP_REASONS.join(', ')} — cleared, so the library will ask again`);
        exercise.dropReason = null;
      }
    } else if (exercise.dropReason) {
      report.warn(path, 'carried a reason for being dropped but is not dropped — the reason was cleared');
      exercise.dropReason = null;
    }
    return true;
  });

  state.routines = state.routines.filter((routine, i) => {
    const path = `routines[${i}]`;
    if (!isObject(routine)) {
      report.error(path, 'routine is not an object');
      return true;
    }
    if (!routine.id) routine.id = `rot_recovered_${i}`;
    fixString(routine, 'name', `${path}.name`, report, { fallback: `Slot ${i + 1}` });
    routine.order = Number.isFinite(Number(routine.order)) ? Number(routine.order) : i;
    fixArray(routine, 'exerciseIds', `${path}.exerciseIds`, report);
    routine.exerciseIds = routine.exerciseIds.filter((id) => typeof id === 'string');
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
    if (session.startTime && !isValidTime(session.startTime)) {
      report.warn(`${path}.startTime`, `"${session.startTime}" is not a valid HH:MM time — cleared`);
      session.startTime = null;
    }
    session.durationMinutes = positiveOrNull(session.durationMinutes, `${path}.durationMinutes`, report);
    if (session.endTime && !isValidTime(session.endTime)) {
      report.warn(`${path}.endTime`, `"${session.endTime}" is not a valid HH:MM time — cleared`);
      session.endTime = null;
    }
    session.warmup = !!session.warmup;
    session.warmupMinutes = positiveOrNull(session.warmupMinutes, `${path}.warmupMinutes`, report);
    fixArray(session, 'skipped', `${path}.skipped`, report);
    session.skipped = session.skipped.filter((entry, si) => {
      const sPath = `${path}.skipped[${si}]`;
      if (!isObject(entry)) {
        report.error(sPath, 'skipped exercise is not an object');
        return true;
      }
      if (!entry.id) entry.id = `skip_recovered_${i}_${si}`;
      fixString(entry, 'note', `${sPath}.note`, report);
      fixEnum(entry, 'reason', SKIP_REASONS, `${sPath}.reason`, report, 'other');
      return true;
    });
    fixArray(session, 'exercises', `${path}.exercises`, report);
    session.exercises = session.exercises.filter((entry, ei) => {
      const ePath = `${path}.exercises[${ei}]`;
      if (!isObject(entry)) {
        report.error(ePath, 'session exercise is not an object');
        return true;
      }
      if (!entry.id) entry.id = `sx_recovered_${i}_${ei}`;
      fixString(entry, 'note', `${ePath}.note`, report);
      if (entry.substitutedFor === undefined) entry.substitutedFor = null;
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

  state.chessGames = state.chessGames.filter((game, i) => {
    const path = `chessGames[${i}]`;
    if (!isObject(game)) {
      report.error(path, 'chess game is not an object');
      return true;
    }
    if (!game.id) game.id = `chess_recovered_${i}`;
    for (const key of ['url', 'opening', 'lesson', 'venue']) {
      fixString(game, key, `${path}.${key}`, report);
    }
    fixEnum(game, 'colour', CHESS_COLOURS, `${path}.colour`, report, 'white');
    fixEnum(game, 'result', CHESS_RESULTS, `${path}.result`, report, 'draw');
    fixDate(game, 'date', `${path}.date`, report);
    game.opponentRating = positiveOrNull(game.opponentRating, `${path}.opponentRating`, report);
    if (!game.lesson.trim()) {
      // The lesson is what the whole view is for, and the editor will not save
      // a game without one. A file that has one anyway is kept -- refusing the
      // import would lose the game entirely -- but it is said out loud.
      report.warn(path, 'chess game has no "what I learned" line — it is kept, but it will not appear on the lessons page');
    }
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
    fixString(book, 'fileName', `${path}.fileName`, report);
    fixEnum(book, 'status', READING_STATUSES, `${path}.status`, report, 'reading');
    if (!READING_SOURCES.includes(book.source)) book.source = 'manual';
    if (!['page', 'percent'].includes(book.unit)) book.unit = 'page';
    const pos = Number(book.position);
    book.position = Number.isFinite(pos) && pos >= 0 ? pos : 0;
    book.pageCount = positiveOrNull(book.pageCount, `${path}.pageCount`, report);
    book.fileSize = Number.isFinite(Number(book.fileSize)) ? Number(book.fileSize) : 0;
    if (book.cover !== null && book.cover !== undefined && typeof book.cover !== 'string') {
      report.warn(`${path}.cover`, 'cover is not an image — cleared');
      book.cover = null;
    }
    if (book.cover === undefined) book.cover = null;
    fixArray(book, 'bookmarks', `${path}.bookmarks`, report);
    book.bookmarks = book.bookmarks.filter((mark, bi) => {
      const bPath = `${path}.bookmarks[${bi}]`;
      if (!isObject(mark)) {
        report.error(bPath, 'bookmark is not an object');
        return true;
      }
      if (!mark.id) mark.id = `bm_recovered_${i}_${bi}`;
      fixString(mark, 'note', `${bPath}.note`, report);
      const page = Number(mark.page);
      if (!Number.isInteger(page) || page < 1) {
        report.warn(bPath, `page "${mark.page}" is not a page number — the bookmark is kept, pointing at page 1`);
        mark.page = 1;
      }
      return true;
    });
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
  for (const note of state.notes ?? []) {
    if (note.attach?.id && note.attach.type === 'thread' && !threadIds.has(note.attach.id)) {
      report.warn(`notes[${note.id}]`, 'attached to a thread that is not in this file — kept as standalone');
      note.attach = null;
    }
  }

  const exerciseIds = new Set((state.exercises ?? []).map((e) => e.id));
  const routineIds = new Set((state.routines ?? []).map((r) => r.id));

  for (const session of state.gymSessions ?? []) {
    if (session.routineId && !routineIds.has(session.routineId)) {
      report.warn(`gymSessions[${session.id}]`, 'names a routine slot that is not in this file — the session is kept, unassigned');
      session.routineId = null;
    }
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

  for (const note of backfillDefaults(candidate, builtinTemplates())) report.note(note);

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
    notes: (state.notes ?? []).length,
    questions: (state.questions ?? []).length,
    applications: (state.applications ?? []).length,
    outreach: (state.outreach ?? []).length,
    exercises: (state.exercises ?? []).length,
    routines: (state.routines ?? []).length,
    gymSessions: (state.gymSessions ?? []).length,
    painRecords: (state.painRecords ?? []).length,
    chessGames: (state.chessGames ?? []).length,
    reading: (state.reading ?? []).length,
    timeBlocks: (state.timeBlocks ?? []).length,
  };
}
