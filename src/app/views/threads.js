// The list of threads, with progress, next task and stall state.

import { el, meter, tag, empty } from '../ui.js';
import { pageHead, editRecord } from './shared.js';
import { threadProgress, nextTask, threadStall } from '../../core/threads.js';
import { makeThread, makeStage, THREAD_TYPES } from '../../core/schema.js';
import { formatDate } from '../../core/dates.js';

export function title() {
  return 'Threads';
}

export function render(ctx) {
  const filter = ctx.route.query.get('filter');
  const showArchived = filter === 'archived';
  const stallDays = ctx.state.settings.stallDays;

  let threads = ctx.state.threads.filter((t) => !!t.archived === showArchived);
  const rows = threads.map((thread) => ({
    thread,
    progress: threadProgress(thread),
    next: nextTask(thread),
    stall: threadStall(thread, { today: ctx.today, days: stallDays }),
  }));
  const visible = filter === 'stalled' ? rows.filter((r) => r.stall.stalled) : rows;

  return el('div', [
    pageHead('Threads', {
      sub: 'One tree per area of your life. Stages unlock in order.',
      actions: [
        el('button.btn.btn--primary', { type: 'button', text: 'New thread', onclick: () => newThread(ctx) }),
      ],
    }),

    el('div.row', { style: { marginBottom: 'var(--sp-4)' } }, [
      filterLink(ctx, null, 'Active', filter),
      filterLink(ctx, 'stalled', 'Stalled', filter),
      filterLink(ctx, 'archived', 'Archived', filter),
    ]),

    visible.length
      ? el('div.grid.grid--2', visible.map((row) => threadCard(ctx, row)))
      : emptyFor(ctx, filter),
  ]);
}

function filterLink(ctx, value, label, current) {
  const href = value ? `#/threads?filter=${value}` : '#/threads';
  const active = (current ?? null) === value;
  return el('a.btn.btn--sm' + (active ? '' : '.btn--ghost'), { href, text: label });
}

function emptyFor(ctx, filter) {
  if (filter === 'stalled') {
    return empty('Nothing has stalled', `Every active thread has completed something in the last ${ctx.state.settings.stallDays} days.`);
  }
  if (filter === 'archived') {
    return empty('No archived threads', 'Threads you archive stay in your data and out of Today.');
  }
  return empty(
    'No threads yet',
    'Start with one area of your life — a project, a course, the job hunt. You will break it into stages, and each stage into tasks small enough to start.',
    el('button.btn.btn--primary', { type: 'button', text: 'Create the first thread', onclick: () => newThread(ctx) }),
  );
}

function threadCard(ctx, { thread, progress, next, stall }) {
  return el('div.card', [
    el('div.card__body.stack', [
      el('div.row.row--between', [
        el('a', { href: `#/thread/${thread.id}`, style: { color: 'var(--text)' } }, [
          el('strong.break', { text: thread.name }),
        ]),
        tag(thread.type),
      ]),

      meter(progress.ratio, progress.ratio === 1 ? 'complete' : ''),

      el('div.row', [
        tag(`${progress.done}/${progress.total} tasks`),
        tag(`${progress.stagesComplete}/${progress.stages} stages`),
        stall.stalled ? tag(`stalled ${stall.idleDays}d`, 'danger') : null,
      ]),

      el('div', [
        el('span.field__label', { text: 'Up next' }),
        next.task
          ? el('div.break', { text: next.task.title })
          : el('div.muted', { text: blockedText(next) }),
      ]),

      el('div.row', [
        el('span.section__meta', {
          text: stall.lastCompletion ? `last completion ${formatDate(stall.lastCompletion)}` : 'nothing completed yet',
        }),
        el('div.spacer'),
        el('a.btn.btn--sm', { href: `#/thread/${thread.id}`, text: 'Open' }),
      ]),
    ]),
  ]);
}

function blockedText(next) {
  switch (next.blocked) {
    case 'no-stages': return 'No stages yet — break this thread down.';
    case 'no-tasks': return 'The open stage has no tasks in it.';
    case 'no-done-when': return 'Needs a done-when before it can start.';
    case 'all-locked': return 'Everything ahead is locked.';
    case 'complete': return 'Complete.';
    default: return 'Nothing available.';
  }
}

export async function newThread(ctx) {
  const values = await editRecord({
    title: 'New thread',
    submitLabel: 'Create',
    fields: [
      { key: 'name', label: 'Name', required: true, placeholder: 'e.g. Compiler project' },
      { key: 'type', label: 'Type', type: 'select', options: THREAD_TYPES, default: 'project' },
      { key: 'description', label: 'Description', placeholder: 'Optional' },
      {
        key: 'firstStage',
        label: 'First stage',
        placeholder: 'e.g. Lexer',
        hint: 'Optional, but a thread with no stages has no next step.',
      },
      {
        key: 'firstDoneWhen',
        label: 'That stage is done when',
        type: 'textarea',
        rows: 2,
        placeholder: 'e.g. every token type has a passing test',
      },
    ],
  });
  if (!values) return;

  let threadId = null;
  ctx.commit('create thread', (state) => {
    const thread = makeThread({ name: values.name, type: values.type, description: values.description });
    if (values.firstStage) {
      thread.stages.push(makeStage({ title: values.firstStage, doneWhen: values.firstDoneWhen || '' }));
    }
    state.threads.push(thread);
    threadId = thread.id;
  }, { undoable: false });

  if (threadId) ctx.navigate(`#/thread/${threadId}`);
}
