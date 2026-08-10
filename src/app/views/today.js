// Today: the home screen.
//
// Order is deliberate. "Up next" sits at the top because it is the feature the
// whole tool exists for: one small, startable thing per thread, so a large
// thread is never visible without its next step.

import { el, tag, icon, empty, toast } from '../ui.js';
import { pageHead, dueTag } from './shared.js';
import { upNext, actionableDueTasks, stalledThreads } from '../../core/threads.js';
import { reviewQueue } from '../../core/srs.js';
import { needsAction, describeReason } from '../../core/pipelines.js';
import { habitSummary, toggleLog } from '../../core/habits.js';
import { isGymHabit } from '../../core/gym.js';
import { blocksForDate, plannedMinutes, actualMinutes, hasActual } from '../../core/timeblocks.js';
import { formatLongDate, formatDuration, nowStamp } from '../../core/dates.js';
import { newThread } from './threads.js';

export function title() {
  return 'Today';
}

export function render(ctx) {
  const today = ctx.today;
  const rows = upNext(ctx.state);
  const due = reviewQueue(ctx.state, { today });
  const actions = needsAction(ctx.state, { today });
  const dueTasks = actionableDueTasks(ctx.state, { today });
  const blocks = blocksForDate(ctx.state, today);
  const habits = habitSummary(ctx.state, { today });
  const stalled = stalledThreads(ctx.state, { today });

  return el('div', [
    pageHead('Today', {
      sub: formatLongDate(today),
      actions: [
        el('a.btn', { href: '#/time', text: 'Plan the day' }),
        el('a.btn', { href: '#/weekly', text: 'Weekly review' }),
      ],
    }),

    stalled.length ? stalledBanner(stalled) : null,

    // 1. Up next.
    el('section.section', [
      el('div.section__head', [
        el('h2.section__title', { text: 'Up next' }),
        el('div.section__rule'),
        el('span.section__meta', { text: `${rows.filter((r) => r.task).length} startable` }),
      ]),
      rows.length
        ? el('div.upnext', rows.map((row) => upNextRow(ctx, row)))
        : empty(
            'No active threads',
            'Cairn shows one next task per thread. Create a thread, break it into stages, and the next small thing will always be on this screen.',
            el('button.btn.btn--primary', { type: 'button', text: 'Create a thread', onclick: () => newThread(ctx) }),
          ),
    ]),

    // 2. Review queue.
    el('section.section', [
      el('div.section__head', [
        el('h2.section__title', { text: 'Review queue' }),
        el('div.section__rule'),
        el('span.section__meta', { text: due.length ? `${due.length} due` : 'clear' }),
      ]),
      due.length
        ? el('div.card', [
            el('div.card__body.stack--tight.stack', [
              el('div.row', bankCounts(due)),
              el('p.muted', { text: 'Questions are due when the scheduler says so, not when you feel like it.' }),
              el('a.btn.btn--primary', { href: '#/questions/review', text: `Start review (${due.length})` }),
            ]),
          ])
        : el('p.muted', { text: 'Nothing due today.' }),
    ]),

    // 3. Needs action.
    el('section.section', [
      el('div.section__head', [
        el('h2.section__title', { text: 'Needs action' }),
        el('div.section__rule'),
        el('span.section__meta', { text: `${actions.count + dueTasks.length} item(s)` }),
      ]),
      actions.count || dueTasks.length
        ? el('div.card', [
            el('div.card__body.stack--tight.stack', [
              ...actions.all.map((entry) => actionRow(entry)),
              ...dueTasks.map((entry) => taskDueRow(ctx, entry)),
            ]),
          ])
        : el('p.muted', { text: 'Nothing due or overdue in the pipelines.' }),
    ]),

    // 4. Time blocks.
    el('section.section', [
      el('div.section__head', [
        el('h2.section__title', { text: 'Today’s blocks' }),
        el('div.section__rule'),
        el('span.section__meta', {
          text: blocks.length
            ? `${formatDuration(blocks.reduce((s, b) => s + plannedMinutes(b), 0))} planned · ${formatDuration(blocks.reduce((s, b) => s + actualMinutes(b), 0))} logged`
            : 'nothing planned',
        }),
      ]),
      blocks.length
        ? el('div.card', [el('div.card__body.stack--tight.stack', blocks.map((block) => blockRow(ctx, block)))])
        : el('div.row', [
            el('span.muted', { text: 'No blocks today.' }),
            el('a.btn.btn--sm', { href: '#/time', text: 'Plan the day' }),
          ]),
    ]),

    // 5. Habits.
    el('section.section', [
      el('div.section__head', [
        el('h2.section__title', { text: 'Habits' }),
        el('div.section__rule'),
        el('span.section__meta', { text: `${habits.filter((h) => h.loggedToday).length}/${habits.length} logged` }),
      ]),
      habits.length
        ? el('div.card', [
            el('div.card__body.stack--tight.stack', habits.map((entry) => habitRow(ctx, entry, today))),
          ])
        : el('div.row', [
            el('span.muted', { text: 'No habits tracked.' }),
            el('a.btn.btn--sm', { href: '#/habits', text: 'Add one' }),
          ]),
    ]),
  ]);
}

function stalledBanner(stalled) {
  return el('div.banner.banner--warn', { style: { marginBottom: 'var(--sp-4)' } }, [
    el('div.banner__body', [
      el('div.banner__title', {
        text: `${stalled.length} thread${stalled.length > 1 ? 's have' : ' has'} not moved`,
      }),
      el('div.banner__text', {
        text: stalled.map((s) => `${s.thread.name} (${s.idleDays}d)`).join(' · '),
      }),
    ]),
    el('a.btn.btn--sm', { href: '#/threads?filter=stalled', text: 'Look at them' }),
  ]);
}

