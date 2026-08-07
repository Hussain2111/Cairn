// The spaced-repetition scheduler.
//
// Rules, in full:
//
//   * Intervals are day offsets: 0, 2, 7, 21 by default. `intervalIndex` is the
//     index of the interval that produced the current due date, so a new
//     question sits at index 0 and is due the day it is added.
//   * An unaided attempt advances one step along the chain and schedules the
//     next review at that interval.
//   * A failed or aided attempt resets to the start of the chain. Since the
//     first interval is 0 days, a reset question is due again the same day --
//     that is the intended behaviour, not an off-by-one.
//   * Hesitation does not reset the chain, but it does block retirement. You
//     can advance while hesitating; you cannot retire while hesitating.
//   * A question retires when it is solved unaided, with no hesitation
//     recorded, at the final interval. At the final interval a hesitant but
//     unaided solve re-schedules at that same final interval rather than
//     retiring.

import { addDays, todayISO, diffDays } from './dates.js';

export const DEFAULT_INTERVALS = [0, 2, 7, 21];

export function normaliseIntervals(intervals) {
  const list = Array.isArray(intervals) ? intervals.filter((n) => Number.isFinite(n) && n >= 0) : [];
  return list.length ? list.map((n) => Math.round(n)) : [...DEFAULT_INTERVALS];
}

export function hesitated(attempt) {
  return typeof attempt?.hesitation === 'string' && attempt.hesitation.trim().length > 0;
}

export function isSolved(attempt) {
  return attempt?.unaided === true;
}

/** Where a brand-new question starts. */
export function initialSchedule(createdISO = todayISO(), intervals = DEFAULT_INTERVALS) {
  const chain = normaliseIntervals(intervals);
  return { intervalIndex: 0, dueDate: addDays(createdISO, chain[0]), retired: false, retiredAt: null };
}

/**
 * Compute the scheduling patch for a question after an attempt.
 * Pure: returns the fields to apply, does not mutate.
 */
export function scheduleAfterAttempt(question, attempt, intervals) {
  const chain = normaliseIntervals(intervals ?? question?.intervals ?? DEFAULT_INTERVALS);
  const last = chain.length - 1;
  const date = attempt?.date || todayISO();
  const current = Number.isInteger(question?.intervalIndex)
    ? Math.max(0, Math.min(last, question.intervalIndex))
    : 0;

  if (!isSolved(attempt)) {
    // Failed or aided: back to the start of the chain.
    return {
      intervalIndex: 0,
      dueDate: addDays(date, chain[0]),
      retired: false,
      retiredAt: null,
      outcome: 'reset',
    };
  }

  if (current >= last) {
    if (!hesitated(attempt)) {
      return {
        intervalIndex: last,
        dueDate: null,
        retired: true,
        retiredAt: date,
        outcome: 'retired',
      };
    }
    // Unaided but hesitant at the final interval: hold at the final spacing.
    return {
      intervalIndex: last,
      dueDate: addDays(date, chain[last]),
      retired: false,
      retiredAt: null,
      outcome: 'held',
    };
  }

  const next = current + 1;
  return {
    intervalIndex: next,
    dueDate: addDays(date, chain[next]),
    retired: false,
    retiredAt: null,
    outcome: 'advanced',
  };
}

/** Apply an attempt to a question, in place, and return the outcome. */
export function recordAttempt(question, attempt, intervals) {
  const patch = scheduleAfterAttempt(question, attempt, intervals);
  question.attempts = [...(question.attempts ?? []), attempt];
  question.intervalIndex = patch.intervalIndex;
  question.dueDate = patch.dueDate;
  question.retired = patch.retired;
  question.retiredAt = patch.retiredAt;
  return patch.outcome;
}

export function isDue(question, today = todayISO()) {
  if (!question || question.retired || !question.dueDate) return false;
  return question.dueDate <= today;
}

export function isDueOn(question, iso) {
  return !!question && !question.retired && question.dueDate === iso;
}

/** Everything due today or earlier, across all banks. Overdue first. */
export function reviewQueue(state, { today = todayISO(), bank = null } = {}) {
  return (state?.questions ?? [])
    .filter((q) => (bank ? q.bank === bank : true))
    .filter((q) => isDue(q, today))
    .map((q) => ({ question: q, overdueBy: -(diffDays(today, q.dueDate) ?? 0) || 0 }))
    .sort((a, b) => b.overdueBy - a.overdueBy || a.question.title.localeCompare(b.question.title));
}

export function dueCountByBank(state, today = todayISO()) {
  const counts = { sql: 0, leetcode: 0, gre: 0 };
  for (const q of state?.questions ?? []) {
    if (isDue(q, today) && counts[q.bank] !== undefined) counts[q.bank] += 1;
  }
  return counts;
}

export function lastAttempt(question) {
  const attempts = question?.attempts ?? [];
  return attempts.length ? attempts[attempts.length - 1] : null;
}

export function questionStats(questions = []) {
  const total = questions.length;
  const retired = questions.filter((q) => q.retired).length;
  const attempts = questions.reduce((sum, q) => sum + (q.attempts?.length ?? 0), 0);
  const unaided = questions.reduce(
    (sum, q) => sum + (q.attempts ?? []).filter((a) => a.unaided).length,
    0,
  );
  return {
    total,
    retired,
    active: total - retired,
    attempts,
    unaided,
    unaidedRate: attempts ? unaided / attempts : 0,
  };
}

/** Progress through the chain, for the little stage pips in the UI. */
export function chainPosition(question, intervals = DEFAULT_INTERVALS) {
  const chain = normaliseIntervals(intervals);
  return {
    index: Math.max(0, Math.min(chain.length - 1, question?.intervalIndex ?? 0)),
    length: chain.length,
    intervals: chain,
  };
}

/**
 * Duplicate detection for the "this is already in the bank" prompt. Matches on
 * URL first (normalised), then on a loosely-normalised title within the bank.
 */
export function normaliseUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return '';
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#]+$/, '');
}

export function normaliseTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function findDuplicateQuestion(state, candidate) {
  const url = normaliseUrl(candidate.url);
  const title = normaliseTitle(candidate.title);
  for (const q of state?.questions ?? []) {
    if (candidate.id && q.id === candidate.id) continue;
    if (url && normaliseUrl(q.url) === url) return { question: q, on: 'url' };
    if (q.bank === candidate.bank && title && normaliseTitle(q.title) === title) {
      return { question: q, on: 'title' };
    }
  }
  return null;
}

/** Merge a candidate into an existing question without losing attempts. */
export function mergeQuestion(existing, candidate) {
  const merged = { ...existing };
  merged.title = existing.title || candidate.title;
  merged.url = existing.url || candidate.url;
  merged.difficulty = candidate.difficulty || existing.difficulty;
  merged.tags = [...new Set([...(existing.tags ?? []), ...(candidate.tags ?? [])])];
  merged.fields = { ...(candidate.fields ?? {}), ...(existing.fields ?? {}) };
  merged.notes = [existing.notes, candidate.notes].filter(Boolean).join('\n\n');
  merged.attempts = [...(existing.attempts ?? []), ...(candidate.attempts ?? [])].sort((a, b) =>
    String(a.date).localeCompare(String(b.date)),
  );
  return merged;
}
