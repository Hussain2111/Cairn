import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isStageComplete,
  isStageUnlocked,
  stageState,
  stageProgress,
  threadProgress,
  nextTask,
  upNext,
  moveStage,
  isActive,
  activeThreads,
  lastCompletionDate,
  actionableDueTasks,
  canStartStage,
  isStageActionable,
} from '../../src/core/threads.js';
import { makeThread, makeStage, makeStep, makeTask } from '../../src/core/schema.js';
import { addDays, todayISO } from '../../src/core/dates.js';

// --- fixtures ---------------------------------------------------------------

function stage(title, taskSpecs = [], extra = {}) {
  const s = makeStage({ title, doneWhen: `${title} is finished` });
  Object.assign(s, extra);
  if (taskSpecs.length) {
    const step = makeStep({ title: `${title} step` });
    for (const spec of taskSpecs) {
      const task = makeTask({ title: spec.title ?? 'task', due: spec.due ?? null });
      task.done = !!spec.done;
      task.doneAt = spec.done ? (spec.doneAt ?? `${todayISO()}T09:00:00`) : null;
      step.tasks.push(task);
    }
    s.steps.push(step);
  }
  return s;
}

function thread(stages, extra = {}) {
  const t = makeThread({ name: 'Thread' });
  t.stages = stages;
  Object.assign(t, extra);
  return t;
}

// --- completion -------------------------------------------------------------

test('a stage completes when all of its tasks are done', () => {
  assert.equal(isStageComplete(stage('A', [{ done: true }, { done: true }])), true);
  assert.equal(isStageComplete(stage('A', [{ done: true }, { done: false }])), false);
});

test('an empty stage is never automatically complete', () => {
  // Otherwise a row of placeholder stages would unlock the whole thread at once.
  assert.equal(isStageComplete(stage('empty')), false);
});

test('force-completing a stage marks it complete with tasks still open', () => {
  const s = stage('A', [{ done: false }, { done: true }], { forceCompleted: true, forceCompletedAt: todayISO() });
  assert.equal(isStageComplete(s), true);
  const progress = stageProgress(s);
  assert.equal(progress.ratio, 1);
  assert.equal(progress.forced, true);
  assert.equal(progress.openTasks, 1, 'the open task is still counted and reported');
});

// --- unlocking --------------------------------------------------------------

test('the first stage is always unlocked; later ones wait for their predecessor', () => {
  const t = thread([stage('A', [{ done: false }]), stage('B', [{ done: false }]), stage('C', [{ done: false }])]);
  assert.equal(isStageUnlocked(t, 0), true);
  assert.equal(isStageUnlocked(t, 1), false);
  assert.equal(isStageUnlocked(t, 2), false);
});

test('completing a stage unlocks the next one only', () => {
  const t = thread([stage('A', [{ done: true }]), stage('B', [{ done: false }]), stage('C', [{ done: false }])]);
  assert.equal(stageState(t, 0), 'complete');
  assert.equal(stageState(t, 1), 'available');
  assert.equal(stageState(t, 2), 'locked');
});

test('force-unlock opens a stage without touching its predecessor', () => {
  const t = thread([stage('A', [{ done: false }]), stage('B', [{ done: false }], { forceUnlocked: true })]);
  assert.equal(stageState(t, 0), 'available');
  assert.equal(stageState(t, 1), 'available');
  assert.equal(isStageComplete(t.stages[0]), false);
});

test('force-unlocking then completing the prior stage does not double-count', () => {
  const t = thread([
    stage('A', [{ done: false }]),
    stage('B', [{ done: true }], { forceUnlocked: true }),
    stage('C', [{ done: false }]),
  ]);
  // C is unlocked because B is complete.
  assert.equal(stageState(t, 2), 'available');
  const before = threadProgress(t);

  // Now finish A. C must not change state, and nothing is counted twice.
  t.stages[0].steps[0].tasks[0].done = true;
  t.stages[0].steps[0].tasks[0].doneAt = `${todayISO()}T10:00:00`;
  assert.equal(stageState(t, 2), 'available');

  const after = threadProgress(t);
  assert.equal(after.done, before.done + 1);
  assert.equal(after.total, before.total);
  assert.equal(after.stagesComplete, 2);
});

test('stage state distinguishes available from in-progress', () => {
  const t = thread([stage('A', [{ done: false }, { done: false }])]);
  assert.equal(stageState(t, 0), 'available');
  t.stages[0].steps[0].tasks[0].done = true;
  assert.equal(stageState(t, 0), 'in-progress');
});

test('a stage cannot be started until a done-when is written', () => {
  const s = stage('A', [{ done: false }]);
  s.doneWhen = '   ';
  const t = thread([s]);
  assert.equal(canStartStage(s), false);
  assert.equal(isStageActionable(t, 0), false);
  s.doneWhen = 'the parser handles nested groups';
  assert.equal(isStageActionable(t, 0), true);
});

