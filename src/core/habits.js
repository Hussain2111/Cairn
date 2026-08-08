// Habits: weekly targets and consistency history. No points, no levels.

import { todayISO, startOfWeek, addDays, weekDates, isValidISODate } from './dates.js';

export function logDates(habit) {
  return [...new Set((habit?.log ?? []).filter(isValidISODate))].sort();
}

export function loggedOn(habit, iso) {
  return logDates(habit).includes(iso);
}

export function loggedToday(habit, today = todayISO()) {
  return loggedOn(habit, today);
}

export function toggleLog(habit, iso) {
  const dates = new Set(logDates(habit));
  if (dates.has(iso)) dates.delete(iso);
  else dates.add(iso);
  habit.log = [...dates].sort();
  return habit;
}

/** Count of logged days in the calendar week containing `iso`. */
export function weekCount(habit, iso = todayISO(), weekStartsOn = 1) {
  const start = startOfWeek(iso, weekStartsOn);
  const days = new Set(weekDates(start));
  return logDates(habit).filter((d) => days.has(d)).length;
}

export function weekStatus(habit, iso = todayISO(), weekStartsOn = 1) {
  const count = weekCount(habit, iso, weekStartsOn);
  const target = Math.max(0, Number(habit?.weeklyTarget) || 0);
  return { count, target, met: target > 0 && count >= target, ratio: target ? Math.min(1, count / target) : 0 };
}

/**
 * Consecutive weeks that met target, counting back from the week containing
 * `iso`. The current week only counts once it has already met target -- a week
 * still in progress neither extends nor breaks the streak.
 */
export function streakWeeks(habit, iso = todayISO(), weekStartsOn = 1) {
  let cursor = startOfWeek(iso, weekStartsOn);
  let streak = 0;
  const current = weekStatus(habit, cursor, weekStartsOn);
  if (current.met) streak += 1;
  cursor = addDays(cursor, -7);
  // Cap the walk-back so a corrupt date can never spin here.
  for (let i = 0; i < 520; i += 1) {
    const status = weekStatus(habit, cursor, weekStartsOn);
    if (!status.met) break;
    streak += 1;
    cursor = addDays(cursor, -7);
  }
  return streak;
}

/** Day-level streak of consecutive logged days ending today or yesterday. */
export function dayStreak(habit, today = todayISO()) {
  const dates = new Set(logDates(habit));
  if (!dates.size) return 0;
  let cursor = dates.has(today) ? today : addDays(today, -1);
  if (!dates.has(cursor)) return 0;
  let streak = 0;
  while (dates.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/** Most recent `weeks` weeks, oldest first. */
export function consistency(habit, { today = todayISO(), weeks = 12, weekStartsOn = 1 } = {}) {
  const thisWeek = startOfWeek(today, weekStartsOn);
  const out = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const start = addDays(thisWeek, -7 * i);
    const status = weekStatus(habit, start, weekStartsOn);
    out.push({ weekStart: start, ...status, current: start === thisWeek });
  }
  return out;
}

export function habitsNotLoggedToday(state, today = todayISO()) {
  return (state?.habits ?? []).filter((h) => !h.archived && !loggedToday(h, today));
}

export function habitSummary(state, { today = todayISO(), weekStartsOn = 1 } = {}) {
  return (state?.habits ?? [])
    .filter((h) => !h.archived)
    .map((habit) => ({
      habit,
      ...weekStatus(habit, today, weekStartsOn),
      streak: streakWeeks(habit, today, weekStartsOn),
      loggedToday: loggedToday(habit, today),
    }));
}
