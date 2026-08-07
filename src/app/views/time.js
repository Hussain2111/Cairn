// Time blocking: a day view from the configured start hour to the end hour,
// plus a weekly distribution of where the hours actually went.

import { el, tag, empty, confirm, toast } from '../ui.js';
import { pageHead, editRecord, threadOptions } from './shared.js';
import {
  blocksForDate,
  plannedMinutes,
  actualMinutes,
  hasActual,
  weeklyDistribution,
  findOverlaps,
  dayTotals,
} from '../../core/timeblocks.js';
import { makeTimeBlock } from '../../core/schema.js';
import {
  todayISO,
  formatLongDate,
  formatDuration,
  addDays,
  startOfWeek,
  timeToMinutes,
  minutesToTime,
  formatDate,
  weekDates,
} from '../../core/dates.js';
import { walkTasks } from '../../core/threads.js';

export function title() {
  return 'Time';
}

export function render(ctx) {
  const date = ctx.route.query.get('date') || ctx.today;
  const settings = ctx.state.settings;
  const totals = dayTotals(ctx.state, date);
  const week = weeklyDistribution(ctx.state, { weekStart: startOfWeek(date, settings.weekStartsOn) });

  return el('div', [
    pageHead('Time', {
      sub: formatLongDate(date),
      actions: [
        el('a.btn.btn--ghost', { href: `#/time?date=${addDays(date, -1)}`, text: '← Prev' }),
        date !== ctx.today ? el('a.btn.btn--ghost', { href: '#/time', text: 'Today' }) : null,
        el('a.btn.btn--ghost', { href: `#/time?date=${addDays(date, 1)}`, text: 'Next →' }),
        el('button.btn.btn--primary', { type: 'button', text: 'Add block', onclick: () => editBlock(ctx, null, date) }),
      ].filter(Boolean),
    }),

    el('div.row', { style: { marginBottom: 'var(--sp-3)' } }, [
      tag(`${formatDuration(totals.planned)} planned`),
      tag(`${formatDuration(totals.actual)} logged`, totals.actual ? 'teal' : ''),
      totals.blocks.length
        ? tag(`${totals.logged}/${totals.blocks.length} blocks logged`)
        : null,
    ]),

    totals.blocks.length || true ? dayGrid(ctx, date, totals.blocks) : null,

    el('section.section', { style: { marginTop: 'var(--sp-6)' } }, [
      el('div.section__head', [
        el('h2.section__title', { text: 'This week' }),
        el('div.section__rule'),
        el('span.section__meta', {
          text: `${formatDuration(week.planned)} planned · ${formatDuration(week.actual)} actual`,
        }),
      ]),
      week.rows.length
        ? el('div.card', [
            el('div.card__body', [
              el('div.row', { style: { marginBottom: 'var(--sp-3)' } }, [
                el('span.field__hint', { text: 'Upper bar planned, lower bar actual.' }),
              ]),
              ...week.rows.map((row) => distributionRow(row, week)),
            ]),
          ])
        : el('p.muted', { text: 'No blocks this week. Plan a day and the distribution will build itself.' }),
    ]),

    weekStrip(ctx, date),
  ]);
}

function distributionRow(row, week) {
  const max = Math.max(...week.rows.map((r) => Math.max(r.planned, r.actual)), 1);
  return el('div.dist', [
    el('div.truncate', { text: row.name, title: row.name }),
    el('div.dist__bars', [
      el('div.dist__bar', [el('div.dist__fill.dist__fill--planned', { style: { width: `${(row.planned / max) * 100}%` } })]),
      el('div.dist__bar', [el('div.dist__fill.dist__fill--actual', { style: { width: `${(row.actual / max) * 100}%` } })]),
    ]),
    el('div.mono', {
      text: `${formatDuration(row.actual)} / ${formatDuration(row.planned)}`,
      title: row.drift >= 0 ? `${formatDuration(row.drift)} over plan` : `${formatDuration(-row.drift)} under plan`,
    }),
  ]);
}

function dayGrid(ctx, date, blocks) {
  const startHour = ctx.state.settings.dayStartHour ?? 8;
  const endHour = ctx.state.settings.dayEndHour ?? 22;
  const hours = [];
  for (let h = startHour; h < endHour; h += 1) hours.push(h);
  const rowHeight = 44;
  const originMinutes = startHour * 60;

  const grid = el('div.day__grid', hours.map((hour) =>
    el('div.day__hour', [
      el('div.day__label', { text: `${String(hour).padStart(2, '0')}:00` }),
      el('div.day__slot', {
        title: 'Add a block here',
        onclick: () => editBlock(ctx, null, date, `${String(hour).padStart(2, '0')}:00`),
      }),
    ])));

  const layer = el('div.day__blocks');
  for (const block of blocks) {
    const start = timeToMinutes(block.start);
    const end = timeToMinutes(block.end);
    if (start === null || end === null) continue;
    const top = ((start - originMinutes) / 60) * rowHeight;
    const height = Math.max(18, ((end - start) / 60) * rowHeight - 2);
    const thread = ctx.state.threads.find((t) => t.id === block.threadId);
    const task = block.taskId ? findTaskTitle(ctx.state, block.taskId) : null;

    layer.appendChild(
      el('button.block' + (hasActual(block) ? '.block--logged' : ''), {
        type: 'button',
        style: { top: `${Math.max(0, top)}px`, height: `${height}px` },
        onclick: () => editBlock(ctx, block, date),
      }, [
        el('div.block__title', { text: block.label || task || thread?.name || 'Untitled block' }),
        el('div.block__time', {
          text: `${block.start}–${block.end}${hasActual(block) ? ` · did ${formatDuration(actualMinutes(block))}` : ''}`,
        }),
      ]),
    );
  }

  return el('div.day', [el('div', { style: { position: 'relative' } }, [grid, layer])]);
}