// --- reordering -------------------------------------------------------------

test('moving a completed stage after an incomplete one re-locks what follows', () => {
  const t = thread([stage('A', [{ done: true }]), stage('B', [{ done: false }]), stage('C', [{ done: false }])]);
  assert.equal(stageState(t, 1), 'available');

  moveStage(t, 0, 2); // A moves to the end: [B, C, A]
  assert.deepEqual(t.stages.map((s) => s.title), ['B', 'C', 'A']);
  assert.equal(stageState(t, 0), 'available', 'B is now first, so it is unlocked');
  assert.equal(stageState(t, 1), 'locked', 'C waits on B');
  assert.equal(stageState(t, 2), 'complete', 'A stays complete wherever it sits');
});

test('moving an incomplete stage to the front locks the stages behind it', () => {
  const t = thread([stage('A', [{ done: true }]), stage('B', [{ done: true }]), stage('C', [{ done: false }])]);
  moveStage(t, 2, 0); // [C, A, B]
  assert.equal(stageState(t, 0), 'available');
  assert.equal(stageState(t, 1), 'complete');
  assert.equal(stageState(t, 2), 'complete');
  // A is complete, so B stays unlocked; the derived model never goes stale.
  assert.equal(isStageUnlocked(t, 2), true);
});

test('moveStage names both what a move locks and what it unlocks', () => {
  // A is finished, so B is workable and C is waiting behind B. Pulling C above
  // B swaps which of them you are allowed to work in — the whole reason order
  // is meaningful, and invisible unless something says so.
  const t = thread([
    stage('A', [{ done: true }]),
    stage('B', [{ done: false }]),
    stage('C', [{ done: false }]),
  ]);
  assert.deepEqual([0, 1, 2].map((i) => stageState(t, i)), ['complete', 'available', 'locked']);

  const { locked, unlocked } = moveStage(t, 2, 1);
  assert.deepEqual(t.stages.map((s) => s.title), ['A', 'C', 'B']);
  assert.deepEqual(locked.map((s) => s.title), ['B'], 'B now sits behind an unfinished C');
  assert.deepEqual(unlocked.map((s) => s.title), ['C'], 'C now follows the finished A');
});

test('moving a completed stage up locks what used to follow it', () => {
  const t = thread([
    stage('B', [{ done: false }]),
    stage('A', [{ done: true }]),
    stage('C', [{ done: false }]),
  ]);
  assert.equal(stageState(t, 2), 'available', 'C follows the completed A');

  const { locked, unlocked } = moveStage(t, 1, 0);
  assert.deepEqual(t.stages.map((s) => s.title), ['A', 'B', 'C']);
  assert.deepEqual(locked.map((s) => s.title), ['C'], 'C now sits behind the unfinished B');
  assert.deepEqual(unlocked.map((s) => s.title), []);
});

test('a completed stage is never reported as locked, wherever it lands', () => {
  const t = thread([
    stage('open', [{ done: false }]),
    stage('finished', [{ done: true }]),
  ]);
  const { locked } = moveStage(t, 1, 0);
  assert.deepEqual(locked.map((s) => s.title), [], 'completion outranks position');
});

test('a move that changes nothing reports nothing', () => {
  const t = thread([stage('A', [{ done: false }]), stage('B', [{ done: false }])]);
  const { locked, unlocked } = moveStage(t, 0, 0);
  assert.deepEqual(locked, []);
  assert.deepEqual(unlocked, []);
});

test('moveStage on an index that does not exist is a no-op rather than a crash', () => {
  const t = thread([stage('A', [{ done: false }])]);
  const result = moveStage(t, 5, 0);
  assert.deepEqual(result.locked, []);
  assert.equal(t.stages.length, 1);
});

// --- rollup -----------------------------------------------------------------

test('progress rolls up from tasks, weighted by task and not by step', () => {
  const s = makeStage({ title: 'A', doneWhen: 'x' });
  const small = makeStep({ title: 'one task' });
  small.tasks.push(Object.assign(makeTask({ title: 't1' }), { done: true }));
  const big = makeStep({ title: 'three tasks' });
  for (let i = 0; i < 3; i += 1) big.tasks.push(makeTask({ title: `b${i}` }));
  s.steps.push(small, big);

  const progress = stageProgress(s);
  assert.equal(progress.done, 1);
  assert.equal(progress.total, 4);
  assert.equal(progress.ratio, 0.25);
});

test('thread progress sums every stage, including locked ones', () => {
  const t = thread([stage('A', [{ done: true }, { done: true }]), stage('B', [{ done: false }, { done: false }])]);
  const p = threadProgress(t);
  assert.deepEqual({ done: p.done, total: p.total, ratio: p.ratio }, { done: 2, total: 4, ratio: 0.5 });
  assert.equal(p.stagesComplete, 1);
  assert.equal(p.stages, 2);
});

