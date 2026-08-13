// Job applications and outreach: board, table, and the needs-action list.

import { el, tag, empty, confirm } from '../ui.js';
import { pageHead, editRecord } from './shared.js';
import { needsAction, describeReason, applicationActions, outreachActions, applicationsByStatus } from '../../core/pipelines.js';
import {
  makeApplication,
  makeOutreach,
  APPLICATION_STATUSES,
  APPLICATION_SOURCES,
  OUTREACH_CHANNELS,
} from '../../core/schema.js';
import { formatDate, todayISO } from '../../core/dates.js';
import { openApplicationImport } from './app-import.js';

export function title() {
  return 'Pipelines';
}

export function render(ctx) {
  const tab = ctx.route.query.get('tab') ?? 'applications';
  const view = ctx.route.query.get('view') ?? 'board';
  const focusId = ctx.route.query.get('focus');
  const actions = needsAction(ctx.state, { today: ctx.today });

  return el('div', [
    pageHead('Pipelines', {
      sub: `${ctx.state.applications.length} application(s) · ${ctx.state.outreach.length} contact(s)`,
      actions: [
        tab === 'outreach'
          ? null
          : el('button.btn', { type: 'button', text: 'Import spreadsheet', onclick: () => openApplicationImport(ctx) }),
        tab === 'outreach'
          ? el('button.btn.btn--primary', { type: 'button', text: 'Log outreach', onclick: () => editOutreach(ctx, null) })
          : el('button.btn.btn--primary', { type: 'button', text: 'Log application', onclick: () => editApplication(ctx, null) }),
      ].filter(Boolean),
    }),

    actions.count
      ? el('section.section', [
          el('div.section__head', [
            el('h2.section__title', { text: 'Needs action' }),
            el('div.section__rule'),
            el('span.section__meta', { text: `${actions.count} item(s)` }),
          ]),
          el('div.card', [
            el('div.card__body.stack--tight.stack', actions.all.map((entry) => actionRow(ctx, entry))),
          ]),
        ])
      : el('p.muted', { style: { marginBottom: 'var(--sp-4)' }, text: 'Nothing needs action right now.' }),

    el('div.row', { style: { marginBottom: 'var(--sp-3)' } }, [
      el('a.btn.btn--sm' + (tab === 'applications' ? '' : '.btn--ghost'), { href: '#/pipelines', text: 'Applications' }),
      el('a.btn.btn--sm' + (tab === 'outreach' ? '' : '.btn--ghost'), { href: '#/pipelines?tab=outreach', text: 'Outreach' }),
      el('div.spacer'),
      tab === 'applications'
        ? el('a.btn.btn--sm.btn--ghost', {
            href: `#/pipelines?view=${view === 'board' ? 'table' : 'board'}`,
            text: view === 'board' ? 'Table view' : 'Board view',
          })
        : null,
    ]),

    tab === 'outreach'
      ? renderOutreach(ctx, focusId)
      : view === 'table'
        ? renderApplicationTable(ctx, focusId)
        : renderApplicationBoard(ctx, focusId),
  ]);
}

function actionRow(ctx, entry) {
  const { item, kind, reasons } = entry;
  const overdue = reasons.some((r) => r.kind === 'due' && r.overdueBy > 0);
  const label = kind === 'application'
    ? `${item.role || 'Role'} — ${item.company || 'Company'}`
    : `${item.name || 'Contact'}${item.company ? ` — ${item.company}` : ''}`;
  return el('div.row.row--between', [
    el('div', [
      el('button.btn.btn--ghost.btn--sm', {
        type: 'button',
        text: label,
        onclick: () => (kind === 'application' ? editApplication(ctx, item) : editOutreach(ctx, item)),
      }),
      el('div.section__meta', { text: item.nextAction || (kind === 'outreach' ? 'no reply yet' : item.status) }),
    ]),
    el('div.row', reasons.map((reason) => tag(describeReason(reason), overdue ? 'danger' : 'amber'))),
  ]);
}

// --- applications -----------------------------------------------------------

function renderApplicationBoard(ctx, focusId) {
  if (!ctx.state.applications.length) {
    return empty(
      'No applications yet',
      'Log each one as you send it, with the resume version you used. The board tells you what has gone quiet.',
      el('button.btn.btn--primary', { type: 'button', text: 'Log the first application', onclick: () => editApplication(ctx, null) }),
    );
  }

  const grouped = applicationsByStatus(ctx.state, APPLICATION_STATUSES);
  return el('div.board', APPLICATION_STATUSES.map((status) =>
    el('div.board__col', [
      el('div.board__head', [
        el('span', { text: status }),
        el('span', { text: String(grouped[status].length) }),
      ]),
      el('div.board__list', grouped[status].length
        ? grouped[status].map((app) => applicationCard(ctx, app, focusId))
        : [el('span.field__hint', { text: '—' })]),
    ])));
}

