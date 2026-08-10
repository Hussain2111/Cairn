// Habits.
//
// Two kinds, deliberately. A simple habit is a name, a weekly target and a log
// of days — that is all most of them need, and forcing a session model onto
// "read for 20 minutes" would only add friction. A gym habit keeps that same
// weekly target and adds what actually happened underneath it: sets, reps,
// weight, and which muscle groups the week has and has not touched.

import { el, tag, empty, confirm, meter, select, toast } from '../ui.js';
import { pageHead, statTile, editRecord } from './shared.js';
import { weekStatus, streakWeeks, consistency, toggleLog, logDates } from '../../core/habits.js';
import {
  isGymHabit,
  weekProgress,
  muscleCoverage,
  sessionsFor,
  sessionTotals,
  sessionMuscles,
  exerciseName,
  exerciseProgression,
  weekDaySessions,
  syncGymLog,
  seedExercises,
} from '../../core/gym.js';
import { makeHabit, HABIT_KINDS } from '../../core/schema.js';
import { startOfWeek, weekDates, weekdayInitials, formatDate, formatDuration, relativeDay, diffDays } from '../../core/dates.js';
import { openSessionDialog } from './gym-session.js';

export function title(ctx) {
  const habit = habitFromRoute(ctx);
  return habit ? habit.name : 'Habits';
}

function habitFromRoute(ctx) {
  const id = ctx.route.params[0];
  return id ? ctx.state.habits.find((h) => h.id === id) ?? null : null;
}

export function render(ctx) {
  const habit = habitFromRoute(ctx);
  if (ctx.route.params[0] && !habit) {
    return empty('That habit is gone', 'It may have been deleted, or the link is from another device.',
      el('a.btn', { href: '#/habits', text: 'Back to habits' }));
  }
  return habit ? renderGym(ctx, habit) : renderList(ctx);
}

// --- the list ---------------------------------------------------------------

function renderList(ctx) {
  const habits = ctx.state.habits.filter((h) => !h.archived);
  const gym = habits.filter(isGymHabit);
  const simple = habits.filter((h) => !isGymHabit(h));

  return el('div', [
    pageHead('Habits', {
      sub: 'A weekly target and a record of which days you actually did it.',
      actions: [
        el('button.btn.btn--primary', { type: 'button', text: 'New habit', onclick: () => editHabit(ctx, null) }),
      ],
    }),

    ...gym.map((habit) => gymSummaryCard(ctx, habit)),
    ...simple.map((habit) => simpleCard(ctx, habit)),

    habits.length
      ? null
      : empty(
          'No habits yet',
          'Add one with a weekly target — three runs a week, five days of practice. A gym habit records the sets you actually did; everything else just records the days.',
          el('button.btn.btn--primary', { type: 'button', text: 'Add a habit', onclick: () => editHabit(ctx, null) }),
        ),
  ]);
}

function simpleCard(ctx, habit) {
  const today = ctx.today;
  const status = weekStatus(habit, today);
  const streak = streakWeeks(habit, today);
  const history = consistency(habit, { today, weeks: 16 });
  const week = weekDates(startOfWeek(today));
  const labels = weekdayInitials();
  const logged = new Set(logDates(habit));

  return el('div.card', [
    el('div.card__body.stack', [
      el('div.row.row--between', [
        el('strong.break', { text: habit.name }),
        el('div.row', [
          tag(`${status.count}/${status.target} this week`, status.met ? 'teal' : ''),
          streak ? tag(`${streak} week${streak > 1 ? 's' : ''} on target`) : null,
          el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            text: 'Edit',
            'aria-label': `Edit ${habit.name}`,
            onclick: () => editHabit(ctx, habit),
          }),
        ]),
      ]),

      el('div.week-strip', week.map((day, i) => {
        const on = logged.has(day);
        return el('button.week-day' + (on ? '.week-day--on' : '') + (day === today ? '.week-day--today' : ''), {
          type: 'button',
          disabled: day > today,
          title: formatDate(day),
          'aria-label': `${habit.name} on ${formatDate(day)}`,
          'aria-pressed': String(on),
          onclick: () => ctx.commit('log habit', () => toggleLog(habit, day), { undoable: false }),
        }, [
          el('div', { text: labels[i] }),
          el('div', { text: on ? '●' : '·' }),
        ]);
      })),

      el('div', [
        el('span.field__label', { text: 'Last 16 weeks' }),
        historyStrip(history),
      ]),
    ]),
  ]);
}

