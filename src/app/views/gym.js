// The gym.
//
// Four pages, one per thing the tab is for: how the week is going and whether a
// lift is moving, the library it draws from, pain grouped by where it hurt, and
// the log itself.

import { el, tag, empty, confirm, meter, select, toast, downloadFile, copyText } from '../ui.js';
import { pageHead, statTile, editRecord } from './shared.js';
import {
  allExercises,
  activeExercises,
  droppedExercises,
  exerciseName,
  exerciseUsage,
  exerciseNameTaken,
  weekProgress,
  sessions,
  sessionsInWeek,
  sessionTotals,
  sessionMuscles,
  sessionMinutes,
  exerciseProgression,
  trainedExerciseIds,
  weekDaySessions,
  painByLocation,
  painRecords,
  painTableCsv,
  painTableMarkdown,
  seedLibrary,
} from '../../core/gym.js';
import { makeExercise, makePainRecord, MUSCLE_GROUPS, EXERCISE_STATUSES, PAIN_TIMING } from '../../core/schema.js';
import { formatDate, formatDuration, relativeDay, weekdayInitials, todayISO } from '../../core/dates.js';
import { openSessionDialog } from './gym-session.js';

const TABS = [
  ['', 'Overview'],
  ['library', 'Library'],
  ['pain', 'Pain'],
  ['history', 'History'],
];

export function title(ctx) {
  const tab = ctx.route.params[0] ?? '';
  const label = TABS.find(([slug]) => slug === tab)?.[1];
  return label && label !== 'Overview' ? `Gym — ${label}` : 'Gym';
}

