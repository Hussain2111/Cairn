import test from 'node:test';
import assert from 'node:assert/strict';

import {
  weekProgress,
  sessions,
  sessionsInWeek,
  sessionTotals,
  sessionMuscles,
  sessionMinutes,
  exerciseName,
  exerciseUsage,
  exerciseNameTaken,
  exerciseMuscles,
  activeExercises,
  droppedExercises,
  exerciseProgression,
  lastSetsFor,
  trainedExerciseIds,
  seedLibrary,
  painByLocation,
  painTable,
  painTableCsv,
} from '../../src/core/gym.js';
import {
  createEmptyState,
  makeExercise,
  makeGymSession,
  makeSessionExercise,
  makeSet,
  makePainRecord,
} from '../../src/core/schema.js';

// Weeks run Sunday to Saturday: Sun 2026-08-02 .. Sat 2026-08-08.
const FRI = '2026-08-07';

function fixture({ target = 4 } = {}) {
  const state = createEmptyState();
  state.settings.gymWeeklyTarget = target;

  const bench = makeExercise({ name: 'Bench press', muscle: 'chest', secondary: ['arms'] });
  const cableFly = makeExercise({ name: 'Cable fly', muscle: 'chest' });
  const row = makeExercise({ name: 'Barbell row', muscle: 'back', secondary: ['arms'] });
  const squat = makeExercise({ name: 'Squat', muscle: 'legs' });
  const pullup = makeExercise({ name: 'Pull-up', muscle: 'back' });
  state.exercises.push(bench, cableFly, row, squat, pullup);

  const add = (date, entries, patch = {}) => {
    const session = makeGymSession({ date, ...patch });
    session.exercises = entries.map(([exercise, sets, note]) =>
      makeSessionExercise({
        exerciseId: exercise.id,
        note: note ?? '',
        sets: sets.map(([reps, weight]) => makeSet({ reps, weight })),
      }));
    state.gymSessions.push(session);
    return session;
  };

  return { state, bench, cableFly, row, squat, pullup, add };
}

// --- the week ---------------------------------------------------------------

test('the week counts sessions inside the Sunday-to-Saturday week only', () => {
  const { state, bench, add } = fixture();
  add('2026-08-01', [[bench, [[10, 60]]]]); // Sat, previous week
  add('2026-08-02', [[bench, [[10, 60]]]]); // Sun, this week
  add('2026-08-05', [[bench, [[10, 60]]]]);
  add('2026-08-09', [[bench, [[10, 60]]]]); // Sun, next week

  assert.equal(sessionsInWeek(state, FRI).length, 2);

  const progress = weekProgress(state, FRI);
  assert.equal(progress.weekStart, '2026-08-02');
  assert.equal(progress.weekEnd, '2026-08-08');
  assert.deepEqual(
    { done: progress.done, target: progress.target, remaining: progress.remaining, daysLeft: progress.daysLeft },
    { done: 2, target: 4, remaining: 2, daysLeft: 2 },
  );
  assert.equal(progress.met, false);
});

test('going past the target is not a debt', () => {
  const { state, bench, add } = fixture({ target: 2 });
  for (const date of ['2026-08-03', '2026-08-04', '2026-08-05']) add(date, [[bench, [[10, 60]]]]);
  const progress = weekProgress(state, FRI);
  assert.equal(progress.remaining, 0);
  assert.equal(progress.met, true);
});

test('the session duration comes from the clock, and never goes negative', () => {
  assert.equal(sessionMinutes(makeGymSession({ startTime: '18:05', endTime: '19:20' })), 75);
  assert.equal(sessionMinutes(makeGymSession({ startTime: '19:00', endTime: '18:00' })), 0);
  assert.equal(sessionMinutes(makeGymSession({ startTime: '18:00' })), 0, 'half a pair is not a duration');
  assert.equal(sessionMinutes(makeGymSession()), 0);
});

// --- what a session touched -------------------------------------------------

test('a session lists the muscles it touched, primary and secondary', () => {
  const { state, bench, row, add } = fixture();
  const session = add('2026-08-03', [[bench, [[10, 60]]], [row, [[10, 50]]]]);
  assert.deepEqual(sessionMuscles(state, session), ['chest', 'back', 'arms']);
});

test('an exercise logged with no sets is not part of what the session touched', () => {
  const { state, bench, add } = fixture();
  const session = add('2026-08-03', [[bench, []]]);
  assert.deepEqual(sessionMuscles(state, session), []);
});

