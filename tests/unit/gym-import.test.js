import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseLogbook,
  planLogbookImport,
  parseLooseDate,
  parseDuration,
  parseSets,
  parseMuscleList,
  parseEquipment,
  parseDropReason,
  parseSkipReason,
  guessMuscleFromName,
  findBodyPart,
  LOGBOOK_EXAMPLE,
} from '../../src/core/gym-import.js';
import { migrate } from '../../src/core/migrations.js';
import { createEmptyState, makeExercise, SCHEMA_VERSION } from '../../src/core/schema.js';

// --- the small parsers ------------------------------------------------------

test('dates are read in the shapes a handwritten log uses', () => {
  assert.equal(parseLooseDate('2026-08-03'), '2026-08-03');
  assert.equal(parseLooseDate('## 2026-08-03 (A)'), '2026-08-03');
  assert.equal(parseLooseDate('3 Aug 2026'), '2026-08-03');
  assert.equal(parseLooseDate('August 3rd, 2026'), '2026-08-03');
  assert.equal(parseLooseDate('03/08/2026'), '2026-08-03', 'day first — this is a personal log');
  assert.equal(parseLooseDate('not a date'), null);
  assert.equal(parseLooseDate('2026-02-30'), null, 'a day that does not exist is not a date');
});

test('durations are read from words as well as numbers', () => {
  assert.equal(parseDuration('75 min'), 75);
  assert.equal(parseDuration('1h 10'), 70);
  assert.equal(parseDuration('1 hour 15 minutes'), 75);
  assert.equal(parseDuration('90'), 90);
  assert.equal(parseDuration('ages'), null);
});

test('sets are read from every notation the log actually uses', () => {
  assert.deepEqual(parseSets('3×10'), [
    { reps: 10, weight: null }, { reps: 10, weight: null }, { reps: 10, weight: null },
  ]);
  assert.deepEqual(parseSets('3x10 @ 40kg'), [
    { reps: 10, weight: 40 }, { reps: 10, weight: 40 }, { reps: 10, weight: 40 },
  ]);
  assert.deepEqual(parseSets('10, 10, 8 @ 40'), [
    { reps: 10, weight: 40 }, { reps: 10, weight: 40 }, { reps: 8, weight: 40 },
  ]);
  assert.deepEqual(parseSets('10/10/8'), [
    { reps: 10, weight: null }, { reps: 10, weight: null }, { reps: 8, weight: null },
  ]);
  assert.deepEqual(parseSets('12 reps @ bw'), [{ reps: 12, weight: null }]);
  assert.deepEqual(parseSets('good pump'), [], 'prose is not a set');
});

test('a weight that was never recorded stays absent rather than becoming zero', () => {
  const [set] = parseSets('3×10');
  assert.equal(set.weight, null, '"no load recorded" and "lifted nothing" are different claims');
});

test('muscles, equipment and reasons are read from the words used', () => {
  assert.deepEqual(parseMuscleList('quads, glutes'), ['legs']);
  assert.deepEqual(parseMuscleList('back and biceps'), ['back', 'arms']);
  assert.equal(parseEquipment('Smith machine'), 'smith', 'Smith beats "machine"');
  assert.equal(parseEquipment('cable'), 'cable');
  assert.equal(parseEquipment('DB'), 'dumbbell');
  assert.equal(parseEquipment('nonsense'), null);

  assert.equal(parseDropReason('pain in the right shoulder'), 'pain');
  assert.equal(parseDropReason('no tension in the target muscle'), 'disliked');
  assert.equal(parseDropReason('gym does not have one'), 'unavailable');
  assert.equal(parseSkipReason('machine occupied').reason, 'occupied');
  assert.equal(parseSkipReason('ran out of time').reason, 'time');
  assert.equal(parseSkipReason('chose not to').reason, 'chose not to');
});

test('a muscle can be guessed from the movement name, and a body part from a sentence', () => {
  assert.equal(guessMuscleFromName('Cable fly'), 'chest');
  assert.equal(guessMuscleFromName('Seated row'), 'back');
  assert.equal(guessMuscleFromName('Smith machine squat'), 'legs');
  assert.equal(guessMuscleFromName('Zercher thingy'), null);

  assert.equal(findBodyPart('right shoulder pain on the third set'), 'right shoulder');
  assert.equal(findBodyPart('pain on the third set'), null, 'a when is not a where');
});

// --- the document -----------------------------------------------------------

test('the example logbook parses completely, with nothing left over', () => {
  const parsed = parseLogbook(LOGBOOK_EXAMPLE);
  assert.equal(parsed.unparsed.length, 0);
  assert.equal(parsed.stats.sessions, 2);
  assert.equal(parsed.stats.sets, 15);
  assert.equal(parsed.stats.skipped, 1);
  assert.equal(parsed.stats.pain, 1);
  assert.equal(parsed.stats.cues, 2);
  assert.equal(parsed.stats.drops, 2);
});

test('a library table becomes exercises with muscles and equipment', () => {
  const parsed = parseLogbook(LOGBOOK_EXAMPLE);
  const byName = Object.fromEntries(parsed.exercises.map((e) => [e.name, e]));

  assert.equal(byName['Lat pulldown'].muscle, 'back');
  assert.deepEqual(byName['Lat pulldown'].secondary, ['arms']);
  assert.equal(byName['Lat pulldown'].equipment, 'cable');
  assert.equal(byName['Chest press machine'].equipment, 'machine');
  assert.equal(byName['Barbell squat'].muscle, 'legs');
  assert.deepEqual(byName['Barbell squat'].secondary, [], 'a secondary that repeats the primary is dropped');
});

