// Schema migrations.
//
// Every persisted state carries `schemaVersion`. Loading or importing runs it
// forward through this chain until it matches SCHEMA_VERSION. Migrations are
// pure functions from one version's shape to the next, and each one records
// what it changed so the import report can say so out loud.

import { SCHEMA_VERSION, DEFAULT_SETTINGS, COLLECTIONS, deepClone } from './schema.js';
import { uid } from './ids.js';
import { nowStamp } from './dates.js';

/**
 * v1 → v2
 *   - questions moved from `banks: { sql: [], leetcode: [], gre: [] }` to a
 *     single flat `questions` array carrying a `bank` field, so the review
 *     queue can be built without touching three lists.
 *   - stages carried a stored `done` boolean; completion is now derived, and
 *     an explicitly-set `done` becomes `forceCompleted`.
 */
function v1_to_v2(input) {
  const state = deepClone(input);
  const notes = [];

  if (state.banks && typeof state.banks === 'object') {
    const flat = Array.isArray(state.questions) ? [...state.questions] : [];
    let moved = 0;
    for (const bank of ['sql', 'leetcode', 'gre']) {
      for (const question of state.banks[bank] ?? []) {
        flat.push({ ...question, bank: question.bank || bank });
        moved += 1;
      }
    }
    state.questions = flat;
    delete state.banks;
    if (moved) notes.push(`moved ${moved} question(s) from per-bank lists into a single list`);
  }

  let converted = 0;
  for (const thread of state.threads ?? []) {
    for (const stage of thread.stages ?? []) {
      if (Object.prototype.hasOwnProperty.call(stage, 'done')) {
        if (stage.done === true && stage.forceCompleted !== true) {
          stage.forceCompleted = true;
          stage.forceCompletedAt = stage.forceCompletedAt ?? null;
          converted += 1;
        }
        delete stage.done;
      }
    }
  }
  if (converted) notes.push(`converted ${converted} stored stage completion flag(s) to force-completed`);

  state.schemaVersion = 2;
  return { state, notes };
}

/**
 * v2 → v3
 *   - weeks became Sunday-to-Saturday everywhere, and the week start stopped
 *     being a setting: it is now a single constant in dates.js. An old file's
 *     `settings.weekStartsOn` is dropped rather than silently obeyed, because
 *     obeying it would give one user Monday weeks and no way to say so.
 *   - habits gained a `kind`, so the gym can carry sessions while everything
 *     else stays a name, a target and a log of dates.
 *   - new collections: exercises, gymSessions, chessGames.
 *   - books gained a source, a page count, bookmarks and cover/file metadata.
 *     Everything that existed before was typed in by hand, so it becomes
 *     `source: 'manual'` and keeps its position untouched.
 */
function v2_to_v3(input) {
  const state = deepClone(input);
  const notes = [];

  if (state.settings && Object.prototype.hasOwnProperty.call(state.settings, 'weekStartsOn')) {
    const was = state.settings.weekStartsOn;
    delete state.settings.weekStartsOn;
    if (was !== 0) notes.push('weeks now run Sunday to Saturday — the old Monday week start was dropped');
  }

  for (const key of ['exercises', 'gymSessions', 'chessGames']) {
    if (!Array.isArray(state[key])) state[key] = [];
  }

  let habits = 0;
  for (const habit of state.habits ?? []) {
    if (habit && typeof habit === 'object' && habit.kind === undefined) {
      habit.kind = 'simple';
      habits += 1;
    }
  }
  if (habits) notes.push(`marked ${habits} habit(s) as simple day-log habits`);

  let books = 0;
  for (const book of state.reading ?? []) {
    if (!book || typeof book !== 'object') continue;
    if (book.source === undefined) {
      book.source = 'manual';
      books += 1;
    }
    if (book.fileName === undefined) book.fileName = '';
    if (book.fileSize === undefined) book.fileSize = 0;
    if (book.pageCount === undefined) book.pageCount = null;
    if (book.cover === undefined) book.cover = null;
    if (book.lastOpenedAt === undefined) book.lastOpenedAt = null;
    if (!Array.isArray(book.bookmarks)) book.bookmarks = [];
  }
  if (books) notes.push(`kept ${books} hand-tracked book(s) as they were, alongside the new imported ones`);

  state.schemaVersion = 3;
  return { state, notes };
}

/**
 * v3 → v4
 *   - a time block pointed at a thread and nothing else. It now points at an
 *     "activity", which is a thread *or* one of the standing areas of the app,
 *     so a week of gym, GRE and applications stops reading as unassigned.
 *   - planned and actual were two time pairs on one record. They are now two
 *     records with a status, which is what they always were. A block carrying
 *     both is split in two: the plan keeps its times, and a second block is
 *     created for what actually happened. Nothing is averaged or dropped.
 */