test('secondary muscles are listed with the primary, deduplicated', () => {
  const { state, bench } = fixture();
  assert.deepEqual(exerciseMuscles(state, bench.id), ['chest', 'arms']);
  assert.deepEqual(exerciseMuscles(state, 'nonsense'), []);
});

// --- the catalogue ----------------------------------------------------------

test('dropping an exercise hides it from the picker without touching history', () => {
  const { state, bench, add } = fixture();
  add('2026-08-03', [[bench, [[10, 60], [8, 65]]]]);

  bench.status = 'dropped';

  assert.equal(activeExercises(state).some((e) => e.id === bench.id), false);
  assert.deepEqual(droppedExercises(state).map((e) => e.name), ['Bench press']);
  assert.equal(exerciseName(state, bench.id), 'Bench press', 'still named in the session');
  assert.deepEqual(exerciseUsage(state, bench.id), { sessions: 1, sets: 2 });
  assert.equal(sessionTotals(state.gymSessions[0]).sets, 2);
  assert.deepEqual(sessionMuscles(state, state.gymSessions[0]), ['chest', 'arms'],
    'the session it appears in is unchanged');
});

test('an exercise that is gone entirely is named rather than rendered blank', () => {
  const { state, bench, add } = fixture();
  add('2026-08-03', [[bench, [[10, 60]]]]);
  state.exercises = state.exercises.filter((e) => e.id !== bench.id);

  assert.equal(exerciseName(state, bench.id), 'Removed exercise');
  assert.equal(sessionTotals(state.gymSessions[0]).sets, 1, 'the sets are still the record');
  assert.deepEqual(sessionMuscles(state, state.gymSessions[0]), [], 'but it can no longer say what it trained');
});

test('duplicate exercise names are caught, dropped ones included', () => {
  const { state, bench } = fixture();
  assert.equal(exerciseNameTaken(state, 'Bench press'), true);
  assert.equal(exerciseNameTaken(state, '  bench PRESS '), true);
  assert.equal(exerciseNameTaken(state, 'Bench press', bench.id), false, 'renaming itself is fine');
  bench.status = 'dropped';
  assert.equal(exerciseNameTaken(state, 'Bench press'), true);
});

test('the starter library seeds once and never duplicates', () => {
  const state = createEmptyState();
  const first = seedLibrary(state);
  assert.ok(first > 15);
  assert.equal(seedLibrary(state), 0);
  assert.equal(state.exercises.length, first);
});

// --- the free-text note -----------------------------------------------------

test('a per-exercise note is kept verbatim, not categorised', () => {
  const { state, bench, add } = fixture();
  add('2026-08-03', [[bench, [[10, 60]], 'no tension in the target muscle, first two sets locking out at the top']]);
  assert.match(
    state.gymSessions[0].exercises[0].note,
    /no tension in the target muscle, first two sets locking out at the top/,
  );
});

test('a session note holds whatever the structured fields used to', () => {
  const { state, bench, add } = fixture();
  const session = add('2026-08-03', [[bench, [[10, 60]]]]);
  session.notes = 'Ten minutes of warm-up. Skipped leg press, machine occupied.';
  assert.match(session.notes, /warm-up/);
  assert.match(session.notes, /Skipped leg press/);
});

// --- progression ------------------------------------------------------------

test('progression is oldest first and headlines the heaviest set', () => {
  const { state, bench, add } = fixture();
  add('2026-08-05', [[bench, [[8, 65], [6, 70]]]]);
  add('2026-07-22', [[bench, [[10, 60], [10, 60]]]]);
  add('2026-07-29', [[bench, [[10, 62.5]]]]);

  const points = exerciseProgression(state, bench.id);
  assert.deepEqual(points.map((p) => p.date), ['2026-07-22', '2026-07-29', '2026-08-05']);
  assert.equal(points[2].topWeight, 70);
  assert.equal(points[2].topReps, 6);
  assert.equal(points[0].volume, 1200);
  assert.equal(points[0].bodyweight, false);
});

test('a bodyweight movement progresses by reps, and says so', () => {
  const { state, pullup, add } = fixture();
  add('2026-07-22', [[pullup, [[6, null], [5, null]]]]);
  add('2026-08-05', [[pullup, [[9, null], [8, null]]]]);

  const points = exerciseProgression(state, pullup.id);
  assert.equal(points.every((p) => p.bodyweight), true);
  assert.equal(points[0].topReps, 6);
  assert.equal(points[1].topReps, 9);
  assert.equal(points[1].topWeight, 0, 'there is no load to plot');
  assert.equal(points[1].volume, 0, 'and no volume either');
  assert.equal(points[1].reps, 17);
});

