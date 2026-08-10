// Time blocking: planned versus logged, per day and per week.
//
// A block is one start, one end, one activity and a status. Planned and logged
// are separate records rather than two time pairs on one, because that is what
// they actually are: an intention written in the morning and an account written
// afterwards. Keeping them apart means a block that was never planned can still
// be logged, a plan that was abandoned stays visible as a plan, and neither has
// to pretend to be an edit of the other.

import { todayISO, timeToMinutes, weekDates, startOfWeek } from './dates.js';
import { activityLabel, UNASSIGNED } from './activities.js';

export const BLOCK_STATUSES = ['planned', 'logged'];

export function isLogged(block) {
  return block?.status === 'logged';
}

export function isPlanned(block) {
  return block?.status !== 'logged';
}

/** Length of the block itself. What that length means depends on its status. */
export function blockMinutes(block) {
  const start = timeToMinutes(block?.start);
  const end = timeToMinutes(block?.end);
  if (start === null || end === null) return 0;
  return Math.max(0, end - start);
}

export function plannedMinutes(block) {
  return isPlanned(block) ? blockMinutes(block) : 0;
}

export function loggedMinutes(block) {
  return isLogged(block) ? blockMinutes(block) : 0;
}

export function blocksForDate(state, iso) {
  return (state?.timeBlocks ?? [])
    .filter((b) => b.date === iso)
    .sort((a, b) => String(a.start).localeCompare(String(b.start)) ||
      String(a.status).localeCompare(String(b.status)));
}

/**
 * Two blocks clash only if they are the same kind of thing. A logged block
 * sitting on top of the plan it fulfils is the normal case, not a conflict.
 */
export function overlaps(a, b) {
  if (a.date !== b.date || a.id === b.id) return false;
  if (isLogged(a) !== isLogged(b)) return false;
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
    logged: blocks.reduce((sum, b) => sum + loggedMinutes(b), 0),
    plannedCount: blocks.filter(isPlanned).length,
    loggedCount: blocks.filter(isLogged).length,
  };
}

/**
 * Hours per activity across a week, planned beside logged. This is the view
 * that tends to disagree with how the week felt, which is why it exists.
 */
export function weeklyDistribution(state, { today = todayISO(), weekStart = null } = {}) {
  const start = weekStart || startOfWeek(today);
  const days = new Set(weekDates(start));
  const byActivity = new Map();
  let planned = 0;
  let logged = 0;

  for (const block of state?.timeBlocks ?? []) {
    if (!days.has(block.date)) continue;
    const key = block.activity || UNASSIGNED;
    const entry = byActivity.get(key) ||
      { activity: block.activity || null, planned: 0, logged: 0, blocks: 0 };
    entry.planned += plannedMinutes(block);
    entry.logged += loggedMinutes(block);
    entry.blocks += 1;
    byActivity.set(key, entry);
    planned += plannedMinutes(block);
    logged += loggedMinutes(block);
  }

  const rows = [...byActivity.values()]
    .map((row) => ({
      ...row,
      name: activityLabel(state, row.activity),
      shareLogged: logged ? row.logged / logged : 0,
      sharePlanned: planned ? row.planned / planned : 0,
      drift: row.logged - row.planned,
    }))
    .sort((a, b) => b.logged - a.logged || b.planned - a.planned);

  return { weekStart: start, planned, logged, rows };
}

/** Blocks that reference a task that no longer exists, for cleanup on delete. */
export function blocksReferencingTask(state, taskId) {
  return (state?.timeBlocks ?? []).filter((b) => b.taskId === taskId);
}

export function blocksReferencingThread(state, threadId) {
  return (state?.timeBlocks ?? []).filter((b) => b.activity === `thread:${threadId}`);
}
