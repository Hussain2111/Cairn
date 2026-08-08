// All dates in Cairn are local-time calendar dates in `YYYY-MM-DD` form.
//
// This is deliberate. `new Date().toISOString().slice(0,10)` returns the UTC
// date, which flips at UTC midnight -- for anyone west of Greenwich that means
// "due today" changes in the middle of the evening. Every helper here works off
// the local calendar fields instead, and every parsed date is anchored at local
// noon so that a daylight-saving shift can never push it into a neighbouring
// day.

export const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n) => String(n).padStart(2, '0');

/** Local calendar date of a Date object, as YYYY-MM-DD. */
export function toISODate(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Today's local calendar date. */
export function todayISO(now = new Date()) {
  return toISODate(now);
}

export function isValidISODate(value) {
  if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(y, m - 1, d, 12, 0, 0, 0);
  return probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d;
}

/** Parse YYYY-MM-DD into a local Date anchored at noon. */
export function parseISODate(value) {
  if (!isValidISODate(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function addDays(iso, days) {
  const date = parseISODate(iso);
  if (!date) return null;
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

/** Whole days from `from` to `to`. Positive when `to` is later. */
export function diffDays(from, to) {
  const a = parseISODate(from);
  const b = parseISODate(to);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

export function isBefore(a, b) {
  return isValidISODate(a) && isValidISODate(b) && a < b;
}

export function isOnOrBefore(a, b) {
  return isValidISODate(a) && isValidISODate(b) && a <= b;
}

// --- the week ---------------------------------------------------------------
//
// Weeks run Sunday to Saturday. This constant is the only place that fact is
// written down: startOfWeek, endOfWeek and the weekday labels all derive from
// it, and nothing else in the app takes a week-start argument. Change it here
// and every "this week" figure — targets, streaks, muscle coverage, the weekly
// review, the time distribution — moves together.

/** Day index the week starts on, as getDay() reports it. 0 = Sunday. */
export const WEEK_STARTS_ON = 0;

/** First day of the week containing `iso`. */
export function startOfWeek(iso) {
  const date = parseISODate(iso);
  if (!date) return null;
  const shift = (date.getDay() - WEEK_STARTS_ON + 7) % 7;
  date.setDate(date.getDate() - shift);
  return toISODate(date);
}

/** Last day of the week containing `iso`. */
export function endOfWeek(iso) {
  const start = startOfWeek(iso);
  return start ? addDays(start, 6) : null;
}

export function weekDates(weekStartISO) {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStartISO, i));
}

/** Days left in the week including `iso` itself. Sat = 1, Sun = 7. */
export function daysLeftInWeek(iso) {
  const end = endOfWeek(iso);
  const delta = diffDays(iso, end);
  return delta === null ? 0 : delta + 1;
}

export function isSameWeek(a, b) {
  const wa = startOfWeek(a);
  return wa !== null && wa === startOfWeek(b);
}

/** Inclusive range test. */
export function withinRange(iso, startISO, endISO) {
  return isValidISODate(iso) && iso >= startISO && iso <= endISO;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Two-letter weekday headings in week order, so a day strip can never drift
 * out of step with WEEK_STARTS_ON.
 */
export function weekdayInitials() {
  return Array.from({ length: 7 }, (_, i) => DAYS[(WEEK_STARTS_ON + i) % 7].slice(0, 2));
}

export function formatDate(iso, { weekday = false } = {}) {
  const date = parseISODate(iso);
  if (!date) return '';
  const base = `${date.getDate()} ${MONTHS[date.getMonth()]}`;
  return weekday ? `${DAYS[date.getDay()]} ${base}` : base;
}

export function formatLongDate(iso) {
  const date = parseISODate(iso);
  if (!date) return '';
  return `${DAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** "today" / "in 3d" / "4d overdue". */
export function relativeDay(iso, today = todayISO()) {
  const delta = diffDays(today, iso);
  if (delta === null) return '';
  if (delta === 0) return 'today';
  if (delta === 1) return 'tomorrow';
  if (delta === -1) return '1d overdue';
  if (delta < 0) return `${Math.abs(delta)}d overdue`;
  return `in ${delta}d`;
}

// --- clock times, used by time blocking -------------------------------------

export const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTime(value) {
  return typeof value === 'string' && HHMM_RE.test(value);
}

export function timeToMinutes(value) {
  if (!isValidTime(value)) return null;
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(total) {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(total)));
  return `${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}`;
}

export function formatDuration(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0m';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (!h) return `${m}m`;
  if (!m) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Local wall-clock timestamp, e.g. 2026-08-07T14:03:22. Never UTC. */
export function nowStamp(now = new Date()) {
  return (
    `${toISODate(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  );
}

/** Calendar date portion of a stamp produced by nowStamp(). */
export function stampToDate(stamp) {
  if (typeof stamp !== 'string') return null;
  const head = stamp.slice(0, 10);
  return isValidISODate(head) ? head : null;
}
