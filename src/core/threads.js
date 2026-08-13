// Thread tree logic: stage unlocking, progress rollup and "next unblocked
// task".
//
// Nothing here is stored. Unlock state and completion are *derived* on every
// read from the two flags that are stored (`forceUnlocked`, `forceCompleted`)
// plus the tasks themselves. That is what makes stage reordering safe: move a
// stage and its status recomputes from its new position, with no stale cache to
// invalidate.

import { diffDays, todayISO, stampToDate } from './dates.js';

export const STAGE_STATES = ['locked', 'available', 'in-progress', 'complete'];

/**
 * A thread is active or it is done. Everything that reads "the threads I am
 * working on" goes through here rather than testing a flag inline, so there is
 * one definition of active to change.
 */
export function isActive(thread) {
  return thread?.status !== 'done';
}

export function activeThreads(state) {
  return (state?.threads ?? []).filter(isActive);
}

// --- counts -----------------------------------------------------------------

export function stepCounts(step) {
  const tasks = step?.tasks ?? [];
  return { done: tasks.filter((t) => t.done).length, total: tasks.length };
}

export function stageCounts(stage) {
  let done = 0;
  let total = 0;
  for (const step of stage?.steps ?? []) {
    const c = stepCounts(step);
    done += c.done;
    total += c.total;
  }
  return { done, total };
}

export function threadCounts(thread) {
  let done = 0;
  let total = 0;
  for (const stage of thread?.stages ?? []) {
    const c = stageCounts(stage);
    done += c.done;
    total += c.total;
  }
  return { done, total };
}

export function ratio({ done, total }) {
  return total === 0 ? 0 : done / total;
}

/** Progress including the force-complete override, which reads as 100%. */
export function stageProgress(stage) {
  const counts = stageCounts(stage);
  const forced = !!stage?.forceCompleted;
  return {
    ...counts,
    forced,
    ratio: forced ? 1 : ratio(counts),
    openTasks: counts.total - counts.done,
  };
}

export function threadProgress(thread) {
  const counts = threadCounts(thread);
  const stages = thread?.stages ?? [];
  const stagesComplete = stages.filter((s) => isStageComplete(s)).length;
  return {
    ...counts,
    ratio: ratio(counts),
    stages: stages.length,
    stagesComplete,
  };
}

// --- completion and unlocking ----------------------------------------------

/**
 * A stage is complete when it was force-completed, or when it holds at least
 * one task and every task is done. A stage with no tasks is never automatically
 * complete -- otherwise a row of empty placeholder stages would unlock the
 * entire thread at once, which is exactly the failure mode the tool exists to
 * prevent.
 */
export function isStageComplete(stage) {
  if (!stage) return false;
  if (stage.forceCompleted) return true;
  const { done, total } = stageCounts(stage);
  return total > 0 && done === total;
}

export function isStageStarted(stage) {
  return stageCounts(stage).done > 0;
}

/**
 * A stage is unlocked when it is the first stage, when it has been manually
 * force-unlocked, or when the stage immediately before it is complete.
 *
 * Using only the immediate predecessor (rather than "all preceding stages") is
 * what stops force-unlocking from double-counting: if stage 2 is force-unlocked
 * and finished while stage 1 is still open, stage 3 unlocks on stage 2's own
 * completion and nothing changes when stage 1 later completes.
 */
export function isStageUnlocked(thread, index) {
  const stages = thread?.stages ?? [];
  const stage = stages[index];
  if (!stage) return false;
  if (index === 0) return true;
  if (stage.forceUnlocked) return true;
  return isStageComplete(stages[index - 1]);
}

export function stageState(thread, index) {
  const stage = thread?.stages?.[index];
  if (!stage) return 'locked';
  if (isStageComplete(stage)) return 'complete';
  if (!isStageUnlocked(thread, index)) return 'locked';
  return isStageStarted(stage) ? 'in-progress' : 'available';
}

/** A stage may only be worked in once it has a written done-when. */
export function canStartStage(stage) {
  return typeof stage?.doneWhen === 'string' && stage.doneWhen.trim().length > 0;
}

export function stageBlockers(thread, index) {
  const stage = thread?.stages?.[index];
  const blockers = [];
  if (!stage) return blockers;
  if (!isStageUnlocked(thread, index)) blockers.push('locked');
  if (!canStartStage(stage)) blockers.push('no-done-when');
  return blockers;
}

/** Can tasks in this stage be ticked right now? */
export function isStageActionable(thread, index) {
  return stageBlockers(thread, index).length === 0;
}

// --- traversal --------------------------------------------------------------

export function* walkTasks(thread) {
  const stages = thread?.stages ?? [];
  for (let si = 0; si < stages.length; si += 1) {
    const stage = stages[si];
    for (const step of stage.steps ?? []) {
      for (const task of step.tasks ?? []) {
        yield { thread, stage, step, task, stageIndex: si };
      }
    }
  }
}

export function allTasks(thread) {
  return [...walkTasks(thread)];
}

