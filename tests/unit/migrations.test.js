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
  const archived = state.notes.find((n) => n.title.includes('Stretching'));
  assert.ok(archived, 'a year of logged days is not thrown away without saying so');
  assert.match(archived.body, /2026-08-03/);
  assert.match(archived.body, /2026-08-05/);
  assert.ok(notes.some((n) => /turned 1 non-gym habit/.test(n)));
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

  const archive = state.notes.find((n) => n.title === 'Gym library archive');
  assert.ok(archive, 'nothing is thrown away without somewhere to read it');
  assert.match(archive.body, /Cable fly.*equipment: cable.*cues: squeeze at the front/);
  assert.match(archive.body, /Upright row.*dropped because: pain.*note: right shoulder/);
  assert.equal(/Plank/.test(archive.body), false, 'an exercise with nothing to keep is not listed');

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
  const out = migrate(createEmptyState([]));
  assert.equal(out.error, null);
  assert.deepEqual(out.applied, []);
});
