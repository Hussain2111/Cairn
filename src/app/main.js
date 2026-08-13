// Application shell: store wiring, routing, navigation, global banners and
// theme.

import { Store } from './store.js';
import { el, clear, toast, confirm, openDialog, downloadFile } from './ui.js';
import { todayISO } from '../core/dates.js';
import { reviewQueue } from '../core/srs.js';
import { needsAction } from '../core/pipelines.js';
import { activeThreads } from '../core/threads.js';
import { renderImportReport } from './views/settings.js';

import * as todayView from './views/today.js';
import * as threadsView from './views/threads.js';
import * as threadView from './views/thread.js';
import * as questionsView from './views/questions.js';
import * as pipelinesView from './views/pipelines.js';
import * as timeView from './views/time.js';
import * as weeklyView from './views/weekly.js';
import * as gymView from './views/gym.js';
import * as readingView from './views/reading.js';
import * as settingsView from './views/settings.js';

const store = new Store({ storage: window.localStorage });

const VIEWS = {
  today: todayView,
  threads: threadsView,
  thread: threadView,
  questions: questionsView,
  review: questionsView,
  pipelines: pipelinesView,
  time: timeView,
  weekly: weeklyView,
  gym: gymView,
  reading: readingView,
  settings: settingsView,
};

const appNode = document.getElementById('app');
const sidebarNode = document.getElementById('sidebar');
const viewNode = document.getElementById('view');
const scrimNode = document.getElementById('scrim');

// --- routing ----------------------------------------------------------------

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  return {
    name: segments[0] || 'today',
    params: segments.slice(1),
    query: new URLSearchParams(queryPart || ''),
    href: `#/${raw}`,
  };
}

function navigate(href, { replace = false } = {}) {
  const target = href.startsWith('#') ? href : `#${href}`;
  if (replace) location.replace(target);
  else location.hash = target.slice(1);
}

// --- context handed to every view ------------------------------------------

const ctx = {
  store,
  get state() {
    return store.state;
  },
  get today() {
    return todayISO();
  },
  route: parseRoute(),
  navigate,
  render: () => render(),
  /**
   * Mutate, save, re-render, and offer undo.
   *
   * `rerender: false` is for autosaves inside a control the user is still
   * typing in — rebuilding the view under them would steal focus and the
   * caret mid-sentence.
   */
  commit(label, fn, { undoable = true, message = null, rerender = true } = {}) {
    const outcome = store.mutate(label, fn);
    if (outcome.saved.ok === false && outcome.saved.reason === 'quota') {
      // The quota banner is already raised by the store.
    } else if (undoable) {
      toast(message || `${label} — undone with ⌘Z`, {
        action: { label: 'Undo', onClick: () => { store.undo(); render(); } },
        timeout: 6000,
      });
    } else if (message) {
      toast(message);
    }
    if (rerender) render();
    return outcome.result;
  },
  toast,
  confirm,
  openDialog,
};

// --- sidebar ----------------------------------------------------------------

function navLink(href, label, badge = null, quiet = false) {
  const active = ctx.route.href.startsWith(href) || (href === '#/today' && ctx.route.name === 'today');
  return el('a.nav__link', {
    href,
    text: label,
    'aria-current': active ? 'page' : null,
  }, badge ? [el('span.nav__badge' + (quiet ? '.nav__badge--quiet' : ''), { text: String(badge) })] : []);
}

function renderSidebar() {
  const state = store.state;
  const today = todayISO();
  const due = reviewQueue(state, { today }).length;
  const actions = needsAction(state, { today }).count;
  const active = activeThreads(state).length;

  clear(sidebarNode);
  sidebarNode.appendChild(
    el('div', [
      el('div.brand', [
        el('span.brand__dot'),
        el('span.brand__mark', { text: 'cairn' }),
      ]),
      el('nav.nav', { 'aria-label': 'Primary' }, [
        navLink('#/today', 'Today'),
        navLink('#/threads', 'Threads', active || null, true),
        navLink('#/questions', 'Questions', due || null),
        navLink('#/pipelines', 'Pipelines', actions || null),
        el('div.nav__section', { text: 'Record' }),
        navLink('#/time', 'Time'),
        navLink('#/weekly', 'Weekly review'),
        el('div.nav__section', { text: 'Keep going' }),
        navLink('#/gym', 'Gym', null, true),
        navLink('#/reading', 'Reading', state.reading.length || null, true),
      ]),
    ]),
  );

  sidebarNode.appendChild(el('div.sidebar__foot', [navLink('#/settings', 'Settings')]));
}

// --- global banners ---------------------------------------------------------

