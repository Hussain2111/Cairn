// Habits: a weekly target, a log of dates, and a consistency history.
// No points, no levels, no streak trophies -- the history is the feedback.

import { el, tag, empty, confirm } from '../ui.js';
import { pageHead, editRecord } from './shared.js';
import { weekStatus, streakWeeks, consistency, toggleLog, logDates } from '../../core/habits.js';
import { makeHabit } from '../../core/schema.js';
import { startOfWeek, weekDates, formatDate, todayISO } from '../../core/dates.js';

export function title() {
  return 'Habits';
}

export function render(ctx) {
  const today = ctx.today;
  const weekStartsOn = ctx.state.settings.weekStartsOn;
  const habits = ctx.state.habits.filter((h) => !h.archived);

  return el('div', [
    pageHead('Habits', {
      sub: 'A weekly target and a record of which days you actually did it.',
      actions: [el('button.btn.btn--primary', { type: 'button', text: 'New habit', onclick: () => editHabit(ctx, null) })],
    }),

    habits.length
      ? el('div.stack', habits.map((habit) => habitCard(ctx, habit, today, weekStartsOn)))
      : empty(
          'No habits yet',
          'Add one with a weekly target — three runs a week, five days of practice. The history shows whether it is holding, without turning it into a game.',
          el('button.btn.btn--primary', { type: 'button', text: 'Add a habit', onclick: () => editHabit(ctx, null) }),
        ),
  ]);
}

function habitCard(ctx, habit, today, weekStartsOn) {
  const status = weekStatus(habit, today, weekStartsOn);
  const streak = streakWeeks(habit, today, weekStartsOn);
  const history = consistency(habit, { today, weeks: 16, weekStartsOn });
  const week = weekDates(startOfWeek(today, weekStartsOn));

  return el('div.card', [
    el('div.card__body.stack', [
      el('div.row.row--between', [
        el('strong.break', { text: habit.name }),
        el('div.row', [
          tag(`${status.count}/${status.target} this week`, status.met ? 'teal' : ''),
          streak ? tag(`${streak} week${streak > 1 ? 's' : ''} on target`) : null,
          el('button.btn.btn--ghost.btn--sm', { type: 'button', text: 'Edit', onclick: () => editHabit(ctx, habit) }),
        ]),
      ]),

      el('div.week-strip', week.map((day) => {
        const on = logDates(habit).includes(day);
        const future = day > today;
        return el('button.week-day' + (on ? '.week-day--on' : '') + (day === today ? '.week-day--today' : ''), {
          type: 'button',
          disabled: future,
          title: formatDate(day),
          'aria-pressed': String(on),
          onclick: () => ctx.commit('log habit', () => toggleLog(habit, day), { undoable: false }),
        }, [
          el('div', { text: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'][(new Date(day + 'T12:00:00').getDay() + 6) % 7] }),
          el('div', { text: on ? '●' : '·' }),
        ]);
      })),

      el('div', [
        el('span.field__label', { text: 'Last 16 weeks' }),
        el('div.habit-weeks', history.map((entry) =>
          el('div.habit-week' +
            (entry.met ? '.habit-week--met' : entry.count ? '.habit-week--partial' : '') +
            (entry.current ? '.habit-week--current' : ''), {
            title: `Week of ${formatDate(entry.weekStart)}: ${entry.count}/${entry.target}`,
            text: String(entry.count),
          }))),
      ]),
    ]),
  ]);
}

async function editHabit(ctx, habit) {
  const isNew = !habit;
  const values = await editRecord({
    title: isNew ? 'New habit' : 'Habit',
    submitLabel: isNew ? 'Add' : 'Save',
    deletable: !isNew,
    fields: [
      { key: 'name', label: 'Name', required: true, placeholder: 'e.g. Gym' },
      { key: 'weeklyTarget', label: 'Times per week', type: 'number', default: 3 },
      { key: 'archived', label: 'Archived', type: 'checkbox' },
    ],
    values: habit ?? {},
  });
  if (!values) return;

  if (values.__delete) {
    const answer = await confirm({
      title: 'Delete this habit?',
      message: `"${habit.name}" and its ${logDates(habit).length} logged day(s) will be removed. Archiving keeps the history instead.`,
      confirmLabel: 'Delete',
      extraLabel: 'Archive instead',
    });
    if (!answer) return;
    if (answer === 'extra') {
      ctx.commit('archive habit', () => { habit.archived = true; });
      return;
    }
    ctx.commit('delete habit', (state) => {
      const index = state.habits.findIndex((h) => h.id === habit.id);
      if (index >= 0) state.habits.splice(index, 1);
    });
    return;
  }

  const target = Math.max(1, Number(values.weeklyTarget) || 1);
  if (isNew) {
    ctx.commit('add habit', (state) => {
      state.habits.push(makeHabit({ name: values.name, weeklyTarget: target }));
    }, { undoable: false });
    return;
  }
  ctx.commit('edit habit', () => {
    habit.name = values.name;
    habit.weeklyTarget = target;
    habit.archived = !!values.archived;
  }, { undoable: false });
}