function historyStrip(history) {
  return el('div.habit-weeks', history.map((entry) =>
    el('div.habit-week' +
      (entry.met ? '.habit-week--met' : entry.count ? '.habit-week--partial' : '') +
      (entry.current ? '.habit-week--current' : ''), {
      title: `Week of ${formatDate(entry.weekStart)}: ${entry.count}/${entry.target}`,
      text: String(entry.count),
    })));
}

function gymSummaryCard(ctx, habit) {
  const progress = weekProgress(ctx.state, habit, ctx.today);
  const coverage = muscleCoverage(ctx.state, habit.id, ctx.today);
  const untrained = coverage.filter((c) => !c.trained);

  return el('div.card', [
    el('div.card__body.stack', [
      el('div.row.row--between', [
        el('div.row', [
          el('strong.break', { text: habit.name }),
          tag('gym', 'teal'),
        ]),
        el('div.row', [
          tag(`${progress.done}/${progress.target} this week`, progress.met ? 'teal' : ''),
          tag(`${progress.daysLeft} day${progress.daysLeft === 1 ? '' : 's'} left`, progress.remaining && progress.daysLeft < progress.remaining ? 'danger' : ''),
        ]),
      ]),
      meter(progress.target ? progress.done / progress.target : 0, progress.met ? 'complete' : ''),
      coverageStrip(coverage),
      el('p.field__hint', {
        text: untrained.length
          ? `Not yet this week: ${untrained.map((c) => c.muscle).join(', ')}.`
          : 'Every group has been trained this week.',
      }),
      el('div.row', [
        el('button.btn.btn--primary.btn--sm', {
          type: 'button',
          text: 'Log a session',
          onclick: () => openSessionDialog(ctx, habit),
        }),
        el('a.btn.btn--sm', { href: `#/habits/${habit.id}`, text: 'Open' }),
        el('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          text: 'Edit',
          'aria-label': `Edit ${habit.name}`,
          onclick: () => editHabit(ctx, habit),
        }),
      ]),
    ]),
  ]);
}

// --- muscle coverage --------------------------------------------------------

/**
 * The view that changes behaviour. An untrained group is not a failure — it is
 * the answer to "what should today's session be?", so the untrained cells are
 * the ones that stand out, not the trained ones.
 */
function coverageStrip(coverage, { today = null } = {}) {
  return el('div.muscles', coverage.map((entry) => {
    const gap = entry.lastTrained && today ? -(diffDays(today, entry.lastTrained) ?? 0) : null;
    return el('div.muscle' + (entry.trained ? '.muscle--trained' : ''), {
      title: entry.trained
        ? `${entry.muscle}: ${entry.sets} set(s) across ${entry.sessions} session(s) this week`
        : entry.lastTrained
          ? `${entry.muscle}: not this week — last trained ${formatDate(entry.lastTrained)}`
          : `${entry.muscle}: never trained`,
      dataset: { muscle: entry.muscle, trained: String(entry.trained) },
    }, [
      el('div.muscle__name', { text: entry.muscle }),
      el('div.muscle__count.mono', { text: entry.trained ? `${entry.sets}` : '—' }),
      today
        ? el('div.muscle__when.faint', {
            text: entry.trained ? 'this week' : gap === null ? 'never' : `${gap}d ago`,
          })
        : null,
    ]);
  }));
}

