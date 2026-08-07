// Thread tree logic: stage unlocking, progress rollup, "next unblocked task",
// and stall detection.
//
// Nothing here is stored. Unlock state and completion are *derived* on every
// read from the two flags that are stored (`forceUnlocked`, `forceCompleted`)
// plus the tasks themselves. That is what makes stage reordering safe: move a
// stage and its status recomputes from its new position, with no stale cache to
// invalidate.

import { diffDays, todayISO, stampToDate } from './dates.js';

export const STAGE_STATES = ['locked', 'available', 'in-progress', 'complete'];

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
  return (state?.threads ?? [])
    .filter((t) => !t.archived)
    .map((thread) => ({ thread, ...nextTask(thread) }))
    .filter((entry) => entry.task || entry.blocked !== 'complete');
}

// --- dates and staleness ----------------------------------------------------

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
 * A thread stalls when nothing in it has completed for `days`, while work
 * remains. With no completions ever, the clock runs from the thread's creation
 * date, so a thread that was set up and abandoned still surfaces.
 */
export function threadStall(thread, { today = todayISO(), days = 14 } = {}) {
  const counts = threadCounts(thread);
  const remaining = counts.total - counts.done;
  const complete = counts.total > 0 && remaining === 0;
  const last = lastCompletionDate(thread);
  const since = last || stampToDate(thread.createdAt) || today;
  const idleDays = diffDays(since, today) ?? 0;
  return {
    thread,
    lastCompletion: last,
    idleDays,
    stalled: !thread.archived && !complete && idleDays >= days,
    everCompleted: !!last,
  };
}

export function stalledThreads(state, { today = todayISO(), days } = {}) {
  const limit = days ?? state?.settings?.stallDays ?? 14;
  return (state?.threads ?? [])
    .filter((t) => !t.archived)
    .map((t) => threadStall(t, { today, days: limit }))
    .filter((s) => s.stalled)
    .sort((a, b) => b.idleDays - a.idleDays);
}

/**
 * Tasks with a due date that you could actually act on.
 *
 * Tasks inside a locked stage are excluded on purpose: a deadline you are not
 * allowed to work towards is noise, not a call to action.
 */
export function actionableDueTasks(state, { today = todayISO(), horizonDays = 0 } = {}) {
  const out = [];
  for (const thread of state?.threads ?? []) {
    if (thread.archived) continue;
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
 * Move a stage within a thread. Unlock state is derived, so there is nothing to
 * recompute -- but the caller still needs the resulting state to report on,
 * e.g. "this move re-locked 2 stages".
 */
export function moveStage(thread, from, to) {
  const stages = thread.stages ?? [];
  if (from < 0 || from >= stages.length) return thread;
  const target = Math.max(0, Math.min(stages.length - 1, to));
  const before = stages.map((_, i) => stageState(thread, i));
  const [moved] = stages.splice(from, 1);
  stages.splice(target, 0, moved);
  const after = stages.map((_, i) => stageState(thread, i));
  return { thread, before, after };
}

/** Tick or untick a task, keeping doneAt honest. */
export function setTaskDone(task, done, stamp) {
  task.done = !!done;
  task.doneAt = done ? stamp : null;
  return task;
}