function v3_to_v4(input) {
  const state = deepClone(input);
  const notes = [];
  const blocks = Array.isArray(state.timeBlocks) ? state.timeBlocks : [];
  const created = [];
  let reassigned = 0;
  let split = 0;

  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue;

    if (block.activity === undefined) {
      block.activity = block.threadId ? `thread:${block.threadId}` : null;
      if (block.threadId) reassigned += 1;
    }
    delete block.threadId;

    const hadActual = !!block.actualStart && !!block.actualEnd;
    const hadPlan = !!block.start && !!block.end;

    if (hadActual && hadPlan) {
      created.push({
        ...block,
        id: `${block.id}_logged`,
        start: block.actualStart,
        end: block.actualEnd,
        status: 'logged',
        // The note was written about the doing, so it travels with the log.
        notes: block.notes ?? '',
      });
      block.notes = '';
      split += 1;
      block.status = 'planned';
    } else if (hadActual) {
      // Only ever logged: it is the record of what happened.
      block.start = block.actualStart;
      block.end = block.actualEnd;
      block.status = 'logged';
    } else if (block.status === undefined) {
      block.status = 'planned';
    }

    delete block.actualStart;
    delete block.actualEnd;
  }

  if (created.length) blocks.push(...created);
  state.timeBlocks = blocks;

  if (reassigned) notes.push(`pointed ${reassigned} time block(s) at the thread they were assigned to`);
  if (split) notes.push(`split ${split} time block(s) into the plan and the separate record of what was actually done`);

  state.schemaVersion = 4;
  return { state, notes };
}

/**
 * v4 → v5
 *   - the generic habit model is gone. The gym was the only thing being tracked
 *     that way, and everything it needs — sessions, exercises, pain — is now its
 *     own shape. A gym habit's weekly target becomes the gym target; its date
 *     log was only ever a mirror of the sessions, so nothing is lost with it.
 *   - a habit that was *not* the gym is turned into a note rather than deleted.
 *     Discarding a year of logged days without asking would be the kind of
 *     silent data loss the import validator exists to prevent, so the dates go
 *     somewhere they can still be read.
 *   - exercises gained secondary muscles, equipment, a status with a reason for
 *     dropping, and cues. `retired: true` becomes `status: 'dropped'` with no
 *     reason, because the old model never asked for one.
 *   - sessions gained an end time, skipped exercises, per-exercise notes and a
 *     routine slot; pain became its own record.
 */
function v4_to_v5(input) {
  const state = deepClone(input);
  const notes = [];

  for (const key of ['routines', 'painRecords']) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  if (!Array.isArray(state.notes)) state.notes = [];
  if (!state.settings || typeof state.settings !== 'object') state.settings = {};

  // --- habits ---------------------------------------------------------------
  const habits = Array.isArray(state.habits) ? state.habits : [];
  const gymHabits = habits.filter((h) => h?.kind === 'gym');
  const others = habits.filter((h) => h?.kind !== 'gym');

  if (gymHabits.length && state.settings.gymWeeklyTarget === undefined) {
    // If there were somehow several, the largest target is the safe one to
    // keep: it is the only choice that cannot quietly lower a goal.
    const target = Math.max(...gymHabits.map((h) => Number(h.weeklyTarget) || 0), 0);
    if (target > 0) {
      state.settings.gymWeeklyTarget = Math.round(target);
      notes.push(`kept your weekly gym target of ${Math.round(target)}`);
    }
  }

  for (const habit of others) {
    const dates = [...new Set((habit.log ?? []).filter((d) => typeof d === 'string'))].sort();
    state.notes.push({
      id: uid('note'),
      title: `Habit archive: ${habit.name || 'Untitled habit'}`,
      body: [
        `Cairn no longer tracks habits other than the gym, so this habit was turned into a note rather than deleted.`,
        '',
        `Weekly target: ${habit.weeklyTarget ?? '—'}`,
        `Days logged: ${dates.length}`,
        '',
        ...dates.map((d) => `- ${d}`),
      ].join('\n'),
      templateId: null,
      attach: null,
      createdAt: nowStamp(),
      updatedAt: nowStamp(),
    });
  }
  if (others.length) {
    notes.push(`turned ${others.length} non-gym habit(s) into notes so the logged days are still readable`);
  }
  delete state.habits;

  // --- the gym's sessions ---------------------------------------------------
  for (const session of state.gymSessions ?? []) {
    if (!session || typeof session !== 'object') continue;
    delete session.habitId;
    if (session.routineId === undefined) session.routineId = null;
    if (session.endTime === undefined) session.endTime = null;
    if (!Array.isArray(session.skipped)) session.skipped = [];
    for (const entry of session.exercises ?? []) {
      if (entry.note === undefined) entry.note = '';
      if (entry.substitutedFor === undefined) entry.substitutedFor = null;
    }
  }

  // --- the library ----------------------------------------------------------
  let dropped = 0;
  for (const exercise of state.exercises ?? []) {
    if (!exercise || typeof exercise !== 'object') continue;
    if (exercise.status === undefined) {
      exercise.status = exercise.retired ? 'dropped' : 'active';
      if (exercise.retired) dropped += 1;
    }
    delete exercise.retired;
    if (exercise.dropReason === undefined) exercise.dropReason = null;
    if (exercise.dropNote === undefined) exercise.dropNote = '';
    if (!Array.isArray(exercise.secondary)) exercise.secondary = [];
    // Nothing recorded equipment before this version, and guessing would be
    // worse than admitting it: the library asks for these to be filled in.
    if (exercise.equipment === undefined) exercise.equipment = 'unspecified';
    if (exercise.cues === undefined) exercise.cues = '';
  }
  if (dropped) {
    notes.push(`marked ${dropped} retired exercise(s) as dropped — open the library to say why`);
  }

  state.schemaVersion = 5;
  return { state, notes };
}