function upNextRow(ctx, row) {
  const { thread, task, step, stage, blocked } = row;

  if (!task) {
    return el('div.upnext__row.upnext__row--blocked', [
      el('span'),
      el('div.upnext__main', [
        el('a.upnext__thread', { href: `#/thread/${thread.id}`, text: thread.name }),
        el('div.upnext__task.upnext__task--blocked', { text: blockedCopy(blocked, row) }),
      ]),
      el('div.upnext__meta', [
        el('a.btn.btn--sm', { href: `#/thread/${thread.id}`, text: fixLabel(blocked) }),
      ]),
    ]);
  }

  return el('div.upnext__row', [
    el('button.upnext__tick', {
      type: 'button',
      'aria-label': `Mark "${task.title}" done`,
      title: 'Mark done',
      onclick: () => {
        ctx.commit('tick task', () => {
          task.done = true;
          task.doneAt = nowStamp();
        }, { undoable: false, message: null });
        toast(`Done: ${task.title}`, {
          action: { label: 'Undo', onClick: () => { ctx.store.undo(); ctx.render(); } },
        });
      },
    }, [icon('check')]),

    el('div.upnext__main', [
      el('a.upnext__thread', { href: `#/thread/${thread.id}`, text: thread.name }),
      el('div.upnext__task.break', { text: task.title }),
      el('div.upnext__where', { text: `${stage.title} › ${step.title}` }),
    ]),

    el('div.upnext__meta', [
      task.estimateMinutes ? tag(formatDuration(task.estimateMinutes)) : null,
      task.due ? dueTag(task.due, ctx.today) : null,
      el('a.btn.btn--ghost.btn--sm', { href: `#/thread/${thread.id}?focus=${task.id}`, text: 'Open' }),
    ]),
  ]);
}

function blockedCopy(blocked, row) {
  switch (blocked) {
    case 'no-stages': return 'No stages yet — nothing to start.';
    case 'no-tasks': return `"${row.stage?.title ?? 'The open stage'}" has no tasks. Break it down.`;
    case 'no-done-when': return `"${row.stage?.title}" needs a done-when before you can work in it.`;
    case 'all-locked': return 'Every remaining stage is locked.';
    default: return 'Nothing startable.';
  }
}

function fixLabel(blocked) {
  if (blocked === 'no-done-when') return 'Write it';
  if (blocked === 'no-tasks' || blocked === 'no-stages') return 'Break it down';
  return 'Open';
}

function bankCounts(due) {
  const counts = due.reduce((acc, entry) => {
    acc[entry.question.bank] = (acc[entry.question.bank] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).map(([bank, count]) => tag(`${bank} ${count}`, 'amber'));
}

function actionRow(entry) {
  const { item, kind, reasons } = entry;
  const overdue = reasons.some((r) => r.kind === 'due' && r.overdueBy > 0);
  const label = kind === 'application'
    ? `${item.role || 'Role'} — ${item.company || 'Company'}`
    : `${item.name || 'Contact'}${item.company ? ` — ${item.company}` : ''}`;
  const href = kind === 'outreach'
    ? `#/pipelines?tab=outreach&focus=${item.id}`
    : `#/pipelines?focus=${item.id}`;
  return el('div.row.row--between', [
    el('div', [
      el('a', { href, text: label }),
      el('div.section__meta', { text: item.nextAction || (kind === 'outreach' ? 'follow up' : item.status) }),
    ]),
    el('div.row', reasons.map((reason) => tag(describeReason(reason), overdue ? 'danger' : 'amber'))),
  ]);
}

function taskDueRow(ctx, entry) {
  return el('div.row.row--between', [
    el('div', [
      el('a', { href: `#/thread/${entry.thread.id}?focus=${entry.task.id}`, text: entry.task.title }),
      el('div.section__meta', { text: `${entry.thread.name} › ${entry.stage.title}` }),
    ]),
    dueTag(entry.due, ctx.today),
  ]);
}

function blockRow(ctx, block) {
  const thread = ctx.state.threads.find((t) => t.id === block.threadId);
  return el('div.row.row--between', [
    el('div', [
      el('span.mono', { text: `${block.start}–${block.end}` }),
      ' ',
      el('span', { text: block.label || thread?.name || 'Unassigned' }),
    ]),
    el('div.row', [
      hasActual(block)
        ? tag(`logged ${formatDuration(actualMinutes(block))}`, 'teal')
        : tag('not logged'),
      el('a.btn.btn--ghost.btn--sm', { href: '#/time', text: 'Open' }),
    ]),
  ]);
}

function habitRow(ctx, entry, today) {
  const { habit, count, target, met, loggedToday } = entry;
  // A gym habit's log is a mirror of its sessions, so ticking it here would be
  // overwritten the next time one is saved. It links to the session form
  // instead, which is where the day actually gets recorded.
  const gym = isGymHabit(habit);

  return el('div.row.row--between', [
    el('div.row', [
      gym
        ? el('a.btn.btn--sm' + (loggedToday ? '' : '.btn--ghost'), {
            href: `#/habits/${habit.id}`,
            text: loggedToday ? '✓ session logged' : 'Log a session',
          })
        : el('button.btn.btn--sm' + (loggedToday ? '' : '.btn--ghost'), {
            type: 'button',
            text: loggedToday ? '✓ logged' : 'Log today',
            onclick: () => ctx.commit('log habit', () => toggleLog(habit, today), { undoable: false }),
          }),
      el('span', { text: habit.name }),
    ]),
    el('div.row', [
      tag(`${count}/${target} this week`, met ? 'teal' : ''),
    ]),
  ]);
}