// --- the gym page -----------------------------------------------------------

function renderGym(ctx, habit) {
  if (!isGymHabit(habit)) {
    // A simple habit has no page of its own; there is nothing on it that the
    // card does not already show.
    return el('div', [
      pageHead(habit.name, { sub: 'A simple habit — the card on the habits page shows everything it records.' }),
      simpleCard(ctx, habit),
      el('a.btn', { href: '#/habits', text: 'Back to habits' }),
    ]);
  }

  const progress = weekProgress(ctx.state, habit, ctx.today);
  const coverage = muscleCoverage(ctx.state, habit.id, ctx.today);
  const sessions = sessionsFor(ctx.state, habit.id);
  const untrained = coverage.filter((c) => !c.trained);

  return el('div', [
    el('a.crumb', { href: '#/habits', text: '← Habits' }),
    pageHead(habit.name, {
      sub: `${sessions.length} session${sessions.length === 1 ? '' : 's'} logged · target ${habit.weeklyTarget}/week`,
      actions: [
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'Log a session',
          onclick: () => openSessionDialog(ctx, habit),
        }),
        el('button.btn', { type: 'button', text: 'Edit habit', onclick: () => editHabit(ctx, habit) }),
      ],
    }),

    section('This week', `${formatDate(progress.weekStart)} – ${formatDate(progress.weekEnd)}`, [
      el('div.grid.grid--4', [
        statTile(progress.done, 'sessions done', progress.met ? 'teal' : ''),
        statTile(progress.target, 'planned'),
        statTile(progress.remaining, 'still to do', progress.remaining && progress.daysLeft < progress.remaining ? 'amber' : ''),
        statTile(progress.daysLeft, progress.daysLeft === 1 ? 'day left' : 'days left'),
      ]),
      progress.remaining && progress.daysLeft < progress.remaining
        ? el('p.field__hint', {
            text: `${progress.remaining} session(s) left with ${progress.daysLeft} day(s) to go — this week will fall short unless you double up.`,
          })
        : null,
      weekStrip(ctx, habit),
    ]),

    section('Muscle coverage', 'this week', [
      coverageStrip(coverage, { today: ctx.today }),
      el('p.field__hint', {
        text: untrained.length
          ? `${untrained.map((c) => c.muscle).join(', ')} ${untrained.length === 1 ? 'has' : 'have'} had nothing this week. That is what today's session is for.`
          : 'Every group has had something this week.',
      }),
    ]),

    section('Progression', 'one exercise over time', [progressionPanel(ctx, habit)]),

    section('History', `${sessions.length} session${sessions.length === 1 ? '' : 's'}`, [
      sessions.length
        ? el('div.stack', sessions.slice(0, 40).map((session) => sessionRow(ctx, habit, session)))
        : el('p.field__hint', { text: 'Nothing logged yet. The first session is the one that sets up the repeat-from-last-time shortcut.' }),
      sessions.length > 40 ? el('p.muted', { text: `…and ${sessions.length - 40} older sessions.` }) : null,
    ]),
  ]);
}

function section(heading, meta, children) {
  return el('section.section', [
    el('div.section__head', [
      el('h2.section__title', { text: heading }),
      el('div.section__rule'),
      meta ? el('span.section__meta', { text: meta }) : null,
    ]),
    el('div.stack', children),
  ]);
}

function weekStrip(ctx, habit) {
  const labels = weekdayInitials();
  return el('div.week-strip', weekDaySessions(ctx.state, habit.id, ctx.today).map((day, i) =>
    el('div.week-day' + (day.sessions.length ? '.week-day--on' : '') + (day.date === ctx.today ? '.week-day--today' : ''), {
      title: day.sessions.length
        ? `${formatDate(day.date)}: ${day.sessions.length} session(s)`
        : formatDate(day.date),
    }, [
      el('div', { text: labels[i] }),
      el('div', { text: day.sessions.length ? '●' : '·' }),
    ])));
}

