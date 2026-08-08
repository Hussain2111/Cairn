// Settings: theme, scheduling and detection windows, export and import,
// archived stages, and the storage meter.

import { el, tag, empty, confirm, toast, downloadFile, openDialog } from '../ui.js';
import { pageHead, statTile } from './shared.js';
import { DEFAULT_SETTINGS, SCHEMA_VERSION, THREAD_TYPES } from '../../core/schema.js';
import { normaliseIntervals } from '../../core/srs.js';
import { summarise } from '../../core/validate.js';
import { formatDate, stampToDate, formatLongDate } from '../../core/dates.js';

export function title() {
  return 'Settings';
}

// A rough browser allowance. Used only to colour the meter, never to block.
const ASSUMED_QUOTA_BYTES = 5 * 1024 * 1024;

export function render(ctx) {
  const settings = ctx.state.settings;
  const bytes = ctx.store.payloadBytes();
  const summary = summarise(ctx.state);

  return el('div', [
    pageHead('Settings', { sub: `Schema v${ctx.state.schemaVersion} · last saved ${ctx.state.meta?.updatedAt ?? 'never'}` }),

    section('Appearance', [
      el('div.row', ['system', 'light', 'dark'].map((theme) =>
        el('button.btn' + (settings.theme === theme ? '.btn--primary' : ''), {
          type: 'button',
          text: theme,
          onclick: () => ctx.commit('set theme', () => { settings.theme = theme; }, { undoable: false }),
        }))),
    ]),

    section('Scheduling', [
      el('div.field-row', [
        numberField('Review intervals (days)', normaliseIntervals(settings.srsIntervals).join(', '), (value) => {
          const parsed = value.split(',').map((n) => Number(n.trim())).filter((n) => Number.isFinite(n) && n >= 0);
          if (!parsed.length) {
            toast('Give at least one interval, e.g. 0, 2, 7, 21', { variant: 'danger' });
            return;
          }
          ctx.commit('set intervals', () => { settings.srsIntervals = parsed; }, { undoable: false });
        }, 'text'),
        numberField('Stall after (days)', settings.stallDays, (value) => {
          ctx.commit('set stall window', () => { settings.stallDays = Math.max(1, Number(value) || 14); }, { undoable: false });
        }),
        numberField('Pipeline idle after (days)', settings.pipelineIdleDays, (value) => {
          ctx.commit('set idle window', () => { settings.pipelineIdleDays = Math.max(1, Number(value) || 14); }, { undoable: false });
        }),
      ]),
      el('div.field-row', [
        numberField('Day starts at (hour)', settings.dayStartHour, (value) => {
          ctx.commit('set day start', () => { settings.dayStartHour = clampHour(value, 8); }, { undoable: false });
        }),
        numberField('Day ends at (hour)', settings.dayEndHour, (value) => {
          ctx.commit('set day end', () => { settings.dayEndHour = clampHour(value, 22); }, { undoable: false });
        }),
      ]),
      el('p.field__hint', {
        text: 'Changing the review intervals affects future scheduling only. Questions already in the chain keep their current due dates.',
      }),
    ]),

    section('Your data', [
      el('div.grid.grid--3', [
        statTile(summary.threads, 'threads'),
        statTile(summary.tasks, 'tasks'),
        statTile(summary.questions, 'questions'),
        statTile(summary.notes, 'notes'),
        statTile(summary.applications + summary.outreach, 'pipeline records'),
        statTile(`${(bytes / 1024).toFixed(0)} KB`, 'stored', bytes > ASSUMED_QUOTA_BYTES * 0.8 ? 'amber' : ''),
      ]),
      bytes > ASSUMED_QUOTA_BYTES * 0.8
        ? el('div.banner.banner--warn', [
            el('div.banner__body', [
              el('div.banner__title', { text: 'Storage is filling up' }),
              el('div.banner__text', { text: 'Export a backup, then archive or delete what you no longer need.' }),
            ]),
          ])
        : null,
      el('div.row', [
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'Export JSON',
          onclick: () => {
            downloadFile(ctx.store.exportFilename(), ctx.store.exportJSON());
            toast('Backup downloaded');
          },
        }),
        importButton(ctx, { merge: false }),
        importButton(ctx, { merge: true }),
      ]),
      el('p.field__hint', {
        text: 'Everything lives in this browser. Clearing site data deletes it — export regularly. Import validates the file first and tells you exactly what it found.',
      }),
    ]),

    ctx.state.archivedStages.length ? archivedSection(ctx) : null,

    section('Danger zone', [
      el('button.btn.btn--danger', {
        type: 'button',
        text: 'Delete everything',
        onclick: async () => {
          const answer = await confirm({
            title: 'Delete all data?',
            message: 'Every thread, note, question and record will be removed from this browser. Export first if you might want it back. This can be undone until you close the tab.',
            confirmLabel: 'Delete everything',
            extraLabel: 'Export first',
          });
          if (answer === 'extra') {
            downloadFile(ctx.store.exportFilename(), ctx.store.exportJSON());
            return;
          }
          if (answer !== 'confirm') return;
          ctx.commit('delete all data', (state) => {
            state.threads.length = 0;
            state.notes.length = 0;
            state.questions.length = 0;
            state.applications.length = 0;
            state.outreach.length = 0;
            state.habits.length = 0;
            state.reading.length = 0;
            state.timeBlocks.length = 0;
            state.archivedStages.length = 0;
          });
        },
      }),
    ]),
  ]);
}

function clampHour(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 23 ? Math.round(n) : fallback;
}

function section(heading, children) {
  return el('section.section', [
    el('div.section__head', [
      el('h2.section__title', { text: heading }),
      el('div.section__rule'),
    ]),
    el('div.card', [el('div.card__body.stack', children)]),
  ]);
}