function applicationCard(ctx, app, focusId) {
  const reasons = applicationActions(app, { today: ctx.today, idleDays: ctx.state.settings.pipelineIdleDays });
  const overdue = reasons.some((r) => r.kind === 'due' && r.overdueBy > 0);
  const classes = ['board__card'];
  if (reasons.length) classes.push(overdue ? 'board__card--overdue' : 'board__card--action');

  const card = el(`button.${classes.join('.')}`, {
    type: 'button',
    dataset: { id: app.id },
    onclick: () => editApplication(ctx, app),
  }, [
    el('div.board__company.clamp-2', { text: app.company || 'Company' }),
    el('div.board__role.clamp-2', { text: app.role || 'Role' }),
    el('div.row', { style: { marginTop: 'var(--sp-1)' } }, [
      tag(app.source || 'direct'),
      app.resumeVersion ? tag(app.resumeVersion) : null,
      app.nextActionDate ? tag(formatDate(app.nextActionDate), overdue ? 'danger' : 'amber') : null,
    ]),
  ]);
  if (focusId === app.id) card.classList.add('is-focused');
  return card;
}

function renderApplicationTable(ctx, focusId) {
  const rows = [...ctx.state.applications].sort((a, b) => String(b.dateApplied).localeCompare(String(a.dateApplied)));
  if (!rows.length) return renderApplicationBoard(ctx, focusId);

  return el('div.table-wrap', [
    el('table', [
      el('thead', [
        el('tr', ['Company', 'Role', 'Source', 'Applied', 'Resume', 'Status', 'Next action', ''].map((h) => el('th', { text: h }))),
      ]),
      el('tbody', rows.map((app) =>
        el('tr', { dataset: { id: app.id } }, [
          el('td', [el('strong.break', { text: app.company || '—' })]),
          el('td.break', { text: app.role || '—' }),
          el('td', [tag(app.source || 'direct')]),
          el('td.mono', { text: app.dateApplied ? formatDate(app.dateApplied) : '—' }),
          el('td.break', { text: app.resumeVersion || '—' }),
          el('td', [tag(app.status, app.status === 'offer' ? 'teal' : app.status === 'rejected' ? 'locked' : '')]),
          el('td', [
            el('div.break', { text: app.nextAction || '—' }),
            app.nextActionDate ? el('div.section__meta', { text: formatDate(app.nextActionDate) }) : null,
          ]),
          el('td', [el('button.btn.btn--sm', { type: 'button', text: 'Edit', onclick: () => editApplication(ctx, app) })]),
        ]))),
    ]),
  ]);
}

async function editApplication(ctx, app) {
  const isNew = !app;
  const values = await editRecord({
    title: isNew ? 'Log an application' : 'Application',
    wide: true,
    deletable: !isNew,
    submitLabel: isNew ? 'Log it' : 'Save',
    fields: [
      { key: 'company', label: 'Company', required: true },
      { key: 'role', label: 'Role', required: true },
      { key: 'source', label: 'Source', type: 'select', options: APPLICATION_SOURCES, default: 'direct' },
      { key: 'url', label: 'Job posting URL', type: 'url' },
      { key: 'dateApplied', label: 'Date applied', type: 'date', default: todayISO() },
      { key: 'resumeVersion', label: 'Resume version sent', placeholder: 'e.g. backend-v3' },
      { key: 'referral', label: 'Referral contact' },
      { key: 'status', label: 'Status', type: 'select', options: APPLICATION_STATUSES, default: 'applied' },
      { key: 'nextAction', label: 'Next action' },
      { key: 'nextActionDate', label: 'Next action date', type: 'date' },
      { key: 'notes', label: 'Notes', type: 'textarea', rows: 4 },
    ],
    values: app ?? {},
  });
  if (!values) return;

  if (values.__delete) {
    const answer = await confirm({
      title: 'Delete this application?',
      message: `${app.role || 'The role'} at ${app.company || 'this company'} will be removed, including its notes. This can be undone.`,
      confirmLabel: 'Delete',
    });
    if (answer !== 'confirm') return;
    ctx.commit('delete application', (state) => {
      const index = state.applications.findIndex((a) => a.id === app.id);
      if (index >= 0) state.applications.splice(index, 1);
    });
    return;
  }

  if (isNew) {
    ctx.commit('log application', (state) => {
      state.applications.push(makeApplication({ ...values, lastMovedAt: ctx.today }));
    }, { undoable: false });
    return;
  }

  const statusChanged = values.status !== app.status;
  ctx.commit('edit application', () => {
    Object.assign(app, values);
    // Any edit counts as movement, so the idle clock restarts here rather than
    // flagging something you just touched.
    app.lastMovedAt = ctx.today;
    if (statusChanged) app.statusChangedAt = ctx.today;
  }, { undoable: false });
}

