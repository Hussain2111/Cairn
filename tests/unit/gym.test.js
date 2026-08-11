import test from 'node:test';
import assert from 'node:assert/strict';

import {
  weekProgress,
  muscleCoverage,
  gapReport,
  equipmentPreference,
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
  exerciseProgression,
  lastSetsFor,
  trainedExerciseIds,
  routines,
  nextRoutine,
  seedLibrary,
  painByLocation,
  painTable,
  painTableCsv,
} from '../../src/core/gym.js';
import {
  createEmptyState,
  makeExercise,
  makeRoutine,
  makeGymSession,
  makeSessionExercise,
  makeSkippedExercise,
  makeSet,
  makePainRecord,
} from '../../src/core/schema.js';

// Weeks run Sunday to Saturday: Sun 2026-08-02 .. Sat 2026-08-08.
const FRI = '2026-08-07';

function fixture({ target = 4 } = {}) {
  const state = createEmptyState([]);
  state.settings.gymWeeklyTarget = target;

  const bench = makeExercise({ name: 'Bench press', muscle: 'chest', secondary: ['arms'], equipment: 'barbell' });
  const cableFly = makeExercise({ name: 'Cable fly', muscle: 'chest', equipment: 'cable' });
  const row = makeExercise({ name: 'Barbell row', muscle: 'back', secondary: ['arms'], equipment: 'barbell' });
  const squat = makeExercise({ name: 'Squat', muscle: 'legs', equipment: 'barbell' });
  const pullup = makeExercise({ name: 'Pull-up', muscle: 'back', equipment: 'bodyweight' });
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

test('the session duration comes from the clock, or from what was written down', () => {
  assert.equal(sessionMinutes(makeGymSession({ startTime: '18:05', endTime: '19:20' })), 75);
  assert.equal(sessionMinutes(makeGymSession({ durationMinutes: 55 })), 55, 'an imported log rarely has times');
  assert.equal(sessionMinutes(makeGymSession({ startTime: '19:00', endTime: '18:00', durationMinutes: 40 })), 40,
    'times that cannot be right fall back rather than going negative');
  assert.equal(sessionMinutes(makeGymSession()), 0);
});

// --- muscle coverage --------------------------------------------------------

test('coverage separates direct work from assistance', () => {
  const { state, bench, row, add } = fixture();
  add('2026-08-03', [[bench, [[10, 60], [8, 65]]]]);
  add('2026-08-05', [[row, [[10, 50]]]]);

  const byMuscle = Object.fromEntries(muscleCoverage(state, FRI).map((c) => [c.muscle, c]));

  assert.equal(byMuscle.chest.primarySets, 2);
  assert.equal(byMuscle.chest.trained, true);
  assert.equal(byMuscle.back.primarySets, 1);

  // Arms were worked as a secondary on both, which is not an arms day.
  assert.equal(byMuscle.arms.primarySets, 0);
  assert.equal(byMuscle.arms.secondarySets, 3);
  assert.equal(byMuscle.arms.trained, false, 'three pressing days do not make an arms day');
  assert.equal(byMuscle.arms.touched, true);

  assert.equal(byMuscle.legs.trained, false);
  assert.equal(byMuscle.legs.sets, 0);
});

test('an untrained group says how long it has actually been', () => {
  const { state, squat, bench, add } = fixture();
  add('2026-07-22', [[squat, [[5, 100]]]]);
  add('2026-08-03', [[bench, [[10, 60]]]]);

  const coverage = muscleCoverage(state, FRI);
  assert.equal(coverage.find((c) => c.muscle === 'legs').lastTrained, '2026-07-22');
  assert.equal(coverage.find((c) => c.muscle === 'arms').lastTrained, null, 'never trained reads as never');
});

test('an exercise logged with no sets does not light up its muscle group', () => {
  const { state, bench, add } = fixture();
  add('2026-08-03', [[bench, []]]);
  assert.equal(muscleCoverage(state, FRI).find((c) => c.muscle === 'chest').trained, false);
  assert.deepEqual(sessionMuscles(state, state.gymSessions[0]), []);
});

test('secondary muscles are listed with the primary, deduplicated', () => {
  const { state, bench } = fixture();
  assert.deepEqual(exerciseMuscles(state, bench.id), ['chest', 'arms']);
  assert.deepEqual(exerciseMuscles(state, 'nonsense'), []);
});

// --- the gap report ---------------------------------------------------------

test('a muscle group with nothing active left is reported as a gap', () => {
  const { state, squat, cableFly, bench } = fixture();
  squat.status = 'dropped';
  squat.dropReason = 'pain';

  const gaps = gapReport(state);
  const legs = gaps.find((g) => g.muscle === 'legs');
  assert.ok(legs, 'legs has no active exercise left');
  assert.equal(legs.reason, 'everything dropped');
  assert.equal(legs.droppedForPain, 1);

  // Chest still has two active options, so it is not a gap.
  assert.equal(gaps.some((g) => g.muscle === 'chest'), false);
  assert.ok(cableFly && bench);

  // A group with nothing in the library at all is a different problem.
  assert.equal(gaps.find((g) => g.muscle === 'core').reason, 'nothing in the library');
});

test('a group whose only options are untried is a gap of its own kind', () => {
  const state = createEmptyState([]);
  state.exercises.push(makeExercise({ name: 'Hanging leg raise', muscle: 'core', status: 'untried' }));
  const core = gapReport(state).find((g) => g.muscle === 'core');
  assert.equal(core.reason, 'only untried options');
  assert.equal(core.untried.length, 1);
});

// --- equipment --------------------------------------------------------------

test('equipment preference counts what was kept and what hurt', () => {
  const { state, bench, cableFly, add } = fixture();
  add('2026-08-03', [[cableFly, [[12, 15], [12, 15], [12, 15]]]]);
  add('2026-08-05', [[bench, [[10, 60]]]]);

  bench.status = 'dropped';
  bench.dropReason = 'pain';
  state.painRecords.push(makePainRecord({ location: 'right shoulder', exerciseId: bench.id }));

  const rows = equipmentPreference(state, { today: FRI });
  const byKind = Object.fromEntries(rows.map((row) => [row.equipment, row]));

  assert.equal(byKind.cable.sets, 3);
  assert.equal(byKind.cable.active, 1);
  assert.equal(byKind.cable.droppedForPain, 0);
  assert.equal(byKind.cable.lastUsed, '2026-08-03');

  assert.equal(byKind.barbell.droppedForPain, 1);
  assert.equal(byKind.barbell.painReports, 1);
  assert.equal(Math.round(byKind.cable.shareOfSets * 100), 75);
});

test('exercises that never say what equipment they use are gathered, not guessed at', () => {
  const state = createEmptyState([]);
  state.exercises.push(makeExercise({ name: 'Mystery machine', muscle: 'back' }));
  const rows = equipmentPreference(state, { today: FRI });
  assert.equal(rows.find((row) => row.equipment === 'unspecified').total, 1);
});

// --- the catalogue ----------------------------------------------------------

test('dropping an exercise hides it from the picker without touching history', () => {
  const { state, bench, add } = fixture();
  add('2026-08-03', [[bench, [[10, 60], [8, 65]]]]);

  bench.status = 'dropped';
  bench.dropReason = 'disliked';

  assert.equal(activeExercises(state).some((e) => e.id === bench.id), false);
  assert.equal(exerciseName(state, bench.id), 'Bench press', 'still named in the session');
  assert.deepEqual(exerciseUsage(state, bench.id), { sessions: 1, sets: 2 });
  assert.equal(sessionTotals(state.gymSessions[0]).sets, 2);
  assert.equal(muscleCoverage(state, FRI).find((c) => c.muscle === 'chest').primarySets, 2);
});

test('an untried exercise is still offered — trying it is the point', () => {
  const state = createEmptyState([]);
  const untried = makeExercise({ name: 'Pendlay row', muscle: 'back', status: 'untried' });
  const dropped = makeExercise({ name: 'Upright row', muscle: 'shoulders', status: 'dropped' });
  state.exercises.push(untried, dropped);

  const names = activeExercises(state).map((e) => e.name);
  assert.deepEqual(names, ['Pendlay row']);
});

test('an exercise that is gone entirely is named rather than rendered blank', () => {
  const { state, bench, add } = fixture();
  add('2026-08-03', [[bench, [[10, 60]]]]);
  state.exercises = state.exercises.filter((e) => e.id !== bench.id);

  assert.equal(exerciseName(state, bench.id), 'Removed exercise');
  assert.equal(sessionTotals(state.gymSessions[0]).sets, 1, 'the sets are still the record');
  assert.equal(muscleCoverage(state, FRI).find((c) => c.muscle === 'chest').primarySets, 0);
});

test('duplicate exercise names are caught, dropped ones included', () => {
  const { state, bench } = fixture();
  assert.equal(exerciseNameTaken(state, 'Bench press'), true);
  assert.equal(exerciseNameTaken(state, '  bench PRESS '), true);
  assert.equal(exerciseNameTaken(state, 'Bench press', bench.id), false, 'renaming itself is fine');
  bench.status = 'dropped';
  assert.equal(exerciseNameTaken(state, 'Bench press'), true);
});

test('the starter library seeds once, with a rotation, and never duplicates', () => {
  const state = createEmptyState([]);
  const first = seedLibrary(state);
  assert.ok(first > 15);
  assert.equal(routines(state).length, 2, 'an A/B split is two slots');
  assert.equal(seedLibrary(state), 0);
  assert.equal(state.exercises.length, first);
  assert.equal(routines(state).length, 2);
});

// --- the rotation -----------------------------------------------------------

test('the next slot is the one after the last session that named one', () => {
  const state = createEmptyState([]);
  const a = makeRoutine({ name: 'A', order: 0 });
  const b = makeRoutine({ name: 'B', order: 1 });
  state.routines.push(b, a); // stored out of order on purpose

  assert.equal(nextRoutine(state).name, 'A', 'with nothing logged, start at the top');

  state.gymSessions.push(makeGymSession({ date: '2026-08-03', routineId: a.id }));
  assert.equal(nextRoutine(state).name, 'B');

  state.gymSessions.push(makeGymSession({ date: '2026-08-05', routineId: b.id }));
  assert.equal(nextRoutine(state).name, 'A', 'and it wraps');
});

test('a session with no slot does not disturb the rotation', () => {
  const state = createEmptyState([]);
  const a = makeRoutine({ name: 'A', order: 0 });
  const b = makeRoutine({ name: 'B', order: 1 });
  state.routines.push(a, b);
  state.gymSessions.push(makeGymSession({ date: '2026-08-03', routineId: a.id }));
  state.gymSessions.push(makeGymSession({ date: '2026-08-05', routineId: null }));

  assert.equal(nextRoutine(state).name, 'B', 'the last session that named a slot is what counts');
});

// --- partial sessions -------------------------------------------------------

test('what was skipped is recorded beside what was done', () => {
  const { state, bench, squat, add } = fixture();
  const session = add('2026-08-03', [[bench, [[10, 60]]]]);
  session.skipped = [
    makeSkippedExercise({ exerciseId: squat.id, reason: 'occupied', note: 'rack taken' }),
  ];

  const totals = sessionTotals(session);
  assert.equal(totals.exercises, 1);
  assert.equal(totals.skipped, 1);
  // A skipped exercise is not training: it must not light up its muscle group.
  assert.equal(muscleCoverage(state, FRI).find((c) => c.muscle === 'legs').trained, false);
});

test('a substitution keeps both halves', () => {
  const { state, squat, bench, add } = fixture();
  const session = add('2026-08-03', []);
  session.exercises = [makeSessionExercise({
    exerciseId: bench.id,
    substitutedFor: squat.id,
    sets: [makeSet({ reps: 10, weight: 60 })],
  })];

  assert.equal(exerciseName(state, session.exercises[0].exerciseId), 'Bench press');
  assert.equal(exerciseName(state, session.exercises[0].substitutedFor), 'Squat');
});

test('a per-exercise note is kept verbatim, not categorised', () => {
  const { state, bench, add } = fixture();
  add('2026-08-03', [[bench, [[10, 60]]], ]);
  state.gymSessions[0].exercises[0].note = 'no tension in the target muscle, first two sets locking out at the top';
  assert.match(state.gymSessions[0].exercises[0].note, /locking out at the top/);
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
