// The GRE programme.
//
// This does not fit the thread model, which is why it has its own view. A
// thread is a tree you decompose once and then work down. This is a fixed daily
// shape with a defined end date: the same blocks most days, a topic assigned in
// advance, gates that a phase either reaches or misses, and a log whose whole
// purpose is to turn missed problems into rules that fire on later ones.
//
// The measure is not a score. It is whether concept gaps fall over time, and
// whether a portable move written in week one fires on an unseen problem in
// week five. Everything here exists to make those two numbers computable.

import { todayISO, addDays, diffDays, withinRange } from './dates.js';
import { GRE_CAUSES, DEFAULT_GRE_BLOCKS, makeGreBlock } from './schema.js';
import { scheduleAfterAttempt, normaliseIntervals } from './srs.js';

// --- the shape of a day -----------------------------------------------------

export function blocks(state) {
  return [...(state?.greBlocks ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function blockByCode(state, code) {
  return (state?.greBlocks ?? []).find((b) => b.code === code) ?? null;
}

export function phases(state) {
  return [...(state?.grePhases ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function phaseById(state, id) {
  return (state?.grePhases ?? []).find((p) => p.id === id) ?? null;
}

export function days(state) {
  return [...(state?.greDays ?? [])].sort((a, b) => (a.dayNumber ?? 0) - (b.dayNumber ?? 0));
}

export function dayByNumber(state, dayNumber) {
  return (state?.greDays ?? []).find((d) => d.dayNumber === dayNumber) ?? null;
}

export function dayByDate(state, iso) {
  return (state?.greDays ?? []).find((d) => d.date === iso) ?? null;
}

/** The day to show: today's if the schedule has one, otherwise the next one. */
export function currentDay(state, today = todayISO()) {
  const exact = dayByDate(state, today);
  if (exact) return exact;
  const upcoming = days(state).filter((d) => d.date && d.date > today);
  if (upcoming.length) return upcoming[0];
  const past = days(state).filter((d) => d.date && d.date <= today);
  return past[past.length - 1] ?? null;
}

export function isCheckpoint(day) {
  return typeof day?.checkpoint === 'string' && day.checkpoint.trim().length > 0;
}

/**
 * The blocks due on a day, in order, with the rules applied:
 *
 *   - a pinned block is always first;
 *   - an every-day block runs on every day in the schedule, checkpoints
 *     included, because that is the one that breaks if it is skipped;
 *   - a block with `notBeforeDay` stays hidden until then — there is nothing
 *     to retrieve before there is anything logged;
 *   - a checkpoint replaces the normal shape of the day, keeping only the
 *     every-day blocks.
 */
export function blocksForDay(state, day) {
  if (!day) return [];
  const checkpoint = isCheckpoint(day);
  const scheduled = new Set(day.blockCodes ?? []);

  const included = blocks(state).filter((block) => {
    if (block.everyDay) return true;
    if (checkpoint) return false;
    if (!scheduled.has(block.code)) return false;
    if (Number.isFinite(block.notBeforeDay) && day.dayNumber < block.notBeforeDay) return false;
    return true;
  });

  return included
    .map((block) => ({
      block,
      topic: block.hasTopic ? (day.topics?.[block.code] ?? '') : '',
      done: (day.completed ?? []).includes(block.code),
    }))
    .sort((a, b) => Number(b.block.pinFirst) - Number(a.block.pinFirst) ||
      (a.block.order ?? 0) - (b.block.order ?? 0));
}

/** A block hidden only because the day is too early, so the view can say why. */
export function blocksNotYetDue(state, day) {
  if (!day || isCheckpoint(day)) return [];
  const scheduled = new Set(day.blockCodes ?? []);
  return blocks(state).filter((block) =>
    !block.everyDay &&
    scheduled.has(block.code) &&
    Number.isFinite(block.notBeforeDay) &&
    day.dayNumber < block.notBeforeDay);
}

export function dayMinutes(state, day) {
  return blocksForDay(state, day).reduce((sum, entry) => sum + (Number(entry.block.minutes) || 0), 0);
}

export function dayProgress(state, day) {
  const list = blocksForDay(state, day);
  const done = list.filter((entry) => entry.done).length;
  return { done, total: list.length, complete: list.length > 0 && done === list.length };
}

export function toggleBlock(day, code) {
  const done = new Set(day.completed ?? []);
  if (done.has(code)) done.delete(code);
  else done.add(code);
  day.completed = [...done];
  return day;
}

// --- phases and gates -------------------------------------------------------

export function daysInPhase(state, phaseId) {
  return days(state).filter((d) => d.phaseId === phaseId);
}

/** The furthest module reached on or before a given day number. */
export function moduleReachedBy(state, dayNumber) {
  let reached = null;
  for (const day of days(state)) {
    if (day.dayNumber > dayNumber) break;
    const module = Number(day.moduleReached);
    if (Number.isFinite(module) && (reached === null || module > reached)) reached = module;
  }
  return reached;
}

/**
 * Where a phase stands against its gate.
 *
 * A missed gate is the signal to change the plan rather than push on, so it is
 * reported as missed the moment the day passes, not softened into "behind".
 */
export function gateStatus(state, phase, { today = todayISO() } = {}) {
  // `Number(null)` is 0 and 0 is finite, so a gate with only half of itself
  // filled in would otherwise read as "module 0 by day 0" and pass forever.
  const present = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
  if (!present(phase?.gateModule) || !present(phase?.gateByDay)) return { hasGate: false };
  const gateModule = Number(phase.gateModule);
  const gateDay = Number(phase.gateByDay);

  const reached = moduleReachedBy(state, gateDay);
  const gateDayRecord = dayByNumber(state, gateDay);
  const gateDate = gateDayRecord?.date ?? null;
  const passed = gateDate ? gateDate < today : false;
  const met = reached !== null && reached >= gateModule;

  return {
    hasGate: true,
    gateModule,
    gateDay,
    gateDate,
    reached,
    met,
    // Only a gate whose day has gone by can be missed. Before that it is open.
    missed: passed && !met,
    daysToGate: gateDate ? diffDays(today, gateDate) : null,
    ratio: gateModule > 0 ? Math.min(1, (reached ?? 0) / gateModule) : 0,
  };
}

export function currentPhase(state, today = todayISO()) {
  const day = currentDay(state, today);
  return day ? phaseById(state, day.phaseId) : phases(state)[0] ?? null;
}

// --- the window -------------------------------------------------------------

export function windowRange(state) {
  const dated = days(state).filter((d) => d.date);
  if (!dated.length) return null;
  return { first: dated[0].date, last: dated[dated.length - 1].date };
}

/** Days left in the programme, counting today. Zero once the window closes. */
export function daysRemaining(state, today = todayISO()) {
  const range = windowRange(state);
  if (!range) return null;
  const delta = diffDays(today, range.last);
  return delta === null ? null : Math.max(0, delta + 1);
}

// --- the vocab streak -------------------------------------------------------

/**
 * Consecutive scheduled days with the every-day block ticked, counting back
 * from today. Today not being done yet does not break it — the day is not over.
 */
export function everyDayBlockStreak(state, today = todayISO()) {
  const block = blocks(state).find((b) => b.everyDay);
  if (!block) return { code: null, streak: 0, doneToday: false };

  const past = days(state)
    .filter((d) => d.date && d.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date));

  const doneToday = past[0]?.date === today && (past[0].completed ?? []).includes(block.code);
  let streak = 0;
  for (const [index, day] of past.entries()) {
    const done = (day.completed ?? []).includes(block.code);
    if (done) {
      streak += 1;
      continue;
    }
    // Today still has time left in it; any earlier gap ends the streak.
    if (index === 0 && day.date === today) continue;
    break;
  }
  return { code: block.code, name: block.name, streak, doneToday };
}

// --- the problem log --------------------------------------------------------

/**
 * The fourth field is mandatory. Without it the extraction did not happen, and
 * an entry that records only what went wrong is a diary, not a study tool.
 */
export function isLoggable(entry) {
  return typeof entry?.portable === 'string' && entry.portable.trim().length > 0;
}

export function entries(state) {
  return [...(state?.greEntries ?? [])].sort(
    (a, b) => String(b.date).localeCompare(String(a.date)) ||
      String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')),
  );
}

export function entryById(state, id) {
  return (state?.greEntries ?? []).find((e) => e.id === id) ?? null;
}

export function greIntervals(state) {
  return normaliseIntervals(state?.settings?.greIntervals ?? [3, 10]);
}

/** Where a new entry starts: due for a cold re-attempt at the first interval. */
export function initialRetrieval(state, date = todayISO()) {
  const chain = greIntervals(state);
  return { intervalIndex: 0, dueDate: addDays(date, chain[0]), retired: false, retiredAt: null };
}

/**
 * Block A's queue. Re-attempts are cold, so the queue deliberately carries no
 * notes: `hidden` is what the view shows until a result is recorded.
 */
export function retrievalQueue(state, { today = todayISO() } = {}) {
  return entries(state)
    .filter((entry) => !entry.retired && entry.dueDate && entry.dueDate <= today)
    .map((entry) => ({
      entry,
      // Only what is needed to find the problem again. Not what I wrote about it.
      prompt: { id: entry.id, source: entry.source, date: entry.date },
      overdueBy: -(diffDays(today, entry.dueDate) ?? 0) || 0,
    }))
    .sort((a, b) => b.overdueBy - a.overdueBy);
}

export function recordRetrieval(state, entry, attempt) {
  // The chain treats "solved unaided" as the advance condition; a cold
  // re-attempt is unaided by definition, so `correct` maps straight onto it.
  const patch = scheduleAfterAttempt(entry, { ...attempt, unaided: attempt.correct }, greIntervals(state));
  entry.attempts = [...(entry.attempts ?? []), attempt];
  entry.intervalIndex = patch.intervalIndex;
  entry.dueDate = patch.dueDate;
  entry.retired = patch.retired;
  entry.retiredAt = patch.retiredAt;
  return patch.outcome;
}

/** Whether this entry's notes may be shown yet, for a given queue position. */
export function retrievalRevealed(entry, { today = todayISO() } = {}) {
  return (entry?.attempts ?? []).some((attempt) => attempt.date === today);
}

// --- the audit --------------------------------------------------------------

const causeCounts = (list) => {
  const counts = Object.fromEntries(GRE_CAUSES.map((cause) => [cause, 0]));
  for (const entry of list) {
    if (counts[entry.cause] !== undefined) counts[entry.cause] += 1;
  }
  return counts;
};

/**
 * The cause breakdown, per phase, so early phases can be set against later
 * ones. The number that matters is the concept share of *misses*: a correct
 * answer reached the slow way is logged too, and would otherwise dilute it.
 */
export function causeByPhase(state) {
  const all = entries(state);
  const rows = phases(state).map((phase) => {
    const dayNumbers = new Set(daysInPhase(state, phase.id).map((d) => d.dayNumber));
    const inPhase = all.filter((entry) => dayNumbers.has(entry.dayNumber));
    return buildCauseRow(phase.name, inPhase);
  });

  const unassigned = all.filter((entry) => !entry.dayNumber ||
    !days(state).some((d) => d.dayNumber === entry.dayNumber));
  if (unassigned.length) rows.push(buildCauseRow('Not on a scheduled day', unassigned));
  return rows;
}

function buildCauseRow(name, list) {
  const misses = list.filter((entry) => !entry.correct);
  const counts = causeCounts(misses);
  return {
    name,
    logged: list.length,
    misses: misses.length,
    correct: list.length - misses.length,
    counts,
    conceptShare: misses.length ? counts.concept / misses.length : 0,
    shares: Object.fromEntries(
      GRE_CAUSES.map((cause) => [cause, misses.length ? counts[cause] / misses.length : 0]),
    ),
  };
}

/**
 * The real output: a portable move written for one problem firing on a later,
 * unseen one. Counted over time, because the point is that the number grows.
 */
export function portableHits(state) {
  const all = entries(state);
  const hits = all.filter((entry) => entry.appliedFrom && entryById(state, entry.appliedFrom));

  const bySource = new Map();
  for (const hit of hits) {
    const source = entryById(state, hit.appliedFrom);
    if (!bySource.has(source.id)) bySource.set(source.id, { source, hits: [] });
    bySource.get(source.id).hits.push(hit);
  }

  return {
    total: hits.length,
    // A move that has fired more than once is the strongest signal in the log.
    sources: [...bySource.values()].sort((a, b) => b.hits.length - a.hits.length),
    rate: all.length ? hits.length / all.length : 0,
    hits,
  };
}

/** Portable-move hits bucketed by phase, oldest phase first. */
export function portableHitsByPhase(state) {
  const { hits } = portableHits(state);
  return phases(state).map((phase) => {
    const dayNumbers = new Set(daysInPhase(state, phase.id).map((d) => d.dayNumber));
    return {
      name: phase.name,
      hits: hits.filter((hit) => dayNumbers.has(hit.dayNumber)).length,
    };
  });
}

/** Entries whose portable move could be linked to — everything earlier. */
export function priorEntries(state, entry) {
  const cutoff = entry?.date ?? todayISO();
  return entries(state)
    .filter((other) => other.id !== entry?.id && isLoggable(other) && other.date <= cutoff)
    .slice(0, 200);
}

export function greSummary(state, { today = todayISO() } = {}) {
  const all = entries(state);
  const misses = all.filter((e) => !e.correct);
  const day = currentDay(state, today);
  const phase = currentPhase(state, today);

  return {
    logged: all.length,
    misses: misses.length,
    correct: all.length - misses.length,
    // A right answer reached the slow way is a miss you did not notice, so the
    // log carries both and the share is of what was logged, not of the misses.
    conceptMisses: misses.filter((e) => e.cause === 'concept').length,
    portable: portableHits(state).total,
    dueToday: retrievalQueue(state, { today }).length,
    day,
    phase,
    gate: phase ? gateStatus(state, phase, { today }) : { hasGate: false },
    daysLeft: daysRemaining(state, today),
    vocab: everyDayBlockStreak(state, today),
    inWindow: (() => {
      const range = windowRange(state);
      return range ? withinRange(today, range.first, range.last) : false;
    })(),
  };
}

// --- seeding ----------------------------------------------------------------

/** The block template, written into the data so it can be edited from there. */
export function seedBlocks(state) {
  if (Array.isArray(state.greBlocks) && state.greBlocks.length) return 0;
  for (const block of DEFAULT_GRE_BLOCKS) state.greBlocks.push(makeGreBlock(block));
  return state.greBlocks.length;
}