// --- outreach ---------------------------------------------------------------

function renderOutreach(ctx, focusId) {
  const rows = [...ctx.state.outreach].sort((a, b) => String(b.dateContacted).localeCompare(String(a.dateContacted)));
  if (!rows.length) {
    return empty(
      'No outreach logged',
      'Track who you contacted, where, and when to follow up. Anything with no reply after two weeks shows up in "needs action".',
      el('button.btn.btn--primary', { type: 'button', text: 'Log the first contact', onclick: () => editOutreach(ctx, null) }),
    );
  }

  return el('div.table-wrap', [
    el('table', [
      el('thead', [
        el('tr', ['Name', 'Company', 'Role', 'Channel', 'Contacted', 'Replied', 'Follow up', ''].map((h) => el('th', { text: h }))),
      ]),
      el('tbody', rows.map((item) => {
        const reasons = outreachActions(item, { today: ctx.today, idleDays: ctx.state.settings.pipelineIdleDays });
        return el('tr', { dataset: { id: item.id } }, [
          el('td', [
            item.url
              ? el('a.break', { href: item.url, target: '_blank', rel: 'noopener noreferrer', text: item.name || '—' })
              : el('strong.break', { text: item.name || '—' }),
          ]),
          el('td.break', { text: item.company || '—' }),
          el('td.break', { text: item.role || '—' }),
          el('td', [tag(item.channel || 'other')]),
          el('td.mono', { text: item.dateContacted ? formatDate(item.dateContacted) : '—' }),
          el('td', [item.replied ? tag('replied', 'teal') : tag('no reply', reasons.length ? 'amber' : '')]),
          el('td.mono', { text: item.followUpDate ? formatDate(item.followUpDate) : '—' }),
          el('td', [el('button.btn.btn--sm', { type: 'button', text: 'Edit', onclick: () => editOutreach(ctx, item) })]),
        ]);
      })),
    ]),
  ]);
}

async function editOutreach(ctx, item) {
  const isNew = !item;
  const values = await editRecord({
    title: isNew ? 'Log outreach' : 'Outreach',
    wide: true,
    deletable: !isNew,
    submitLabel: isNew ? 'Log it' : 'Save',
    fields: [
      { key: 'name', label: 'Name', required: true },
      { key: 'company', label: 'Company' },
      { key: 'role', label: 'Role' },
      { key: 'channel', label: 'Channel', type: 'select', options: OUTREACH_CHANNELS, default: 'LinkedIn' },
      { key: 'url', label: 'Profile URL', type: 'url' },
      { key: 'dateContacted', label: 'Date contacted', type: 'date', default: todayISO() },
      { key: 'replied', label: 'They replied', type: 'checkbox' },
      { key: 'followUpDate', label: 'Follow up on', type: 'date' },
      { key: 'notes', label: 'Notes', type: 'textarea', rows: 4 },
    ],
    values: item ?? {},
  });
  if (!values) return;

  if (values.__delete) {
    const answer = await confirm({
      title: 'Delete this contact?',
      message: `${item.name || 'This contact'} will be removed. This can be undone.`,
      confirmLabel: 'Delete',
    });
    if (answer !== 'confirm') return;
    ctx.commit('delete outreach', (state) => {
      const index = state.outreach.findIndex((o) => o.id === item.id);
      if (index >= 0) state.outreach.splice(index, 1);
    });
    return;
  }

  if (isNew) {
    ctx.commit('log outreach', (state) => {
      state.outreach.push(makeOutreach({ ...values, lastMovedAt: ctx.today }));
    }, { undoable: false });
    return;
  }
  ctx.commit('edit outreach', () => {
    Object.assign(item, values);
    item.lastMovedAt = ctx.today;
  }, { undoable: false });
}
