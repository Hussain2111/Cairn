// Persistence, undo, quota handling and multi-tab conflict detection.
//
// The storage backend is injected so the whole thing can be exercised without a
// browser; in the app it is `window.localStorage`.

import { STORAGE_KEY, SCHEMA_VERSION, createEmptyState, deepClone } from '../core/schema.js';
import { builtinTemplates } from '../core/templates.js';
import { validateImport } from '../core/validate.js';
import { nowStamp, todayISO } from '../core/dates.js';
import { uid } from '../core/ids.js';

const UNDO_LIMIT = 40;

export class QuotaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QuotaError';
  }
}

function isQuotaError(error) {
  return (
    error &&
    (error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22 ||
      error.code === 1014)
  );
}

export class Store {
  /**
   * @param {object} options
   * @param {Storage} options.storage    localStorage-compatible backend
   * @param {string}  [options.key]
   */
  constructor({ storage, key = STORAGE_KEY } = {}) {
    this.storage = storage;
    this.key = key;
    this.tabId = uid('tab');
    this.state = createEmptyState(builtinTemplates());
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
    this.status = { quota: null, conflict: null, loadReport: null };
    this.lastSeenSeq = 0;
    this.dirty = false;
  }

  // --- subscription ---------------------------------------------------------

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event = 'change') {
    for (const fn of this.listeners) fn(this.state, event, this);
  }

  // --- load / save ----------------------------------------------------------

  load() {
    let raw = null;
    try {
      raw = this.storage?.getItem(this.key) ?? null;
    } catch (error) {
      this.status.loadReport = { ok: false, errors: [{ path: 'storage', message: error.message }], warnings: [], notes: [] };
      return this.state;
    }
    if (!raw) {
      this.state = createEmptyState(builtinTemplates());
      this.lastSeenSeq = 0;
      return this.state;
    }
    const report = validateImport(raw);
    this.status.loadReport = report;
    if (report.ok) {
      this.state = report.state;
      this.lastSeenSeq = this.state.meta?.writeSeq ?? 0;
      // A question with no due date is scheduled for today rather than
      // vanishing from the queue.
      for (const q of this.state.questions) {
        if (!q.retired && !q.dueDate) q.dueDate = todayISO();
      }
    } else {
      // Keep the unreadable payload where the user can still get at it rather
      // than overwriting it with an empty state.
      this.status.corruptRaw = raw;
      this.state = createEmptyState(builtinTemplates());
    }
    return this.state;
  }

  /**
   * Persist. Returns `{ok, reason}` — callers surface quota problems rather
   * than assuming success.
   */
  save({ force = false } = {}) {
    const persisted = this.readPersistedMeta();
    if (!force && persisted && persisted.writeSeq > this.lastSeenSeq && persisted.writerId !== this.tabId) {
      this.status.conflict = {
        detectedAt: nowStamp(),
        theirSeq: persisted.writeSeq,
        ourSeq: this.lastSeenSeq,
      };
      this.dirty = true;
      this.emit('conflict');
      return { ok: false, reason: 'conflict' };
    }

    this.state.meta = this.state.meta || {};
    this.state.meta.updatedAt = nowStamp();
    this.state.meta.writeSeq = (this.state.meta.writeSeq ?? 0) + 1;
    this.state.meta.writerId = this.tabId;
    this.state.schemaVersion = SCHEMA_VERSION;

    const payload = JSON.stringify(this.state);
    try {
      this.storage.setItem(this.key, payload);
      this.lastSeenSeq = this.state.meta.writeSeq;
      this.status.quota = null;
      this.dirty = false;
      return { ok: true };
    } catch (error) {
      if (isQuotaError(error)) {
        this.status.quota = {
          detectedAt: nowStamp(),
          bytes: payload.length,
          message: 'Browser storage is full. Your last change is still on screen but has not been saved.',
        };
        this.dirty = true;
        this.emit('quota');
        return { ok: false, reason: 'quota', bytes: payload.length };
      }
      this.dirty = true;
      return { ok: false, reason: 'error', error };
    }
  }

  readPersistedMeta() {
    try {
      const raw = this.storage?.getItem(this.key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.meta ?? null;
    } catch {
      return null;
    }
  }

  /** Estimated size of the saved payload, for the storage meter. */
  payloadBytes() {
    try {
      return JSON.stringify(this.state).length;
    } catch {
      return 0;
    }
  }

  // --- mutation with undo ---------------------------------------------------

  /**
   * Run a mutation against a snapshot of state, pushing the previous state onto
   * the undo stack. Every destructive path in the app goes through here, which
   * is what makes "undo for every destructive action" hold.
   *
   * @param {string} label   shown in the undo toast
   * @param {(state:object) => any} fn
   */
  mutate(label, fn) {
    const before = deepClone(this.state);
    let result;
    try {
      result = fn(this.state);
    } catch (error) {
      this.state = before; // never leave a half-applied mutation behind
      throw error;
    }
    this.undoStack.push({ label, state: before, at: nowStamp() });
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
    const saved = this.save();
    this.emit('change');
    return { result, saved, label };
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push({ label: entry.label, state: deepClone(this.state) });
    this.state = entry.state;
    this.save({ force: true });
    this.emit('change');
    return entry.label;
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push({ label: entry.label, state: deepClone(this.state) });
    this.state = entry.state;
    this.save({ force: true });
    this.emit('change');
    return entry.label;
  }

  lastUndoLabel() {
    return this.undoStack[this.undoStack.length - 1]?.label ?? null;
  }

  // --- export / import ------------------------------------------------------

  exportJSON() {
    return JSON.stringify({ ...this.state, meta: { ...this.state.meta, exportedAt: nowStamp() } }, null, 2);
  }

  exportFilename() {
    return `cairn-${todayISO()}.json`;
  }

  /**
   * Validate and (if valid) replace state. Import is undoable like anything
   * else, so a bad import is one keystroke away from being reversed.
   */
  importJSON(raw, { merge = false } = {}) {
    const report = validateImport(raw);
    if (!report.ok) return report;
    const incoming = report.state;
    this.mutate('import', (state) => {
      if (!merge) {
        Object.keys(state).forEach((key) => delete state[key]);
        Object.assign(state, incoming, { meta: { ...incoming.meta, writeSeq: state.meta?.writeSeq ?? 0 } });
      } else {
        mergeInto(state, incoming);
      }
    });
    return report;
  }

  /** Adopt whatever another tab wrote, discarding this tab's unsaved edits. */
  reloadFromStorage() {
    this.status.conflict = null;
    this.load();
    this.emit('change');
  }

  /** Keep this tab's state and overwrite whatever the other tab wrote. */
  overwriteStorage() {
    this.status.conflict = null;
    const persisted = this.readPersistedMeta();
    this.lastSeenSeq = persisted?.writeSeq ?? this.lastSeenSeq;
    this.state.meta.writeSeq = Math.max(this.lastSeenSeq, this.state.meta?.writeSeq ?? 0);
    const result = this.save({ force: true });
    this.emit('change');
    return result;
  }
}

/** Additive merge used by "import and merge": ids that already exist win. */
function mergeInto(target, incoming) {
  const collections = [
    'threads',
    'notes',
    'noteTemplates',
    'questions',
    'applications',
    'outreach',
    'habits',
    'reading',
    'timeBlocks',
    'archivedStages',
  ];
  for (const key of collections) {
    const existing = new Set((target[key] ?? []).map((item) => item.id));
    for (const item of incoming[key] ?? []) {
      if (!existing.has(item.id)) target[key].push(item);
    }
  }
}
