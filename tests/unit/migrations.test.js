import test from 'node:test';
import assert from 'node:assert/strict';

import { migrate } from '../../src/core/migrations.js';
import { createEmptyState, SCHEMA_VERSION } from '../../src/core/schema.js';

// The chain is only worth having if an old file can still be opened. These
// cover the steps that moved or removed something, not the ones that only
// added an empty collection.

test('a gym habit becomes the weekly target, and the sessions are untouched', () => {
  const v4 = {
    schemaVersion: 4,
    threads: [],
    notes: [],
    habits: [{ id: 'h1', name: 'Gym', kind: 'gym', weeklyTarget: 5, log: ['2026-08-03'], archived: false }],
    exercises: [{ id: 'e1', name: 'Bench press', muscle: 'chest', retired: true }],
    gymSessions: [{ id: 'g1', habitId: 'h1', date: '2026-08-03', exercises: [{ id: 'x1', exerciseId: 'e1', sets: [] }] }],
    settings: {},
  };

  const { state, error, notes } = migrate(v4);
  assert.equal(error, null);
  assert.equal(state.schemaVersion, SCHEMA_VERSION);
  assert.equal(state.habits, undefined, 'the collection is gone');
  assert.equal(state.settings.gymWeeklyTarget, 5);
  assert.equal(state.gymSessions[0].habitId, undefined);
  // The rotation and the skipped list went again in v6→v7; running the whole
  // chain has to land on the current shape, not on an intermediate one.
  assert.equal(state.gymSessions[0].routineId, undefined);
  assert.equal(state.gymSessions[0].skipped, undefined);
  assert.equal(state.gymSessions[0].exercises[0].note, '');
  assert.ok(notes.some((n) => /weekly gym target of 5/.test(n)));
});

test('a retired exercise becomes dropped, with no invented reason', () => {
  const { state } = migrate({
    schemaVersion: 4,
    threads: [], notes: [], habits: [], gymSessions: [], settings: {},
    exercises: [{ id: 'e1', name: 'Upright row', muscle: 'shoulders', retired: true }],
  });
  const [exercise] = state.exercises;
  assert.equal(exercise.status, 'dropped');
  assert.equal(exercise.retired, undefined);
  assert.deepEqual(exercise.secondary, []);
  // v4→v5 declined to invent a reason; v6→v7 removed the field. Neither step
  // guessed, so nothing was ever made up.
  assert.equal(exercise.dropReason, undefined);
  assert.equal(exercise.equipment, undefined);
});

test('a habit that was not the gym becomes a note rather than being deleted', () => {
  const { state, notes } = migrate({
    schemaVersion: 4,
    threads: [], notes: [], gymSessions: [], exercises: [], settings: {},
    habits: [{ id: 'h2', name: 'Stretching', kind: 'simple', weeklyTarget: 5, log: ['2026-08-03', '2026-08-05'] }],
  });

  assert.equal(state.habits, undefined);
  // v4→v5 turned it into a note; v7→v8 removed the notes collection. Running
  // the chain has to land on the current shape, so the note is gone — but the
  // logged days it held come out in the report rather than disappearing with
  // it, which is the whole reason v4→v5 wrote them down.
  assert.equal(state.notes, undefined);
  assert.ok(notes.some((n) => /turned 1 non-gym habit/.test(n)));
  const reproduced = notes.join('\n');
  assert.match(reproduced, /Habit archive: Stretching/);
  assert.match(reproduced, /2026-08-03/);
  assert.match(reproduced, /2026-08-05/);
});

// --- v6 → v7: the two reductions --------------------------------------------

function v6({ ...patch } = {}) {
  return {
    schemaVersion: 6,
    threads: [], notes: [], noteTemplates: [], questions: [], applications: [], outreach: [],
    exercises: [], routines: [], gymSessions: [], painRecords: [],
    greBlocks: [], grePhases: [], greDays: [], greEntries: [],
    chessGames: [], reading: [], timeBlocks: [], archivedStages: [],
    settings: {},
    ...patch,
  };
}

test('chess is removed, and the count is reported rather than deleted quietly', () => {
  const { state, error, notes } = migrate(v6({
    chessGames: [
      { id: 'c1', date: '2026-08-01', result: 'win', lesson: 'hung a knight' },
      { id: 'c2', date: '2026-08-02', result: 'loss', lesson: 'drifted' },
    ],
  }));

  assert.equal(error, null);
  assert.equal(state.schemaVersion, SCHEMA_VERSION);
  assert.equal(state.chessGames, undefined, 'no orphaned key is left behind');
  assert.ok(notes.some((n) => /removed 2 chess game/.test(n)));
});

