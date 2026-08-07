// Time blocking: planned versus actual, per day and per week.

import { todayISO, timeToMinutes, weekDates, startOfWeek } from './dates.js';

export function plannedMinutes(block) {
  const start = timeToMinutes(block?.start);
  const end = timeToMinutes(block?.end);
  if (start === null || end === null) return 0;
  return Math.max(0, end - start);
}

export function actualMinutes(block) {
  const start = timeToMinutes(block?.actualStart);
  const end = timeToMinutes(block?.actualEnd);
  if (start === null || end === null) return 0;
  return Math.max(0, end - start);
}

export function hasActual(block) {
  return !!block?.actualStart && !!block?.actualEnd;
}

export function blocksForDate(state, iso) {
  return (state?.timeBlocks ?? [])
    .filter((b) => b.date === iso)
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
}

export function overlaps(a, b) {
  if (a.date !== b.date || a.id === b.id) return false;
  const aStart = timeToMinutes(a.start);
  const aEnd = timeToMinutes(a.end);
  const bStart = timeToMinutes(b.start);
  const bEnd = timeToMinutes(b.end);
  if ([aStart, aEnd, bStart, bEnd].some((v) => v === null)) return false;
  return aStart < bEnd && bStart < aEnd;
}

export function findOverlaps(state, block) {
  return blocksForDate(state, block.date).filter((other) => overlaps(block, other));
}

export function dayTotals(state, iso) {
  const blocks = blocksForDate(state, iso);
  return {
    blocks,
    planned: blocks.reduce((sum, b) => sum + plannedMinutes(b), 0),
    actual: blocks.reduce((sum, b) => sum + actualMinutes(b), 0),
    logged: blocks.filter(hasActual).length,
  };
}

/**
 * Hours per thread across a week. This is the view that tends to disagree with
 * how the week felt, which is the reason it exists.
 */
export function weeklyDistribution(state, { today = todayISO(), weekStart = null, weekStartsOn = 1 } = {}) {
  const start = weekStart || startOfWeek(today, weekStartsOn);
  const days = new Set(weekDates(start));
  const byThread = new Map();
  let planned = 0;
  let actual = 0;

  for (const block of state?.timeBlocks ?? []) {
    if (!days.has(block.date)) continue;
    const key = block.threadId || '__unassigned';
    const entry = byThread.get(key) || { threadId: block.threadId || null, planned: 0, actual: 0, blocks: 0 };
    const p = plannedMinutes(block);
    const a = actualMinutes(block);
    entry.planned += p;
    entry.actual += a;
    entry.blocks += 1;
    byThread.set(key, entry);
    planned += p;
    actual += a;
  }

  const threadName = (id) => (state?.threads ?? []).find((t) => t.id === id)?.name ?? 'Unassigned';
  const rows = [...byThread.values()]
    .map((row) => ({
      ...row,
      name: row.threadId ? threadName(row.threadId) : 'Unassigned',
      shareActual: actual ? row.actual / actual : 0,
      sharePlanned: planned ? row.planned / planned : 0,
      drift: row.actual - row.planned,
    }))
    .sort((a, b) => b.actual - a.actual || b.planned - a.planned);

  return { weekStart: start, planned, actual, rows };
}

/** Blocks that reference a task that no longer exists, for cleanup on delete. */
export function blocksReferencingTask(state, taskId) {
  return (state?.timeBlocks ?? []).filter((b) => b.taskId === taskId);
}

export function blocksReferencingThread(state, threadId) {
  return (state?.timeBlocks ?? []).filter((b) => b.threadId === threadId);
}
