// What a block of time was spent on.
//
// Threads are only part of it. Most of a week is not a project with stages: it
// is the gym, GRE, practice problems, reading, applications. Those are real
// areas of the app with their own records, so a block points at one of them the
// same way it points at a thread — and the weekly distribution can finally add
// up to the whole week instead of the part that happened to be a project.
//
// A block's `activity` is a namespaced string: "thread:<id>" or "area:<id>".
// Namespacing keeps a thread whose id happens to read like an area name from
// colliding with one, and makes an unknown value obvious rather than silent.

import { activeThreads } from './threads.js';

/** The trackable areas that are not threads. Order is the order they appear. */
export const ACTIVITY_AREAS = [
  { id: 'gym', label: 'Gym', route: '#/gym' },
  { id: 'gre', label: 'GRE practice', route: '#/questions/gre' },
  { id: 'leetcode', label: 'LeetCode practice', route: '#/questions/leetcode' },
  { id: 'sql', label: 'SQL practice', route: '#/questions/sql' },
  { id: 'reading', label: 'Reading', route: '#/reading' },
  { id: 'applications', label: 'Applications and outreach', route: '#/pipelines' },
  { id: 'writing', label: 'Writing', route: null },
  { id: 'admin', label: 'Admin and errands', route: null },
  { id: 'rest', label: 'Rest', route: null },
];

const AREA_BY_ID = new Map(ACTIVITY_AREAS.map((area) => [area.id, area]));

export const UNASSIGNED = '__unassigned';

/** @returns {{kind:'thread'|'area'|'none', id:string|null}} */
export function parseActivity(activity) {
  const raw = String(activity ?? '');
  if (!raw) return { kind: 'none', id: null };
  const at = raw.indexOf(':');
  if (at < 0) return { kind: 'none', id: null };
  const kind = raw.slice(0, at);
  const id = raw.slice(at + 1);
  if (!id) return { kind: 'none', id: null };
  if (kind === 'thread') return { kind: 'thread', id };
  if (kind === 'area') return { kind: 'area', id };
  return { kind: 'none', id: null };
}

export const threadActivity = (id) => `thread:${id}`;
export const areaActivity = (id) => `area:${id}`;

/** The thread a block belongs to, or null if it belongs to an area instead. */
export function activityThreadId(activity) {
  const parsed = parseActivity(activity);
  return parsed.kind === 'thread' ? parsed.id : null;
}

export function activityLabel(state, activity) {
  const parsed = parseActivity(activity);
  if (parsed.kind === 'thread') {
    const thread = (state?.threads ?? []).find((t) => t.id === parsed.id);
    // A thread that has been deleted is named as gone rather than as
    // unassigned: the hours were spent on something.
    return thread ? thread.name : 'A deleted thread';
  }
  if (parsed.kind === 'area') return AREA_BY_ID.get(parsed.id)?.label ?? parsed.id;
  return 'Unassigned';
}

export function activityRoute(state, activity) {
  const parsed = parseActivity(activity);
  if (parsed.kind === 'thread') {
    return (state?.threads ?? []).some((t) => t.id === parsed.id) ? `#/thread/${parsed.id}` : null;
  }
  if (parsed.kind === 'area') return AREA_BY_ID.get(parsed.id)?.route ?? null;
  return null;
}

/**
 * Everything a block can be assigned to, as select options. Threads first —
 * they are the thing with a deadline — then the standing areas.
 */
export function activityOptions(state, { noneLabel = 'Unassigned' } = {}) {
  const options = [{ value: '', label: noneLabel }];
  const threads = activeThreads(state);
  if (threads.length) {
    options.push({ value: '__threads', label: '— threads —' });
    for (const thread of threads) options.push({ value: threadActivity(thread.id), label: thread.name });
  }
  options.push({ value: '__areas', label: '— everything else —' });
  for (const area of ACTIVITY_AREAS) options.push({ value: areaActivity(area.id), label: area.label });
  return options;
}

/** Separator entries exist to group the list; they are not choices. */
export function isChoosableActivity(value) {
  return !String(value ?? '').startsWith('__');
}

export function normaliseActivity(value) {
  if (!value || !isChoosableActivity(value)) return null;
  return parseActivity(value).kind === 'none' ? null : value;
}