function findTaskTitle(state, taskId) {
  for (const thread of state.threads) {
    for (const entry of walkTasks(thread)) {
      if (entry.task.id === taskId) return entry.task.title;
    }
  }
  return null;
}

function weekStrip(ctx, date) {
  const start = startOfWeek(date, ctx.state.settings.weekStartsOn);
  return el('div.row', { style: { marginTop: 'var(--sp-4)' } }, weekDates(start).map((day) => {
    const totals = dayTotals(ctx.state, day);
    return el('a.week-day' + (day === date ? '.week-day--on' : '') + (day === ctx.today ? '.week-day--today' : ''), {
      href: `#/time?date=${day}`,
      title: formatLongDate(day),
    }, [
      el('div', { text: formatDate(day) }),
      el('div', { text: totals.actual ? formatDuration(totals.actual) : '·' }),
    ]);
  }));
}

// --- editing ----------------------------------------------------------------

function taskOptionsFor(state, threadId) {
  const options = [{ value: '', label: 'No specific task' }];
  const thread = state.threads.find((t) => t.id === threadId);
  if (!thread) return options;
  for (const { task, stage } of walkTasks(thread)) {
    if (task.done) continue;
    options.push({ value: task.id, label: `${stage.title} › ${task.title}` });
  }
  return options;
}

async function editBlock(ctx, block, date, startHint = null) {
  const isNew = !block;
  const values = await editRecord({
    title: isNew ? 'New block' : 'Block',
    wide: true,
    deletable: !isNew,
    submitLabel: isNew ? 'Add' : 'Save',
    fields: [
      { key: 'date', label: 'Date', type: 'date', default: date },
      { key: 'start', label: 'Start', type: 'time', default: startHint ?? '09:00' },
      { key: 'end', label: 'End', type: 'time', default: startHint ? minutesToTime(timeToMinutes(startHint) + 60) : '10:00' },
      { key: 'threadId', label: 'Thread', type: 'select', options: threadOptions(ctx.state, { noneLabel: 'Unassigned' }) },
      {
        key: 'taskId',
        label: 'Task',
        type: 'select',
        options: taskOptionsFor(ctx.state, block?.threadId ?? ''),
        hint: 'Tasks are listed for the block’s current thread. Save, reopen, and the list follows the thread you picked.',
      },
      { key: 'label', label: 'Label', placeholder: 'Optional' },
      { key: 'actualStart', label: 'Actually started', type: 'time' },
      { key: 'actualEnd', label: 'Actually ended', type: 'time' },
      { key: 'notes', label: 'Notes', type: 'textarea', rows: 3 },
    ],
    values: block ?? { date, start: startHint ?? '09:00' },
  });
  if (!values) return;

  if (values.__delete) {
    const answer = await confirm({
      title: 'Delete this block?',
      message: `The ${block.start}–${block.end} block will be removed. This can be undone.`,
      confirmLabel: 'Delete',
    });
    if (answer !== 'confirm') return;
    ctx.commit('delete block', (state) => {
      const index = state.timeBlocks.findIndex((b) => b.id === block.id);
      if (index >= 0) state.timeBlocks.splice(index, 1);
    });
    return;
  }

  if (timeToMinutes(values.end) !== null && timeToMinutes(values.start) !== null && timeToMinutes(values.end) <= timeToMinutes(values.start)) {
    toast('A block has to end after it starts.', { variant: 'danger' });
    return;
  }

  const candidate = { ...(block ?? makeTimeBlock()), ...values };
  const clashes = findOverlaps(ctx.state, candidate).filter((b) => b.id !== candidate.id);
  if (clashes.length) {
    const answer = await confirm({
      title: 'That overlaps another block',
      message: `It runs into ${clashes.map((b) => `${b.start}–${b.end}`).join(', ')}. Overlapping blocks are allowed — planned time just will not add up to wall-clock time.`,
      confirmLabel: 'Keep it anyway',
      danger: false,
    });
    if (answer !== 'confirm') return;
  }

  if (isNew) {
    ctx.commit('add block', (state) => {
      state.timeBlocks.push(makeTimeBlock({ ...values, threadId: values.threadId || null, taskId: values.taskId || null }));
    }, { undoable: false });
    return;
  }
  ctx.commit('edit block', () => {
    Object.assign(block, values, { threadId: values.threadId || null, taskId: values.taskId || null });
  }, { undoable: false });
}