function sessionRow(ctx, habit, session) {
  const totals = sessionTotals(session);
  const muscles = sessionMuscles(ctx.state, session);

  return el('div.card.session', [
    el('div.card__body.stack--tight.stack', [
      el('div.row.row--between', [
        el('div.row', [
          el('strong.mono', { text: formatDate(session.date, { weekday: true }) }),
          el('span.section__meta', { text: relativeDay(session.date, ctx.today) }),
        ]),
        el('div.row', [
          session.startTime ? tag(session.startTime) : null,
          session.durationMinutes ? tag(formatDuration(session.durationMinutes)) : null,
          session.warmup
            ? tag(`warm-up ${session.warmupMinutes ? `${session.warmupMinutes}m` : 'done'}`, 'teal')
            : tag('no warm-up', 'locked'),
          el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            text: 'Open',
            'aria-label': `Open session on ${session.date}`,
            onclick: () => openSessionDialog(ctx, habit, session),
          }),
        ]),
      ]),
      el('div.row', [
        tag(`${totals.exercises} exercise${totals.exercises === 1 ? '' : 's'}`),
        tag(`${totals.sets} sets`),
        tag(`${totals.reps} reps`),
        totals.volume ? tag(`${Math.round(totals.volume)} kg volume`) : null,
        ...muscles.map((m) => tag(m, 'teal')),
      ]),
      el('ul.session__lines', (session.exercises ?? []).map((entry) =>
        el('li.mono.break', {
          text: `${exerciseName(ctx.state, entry.exerciseId)} — ${(entry.sets ?? [])
            .map((s) => `${s.reps ?? '?'}×${s.weight ?? 'bw'}`)
            .join(', ')}`,
        }))),
      session.notes ? el('p.muted.break', { text: session.notes }) : null,
    ]),
  ]);
}