test('a time block pointing at chess is unassigned rather than left dangling', () => {
  const { state, notes } = migrate(v6({
    timeBlocks: [
      { id: 'b1', date: '2026-08-05', start: '18:00', end: '19:00', activity: 'area:chess', status: 'logged' },
      { id: 'b2', date: '2026-08-05', start: '09:00', end: '10:00', activity: 'area:gym', status: 'logged' },
    ],
  }));

  assert.equal(state.timeBlocks[0].activity, null);
  assert.equal(state.timeBlocks[1].activity, 'area:gym', 'the others are untouched');
  assert.ok(notes.some((n) => /unassigned 1 time block/.test(n)));
});

test('the sets, reps, weights and notes of a logged session survive intact', () => {
  const { state } = migrate(v6({
    exercises: [{ id: 'e1', name: 'Bench press', muscle: 'chest', status: 'active', equipment: 'barbell' }],
    gymSessions: [{
      id: 'g1',
      date: '2026-08-05',
      startTime: '18:00',
      endTime: '19:15',
      exercises: [{
        id: 'x1', exerciseId: 'e1', substitutedFor: null, note: 'good pump',
        sets: [{ id: 's1', reps: 10, weight: 60 }, { id: 's2', reps: 8, weight: 65 }],
      }],
      skipped: [],
      notes: 'felt strong',
    }],
  }));

  const [session] = state.gymSessions;
  assert.equal(session.date, '2026-08-05');
  assert.deepEqual([session.startTime, session.endTime], ['18:00', '19:15']);
  assert.deepEqual(session.exercises[0].sets, [
    { id: 's1', reps: 10, weight: 60 },
    { id: 's2', reps: 8, weight: 65 },
  ]);
  assert.equal(session.exercises[0].note, 'good pump', 'the note is the point of the whole record');
  assert.equal(session.notes, 'felt strong');
});

test('warm-up, the slot and the skipped list are folded into the session note', () => {
  const { state, notes } = migrate(v6({
    routines: [{ id: 'r1', name: 'A — push', order: 0 }],
    exercises: [
      { id: 'e1', name: 'Bench press', muscle: 'chest', status: 'active' },
      { id: 'e2', name: 'Leg press', muscle: 'legs', status: 'active' },
    ],
    gymSessions: [{
      id: 'g1',
      date: '2026-08-05',
      routineId: 'r1',
      warmup: true,
      warmupMinutes: 10,
      durationMinutes: 70,
      notes: 'busy gym.',
      exercises: [{ id: 'x1', exerciseId: 'e1', sets: [{ id: 's1', reps: 10, weight: 60 }], note: '' }],
      skipped: [{ id: 'k1', exerciseId: 'e2', reason: 'occupied', note: 'rack taken' }],
    }],
  }));

  const [session] = state.gymSessions;
  assert.match(session.notes, /^busy gym\./, 'what was already written stays first');
  assert.match(session.notes, /Slot: A — push\./);
  assert.match(session.notes, /Warm-up: 10 min\./);
  assert.match(session.notes, /Duration: 70 min\./, 'a duration with no clock times has nowhere else to go');
  assert.match(session.notes, /Skipped Leg press \(occupied — rack taken\)\./);

  for (const key of ['routineId', 'warmup', 'warmupMinutes', 'durationMinutes', 'skipped']) {
    assert.equal(session[key], undefined, `${key} is gone`);
  }
  assert.equal(state.routines, undefined);
  assert.ok(notes.some((n) => /folded the warm-up, slot and skipped/.test(n)));
});

test('a duration is not folded in when the clock times already say it', () => {
  const { state } = migrate(v6({
    gymSessions: [{
      id: 'g1', date: '2026-08-05', startTime: '18:00', endTime: '19:15',
      durationMinutes: 75, notes: '', exercises: [], skipped: [],
    }],
  }));
  assert.equal(state.gymSessions[0].notes, '', 'it would only repeat what the times already give');
});

test('a substitution becomes a clause on the note of the exercise that happened', () => {
  const { state } = migrate(v6({
    exercises: [
      { id: 'e1', name: 'Smith machine squat', muscle: 'legs', status: 'active' },
      { id: 'e2', name: 'Squat', muscle: 'legs', status: 'active' },
    ],
    gymSessions: [{
      id: 'g1', date: '2026-08-05', notes: '', skipped: [],
      exercises: [{
        id: 'x1', exerciseId: 'e1', substitutedFor: 'e2', note: 'felt stable',
        sets: [{ id: 's1', reps: 8, weight: 60 }],
      }],
    }],
  }));

  const [entry] = state.gymSessions[0].exercises;
  assert.equal(entry.note, 'felt stable Instead of Squat.');
  assert.equal(entry.substitutedFor, undefined);
});