// --- next task --------------------------------------------------------------

test('next task is the first undone task in the earliest workable stage', () => {
  const t = thread([
    stage('A', [{ title: 'a1', done: true }, { title: 'a2', done: false }]),
    stage('B', [{ title: 'b1', done: false }]),
  ]);
  assert.equal(nextTask(t).task.title, 'a2');
});

test('next task skips completed stages and never enters a locked one', () => {
  const t = thread([
    stage('A', [{ title: 'a1', done: true }]),
    stage('B', [{ title: 'b1', done: false }]),
    stage('C', [{ title: 'c1', done: false }]),
  ]);
  assert.equal(nextTask(t).task.title, 'b1');
});

test('next task explains itself when there is nothing to show', () => {
  assert.equal(nextTask(thread([])).blocked, 'no-stages');
  assert.equal(nextTask(thread([stage('A', [{ done: true }])])).blocked, 'complete');

  const noDoneWhen = stage('A', [{ done: false }]);
  noDoneWhen.doneWhen = '';
  assert.equal(nextTask(thread([noDoneWhen])).blocked, 'no-done-when');

  assert.equal(nextTask(thread([stage('A')])).blocked, 'no-tasks');
});

test('up next returns one line per active thread and skips finished ones', () => {
  const state = {
    threads: [
      thread([stage('A', [{ title: 'live', done: false }])], { name: 'Live' }),
      thread([stage('A', [{ title: 'gone', done: false }])], { name: 'Finished', status: 'done' }),
    ],
  };
  const rows = upNext(state);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].task.title, 'live');
});

// --- active and done --------------------------------------------------------

test('a thread is active unless it has been marked done', () => {
  assert.equal(isActive(thread([], {})), true, 'a thread with no status set is active');
  assert.equal(isActive(thread([], { status: 'active' })), true);
  assert.equal(isActive(thread([], { status: 'done' })), false);
});

test('done threads are left out of the active list and of up next', () => {
  const state = {
    threads: [
      thread([stage('A', [{ title: 'live', done: false }])], { name: 'Working on it' }),
      thread([stage('A', [{ title: 'shelved', done: false }])], { name: 'Finished', status: 'done' }),
    ],
  };
  assert.deepEqual(activeThreads(state).map((t) => t.name), ['Working on it']);
  assert.deepEqual(upNext(state).map((row) => row.thread.name), ['Working on it']);
});

test('a due task in a done thread is not actionable', () => {
  const state = {
    threads: [thread([stage('A', [{ title: 'overdue', done: false, due: '2026-08-01' }])], { status: 'done' })],
  };
  assert.equal(actionableDueTasks(state, { today: '2026-08-12' }).length, 0);
});

test('the last completion date is the latest one, not the last in tree order', () => {
  const t = thread([
    stage('A', [{ done: true, doneAt: '2026-08-05T09:00:00' }]),
    stage('B', [{ done: true, doneAt: '2026-07-01T09:00:00' }]),
  ]);
  assert.equal(lastCompletionDate(t), '2026-08-05');
  assert.equal(lastCompletionDate(thread([stage('A', [{ done: false }])])), null);
});


// --- due tasks --------------------------------------------------------------

test('a due task inside a locked stage does not surface as needing action', () => {
  const today = todayISO();
  const locked = stage('B', [{ title: 'locked and due', due: today, done: false }]);
  const state = { threads: [thread([stage('A', [{ done: false }]), locked])] };

  const due = actionableDueTasks(state, { today });
  assert.deepEqual(due.map((d) => d.task.title), []);

  // Unlock the stage and the same task appears.
  locked.forceUnlocked = true;
  assert.deepEqual(actionableDueTasks(state, { today }).map((d) => d.task.title), ['locked and due']);
});

test('due tasks in a stage with no done-when are not actionable either', () => {
  const today = todayISO();
  const s = stage('A', [{ title: 'due', due: today, done: false }]);
  s.doneWhen = '';
  assert.deepEqual(actionableDueTasks({ threads: [thread([s])] }, { today }), []);
});

test('overdue tasks come first and report how late they are', () => {
  const today = '2026-08-07';
  const s = stage('A', [
    { title: 'late', due: addDays(today, -3), done: false },
    { title: 'today', due: today, done: false },
    { title: 'later', due: addDays(today, 5), done: false },
  ]);
  const due = actionableDueTasks({ threads: [thread([s])] }, { today });
  assert.deepEqual(due.map((d) => d.task.title), ['late', 'today']);
  assert.equal(due[0].overdueBy, 3);
  assert.equal(due[1].overdueBy, 0);
});