export function findTask(state, taskId) {
  for (const thread of state?.threads ?? []) {
    for (const entry of walkTasks(thread)) {
      if (entry.task.id === taskId) return entry;
    }
  }
  return null;
}

export function findStage(state, stageId) {
  for (const thread of state?.threads ?? []) {
    const index = (thread.stages ?? []).findIndex((s) => s.id === stageId);
    if (index >= 0) return { thread, stage: thread.stages[index], stageIndex: index };
  }
  return null;
}

// --- the point of the whole app --------------------------------------------

/**
 * The single next task you could actually start in this thread: the first
 * undone task, in plan order, inside the earliest stage that is unlocked,
 * incomplete and has a done-when written.
 *
 * Returns `{ task, step, stage, stageIndex }`, or a `{ blocked }` marker
 * explaining why there is nothing to show -- an empty "up next" line with no
 * reason is worse than useless.
 */
export function nextTask(thread) {
  const stages = thread?.stages ?? [];
  if (!stages.length) return { blocked: 'no-stages' };

  let sawIncompleteStage = false;
  let needsDoneWhen = null;

  for (let si = 0; si < stages.length; si += 1) {
    const stage = stages[si];
    if (isStageComplete(stage)) continue;
    if (!isStageUnlocked(thread, si)) continue;
    sawIncompleteStage = true;
    if (!canStartStage(stage)) {
      if (!needsDoneWhen) needsDoneWhen = { blocked: 'no-done-when', stage, stageIndex: si };
      continue;
    }
    for (const step of stage.steps ?? []) {
      for (const task of step.tasks ?? []) {
        if (!task.done) return { task, step, stage, stageIndex: si };
      }
    }
    // Unlocked, started, but every task in it is done -- yet the stage is not
    // complete, which only happens when it has no tasks at all.
    if (!(stage.steps ?? []).some((s) => (s.tasks ?? []).length)) {
      return { blocked: 'no-tasks', stage, stageIndex: si };
    }
  }

  if (needsDoneWhen) return needsDoneWhen;
  if (!sawIncompleteStage) {
    const anyIncomplete = stages.some((s) => !isStageComplete(s));
    return { blocked: anyIncomplete ? 'all-locked' : 'complete' };
  }
  return { blocked: 'no-tasks' };
}

/** "Up next" across every active thread: one line each. */
export function upNext(state) {
  return activeThreads(state)
    .map((thread) => ({ thread, ...nextTask(thread) }))
    .filter((entry) => entry.task || entry.blocked !== 'complete');
}

// --- dates ------------------------------------------------------------------

export function lastCompletionDate(thread) {
  let latest = null;
  for (const { task } of walkTasks(thread)) {
    if (!task.done || !task.doneAt) continue;
    const date = stampToDate(task.doneAt) || task.doneAt;
    if (!latest || date > latest) latest = date;
  }
  return latest;
}

/**
 * Tasks with a due date that you could actually act on.
 *
 * Tasks inside a locked stage are excluded on purpose: a deadline you are not
 * allowed to work towards is noise, not a call to action.
 */
export function actionableDueTasks(state, { today = todayISO(), horizonDays = 0 } = {}) {
  const out = [];
  for (const thread of activeThreads(state)) {
    for (const entry of walkTasks(thread)) {
      const { task, stageIndex } = entry;
      if (task.done || !task.due) continue;
      if (!isStageActionable(thread, stageIndex)) continue;
      const delta = diffDays(today, task.due);
      if (delta === null || delta > horizonDays) continue;
      // `delta || 0` keeps a same-day task at 0 rather than -0.
      out.push({ ...entry, due: task.due, overdueBy: -delta || 0 });
    }
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}

// --- mutations that need care ----------------------------------------------

/**
 * Move a stage within a thread.
 *
 * Unlock state is derived, so there is nothing to recompute -- but moving a
 * completed stage below an incomplete one re-locks everything that was relying
 * on it, and that happens silently unless someone says so. The states are
 * captured per stage *id* rather than per position, because the positions are
 * exactly what the move changes, so the caller can name which stages changed
 * rather than counting how many are locked now.
 */
export function moveStage(thread, from, to) {
  const stages = thread.stages ?? [];
  if (from < 0 || from >= stages.length) return { thread, moved: null, locked: [], unlocked: [] };
  const target = Math.max(0, Math.min(stages.length - 1, to));

  const before = new Map(stages.map((stage, i) => [stage.id, stageState(thread, i)]));
  const [moved] = stages.splice(from, 1);
  stages.splice(target, 0, moved);
  const after = new Map(stages.map((stage, i) => [stage.id, stageState(thread, i)]));

  const locked = [];
  const unlocked = [];
  for (const stage of stages) {
    const was = before.get(stage.id);
    const now = after.get(stage.id);
    if (was === now) continue;
    if (now === 'locked') locked.push(stage);
    else if (was === 'locked') unlocked.push(stage);
  }
  return { thread, moved, from, to: target, before, after, locked, unlocked };
}

/** Tick or untick a task, keeping doneAt honest. */
export function setTaskDone(task, done, stamp) {
  task.done = !!done;
  task.doneAt = done ? stamp : null;
  return task;
}