export function render(ctx) {
  const tab = ctx.route.params[0] ?? '';
  const body =
    tab === 'library' ? renderLibrary(ctx)
      : tab === 'pain' ? renderPain(ctx)
        : tab === 'history' ? renderHistory(ctx)
          : renderOverview(ctx);

  return el('div', [
    pageHead('Gym', {
      sub: 'Sets, reps, weight and how it felt. Weeks run Sunday to Saturday.',
      actions: [
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'Log a session',
          onclick: () => openSessionDialog(ctx),
        }),
      ],
    }),
    el('nav.tabs', { 'aria-label': 'Gym sections' }, TABS.map(([slug, label]) =>
      el('a.tab' + (slug === tab ? '.tab--on' : ''), {
        href: slug ? `#/gym/${slug}` : '#/gym',
        text: label,
        'aria-current': slug === tab ? 'page' : null,
      }))),
    body,
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

// --- overview ---------------------------------------------------------------

function renderOverview(ctx) {
  const progress = weekProgress(ctx.state, ctx.today);
  const library = allExercises(ctx.state);

  if (!library.length && !sessions(ctx.state).length) {
    return empty(
      'Nothing set up yet',
      'Start with a library of movements, then log sessions against it. Sets, reps, weight and one line about how each exercise felt — that is the whole model.',
      el('button.btn.btn--primary', {
        type: 'button',
        text: 'Add the starter library',
        onclick: () => {
          const added = ctx.commit('seed gym library', (state) => seedLibrary(state));
          toast(`${added} exercises added. Rename, re-tag or drop whatever does not match your gym.`);
        },
      }),
    );
  }

  return el('div.stack', [
    section('This week', `${formatDate(progress.weekStart)} – ${formatDate(progress.weekEnd)}`, [
      el('div.grid.grid--4', [
        statTile(progress.done, 'sessions', progress.met ? 'teal' : ''),
        statTile(progress.target || '—', 'target'),
        statTile(progress.remaining, 'still to do', progress.remaining && progress.daysLeft < progress.remaining ? 'amber' : ''),
        statTile(progress.daysLeft, progress.daysLeft === 1 ? 'day left' : 'days left'),
      ]),
      progress.target ? meter(progress.done / progress.target, progress.met ? 'complete' : '') : null,
      weekStrip(ctx),
    ]),

    section('Progression', 'one exercise over time', [progressionPanel(ctx)]),
  ]);
}

function weekStrip(ctx) {
  const labels = weekdayInitials();
  return el('div.week-strip', weekDaySessions(ctx.state, ctx.today).map((day, i) =>
    el('div.week-day' + (day.sessions.length ? '.week-day--on' : '') + (day.date === ctx.today ? '.week-day--today' : ''), {
      title: day.sessions.length ? `${formatDate(day.date)}: ${day.sessions.length} session(s)` : formatDate(day.date),
    }, [
      el('div', { text: labels[i] }),
      el('div', { text: day.sessions.length ? '●' : '·' }),
    ])));
}

function progressionPanel(ctx) {
  const options = trainedExerciseIds(ctx.state)
    .map((id) => ({ id, name: exerciseName(ctx.state, id) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const host = el('div.stack');
  if (!options.length) {
    host.appendChild(el('p.field__hint', { text: 'Log a couple of sessions and this shows whether anything is actually moving.' }));
    return host;
  }

  const chart = el('div.stack');
  const picker = select(options.map((o) => ({ value: o.id, label: o.name })), options[0].id, {
    'aria-label': 'Exercise to chart',
  });

  const drawChart = () => {
    chart.replaceChildren();
    const points = exerciseProgression(ctx.state, picker.value);
    if (!points.length) return;

    // A bodyweight movement has no load to plot, so its progression is reps.
    const bodyweight = points.every((point) => point.bodyweight);
    const value = (point) => (bodyweight ? point.topReps : point.topWeight);
    const peak = Math.max(...points.map(value), 1);
    const delta = value(points[points.length - 1]) - value(points[0]);
    const last = points[points.length - 1];
    const unit = bodyweight ? 'reps' : 'kg';

    chart.appendChild(
      el('div.row', [
        tag(`${points.length} session${points.length === 1 ? '' : 's'}`),
        bodyweight ? tag('bodyweight — tracked by reps', 'teal') : null,
        tag(`best ${value(last)} ${unit}${bodyweight ? '' : ` × ${last.topReps}`}`, 'teal'),
        points.length > 1
          ? tag(
              delta > 0 ? `up ${Math.round(delta * 10) / 10} ${unit}` : delta < 0 ? `down ${Math.round(-delta * 10) / 10} ${unit}` : 'no change',
              delta > 0 ? 'teal' : delta < 0 ? 'amber' : '',
            )
          : null,
      ]),
    );
    if (points.length < 2) {
      chart.appendChild(el('p.field__hint', { text: 'One session so far. Two makes a direction.' }));
    }

    chart.appendChild(
      el('div.progression', points.slice(-24).map((point) =>
        el('div.progression__col', {
          title: `${formatDate(point.date)}: top set ${point.topReps} × ${point.bodyweight ? 'bodyweight' : point.topWeight} · ${point.sets} sets · ${point.reps} reps`,
        }, [
          el('div.progression__bar', { style: { height: `${Math.max(4, (value(point) / peak) * 100)}%` } }),
          el('div.progression__label.mono.faint', { text: formatDate(point.date) }),
        ]))),
    );
  };

  picker.addEventListener('change', drawChart);
  drawChart();
  host.append(el('div.row', [picker]), chart);
  return host;
}

// --- library ----------------------------------------------------------------

function renderLibrary(ctx) {
  const active = activeExercises(ctx.state);
  const dropped = droppedExercises(ctx.state);

  return el('div.stack', [
    el('div.row', [
      el('button.btn', { type: 'button', text: 'Add an exercise', onclick: () => editExercise(ctx, null) }),
      allExercises(ctx.state).length
        ? null
        : el('button.btn', {
            type: 'button',
            text: 'Add the starter library',
            onclick: () => {
              const added = ctx.commit('seed gym library', (state) => seedLibrary(state));
              toast(`${added} exercises added.`);
            },
          }),
    ]),

    libraryGroup(ctx, 'Active', active, 'What a session picks from.'),
    libraryGroup(ctx, 'Dropped', dropped, 'Out of the picker, still in every session that used them.'),
  ]);
}

function libraryGroup(ctx, heading, list, hint) {
  return section(heading, `${list.length}`, [
    el('p.field__hint', { text: hint }),
    list.length
      ? el('div.card', [el('div.card__body.stack--tight.stack', list.map((e) => exerciseRow(ctx, e)))])
      : el('p.muted', { text: 'Nothing here.' }),
  ]);
}

function exerciseRow(ctx, exercise) {
  const usage = exerciseUsage(ctx.state, exercise.id);
  return el('div.row.row--between.exercise-row', { dataset: { status: exercise.status } }, [
    el('div.row', [
      el('strong.break', { text: exercise.name }),
      tag(exercise.muscle, 'teal'),
      ...(exercise.secondary ?? []).map((m) => tag(m)),
      el('span.section__meta', {
        text: usage.sessions ? `${usage.sets} sets across ${usage.sessions} session(s)` : 'never used',
      }),
    ]),
    el('div.row', [
      el('button.btn.btn--ghost.btn--sm', {
        type: 'button',
        text: 'Edit',
        'aria-label': `Edit ${exercise.name}`,
        onclick: () => editExercise(ctx, exercise),
      }),
      el('button.btn.btn--ghost.btn--sm', {
        type: 'button',
        text: exercise.status === 'dropped' ? 'Bring back' : 'Drop',
        'aria-label': `${exercise.status === 'dropped' ? 'Bring back' : 'Drop'} ${exercise.name}`,
        onclick: () => ctx.commit(exercise.status === 'dropped' ? 'restore exercise' : 'drop exercise', () => {
          exercise.status = exercise.status === 'dropped' ? 'active' : 'dropped';
        }, { undoable: false }),
      }),
    ]),
  ]);
}

async function editExercise(ctx, exercise) {
  const isNew = !exercise;
  const values = await editRecord({
    title: isNew ? 'Add an exercise' : 'Exercise',
    submitLabel: isNew ? 'Add' : 'Save',
    deletable: !isNew,
    fields: [
      { key: 'name', label: 'Name', required: true, placeholder: 'e.g. Seated cable row' },
      { key: 'muscle', label: 'Primary muscle', type: 'select', options: MUSCLE_GROUPS, default: 'chest' },
      {
        key: 'secondary',
        label: 'Secondary muscles',
        placeholder: 'e.g. arms, core',
        hint: 'Comma-separated. Optional.',
      },
      { key: 'status', label: 'Status', type: 'select', options: EXERCISE_STATUSES, default: 'active' },
    ],
    values: exercise ? { ...exercise, secondary: (exercise.secondary ?? []).join(', ') } : {},
  });
  if (!values) return;

  if (values.__delete) {
    const usage = exerciseUsage(ctx.state, exercise.id);
    if (usage.sessions) {
      // Deleting would leave those sets labelled "Removed exercise". Dropping
      // does the same job to the picker and leaves the history intact.
      const answer = await confirm({
        title: 'Drop it instead',
        message: `"${exercise.name}" appears in ${usage.sessions} session(s). Deleting it would leave those sets labelled "Removed exercise". Dropping takes it out of the picker and leaves the history exactly as it is.`,
        confirmLabel: 'Drop it',
        danger: false,
      });
      if (answer !== 'confirm') return;
      ctx.commit('drop exercise', () => { exercise.status = 'dropped'; }, { undoable: false });
      return;
    }
    const answer = await confirm({
      title: 'Delete this exercise?',
      message: `"${exercise.name}" has never been used, so nothing else changes.`,
      confirmLabel: 'Delete',
    });
    if (answer !== 'confirm') return;
    ctx.commit('delete exercise', (state) => {
      const index = state.exercises.findIndex((e) => e.id === exercise.id);
      if (index >= 0) state.exercises.splice(index, 1);
    });
    return;
  }

  if (exerciseNameTaken(ctx.state, values.name, exercise?.id)) {
    toast(`There is already an exercise called "${values.name}".`, { variant: 'danger' });
    return;
  }

  const secondary = String(values.secondary ?? '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((m) => MUSCLE_GROUPS.includes(m) && m !== values.muscle);

  if (isNew) {
    ctx.commit('add exercise', (state) => {
      state.exercises.push(makeExercise({
        name: values.name,
        muscle: values.muscle,
        secondary,
        status: values.status,
      }));
    }, { undoable: false });
    return;
  }
  // Renaming is a correction, so it propagates to every session that used it —
  // which is the point of storing the id rather than the name.
  ctx.commit('edit exercise', () => {
    Object.assign(exercise, {
      name: values.name,
      muscle: values.muscle,
      secondary,
      status: values.status,
    });
  }, { undoable: false });
}

// --- pain -------------------------------------------------------------------

function renderPain(ctx) {
  const groups = painByLocation(ctx.state);
  const all = painRecords(ctx.state);
  const recurring = groups.filter((group) => group.recursAcrossExercises);

  return el('div.stack', [
    el('div.row', [
      el('button.btn', { type: 'button', text: 'Record pain', onclick: () => addPainRecord(ctx) }),
      all.length
        ? el('button.btn.btn--ghost', {
            type: 'button',
            text: 'Export as CSV',
            onclick: () => downloadFile(`cairn-pain-${todayISO()}.csv`, painTableCsv(ctx.state), 'text/csv'),
          })
        : null,
      all.length
        ? el('button.btn.btn--ghost', {
            type: 'button',
            text: 'Copy as a table',
            onclick: async () => {
              const ok = await copyText(painTableMarkdown(ctx.state));
              toast(ok ? 'Pain table copied as markdown.' : 'Could not reach the clipboard.', { variant: ok ? '' : 'danger' });
            },
          })
        : null,
    ]),

    all.length
      ? el('div.stack', [
          recurring.length
            ? el('div.banner.banner--danger', [
                el('div.banner__body', [
                  el('div.banner__title', {
                    text: `${recurring.length} location${recurring.length === 1 ? '' : 's'} hurting across more than one exercise`,
                  }),
                  el('div.banner__text', {
                    text: `${recurring.map((g) => `${g.location} (${g.exerciseNames.length} exercises)`).join(', ')} — a pain that follows several different movements is about the body, not the movement. One that only ever appears on a single exercise is about that exercise.`,
                  }),
                ]),
              ])
            : el('p.field__hint', {
                text: 'No location has hurt on more than one exercise yet, which means every pain so far points at a specific movement rather than at you.',
              }),

          ...groups.map((group) => painGroupCard(ctx, group)),
        ])
      : empty(
          'No pain recorded',
          'Recorded as its own entry rather than a note, because the only question worth asking of it — does this recur across different exercises, or is it isolated to one — cannot be answered by reading paragraphs.',
          el('button.btn.btn--primary', { type: 'button', text: 'Record pain', onclick: () => addPainRecord(ctx) }),
        ),
  ]);
}

function painGroupCard(ctx, group) {
  return el('div.card.pain-group', { dataset: { recurring: String(group.recursAcrossExercises) } }, [
    el('div.card__body.stack--tight.stack', [
      el('div.row.row--between', [
        el('div.row', [
          el('strong.break', { text: group.location }),
          tag(`${group.count} time${group.count === 1 ? '' : 's'}`),
          group.recursAcrossExercises
            ? tag(`${group.exerciseNames.length} different exercises`, 'danger')
            : tag('one exercise only', 'amber'),
        ]),
        el('span.section__meta', {
          text: group.firstSeen === group.lastSeen
            ? formatDate(group.lastSeen)
            : `${formatDate(group.firstSeen)} – ${formatDate(group.lastSeen)}`,
        }),
      ]),
      el('div.row', [
        group.during ? tag(`${group.during} during`) : null,
        group.after ? tag(`${group.after} after`) : null,
      ]),
      el('table.table', [
        el('thead', [el('tr', [
          el('th', { text: 'Date' }),
          el('th', { text: 'Exercise' }),
          el('th', { text: 'When' }),
          el('th', { text: 'Note' }),
        ])]),
        el('tbody', group.records.map((record) =>
          el('tr', [
            el('td.mono', { text: formatDate(record.date) }),
            el('td.break', { text: record.exerciseId ? exerciseName(ctx.state, record.exerciseId) : '—' }),
            el('td', { text: record.when }),
            el('td.break', [
              el('span', { text: record.note || '—' }),
              ' ',
              el('button.btn.btn--ghost.btn--sm', {
                type: 'button',
                text: 'Edit',
                'aria-label': `Edit the ${group.location} record from ${record.date}`,
                onclick: () => addPainRecord(ctx, record),
              }),
            ]),
          ]))),
      ]),
    ]),
  ]);
}

async function addPainRecord(ctx, record = null) {
  const isNew = !record;
  const values = await editRecord({
    title: isNew ? 'Record pain' : 'Pain',
    submitLabel: isNew ? 'Record it' : 'Save',
    deletable: !isNew,
    fields: [
      { key: 'date', label: 'Date', type: 'date', default: ctx.today },
      { key: 'location', label: 'Where', required: true, placeholder: 'e.g. right shoulder' },
      {
        key: 'exerciseId',
        label: 'Exercise',
        type: 'select',
        options: [
          { value: '', label: 'Not tied to one' },
          ...allExercises(ctx.state).map((e) => ({ value: e.id, label: e.name })),
        ],
      },
      { key: 'when', label: 'During or after', type: 'select', options: PAIN_TIMING, default: 'during' },
      { key: 'note', label: 'Note', type: 'textarea', rows: 2 },
    ],
    values: record ?? {},
  });
  if (!values) return;

  if (values.__delete) {
    const answer = await confirm({
      title: 'Delete this record?',
      message: 'It will stop counting towards whether this location recurs.',
      confirmLabel: 'Delete',
    });
    if (answer !== 'confirm') return;
    ctx.commit('delete pain record', (state) => {
      const index = state.painRecords.findIndex((r) => r.id === record.id);
      if (index >= 0) state.painRecords.splice(index, 1);
    });
    return;
  }

  const patch = {
    date: values.date || ctx.today,
    location: values.location,
    exerciseId: values.exerciseId || null,
    when: values.when,
    note: values.note,
  };

  if (isNew) {
    ctx.commit('record pain', (state) => { state.painRecords.push(makePainRecord(patch)); }, { undoable: false });
    return;
  }
  ctx.commit('edit pain record', () => Object.assign(record, patch), { undoable: false });
}

// --- history ----------------------------------------------------------------

function renderHistory(ctx) {
  const list = sessions(ctx.state);
  if (!list.length) {
    return empty(
      'Nothing logged yet',
      'The first session is the one that sets up the repeat-from-last-time shortcut. After that, logging one is mostly tapping.',
      el('button.btn.btn--primary', { type: 'button', text: 'Log a session', onclick: () => openSessionDialog(ctx) }),
    );
  }

  return el('div.stack', [
    el('p.field__hint', {
      text: `${list.length} session${list.length === 1 ? '' : 's'}, newest first. This week: ${sessionsInWeek(ctx.state, ctx.today).length}.`,
    }),
    ...list.slice(0, 60).map((session) => sessionCard(ctx, session)),
    list.length > 60 ? el('p.muted', { text: `…and ${list.length - 60} older sessions.` }) : null,
  ]);
}

function sessionCard(ctx, session) {
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
          session.startTime ? tag(`${session.startTime}${session.endTime ? `–${session.endTime}` : ''}`) : null,
          sessionMinutes(session) ? tag(formatDuration(sessionMinutes(session))) : null,
          el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            text: 'Open',
            'aria-label': `Open session on ${session.date}`,
            onclick: () => openSessionDialog(ctx, session),
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
        el('li.break', [
          el('span.mono', {
            text: `${exerciseName(ctx.state, entry.exerciseId)} — ${(entry.sets ?? [])
              .map((s) => `${s.reps ?? '?'}×${s.weight ?? 'bw'}`)
              .join(', ')}`,
          }),
          entry.note ? el('div.hesitation.break', { text: entry.note }) : null,
        ]))),
      session.notes ? el('p.muted.break', { text: session.notes }) : null,
    ]),
  ]);
}