test('equipment, cues and drop reasons are archived as a note rather than deleted', () => {
  const { state, notes } = migrate(v6({
    exercises: [
      { id: 'e1', name: 'Cable fly', muscle: 'chest', status: 'active', equipment: 'cable', cues: 'squeeze at the front' },
      { id: 'e2', name: 'Upright row', muscle: 'shoulders', status: 'dropped', equipment: 'barbell', dropReason: 'pain', dropNote: 'right shoulder' },
      { id: 'e3', name: 'Plank', muscle: 'core', status: 'untried', equipment: 'unspecified' },
    ],
  }));

  // Same again: v6→v7 wrote the archive as a note, v7→v8 took the notes
  // collection away, and the text survives in the report.
  assert.equal(state.notes, undefined);
  const archive = notes.join('\n');
  assert.match(archive, /Gym library archive/);
  assert.match(archive, /Cable fly.*equipment: cable.*cues: squeeze at the front/s);
  assert.match(archive, /Upright row.*dropped because: pain.*note: right shoulder/s);
  assert.equal(/Plank/.test(archive), false, 'an exercise with nothing to keep is not listed');

  for (const exercise of state.exercises) {
    for (const key of ['equipment', 'cues', 'dropReason', 'dropNote']) {
      assert.equal(exercise[key], undefined, `${key} is gone from ${exercise.name}`);
    }
  }
  assert.ok(notes.some((n) => /Gym library archive/.test(n)));
});

test('untried exercises join the active library, since there are only two states now', () => {
  const { state, notes } = migrate(v6({
    exercises: [
      { id: 'e1', name: 'Plank', muscle: 'core', status: 'untried' },
      { id: 'e2', name: 'Squat', muscle: 'legs', status: 'dropped' },
    ],
  }));
  assert.equal(state.exercises[0].status, 'active');
  assert.equal(state.exercises[1].status, 'dropped', 'dropped stays dropped');
  assert.ok(notes.some((n) => /1 untried exercise/.test(n)));
});

test('a file with nothing to change still migrates cleanly', () => {
  const { state, error } = migrate(v6());
  assert.equal(error, null);
  assert.equal(state.schemaVersion, SCHEMA_VERSION);
  assert.equal(state.chessGames, undefined);
  assert.equal(state.routines, undefined);
});

test('a current-version state is left alone', () => {
  const out = migrate(createEmptyState());
  assert.equal(out.error, null);
  assert.deepEqual(out.applied, []);
});

// --- v7 → v8: five removals -------------------------------------------------

function v7({ ...patch } = {}) {
  return {
    schemaVersion: 7,
    threads: [], notes: [], noteTemplates: [], questions: [], applications: [], outreach: [],
    exercises: [], gymSessions: [], painRecords: [],
    greBlocks: [], grePhases: [], greDays: [], greEntries: [],
    reading: [], timeBlocks: [], archivedStages: [],
    settings: { stallDays: 14, greIntervals: [3, 10] },
    ...patch,
  };
}

const threadWith = (id, extra = {}) => ({
  id, name: `Thread ${id}`, type: 'project', notes: '', links: [], stages: [], createdAt: '2026-01-01T09:00:00', ...extra,
});

test('an archived thread becomes done, and the flag goes', () => {
  const { state, notes } = migrate(v7({
    threads: [threadWith('t1', { archived: true }), threadWith('t2', { archived: false })],
  }));
  assert.equal(state.threads[0].status, 'done');
  assert.equal(state.threads[1].status, 'active');
  for (const thread of state.threads) assert.equal(thread.archived, undefined);
  assert.ok(notes.some((n) => /1 archived thread/.test(n)));
});

test('archived stages go back into their thread rather than being deleted with the collection', () => {
  const { state, notes } = migrate(v7({
    threads: [threadWith('t1')],
    archivedStages: [
      { threadId: 't1', threadName: 'Thread t1', stage: { id: 's9', title: 'Shelved', steps: [] }, archivedAt: '2026-06-01T09:00:00' },
      { threadId: 'gone', threadName: 'Deleted', stage: { id: 's8', title: 'Orphan', steps: [] } },
    ],
  }));
  assert.deepEqual(state.threads[0].stages.map((s) => s.title), ['Shelved']);
  assert.equal(state.archivedStages, undefined);
  assert.ok(notes.some((n) => /returned 1 archived stage/.test(n)));
  assert.ok(notes.some((n) => /Orphan/.test(n)), 'one with no thread left is named, not dropped quietly');
});