function progressionPanel(ctx, habit) {
  // Only exercises this habit has actually done — a picker of everything would
  // mostly be empty charts.
  const done = new Set();
  for (const session of sessionsFor(ctx.state, habit.id)) {
    for (const entry of session.exercises ?? []) done.add(entry.exerciseId);
  }
  const options = [...done]
    .map((id) => ({ id, name: exerciseName(ctx.state, id) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const host = el('div.stack');
  if (!options.length) {
    host.appendChild(el('p.field__hint', { text: 'Log a couple of sessions and this will show whether the weight is actually moving.' }));
    return host;
  }

  const chart = el('div.stack');
  const picker = select(options.map((o) => ({ value: o.id, label: o.name })), options[0].id, {
    'aria-label': 'Exercise to chart',
  });

  const drawChart = () => {
    chart.replaceChildren();
    const points = exerciseProgression(ctx.state, picker.value);
    if (points.length < 2) {
      chart.appendChild(el('p.field__hint', {
        text: 'One session so far. Two makes a direction; this fills in from the next one.',
      }));
      if (!points.length) return;
    }

    const peak = Math.max(...points.map((p) => p.topWeight), 1);
    const first = points[0];
    const last = points[points.length - 1];
    const delta = last.topWeight - first.topWeight;

    chart.appendChild(
      el('div.row', [
        tag(`${points.length} session${points.length === 1 ? '' : 's'}`),
        tag(`top ${last.topWeight || 'bw'}${last.topWeight ? ' kg' : ''} × ${last.topReps}`, 'teal'),
        points.length > 1
          ? tag(delta > 0 ? `up ${Math.round(delta * 10) / 10} kg` : delta < 0 ? `down ${Math.round(-delta * 10) / 10} kg` : 'no change',
              delta > 0 ? 'teal' : delta < 0 ? 'amber' : '')
          : null,
      ]),
    );

    chart.appendChild(
      el('div.progression', points.slice(-20).map((point) =>
        el('div.progression__col', {
          title: `${formatDate(point.date)}: top set ${point.topReps} × ${point.topWeight || 'bodyweight'} · ${point.sets} sets · ${point.reps} reps`,
        }, [
          el('div.progression__bar', { style: { height: `${Math.max(4, (point.topWeight / peak) * 100)}%` } }),
          el('div.progression__label.mono.faint', { text: formatDate(point.date).replace(' ', ' ') }),
        ]))),
    );
  };

  picker.addEventListener('change', drawChart);
  drawChart();
  host.append(el('div.row', [picker]), chart);
  return host;
}

// --- editing ----------------------------------------------------------------

async function editHabit(ctx, habit) {
  const isNew = !habit;
  const values = await editRecord({
    title: isNew ? 'New habit' : 'Habit',
    submitLabel: isNew ? 'Add' : 'Save',
    deletable: !isNew,
    fields: [
      { key: 'name', label: 'Name', required: true, placeholder: 'e.g. Gym' },
      {
        key: 'kind',
        label: 'Kind',
        type: 'select',
        options: [
          { value: 'simple', label: 'Simple — just record the days' },
          { value: 'gym', label: 'Gym — record the sets as well' },
        ],
        default: 'simple',
        hint: 'A gym habit logs sessions with exercises, sets, reps and weight, and shows muscle coverage for the week.',
      },
      { key: 'weeklyTarget', label: 'Times per week', type: 'number', default: 3 },
      { key: 'archived', label: 'Archived', type: 'checkbox' },
    ],
    values: habit ?? {},
  });
  if (!values) return;

  if (values.__delete) {
    await deleteHabit(ctx, habit);
    return;
  }

  const target = Math.max(1, Number(values.weeklyTarget) || 1);
  const kind = HABIT_KINDS.includes(values.kind) ? values.kind : 'simple';

  if (isNew) {
    ctx.commit('add habit', (state) => {
      const created = makeHabit({ name: values.name, weeklyTarget: target, kind });
      state.habits.push(created);
      if (kind === 'gym') seedExercises(state);
    }, { undoable: false });
    if (kind === 'gym') {
      toast('Gym habit added, with a starter list of exercises you can rename or retire in Settings.');
    }
    return;
  }

  const wasGym = isGymHabit(habit);
  ctx.commit('edit habit', (state) => {
    habit.name = values.name;
    habit.weeklyTarget = target;
    habit.kind = kind;
    habit.archived = !!values.archived;
    if (kind === 'gym') {
      if (!wasGym) seedExercises(state);
      // Switching to a gym habit hands the log over to the sessions, which is
      // empty at first — say so rather than silently wiping the history.
      syncGymLog(state, habit.id);
    }
  }, { undoable: false });

  if (kind === 'gym' && !wasGym) {
    toast('This habit now records sessions. Days logged before the change are cleared, because there is nothing recorded for them.', { timeout: 9000 });
  }
}

async function deleteHabit(ctx, habit) {
  const sessions = isGymHabit(habit) ? sessionsFor(ctx.state, habit.id).length : 0;
  const answer = await confirm({
    title: 'Delete this habit?',
    message: sessions
      ? `"${habit.name}", its ${logDates(habit).length} logged day(s) and all ${sessions} recorded session(s) will be removed. Archiving keeps everything instead.`
      : `"${habit.name}" and its ${logDates(habit).length} logged day(s) will be removed. Archiving keeps the history instead.`,
    confirmLabel: 'Delete',
    extraLabel: 'Archive instead',
  });
  if (!answer) return;
  if (answer === 'extra') {
    ctx.commit('archive habit', () => { habit.archived = true; });
    ctx.navigate('#/habits');
    return;
  }
  ctx.commit('delete habit', (state) => {
    const index = state.habits.findIndex((h) => h.id === habit.id);
    if (index >= 0) state.habits.splice(index, 1);
    state.gymSessions = state.gymSessions.filter((s) => s.habitId !== habit.id);
  });
  ctx.navigate('#/habits');
}