function renderBanners() {
  const banners = [];

  if (store.status.quota) {
    banners.push(
      el('div.banner.banner--danger', [
        el('div.banner__body', [
          el('div.banner__title', { text: 'Storage is full — your last change is not saved' }),
          el('div.banner__text', {
            text: 'Export a backup now, then delete or archive some data. Nothing is lost while this tab stays open.',
          }),
        ]),
        el('button.btn.btn--primary.btn--sm', {
          type: 'button',
          text: 'Export now',
          onclick: () => {
            downloadFile(store.exportFilename(), store.exportJSON());
          },
        }),
      ]),
    );
  }

  if (store.status.conflict) {
    banners.push(
      el('div.banner.banner--warn', [
        el('div.banner__body', [
          el('div.banner__title', { text: 'Another tab has changed this data' }),
          el('div.banner__text', {
            text: 'Your changes here have not been saved, so nothing was overwritten. Load the other tab’s version, or keep this one.',
          }),
        ]),
        el('button.btn.btn--sm', {
          type: 'button',
          text: 'Load theirs',
          onclick: () => { store.reloadFromStorage(); render(); },
        }),
        el('button.btn.btn--sm.btn--danger', {
          type: 'button',
          text: 'Keep mine',
          onclick: () => { store.overwriteStorage(); render(); },
        }),
      ]),
    );
  }

  const load = store.status.loadReport;
  if (load && !load.ok && store.status.corruptRaw) {
    banners.push(
      el('div.banner.banner--danger', [
        el('div.banner__body', [
          el('div.banner__title', { text: 'Saved data could not be read' }),
          el('div.banner__text', {
            text: 'Cairn opened empty so it does not overwrite what is stored. The stored data is untouched — download it and inspect it before saving anything else.',
          }),
        ]),
        el('button.btn.btn--sm', {
          type: 'button',
          text: 'Details',
          onclick: () => openDialog({
            title: 'Why the saved data was refused',
            wide: true,
            body: renderImportReport(load),
            footer: (close) => [el('button.btn', { type: 'button', text: 'Close', onclick: () => close() })],
          }),
        }),
        el('button.btn.btn--sm', {
          type: 'button',
          text: 'Download raw',
          onclick: () => downloadFile(`cairn-unreadable-${todayISO()}.json`, store.status.corruptRaw, 'text/plain'),
        }),
      ]),
    );
  } else if (load?.ok && load.warnings?.length && !store.status.warningsDismissed) {
    banners.push(
      el('div.banner.banner--warn', [
        el('div.banner__body', [
          el('div.banner__title', { text: `Saved data loaded with ${load.warnings.length} repair(s)` }),
          el('div.banner__text', { text: 'Nothing was dropped. Open the details to see exactly what changed.' }),
        ]),
        el('button.btn.btn--sm', {
          type: 'button',
          text: 'Details',
          onclick: () => openDialog({
            title: 'Repairs made while loading',
            wide: true,
            body: renderImportReport(load),
            footer: (close) => [el('button.btn', { type: 'button', text: 'Close', onclick: () => close() })],
          }),
        }),
        el('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          text: 'Dismiss',
          onclick: () => { store.status.warningsDismissed = true; render(); },
        }),
      ]),
    );
  }

  return banners.length ? el('div.banners', banners) : null;
}

// --- render -----------------------------------------------------------------

let rendering = false;
let lastRenderedHref = null;

/**
 * Re-render.
 *
 * Committing a change rebuilds the view, which replaces every node in it — and
 * a replaced node has no scroll position, so the page snaps to the top. On a
 * long thread that made ticking anything below the fold unusable: the row you
 * were looking at vanished upwards the moment you touched it.
 *
 * So scrolling to the top is reserved for what it was actually for — arriving
 * at a different view. A re-render of the view you are already on restores
 * where you were, and puts the focus ring back on the element that had it, so
 * tapping a checkbox leaves the keyboard where it was too.
 */