test('the stall window and the GRE spacing leave the settings', () => {
  const { state } = migrate(v7({ settings: { stallDays: 14, greIntervals: [3, 10], srsIntervals: [0, 2, 7, 21], gymWeeklyTarget: 4 } }));
  assert.equal(state.settings.stallDays, undefined);
  assert.equal(state.settings.greIntervals, undefined);
  assert.deepEqual(state.settings.srsIntervals, [0, 2, 7, 21], 'the review chain is untouched');
  assert.equal(state.settings.gymWeeklyTarget, 4);
});

test('a note attached to a task is folded into that task, keeping its title', () => {
  const thread = threadWith('t1');
  thread.stages = [{
    id: 's1', title: 'Lexer', doneWhen: 'x', steps: [{
      id: 'p1', title: 'Numbers', tasks: [{ id: 'k1', title: 'Integer literals', notes: 'already here' }],
    }],
  }];
  const { state, notes } = migrate(v7({
    threads: [thread],
    notes: [{ id: 'n1', title: 'How the lexer reads digits', body: 'peek, then consume', attach: { type: 'task', id: 'k1' } }],
  }));

  const task = state.threads[0].stages[0].steps[0].tasks[0];
  assert.match(task.notes, /already here/, 'what was already in the note field survives');
  assert.match(task.notes, /How the lexer reads digits/);
  assert.match(task.notes, /peek, then consume/);
  assert.equal(state.notes, undefined);
  assert.ok(notes.some((n) => /folded 1 note/.test(n)));
});

test('a note attached to a thread, stage or step lands on that record', () => {
  const thread = threadWith('t1');
  thread.stages = [{ id: 's1', title: 'Lexer', doneWhen: 'x', notes: '', steps: [{ id: 'p1', title: 'Numbers', notes: '', tasks: [] }] }];
  const { state } = migrate(v7({
    threads: [thread],
    notes: [
      { id: 'n1', title: 'On the thread', body: 'a', attach: { type: 'thread', id: 't1' } },
      { id: 'n2', title: 'On the stage', body: 'b', attach: { type: 'stage', id: 's1' } },
      { id: 'n3', title: 'On the step', body: 'c', attach: { type: 'step', id: 'p1' } },
    ],
  }));
  assert.match(state.threads[0].notes, /On the thread/);
  assert.match(state.threads[0].stages[0].notes, /On the stage/);
  assert.match(state.threads[0].stages[0].steps[0].notes, /On the step/);
});

test('a standalone note has nowhere to go, so its text comes out in the report', () => {
  const { state, notes } = migrate(v7({
    notes: [{ id: 'n1', title: 'Reading list', body: 'Gödel, Escher, Bach\nThe Mythical Man-Month', attach: null }],
  }));
  assert.equal(state.notes, undefined);
  const report = notes.join('\n');
  assert.match(report, /attached to nothing/);
  assert.match(report, /Reading list/);
  assert.match(report, /Mythical Man-Month/, 'the writing is reproduced, not summarised as a count');
});

test('a note attached to something that no longer exists is treated as standalone', () => {
  const { notes } = migrate(v7({
    notes: [{ id: 'n1', title: 'Orphan', body: 'still readable', attach: { type: 'task', id: 'deleted' } }],
  }));
  assert.match(notes.join('\n'), /still readable/);
});

// --- reading ---------------------------------------------------------------

const book = (patch) => ({
  id: 'b1', title: 'SICP', author: 'Abelson', source: 'pdf', fileName: 'sicp.pdf', fileSize: 900,
  pageCount: 657, cover: 'data:image/jpeg;base64,xxx', position: 120, unit: 'page', total: 657,
  status: 'reading', notes: '', bookmarks: [], lastOpenedAt: '2026-08-01', ...patch,
});

test('a book keeps its page and loses everything the reader needed', () => {
  const { state } = migrate(v7({ reading: [book({})] }));
  const [out] = state.reading;
  assert.equal(out.title, 'SICP');
  assert.equal(out.page, 120, 'where I was is the part worth keeping');
  assert.equal(out.status, 'reading');
  assert.equal(out.rating, null);
  for (const key of ['source', 'fileName', 'fileSize', 'pageCount', 'cover', 'position', 'unit', 'total', 'bookmarks', 'lastOpenedAt']) {
    assert.equal(out[key], undefined, `${key} is gone`);
  }
});

