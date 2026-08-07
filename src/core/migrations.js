// Schema migrations.
//
// Every persisted state carries `schemaVersion`. Loading or importing runs it
// forward through this chain until it matches SCHEMA_VERSION. Migrations are
// pure functions from one version's shape to the next, and each one records
// what it changed so the import report can say so out loud.

import { SCHEMA_VERSION, DEFAULT_SETTINGS, COLLECTIONS, deepClone } from './schema.js';
import { uid } from './ids.js';

/**
 * v1 → v2
 *   - questions moved from `banks: { sql: [], leetcode: [], gre: [] }` to a
 *     single flat `questions` array carrying a `bank` field, so the review
 *     queue can be built without touching three lists.
 *   - stages carried a stored `done` boolean; completion is now derived, and
 *     an explicitly-set `done` becomes `forceCompleted`.
 */
function v1_to_v2(input) {
  const state = deepClone(input);
  const notes = [];

  if (state.banks && typeof state.banks === 'object') {
    const flat = Array.isArray(state.questions) ? [...state.questions] : [];
    let moved = 0;
    for (const bank of ['sql', 'leetcode', 'gre']) {
      for (const question of state.banks[bank] ?? []) {
        flat.push({ ...question, bank: question.bank || bank });
        moved += 1;
      }
    }
    state.questions = flat;
    delete state.banks;
    if (moved) notes.push(`moved ${moved} question(s) from per-bank lists into a single list`);
  }

  let converted = 0;
  for (const thread of state.threads ?? []) {
    for (const stage of thread.stages ?? []) {
      if (Object.prototype.hasOwnProperty.call(stage, 'done')) {
        if (stage.done === true && stage.forceCompleted !== true) {
          stage.forceCompleted = true;
          stage.forceCompletedAt = stage.forceCompletedAt ?? null;
          converted += 1;
        }
        delete stage.done;
      }
    }
  }
  if (converted) notes.push(`converted ${converted} stored stage completion flag(s) to force-completed`);

  state.schemaVersion = 2;
  return { state, notes };
}

export const MIGRATIONS = {
  1: v1_to_v2,
};

export const OLDEST_SUPPORTED_VERSION = 1;

/**
 * Run a state forward to the current schema version.
 * @returns {{state:object, applied:number[], notes:string[], error:string|null}}
 */
export function migrate(input) {
  let state = input;
  const applied = [];
  const notes = [];
  let guard = 0;

  let version = Number(state?.schemaVersion);
  if (!Number.isInteger(version)) {
    return { state, applied, notes, error: 'missing or non-integer schemaVersion' };
  }
  if (version > SCHEMA_VERSION) {
    return {
      state,
      applied,
      notes,
      error: `file is schema v${version} but this build only understands up to v${SCHEMA_VERSION}. Update Cairn before importing.`,
    };
  }
  if (version < OLDEST_SUPPORTED_VERSION) {
    return { state, applied, notes, error: `schema v${version} is older than the oldest supported version (v${OLDEST_SUPPORTED_VERSION})` };
  }

  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) {
      return { state, applied, notes, error: `no migration registered from schema v${version}` };
    }
    const result = step(state);
    state = result.state;
    notes.push(...(result.notes ?? []).map((n) => `v${version}→v${version + 1}: ${n}`));
    applied.push(version);
    version = Number(state.schemaVersion);
    guard += 1;
    if (guard > 50) return { state, applied, notes, error: 'migration chain did not terminate' };
  }

  return { state, applied, notes, error: null };
}

/**
 * Fill in collections and settings a valid-but-sparse file omitted. Additive
 * only -- it never removes or rewrites data that is already there.
 */
export function backfillDefaults(state, templates = []) {
  const notes = [];
  for (const key of COLLECTIONS) {
    if (!Array.isArray(state[key])) {
      state[key] = [];
      notes.push(`added missing "${key}" collection (empty)`);
    }
  }
  if (!state.settings || typeof state.settings !== 'object') {
    state.settings = { ...DEFAULT_SETTINGS };
    notes.push('restored default settings');
  } else {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      if (state.settings[key] === undefined) {
        state.settings[key] = Array.isArray(value) ? [...value] : value;
        notes.push(`filled default setting "${key}"`);
      }
    }
  }
  if (!state.meta || typeof state.meta !== 'object') {
    state.meta = { createdAt: null, updatedAt: null, writeSeq: 0, writerId: null };
    notes.push('rebuilt meta block');
  }
  if (templates.length) {
    const have = new Set(state.noteTemplates.map((t) => t.id));
    for (const template of templates) {
      if (!have.has(template.id)) {
        state.noteTemplates.push({ ...template });
        notes.push(`restored built-in template "${template.name}"`);
      }
    }
  }
  // Ids are load-bearing: anything without one gets a fresh id rather than
  // being dropped.
  for (const key of COLLECTIONS) {
    for (const item of state[key]) {
      if (item && typeof item === 'object' && !item.id) {
        item.id = uid(key.slice(0, 3));
        notes.push(`generated a missing id in "${key}"`);
      }
    }
  }
  return notes;
}