function render() {
  if (rendering) return;
  rendering = true;
  try {
    ctx.route = parseRoute();
    const view = VIEWS[ctx.route.name] ?? VIEWS.today;
    const sameView = lastRenderedHref === ctx.route.href;
    const scrollY = sameView ? window.scrollY : 0;
    const refocus = sameView ? focusTarget(document.activeElement) : null;
    renderSidebar();

    clear(viewNode);
    viewNode.appendChild(
      el('button.btn.btn--sm.menu-toggle', {
        type: 'button',
        text: '☰ Menu',
        style: { marginBottom: 'var(--sp-3)' },
        onclick: () => {
          appNode.dataset.menu = appNode.dataset.menu === 'open' ? 'closed' : 'open';
        },
      }),
    );
    const banners = renderBanners();
    if (banners) viewNode.appendChild(banners);

    let content;
    try {
      content = view.render(ctx);
    } catch (error) {
      console.error(error);
      content = el('div.empty', [
        el('div.empty__title', { text: 'This view failed to render' }),
        el('p.empty__body', { text: String(error?.message || error) }),
        el('a.btn', { href: '#/today', text: 'Back to Today' }),
      ]);
    }
    viewNode.appendChild(content);
    document.title = view.title ? `${view.title(ctx)} · Cairn` : 'Cairn';
    lastRenderedHref = ctx.route.href;

    if (sameView) {
      window.scrollTo({ top: scrollY });
      restoreFocus(refocus);
    } else {
      window.scrollTo({ top: 0 });
    }
  } finally {
    rendering = false;
  }
}

/**
 * Where the focus was, in terms that survive the view being rebuilt: the
 * data-id of the row it was in, plus something that identifies the control
 * within that row *by name*.
 *
 * By name, and not by position, because position is exactly what a re-render
 * changes. Ticking a task adds a button to its step, so the nth control in that
 * step is no longer the same control — restoring by index put the focus on a
 * checkbox that the keystroke still in flight then activated, ticking a task
 * nobody asked to tick. A control with no stable name is simply not restored:
 * losing the focus ring is a small cost, and pressing the wrong button is not.
 */
function focusTarget(node) {
  if (!(node instanceof HTMLElement) || !viewNode.contains(node)) return null;
  const owner = node.closest('[data-id]');
  if (!owner?.dataset.id) return null;
  if (owner === node) return { id: owner.dataset.id, within: null };

  const label = node.getAttribute('aria-label');
  const placeholder = node.getAttribute('placeholder');
  if (!label && !placeholder) return { id: owner.dataset.id, within: null };
  const attribute = label ? 'aria-label' : 'placeholder';
  // An attribute *value*, so quotes and backslashes are what need escaping —
  // CSS.escape is for identifiers and would mangle the spaces.
  const value = (label ?? placeholder).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return { id: owner.dataset.id, within: `[${attribute}="${value}"]` };
}

function restoreFocus(target) {
  if (!target) return;
  const owner = viewNode.querySelector(`[data-id="${CSS.escape(target.id)}"]`);
  if (!owner) return;
  const node = target.within ? owner.querySelector(target.within) : owner;
  node?.focus?.({ preventScroll: true });
}

// --- undo -------------------------------------------------------------------
//
// The single-key navigation shortcuts and their cheat sheet are gone. Undo and
// redo stay: they are not a shortcut for something on screen, they are the only
// way to reverse a destructive action.

window.addEventListener('keydown', (event) => {
  const mod = event.metaKey || event.ctrlKey;
  if (!mod) return;

  if (event.key.toLowerCase() === 'z') {
    event.preventDefault();
    const label = event.shiftKey ? store.redo() : store.undo();
    render();
    toast(label ? (event.shiftKey ? `Redid: ${label}` : `Undid: ${label}`) : 'Nothing to undo');
    return;
  }
  if (event.key.toLowerCase() === 'y') {
    event.preventDefault();
    const label = store.redo();
    render();
    toast(label ? `Redid: ${label}` : 'Nothing to redo');
  }
});

// --- multi-tab --------------------------------------------------------------

window.addEventListener('storage', (event) => {
  if (event.key !== store.key) return;
  const meta = store.readPersistedMeta();
  if (!meta || meta.writerId === store.tabId) return;
  if (store.dirty) {
    store.status.conflict = { detectedAt: new Date().toISOString(), theirSeq: meta.writeSeq, ourSeq: store.lastSeenSeq };
    render();
  } else {
    // Nothing unsaved here, so adopt the other tab's write instead of
    // sitting on a stale view.
    store.reloadFromStorage();
    toast('Updated from another tab');
  }
});

// --- boot -------------------------------------------------------------------

window.addEventListener('hashchange', () => {
  appNode.dataset.menu = 'closed';
  render();
});

scrimNode.addEventListener('click', () => {
  appNode.dataset.menu = 'closed';
});

store.subscribe((state) => {
  const theme = state.settings?.theme;
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
  else document.documentElement.removeAttribute('data-theme');
});

store.load();
if (!location.hash) navigate('#/today', { replace: true });
const theme = store.state.settings?.theme;
if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
render();

// Offline support. Registration failures are non-fatal — the app works
// without it, just not on a dead connection.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('../../sw.js', import.meta.url)).catch(() => {});
  });
}

// Exposed for the end-to-end tests to seed and inspect state.
window.cairn = { store, render, navigate };