test('bookmarks are written into the book note rather than deleted with the reader', () => {
  const { state, notes } = migrate(v7({
    reading: [book({ bookmarks: [{ id: 'm1', page: 42, note: 'the metacircular evaluator' }, { id: 'm2', page: 88, note: '' }] })],
  }));
  assert.match(state.reading[0].notes, /p42 \(the metacircular evaluator\)/);
  assert.match(state.reading[0].notes, /p88/);
  assert.ok(notes.some((n) => /bookmarks/.test(n)));
});

test('paused and abandoned map onto the three states, with the original in the note', () => {
  const { state } = migrate(v7({
    reading: [book({ id: 'b1', status: 'paused' }), book({ id: 'b2', status: 'abandoned' }), book({ id: 'b3', status: 'finished' })],
  }));
  assert.equal(state.reading[0].status, 'reading');
  assert.match(state.reading[0].notes, /Was paused/);
  assert.equal(state.reading[1].status, 'to read');
  assert.match(state.reading[1].notes, /Was abandoned/);
  assert.equal(state.reading[2].status, 'finished');
});

test('a book tracked by percentage has no page, rather than a percentage pretending to be one', () => {
  const { state } = migrate(v7({ reading: [book({ unit: 'percent', position: 45 })] }));
  assert.equal(state.reading[0].page, null);
});

// --- the GRE ----------------------------------------------------------------

test('a logged GRE problem becomes a question in the GRE bank, with its four fields', () => {
  const { state, notes } = migrate(v7({
    greEntries: [{
      id: 'gre1', date: '2026-08-01', source: 'PowerPrep 2 Q14',
      gave: 'two circles, one radius', did: 'solved for the area first', broke: 'missed that they share a centre',
      portable: 'draw the figure before choosing a formula', correct: false, cause: 'careless',
      attempts: [{ id: 'a1', date: '2026-08-04', correct: true, minutes: 3, note: 'saw it immediately' }],
      intervalIndex: 1, dueDate: '2026-08-14', retired: false, retiredAt: null, createdAt: '2026-08-01',
    }],
  }));

  assert.equal(state.greEntries, undefined);
  assert.equal(state.questions.length, 1);
  const [q] = state.questions;
  assert.equal(q.bank, 'gre');
  assert.equal(q.title, 'PowerPrep 2 Q14');
  assert.equal(q.extraction.portable, 'draw the figure before choosing a formula');
  assert.equal(q.extraction.broke, 'missed that they share a centre');
  assert.equal(q.extraction.cause, 'careless');
  // The scheduler is the same one; only the chain differs.
  assert.equal(q.intervalIndex, 1);
  assert.equal(q.dueDate, '2026-08-14');
  assert.equal(q.attempts.length, 1);
  assert.equal(q.attempts[0].unaided, true, 'a correct GRE attempt is an unaided one');
  assert.equal(q.attempts[0].hesitation, 'saw it immediately');
  assert.ok(notes.some((n) => /1 logged GRE problem/.test(n)));
});

test('an entry with no source is titled from what the problem gave', () => {
  const { state } = migrate(v7({
    greEntries: [{ id: 'g1', source: '', gave: 'a quadratic with an irrational root', did: '', broke: '', portable: 'x', attempts: [] }],
  }));
  assert.equal(state.questions[0].title, 'a quadratic with an irrational root');
});

test('the GRE programme itself is gone', () => {
  const { state } = migrate(v7({
    greBlocks: [{ id: 'b1', code: 'A', name: 'Retrieval' }],
    grePhases: [{ id: 'p1', name: 'Phase 1', gateModule: 4, gateByDay: 10 }],
    greDays: [{ id: 'd1', dayNumber: 1, blockCodes: ['A'] }],
  }));
  for (const key of ['greBlocks', 'grePhases', 'greDays', 'greEntries']) {
    assert.equal(state[key], undefined, `${key} is gone`);
  }
});

test('every question carries an extraction afterwards, empty or not', () => {
  const { state } = migrate(v7({
    questions: [{ id: 'q1', bank: 'sql', title: 'Window functions', attempts: [], intervalIndex: 0, dueDate: '2026-08-20' }],
  }));
  assert.deepEqual(state.questions[0].extraction, { gave: '', did: '', broke: '', portable: '', cause: null });
});

test('a v7 file with nothing in it migrates cleanly', () => {
  const { state, error } = migrate(v7());
  assert.equal(error, null);
  assert.equal(state.schemaVersion, SCHEMA_VERSION);
});