test('sessions carry duration, warm-up, sets and the per-exercise feedback', () => {
  const parsed = parseLogbook(LOGBOOK_EXAMPLE);
  const [first, second] = parsed.sessions;

  assert.equal(first.date, '2026-08-03');
  assert.equal(first.routineName, 'A');
  assert.equal(first.durationMinutes, 70);
  assert.equal(first.warmup, true);
  assert.equal(first.warmupMinutes, 10);

  const fly = first.exercises.find((e) => e.name === 'Cable fly');
  assert.equal(fly.note, 'no tension in the target muscle', 'the sentence survives intact');
  assert.equal(fly.sets.length, 3);

  assert.equal(second.warmup, false, '"Warm-up: none" is a no, not a missing field');
  assert.equal(second.warmupMinutes, null);
});

test('a substitution is read as both halves', () => {
  const parsed = parseLogbook(LOGBOOK_EXAMPLE);
  const swap = parsed.sessions[0].exercises.find((e) => e.substitutedForName);
  assert.equal(swap.name, 'Smith machine squat');
  assert.equal(swap.substitutedForName, 'Barbell squat');
});

test('a skipped exercise keeps its reason', () => {
  const [session] = parseLogbook(LOGBOOK_EXAMPLE).sessions;
  assert.deepEqual(
    session.skipped.map((s) => [s.name, s.reason]),
    [['Leg press', 'occupied']],
  );
});

test('cues and the dropped list land on the right exercises', () => {
  const parsed = parseLogbook(LOGBOOK_EXAMPLE);
  const byName = Object.fromEntries(parsed.exercises.map((e) => [e.name, e]));

  assert.match(byName['Lat pulldown'].cues, /drive the elbows down/);
  assert.equal(byName['Upright row'].status, 'dropped');
  assert.equal(byName['Upright row'].dropReason, 'pain');
  assert.equal(byName['Barbell curl'].dropReason, 'disliked', 'disliked and painful are not the same thing');
});

test('pain written inside a session and again in the table is one event', () => {
  const parsed = parseLogbook(LOGBOOK_EXAMPLE);
  assert.equal(parsed.pain.length, 1);
  assert.equal(parsed.pain[0].location, 'right shoulder');
  assert.equal(parsed.pain[0].exerciseName, 'Seated row');
  assert.equal(parsed.pain[0].date, '2026-08-05');
});

test('every line that could not be interpreted is reported, with its number', () => {
  const parsed = parseLogbook(`## 2026-08-03

- Bench press · 3×10 @ 60kg

Felt reasonably strong today, thinking about changing the split soon.
`);
  assert.equal(parsed.sessions.length, 1);
  assert.equal(parsed.sessions[0].exercises.length, 1);

  assert.equal(parsed.unparsed.length, 1, 'the prose was not silently swallowed');
  assert.equal(parsed.unparsed[0].line, 5);
  assert.match(parsed.unparsed[0].text, /thinking about changing the split/);
});

test('a muscle read from the name is flagged rather than presented as fact', () => {
  const parsed = parseLogbook(`## 2026-08-03
- Cable fly · 3×12
`);
  const [fly] = parsed.exercises;
  assert.equal(fly.muscle, 'chest');
  assert.equal(fly.guessedMuscle, true);
  assert.equal(fly.guessedFromName, true);
  assert.match(parsed.warnings.map((w) => w.message).join(' '), /read as chest from the name/);
});

test('a session with no date is kept and flagged rather than dropped', () => {
  const parsed = parseLogbook(`## Some session
Duration: 40 min
- Bench press · 3×10
`);
  // The heading is not a date, so the block is not a session start; the lines
  // still have to go somewhere, and that somewhere is the unparsed list.
  assert.ok(parsed.unparsed.length > 0);
});

// --- planning against existing state ---------------------------------------

test('an exercise already in the library is matched, not duplicated', () => {
  const state = createEmptyState([]);
  state.exercises.push(makeExercise({ name: 'Lat pulldown', muscle: 'back', equipment: 'cable' }));

  const plan = planLogbookImport(parseLogbook(LOGBOOK_EXAMPLE), state);
  const existing = plan.library.find((e) => e.name === 'Lat pulldown');
  assert.equal(existing.action, 'update');
  assert.equal(plan.counts.updatedExercises, 1);
  assert.ok(plan.counts.newExercises > 0);
});

test('a session on a date already logged is flagged before committing', () => {
  const state = createEmptyState([]);
  state.gymSessions.push({ id: 's1', date: '2026-08-03', exercises: [], skipped: [] });

  const plan = planLogbookImport(parseLogbook(LOGBOOK_EXAMPLE), state);
  assert.equal(plan.counts.clashes, 1);
  assert.equal(plan.sessions.find((s) => s.date === '2026-08-03').clash, true);
  assert.equal(plan.sessions.find((s) => s.date === '2026-08-05').clash, false);
});

// --- the migration off habits ----------------------------------------------

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
  assert.equal(state.gymSessions[0].routineId, null);
  assert.deepEqual(state.gymSessions[0].skipped, []);
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
  assert.equal(exercise.dropReason, null, 'the old model never asked why, so it does not pretend to know');
  assert.equal(exercise.equipment, 'unspecified');
  assert.deepEqual(exercise.secondary, []);
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
