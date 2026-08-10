// Time blocking: a day view from the configured start hour to the end hour,
// plus a weekly distribution of where the hours actually went.
//
// The day is the context. A block belongs to the day you are looking at, so the
// form does not ask for a date — prev/next already answered that. And a block
// is either a plan or a record of what happened, never half of each.

import { el, tag, confirm, toast } from '../ui.js';
import { pageHead, editRecord } from './shared.js';
import {
  blocksForDate,
  blockMinutes,
  isLogged,
  weeklyDistribution,
  findOverlaps,
  dayTotals,
  BLOCK_STATUSES,
} from '../../core/timeblocks.js';
import {
  activityOptions,
  activityLabel,
  activityThreadId,
  normaliseActivity,
} from '../../core/activities.js';
import { makeTimeBlock } from '../../core/schema.js';
import {
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
  const totals = dayTotals(ctx.state, date);
  const week = weeklyDistribution(ctx.state, { weekStart: startOfWeek(date) });

  return el('div', [
    pageHead('Time', {
      sub: formatLongDate(date),
      actions: [
        el('a.btn.btn--ghost', { href: `#/time?date=${addDays(date, -1)}`, text: '← Prev' }),
        date !== ctx.today ? el('a.btn.btn--ghost', { href: '#/time', text: 'Today' }) : null,
        el('a.btn.btn--ghost', { href: `#/time?date=${addDays(date, 1)}`, text: 'Next →' }),
        el('button.btn', {
          type: 'button',
          text: 'Plan a block',
          onclick: () => editBlock(ctx, null, date, { status: 'planned' }),
        }),
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'Log a block',
          onclick: () => editBlock(ctx, null, date, { status: 'logged' }),
        }),
      ].filter(Boolean),
    }),

    el('div.row', { style: { marginBottom: 'var(--sp-3)' } }, [
      tag(`${formatDuration(totals.planned)} planned`),
      tag(`${formatDuration(totals.logged)} logged`, totals.logged ? 'teal' : ''),
      totals.plannedCount || totals.loggedCount
        ? tag(`${totals.plannedCount} planned · ${totals.loggedCount} logged`)
        : null,
    ]),

    dayGrid(ctx, date, totals.blocks),

    unloggedPlans(ctx, totals.blocks),

    el('section.section', { style: { marginTop: 'var(--sp-6)' } }, [
      el('div.section__head', [
        el('h2.section__title', { text: 'This week' }),
        el('div.section__rule'),
        el('span.section__meta', {
          text: `${formatDuration(week.planned)} planned · ${formatDuration(week.logged)} logged`,
        }),
      ]),
      week.rows.length
        ? el('div.card', [
            el('div.card__body', [
              el('div.row', { style: { marginBottom: 'var(--sp-3)' } }, [
                el('span.field__hint', { text: 'Upper bar planned, lower bar logged.' }),
              ]),
              ...week.rows.map((row) => distributionRow(row, week)),
            ]),
          ])
        : el('p.muted', { text: 'No blocks this week. Plan a day, or log one after the fact, and the distribution builds itself.' }),
    ]),

    weekStrip(ctx, date),
  ]);
}