function numberField(label, value, onCommit, type = 'number') {
  const control = el('input.input', { type, value: String(value ?? '') });
  control.addEventListener('change', () => onCommit(control.value));
  return el('label.field', [el('span.field__label', { text: label }), control]);
}

function archivedSection(ctx) {
  return section('Archived stages', [
    el('p.field__hint', { text: 'Stages archived instead of deleted. Their completed work is still in your data.' }),
    ...ctx.state.archivedStages.map((entry, index) =>
      el('div.row.row--between', [
        el('div', [
          el('strong.break', { text: entry.stage.title }),
          el('div.section__meta', {
            text: `${entry.threadName ?? 'unknown thread'} · archived ${formatDate(stampToDate(entry.archivedAt) ?? '')}`,
          }),
        ]),
        el('div.row', [
          el('button.btn.btn--sm', {
            type: 'button',
            text: 'Restore',
            onclick: () => {
              const thread = ctx.state.threads.find((t) => t.id === entry.threadId);
              if (!thread) {
                toast('The thread it belonged to is gone. Restore it into another thread by importing a backup.', { variant: 'danger' });
                return;
              }
              ctx.commit('restore stage', (state) => {
                thread.stages.push(entry.stage);
                state.archivedStages.splice(index, 1);
              });
            },
          }),
          el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            text: 'Delete',
            onclick: async () => {
              const answer = await confirm({
                title: 'Delete this archived stage?',
                message: `"${entry.stage.title}" will be gone for good, apart from undo.`,
                confirmLabel: 'Delete',
              });
              if (answer !== 'confirm') return;
              ctx.commit('delete archived stage', (state) => state.archivedStages.splice(index, 1));
            },
          }),
        ]),
      ])),
  ]);
}

// --- import -----------------------------------------------------------------

function importButton(ctx, { merge }) {
  const picker = el('input', {
    type: 'file',
    accept: 'application/json,.json',
    style: { display: 'none' },
    onchange: async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      picker.value = '';
      await runImport(ctx, text, { merge, filename: file.name });
    },
  });

  return el('span', [
    picker,
    el('button.btn', {
      type: 'button',
      text: merge ? 'Import and merge' : 'Import (replace)',
      onclick: () => picker.click(),
    }),
  ]);
}

async function runImport(ctx, text, { merge, filename }) {
  // Validate before touching anything, so a bad file can never half-load.
  const { validateImport } = await import('../../core/validate.js');
  const report = validateImport(text);

  if (!report.ok) {
    await openDialog({
      title: `Cannot import ${filename}`,
      wide: true,
      body: renderImportReport(report),
      footer: (close) => [el('button.btn', { type: 'button', text: 'Close', onclick: () => close() })],
    });
    return;
  }

  const proceed = await openDialog({
    title: merge ? 'Merge this file in?' : 'Replace everything with this file?',
    wide: true,
    body: [
      el('p', {
        text: merge
          ? 'Records with ids you already have are left alone; everything else is added.'
          : 'Your current data will be replaced. This can be undone.',
      }),
      renderImportReport(report),
    ],
    footer: (close) => [
      el('button.btn', { type: 'button', text: 'Cancel', onclick: () => close(null) }),
      el('button.btn.btn--primary', { type: 'button', text: merge ? 'Merge' : 'Replace', onclick: () => close('go') }),
    ],
  });
  if (proceed !== 'go') return;

  ctx.store.importJSON(text, { merge });
  ctx.render();
  toast(`Imported ${filename}`, {
    action: { label: 'Undo', onClick: () => { ctx.store.undo(); ctx.render(); } },
  });
}

/**
 * The import report, shown before an import and after a repaired load.
 * Exported because the shell reuses it for load-time problems.
 */
export function renderImportReport(report) {
  const rows = [];

  if (report.summary) {
    rows.push(
      el('div.row', [
        tag(`${report.summary.threads} threads`),
        tag(`${report.summary.stages} stages`),
        tag(`${report.summary.tasks} tasks`),
        tag(`${report.summary.questions} questions`),
        tag(`${report.summary.notes} notes`),
        tag(`${report.summary.applications} applications`),
        tag(`${report.summary.outreach} outreach`),
        tag(`${report.summary.habits} habits`),
        tag(`${report.summary.timeBlocks} time blocks`),
      ]),
    );
  }

  if (report.errors?.length) {
    rows.push(
      el('div.stack--tight.stack', [
        el('strong', { text: `${report.errors.length} problem(s) that stop the import` }),
        ...report.errors.slice(0, 40).map((e) =>
          el('div.row', [tag(e.path, 'danger'), el('span.break', { text: e.message })])),
        report.errors.length > 40 ? el('span.muted', { text: `…and ${report.errors.length - 40} more.` }) : null,
      ]),
    );
  }

  if (report.notes?.length) {
    rows.push(
      el('div.stack--tight.stack', [
        el('strong', { text: 'Migration and backfill' }),
        ...report.notes.map((n) => el('div.muted.break', { text: n })),
      ]),
    );
  }

  if (report.warnings?.length) {
    rows.push(
      el('div.stack--tight.stack', [
        el('strong', { text: `${report.warnings.length} repair(s) — nothing was dropped` }),
        ...report.warnings.slice(0, 60).map((w) =>
          el('div.row', [tag(w.path, 'amber'), el('span.break', { text: w.message })])),
        report.warnings.length > 60 ? el('span.muted', { text: `…and ${report.warnings.length - 60} more.` }) : null,
      ]),
    );
  }

  if (!rows.length) rows.push(el('p.muted', { text: 'The file is clean — nothing to report.' }));
  return el('div.stack', rows);
}
