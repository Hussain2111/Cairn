import test from 'node:test';
import assert from 'node:assert/strict';

import {
  toISODate,
  todayISO,
  isValidISODate,
  parseISODate,
  addDays,
  diffDays,
  startOfWeek,
  endOfWeek,
  weekDates,
  daysLeftInWeek,
  isSameWeek,
  weekdayInitials,
  formatDate,
  relativeDay,
  timeToMinutes,
  minutesToTime,
  formatDuration,
  stampToDate,
  withinRange,
} from '../../src/core/dates.js';

test('the calendar date comes from local time, not UTC', () => {
  // 22:30 on 7 Aug local. In any timezone west of UTC this instant is already
  // 8 Aug in UTC; "today" must still read as 7 Aug.
  const lateEvening = new Date(2026, 7, 7, 22, 30, 0);
  assert.equal(toISODate(lateEvening), '2026-08-07');
  assert.equal(todayISO(lateEvening), '2026-08-07');

  const justAfterMidnight = new Date(2026, 7, 8, 0, 5, 0);
  assert.equal(todayISO(justAfterMidnight), '2026-08-08');
});

test('date validation rejects impossible and malformed dates', () => {
  assert.equal(isValidISODate('2026-02-29'), false, '2026 is not a leap year');
  assert.equal(isValidISODate('2024-02-29'), true);
  assert.equal(isValidISODate('2026-13-01'), false);
  assert.equal(isValidISODate('2026-8-7'), false);
  assert.equal(isValidISODate('not a date'), false);
  assert.equal(isValidISODate(null), false);
  assert.equal(isValidISODate('2026-08-07T10:00:00'), false);
});

test('parsed dates sit at local noon so DST cannot shift the day', () => {
  const date = parseISODate('2026-03-29');
  assert.equal(date.getHours(), 12);
  assert.equal(toISODate(date), '2026-03-29');
});

test('addDays crosses month, year and leap boundaries', () => {
  assert.equal(addDays('2026-08-07', 1), '2026-08-08');
  assert.equal(addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2026-08-07', 21), '2026-08-28');
});

test('addDays survives a daylight-saving transition', () => {
  // Late March and late October are where a naive +86400000ms goes wrong.
  assert.equal(addDays('2026-03-28', 1), '2026-03-29');
  assert.equal(addDays('2026-03-29', 1), '2026-03-30');
  assert.equal(addDays('2026-10-24', 1), '2026-10-25');
  assert.equal(addDays('2026-10-25', 1), '2026-10-26');
  assert.equal(diffDays('2026-03-28', '2026-03-30'), 2);
  assert.equal(diffDays('2026-10-24', '2026-10-26'), 2);
});

test('diffDays is signed and inclusive of direction', () => {
  assert.equal(diffDays('2026-08-07', '2026-08-07'), 0);
  assert.equal(diffDays('2026-08-07', '2026-08-21'), 14);
  assert.equal(diffDays('2026-08-21', '2026-08-07'), -14);
  assert.equal(diffDays('nonsense', '2026-08-07'), null);
});

test('weeks run Sunday to Saturday', () => {
  assert.equal(startOfWeek('2026-08-07'), '2026-08-02'); // Fri -> the Sunday before
  assert.equal(startOfWeek('2026-08-02'), '2026-08-02'); // a Sunday is its own week start
  assert.equal(endOfWeek('2026-08-02'), '2026-08-08'); // .. and ends on Saturday
  assert.deepEqual(weekDates('2026-08-02').length, 7);
  assert.equal(weekDates('2026-08-02')[6], '2026-08-08');
});

test('the boundary falls between Saturday and Sunday, not Sunday and Monday', () => {
  const saturday = '2026-08-08';
  const sunday = '2026-08-09';
  const monday = '2026-08-10';

  assert.equal(startOfWeek(saturday), '2026-08-02', 'Saturday closes the week that began on the 2nd');
  assert.equal(startOfWeek(sunday), '2026-08-09', 'Sunday opens a new one');
  assert.equal(startOfWeek(monday), '2026-08-09', 'Monday is the second day of that same week');
  assert.notEqual(startOfWeek(saturday), startOfWeek(sunday), 'the one boundary in the week');
  assert.equal(startOfWeek(sunday), startOfWeek(monday));
  assert.equal(isSameWeek(saturday, sunday), false);
  assert.equal(isSameWeek(sunday, '2026-08-15'), true);
});

test('there is exactly one week boundary in any seven consecutive days', () => {
  let boundaries = 0;
  let cursor = '2026-08-05';
  for (let i = 0; i < 7; i += 1) {
    const next = addDays(cursor, 1);
    if (startOfWeek(cursor) !== startOfWeek(next)) boundaries += 1;
    cursor = next;
  }
  assert.equal(boundaries, 1);
});

test('days left in the week counts today, and runs out on Saturday', () => {
  assert.equal(daysLeftInWeek('2026-08-02'), 7, 'a whole week ahead on Sunday');
  assert.equal(daysLeftInWeek('2026-08-07'), 2, 'Friday leaves Friday and Saturday');
  assert.equal(daysLeftInWeek('2026-08-08'), 1, 'Saturday is the last of it');
});

test('the weekday strip is labelled in week order', () => {
  assert.deepEqual(weekdayInitials(), ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']);
  // The labels and the dates have to agree, or the strip lies about which
  // square is which day.
  const dates = weekDates(startOfWeek('2026-08-07'));
  const labels = weekdayInitials();
  dates.forEach((iso, i) => {
    assert.equal(formatDate(iso, { weekday: true }).slice(0, 2), labels[i]);
  });
});

test('relative day phrasing', () => {
  const today = '2026-08-07';
  assert.equal(relativeDay(today, today), 'today');
  assert.equal(relativeDay('2026-08-08', today), 'tomorrow');
  assert.equal(relativeDay('2026-08-06', today), '1d overdue');
  assert.equal(relativeDay('2026-08-01', today), '6d overdue');
  assert.equal(relativeDay('2026-08-12', today), 'in 5d');
});

test('clock times round-trip and validate', () => {
  assert.equal(timeToMinutes('09:30'), 570);
  assert.equal(timeToMinutes('24:00'), null);
  assert.equal(timeToMinutes('9:30'), null);
  assert.equal(minutesToTime(570), '09:30');
  assert.equal(minutesToTime(0), '00:00');
  assert.equal(formatDuration(90), '1h 30m');
  assert.equal(formatDuration(60), '1h');
  assert.equal(formatDuration(45), '45m');
  assert.equal(formatDuration(0), '0m');
});

test('stamps keep their local calendar day', () => {
  assert.equal(stampToDate('2026-08-07T23:59:00'), '2026-08-07');
  assert.equal(stampToDate('garbage'), null);
  assert.equal(stampToDate(undefined), null);
});

test('withinRange is inclusive at both ends', () => {
  assert.equal(withinRange('2026-08-03', '2026-08-03', '2026-08-09'), true);
  assert.equal(withinRange('2026-08-09', '2026-08-03', '2026-08-09'), true);
  assert.equal(withinRange('2026-08-10', '2026-08-03', '2026-08-09'), false);
});