function distributionRow(row, week) {
  const max = Math.max(...week.rows.map((r) => Math.max(r.planned, r.logged)), 1);
  return el('div.dist', [
    el('div.truncate', { text: row.name, title: row.name }),
    el('div.dist__bars', [
      el('div.dist__bar', [el('div.dist__fill.dist__fill--planned', { style: { width: `${(row.planned / max) * 100}%` } })]),
      el('div.dist__bar', [el('div.dist__fill.dist__fill--actual', { style: { width: `${(row.logged / max) * 100}%` } })]),
    ]),
    el('div.mono', {
      text: `${formatDuration(row.logged)} / ${formatDuration(row.planned)}`,
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
        onclick: () => editBlock(ctx, null, date, { start: `${String(hour).padStart(2, '0')}:00` }),
      }),
    ])));

  // Planned and logged sit in two columns, so a day where the plan survived
  // contact with reality reads as two matching bars rather than one hidden
  // behind the other.
  const layer = el('div.day__blocks');
  for (const block of blocks) {
    const start = timeToMinutes(block.start);
    const end = timeToMinutes(block.end);
    if (start === null || end === null) continue;
    const top = ((start - originMinutes) / 60) * rowHeight;
    const height = Math.max(18, ((end - start) / 60) * rowHeight - 2);
    const logged = isLogged(block);
    const task = block.taskId ? findTaskTitle(ctx.state, block.taskId) : null;

    layer.appendChild(
      el('button.block' + (logged ? '.block--logged' : ''), {
        type: 'button',
        dataset: { status: block.status },
        style: {
          top: `${Math.max(0, top)}px`,
          height: `${height}px`,
          left: logged ? '50%' : '0',
          right: logged ? '0' : '50%',
        },
        'aria-label': `${logged ? 'Logged' : 'Planned'} ${block.start} to ${block.end}`,
        onclick: () => editBlock(ctx, block, date),
      }, [
        el('div.block__title', {
          text: block.label || task || activityLabel(ctx.state, block.activity),
        }),
        el('div.block__time', {
          text: `${block.start}–${block.end} · ${formatDuration(blockMinutes(block))}`,
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
  const start = startOfWeek(date);
  return el('div.row', { style: { marginTop: 'var(--sp-4)' } }, weekDates(start).map((day) => {
    const totals = dayTotals(ctx.state, day);
    return el('a.week-day' + (day === date ? '.week-day--on' : '') + (day === ctx.today ? '.week-day--today' : ''), {
      href: `#/time?date=${day}`,
      title: formatLongDate(day),
    }, [
      el('div', { text: formatDate(day) }),
      el('div', { text: totals.logged ? formatDuration(totals.logged) : '·' }),
    ]);
  }));
}

// --- editing ----------------------------------------------------------------

function taskOptionsFor(state, activity) {
  const options = [{ value: '', label: 'No specific task' }];
  const thread = state.threads.find((t) => t.id === activityThreadId(activity));
  if (!thread) return options;
  for (const { task, stage } of walkTasks(thread)) {
    if (task.done) continue;
    options.push({ value: task.id, label: `${stage.title} › ${task.title}` });
  }
  return options;
}

async function editBlock(ctx, block, date, defaults = {}) {
  const isNew = !block;
  const start = defaults.start ?? block?.start ?? '09:00';
  const status = block?.status ?? defaults.status ?? 'planned';

  const values = await editRecord({
    title: isNew ? (status === 'logged' ? 'Log a block' : 'Plan a block') : 'Block',
    wide: true,
    deletable: !isNew,
    submitLabel: isNew ? 'Add' : 'Save',
    fields: [
      {
        key: 'status',
        label: 'Status',
        type: 'select',
        options: [
          { value: 'planned', label: 'Planned — what I mean to do' },
          { value: 'logged', label: 'Logged — what I actually did' },
        ],
        default: status,
        hint: 'A plan and a record of what happened are two blocks. That is what makes the weekly comparison honest.',
      },
      { key: 'start', label: 'Start', type: 'time', default: start },
      {
        key: 'end',
        label: 'End',
        type: 'time',
        default: block?.end ?? minutesToTime(timeToMinutes(start) + 60),
      },
      {
        key: 'activity',
        label: 'Activity',
        type: 'select',
        options: activityOptions(ctx.state),
        hint: 'A thread, or one of the standing areas — the gym and GRE are as assignable as a project.',
      },
      {
        key: 'taskId',
        label: 'Task',
        type: 'select',
        options: taskOptionsFor(ctx.state, block?.activity ?? ''),
        hint: 'Only for blocks on a thread. Save, reopen, and the list follows the thread you picked.',
      },
      { key: 'label', label: 'Label', placeholder: 'Optional' },
      { key: 'notes', label: 'Notes', type: 'textarea', rows: 3 },
    ],
    // The date is not asked for: it is the day you are looking at.
    values: block ?? { start, status },
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

  if (timeToMinutes(values.end) !== null && timeToMinutes(values.start) !== null &&
    timeToMinutes(values.end) <= timeToMinutes(values.start)) {
    toast('A block has to end after it starts.', { variant: 'danger' });
    return;
  }

  const patch = {
    start: values.start,
    end: values.end,
    status: BLOCK_STATUSES.includes(values.status) ? values.status : 'planned',
    activity: normaliseActivity(values.activity),
    taskId: values.taskId || null,
    label: values.label,
    notes: values.notes,
    date: block?.date ?? date,
  };

  const candidate = { ...(block ?? makeTimeBlock()), ...patch };
  const clashes = findOverlaps(ctx.state, candidate).filter((b) => b.id !== candidate.id);
  if (clashes.length) {
    const answer = await confirm({
      title: 'That overlaps another block',
      message: `It runs into ${clashes.map((b) => `${b.start}–${b.end}`).join(', ')}, which is the same kind of block. Overlapping is allowed — the hours just will not add up to wall-clock time.`,
      confirmLabel: 'Keep it anyway',
      danger: false,
    });
    if (answer !== 'confirm') return;
  }

  if (isNew) {
    ctx.commit('add block', (state) => {
      state.timeBlocks.push(makeTimeBlock(patch));
    }, { undoable: false });
    return;
  }
  ctx.commit('edit block', () => Object.assign(block, patch), { undoable: false });
}

/**
 * Plans with nothing logged over them. One button turns a plan into the record
 * of having done it, which is the common case and should not require retyping
 * the same two times into a second form.
 */
function unloggedPlans(ctx, blocks) {
  const logged = blocks.filter(isLogged);
  const covered = (plan) => logged.some((entry) =>
    timeToMinutes(entry.start) < timeToMinutes(plan.end) &&
    timeToMinutes(plan.start) < timeToMinutes(entry.end));
  const open = blocks.filter((b) => !isLogged(b) && !covered(b));
  if (!open.length) return null;

  return el('div.row', { style: { marginTop: 'var(--sp-3)' } }, [
    el('span.field__hint', { text: 'Planned, nothing logged against it yet:' }),
    ...open.map((block) =>
      el('button.btn.btn--sm', {
        type: 'button',
        text: `${block.start} ${block.label || activityLabel(ctx.state, block.activity)} — did it`,
        'aria-label': `Log the ${block.start} block as done`,
        onclick: () => logFromPlan(ctx, block),
      })),
  ]);
}

/** Offered from the day view: turn a plan into the record of having done it. */
function logFromPlan(ctx, block) {
  ctx.commit('log a planned block', (state) => {
    state.timeBlocks.push(makeTimeBlock({
      date: block.date,
      start: block.start,
      end: block.end,
      activity: block.activity,
      taskId: block.taskId,
      label: block.label,
      status: 'logged',
    }));
  }, { undoable: false });
}