test('at equal weight the heavier set is the one with more reps', () => {
  const { state, bench, add } = fixture();
  add('2026-08-05', [[bench, [[6, 70], [9, 70], [12, 40]]]]);
  const [point] = exerciseProgression(state, bench.id);
  assert.deepEqual([point.topWeight, point.topReps], [70, 9]);
});

test('adding an exercise offers the sets from the last time it was done', () => {
  const { state, bench, add } = fixture();
  add('2026-07-22', [[bench, [[10, 60]]]]);
  add('2026-08-05', [[bench, [[8, 65], [6, 70]]]]);

  assert.deepEqual(lastSetsFor(state, bench.id), [{ reps: 8, weight: 65 }, { reps: 6, weight: 70 }]);
  assert.deepEqual(lastSetsFor(state, 'nonsense'), []);
});

test('two sessions on the same day still have a defined order', () => {
  const { state, bench, add } = fixture();
  const first = add('2026-08-05', [[bench, [[10, 60]]]]);
  const second = add('2026-08-05', [[bench, [[8, 70]]]]);
  first.createdAt = second.createdAt = '2026-08-05T18:00:00';

  assert.deepEqual(sessions(state).map((s) => s.id), [second.id, first.id]);
  assert.deepEqual(lastSetsFor(state, bench.id), [{ reps: 8, weight: 70 }]);
});

test('only exercises actually done appear in the progression picker', () => {
  const { state, bench, squat, add } = fixture();
  add('2026-08-05', [[bench, [[10, 60]]], [squat, []]]);
  assert.deepEqual(trainedExerciseIds(state), [bench.id], 'a block with no sets is not a data point');
});

// --- pain -------------------------------------------------------------------

function painFixture() {
  const { state, bench, cableFly, row, add } = fixture();
  const on = (location, exercise, date, when = 'during', note = '') =>
    state.painRecords.push(makePainRecord({ location, exerciseId: exercise?.id ?? null, date, when, note }));
  return { state, bench, cableFly, row, add, on };
}

test('pain that follows several exercises is separated from pain isolated to one', () => {
  const { state, bench, cableFly, row, on } = painFixture();
  on('right shoulder', bench, '2026-07-20');
  on('Right Shoulder ', cableFly, '2026-08-01', 'after', 'ached that evening');
  on('lower back', row, '2026-08-03');
  on('lower back', row, '2026-08-06');

  const groups = painByLocation(state);
  const shoulder = groups.find((g) => g.key === 'right shoulder');
  const back = groups.find((g) => g.key === 'lower back');

  assert.equal(shoulder.count, 2);
  assert.deepEqual(shoulder.exerciseNames, ['Bench press', 'Cable fly']);
  assert.equal(shoulder.recursAcrossExercises, true, 'two different movements — this one is about the body');
  assert.equal(shoulder.during, 1);
  assert.equal(shoulder.after, 1);
  assert.deepEqual([shoulder.firstSeen, shoulder.lastSeen], ['2026-07-20', '2026-08-01']);

  assert.equal(back.count, 2);
  assert.equal(back.recursAcrossExercises, false, 'twice on the same movement is about the movement');

  // The recurring one is listed first, because it is the one that matters.
  assert.equal(groups[0].key, 'right shoulder');
});

test('location is matched regardless of case and spacing', () => {
  const { state, bench, on } = painFixture();
  on('Right  Shoulder', bench, '2026-08-01');
  on('right shoulder', bench, '2026-08-03');
  assert.equal(painByLocation(state).length, 1);
});

test('pain with no exercise attached still groups by location', () => {
  const { state, on } = painFixture();
  on('neck', null, '2026-08-01');
  const [group] = painByLocation(state);
  assert.equal(group.count, 1);
  assert.equal(group.recursAcrossExercises, false);
  assert.deepEqual(group.exerciseNames, []);
});

test('the pain table exports as dated rows', () => {
  const { state, bench, on } = painFixture();
  on('right shoulder', bench, '2026-08-05', 'during', 'third set only');

  assert.deepEqual(painTable(state), [{
    date: '2026-08-05',
    location: 'right shoulder',
    exercise: 'Bench press',
    when: 'during',
    note: 'third set only',
  }]);

  const csv = painTableCsv(state);
  assert.match(csv, /^date,location,exercise,when,note/);
  assert.match(csv, /2026-08-05,right shoulder,Bench press,during,third set only/);
});

test('a note containing a comma survives the CSV', () => {
  const { state, bench, on } = painFixture();
  on('knee', bench, '2026-08-05', 'after', 'ached, then eased off');
  assert.match(painTableCsv(state), /"ached, then eased off"/);
});