/**
 * v5 → v6
 *   - the GRE became its own view rather than a thread, because it is a fixed
 *     daily programme with an end date, not a tree of stages. Four collections
 *     arrive empty: the plan is seeded from a paste, never from the source.
 */
function v5_to_v6(input) {
  const state = deepClone(input);
  const notes = [];
  for (const key of ['greBlocks', 'grePhases', 'greDays', 'greEntries']) {
    if (!Array.isArray(state[key])) state[key] = [];
  }
  if (!state.settings || typeof state.settings !== 'object') state.settings = {};
  if (!Array.isArray(state.settings.greIntervals)) {
    state.settings.greIntervals = [3, 10];
    notes.push('added the GRE retrieval spacing: a cold re-attempt at +3 days, then +10');
  }
  state.schemaVersion = 6;
  return { state, notes };
}

export const MIGRATIONS = {
  1: v1_to_v2,
  2: v2_to_v3,
  3: v3_to_v4,
  4: v4_to_v5,
  5: v5_to_v6,
};

export const OLDEST_SUPPORTED_VERSION = 1;

/**
 * Run a state forward to the current schema version.
 * @returns {{state:object, applied:number[], notes:string[], error:string|null}}
 */
export function migrate(input) {
  let state = input;
  const applied = [];
  const notes = [];
  let guard = 0;

  let version = Number(state?.schemaVersion);
  if (!Number.isInteger(version)) {
    return { state, applied, notes, error: 'missing or non-integer schemaVersion' };
  }
  if (version > SCHEMA_VERSION) {
    return {
      state,
      applied,
      notes,
      error: `file is schema v${version} but this build only understands up to v${SCHEMA_VERSION}. Update Cairn before importing.`,
    };
  }
  if (version < OLDEST_SUPPORTED_VERSION) {
    return { state, applied, notes, error: `schema v${version} is older than the oldest supported version (v${OLDEST_SUPPORTED_VERSION})` };
  }

  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) {
      return { state, applied, notes, error: `no migration registered from schema v${version}` };
    }
    const result = step(state);
    state = result.state;
    notes.push(...(result.notes ?? []).map((n) => `v${version}→v${version + 1}: ${n}`));
    applied.push(version);
    version = Number(state.schemaVersion);
    guard += 1;
    if (guard > 50) return { state, applied, notes, error: 'migration chain did not terminate' };
  }

  return { state, applied, notes, error: null };
}

/**
 * Fill in collections and settings a valid-but-sparse file omitted. Additive
 * only -- it never removes or rewrites data that is already there.
 */
export function backfillDefaults(state, templates = []) {
  const notes = [];
  for (const key of COLLECTIONS) {
    if (!Array.isArray(state[key])) {
      state[key] = [];
      notes.push(`added missing "${key}" collection (empty)`);
    }
  }
  if (!state.settings || typeof state.settings !== 'object') {
    state.settings = { ...DEFAULT_SETTINGS };
    notes.push('restored default settings');
  } else {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (state.settings[key] === undefined) {
        state.settings[key] = Array.isArray(value) ? [...value] : value;
        notes.push(`filled default setting "${key}"`);
      }
    }
  }
  if (!state.meta || typeof state.meta !== 'object') {
    state.meta = { createdAt: null, updatedAt: null, writeSeq: 0, writerId: null };
    notes.push('rebuilt meta block');
  }
  if (templates.length) {
    const have = new Set(state.noteTemplates.map((t) => t.id));
    for (const template of templates) {
      if (!have.has(template.id)) {
        state.noteTemplates.push({ ...template });
        notes.push(`restored built-in template "${template.name}"`);
      }
    }
  }
  // Ids are load-bearing: anything without one gets a fresh id rather than
  // being dropped.
  for (const key of COLLECTIONS) {
    for (const item of state[key]) {
      if (item && typeof item === 'object' && !item.id) {
        item.id = uid(key.slice(0, 3));
        notes.push(`generated a missing id in "${key}"`);
      }
    }
  }
  return notes;
}
