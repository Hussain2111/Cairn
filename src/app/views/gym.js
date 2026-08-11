// The gym.
//
// Five pages behind one tab. The overview answers "what should today be", the
// library is the set of movements I actually maintain, pain is its own record
// because a paragraph cannot be grouped, history is the log, and the importer
// is a one-time path for the markdown logbook this replaces.

import { el, tag, empty, confirm, meter, select, toast, input, downloadFile, copyText } from '../ui.js';
import { pageHead, statTile, editRecord } from './shared.js';
import {
  allExercises,
  activeExercises,
  exercisesByStatus,
  exerciseById,
  exerciseName,
  exerciseUsage,
  exerciseNameTaken,
  equipmentPreference,
  weekProgress,
  weeklyTarget,
  muscleCoverage,
  gapReport,
  sessions,
  sessionsInWeek,
  sessionTotals,
  sessionMuscles,
  sessionMinutes,
  exerciseProgression,
  trainedExerciseIds,
  weekDaySessions,
  routines,
  routineName,
  nextRoutine,
  painByLocation,
  painRecords,
  painTableCsv,
  painTableMarkdown,
  seedLibrary,
} from '../../core/gym.js';
import {
  makeExercise,
  makePainRecord,
  MUSCLE_GROUPS,
  EQUIPMENT_TYPES,
  EXERCISE_STATUSES,
  DROP_REASONS,
  PAIN_TIMING,
} from '../../core/schema.js';
import { formatDate, formatDuration, relativeDay, diffDays, weekdayInitials, todayISO } from '../../core/dates.js';
import { openSessionDialog } from './gym-session.js';
import { openLogbookImport } from './gym-import.js';

const TABS = [
  ['', 'Overview'],
  ['library', 'Library'],
  ['pain', 'Pain'],
  ['history', 'History'],
];

export function title(ctx) {
  const tab = ctx.route.params[0] ?? '';
  return TABS.find(([slug]) => slug === tab)?.[1] ? `Gym — ${TABS.find(([slug]) => slug === tab)[1]}` : 'Gym';
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
      sub: 'Sessions, not check-marks. Weeks run Sunday to Saturday.',
      actions: [
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'Log a session',
          onclick: () => openSessionDialog(ctx),
        }),
        el('button.btn', {
          type: 'button',
          text: 'Import logbook',
          onclick: () => openLogbookImport(ctx),
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

// --- overview ---------------------------------------------------------------

function renderOverview(ctx) {
  const progress = weekProgress(ctx.state, ctx.today);
  const coverage = muscleCoverage(ctx.state, ctx.today);
  const untrained = coverage.filter((row) => !row.trained);
  const gaps = gapReport(ctx.state);
  const next = nextRoutine(ctx.state);
  const library = allExercises(ctx.state);

  if (!library.length && !sessions(ctx.state).length) {
    return empty(
      'Nothing set up yet',
      'The gym is the one thing here tracked by session rather than by tick, because whether you went is not the useful part. Start with a library of movements, or paste in the logbook you already keep.',
      el('div.row', [
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'Add the starter library',
          onclick: () => {
            const added = ctx.commit('seed gym library', (state) => seedLibrary(state));
            toast(`${added} exercises and an A/B rotation added. Rename, re-tag or drop whatever does not match your gym.`);
          },
        }),
        el('button.btn', { type: 'button', text: 'Import my logbook', onclick: () => openLogbookImport(ctx) }),
      ]),
    );
  }

  return el('div.stack', [
    section('This week', `${formatDate(progress.weekStart)} – ${formatDate(progress.weekEnd)}`, [
      el('div.grid.grid--4', [
        statTile(progress.done, 'sessions done', progress.met ? 'teal' : ''),
        statTile(progress.target || '—', 'target'),
        statTile(progress.remaining, 'still to do', progress.remaining && progress.daysLeft < progress.remaining ? 'amber' : ''),
        statTile(progress.daysLeft, progress.daysLeft === 1 ? 'day left' : 'days left'),
      ]),
      progress.target
        ? meter(progress.done / progress.target, progress.met ? 'complete' : '')
        : el('p.field__hint', { text: 'No weekly target set. Settings › Gym.' }),
      progress.remaining && progress.daysLeft < progress.remaining
        ? el('p.field__hint', {
            text: `${progress.remaining} session(s) left with ${progress.daysLeft} day(s) to go — this week falls short unless you double up.`,
          })
        : null,
      weekStrip(ctx),
      next
        ? el('div.row', [
            el('span.field__hint', { text: 'Next in the rotation:' }),
            tag(next.name, 'teal'),
            el('button.btn.btn--sm', {
              type: 'button',
              text: `Log ${next.name}`,
              onclick: () => openSessionDialog(ctx),
            }),
          ])
        : null,
    ]),

    section('Muscle coverage', 'this week', [
      coverageStrip(coverage, ctx.today),
      el('p.field__hint', {
        text: untrained.length
          ? `${untrained.map((row) => row.muscle).join(', ')} ${untrained.length === 1 ? 'has' : 'have'} had no direct work this week. That is what today's session is for.`
          : 'Every group has had direct work this week.',
      }),
      el('p.field__hint', {
        text: 'The big number is direct sets. A group only counts as trained when it was the primary target — three pressing days do not make a back day.',
      }),
    ]),

    gaps.length ? section('Gaps in the library', `${gaps.length}`, [gapPanel(ctx, gaps)]) : null,

    section('Equipment', 'what actually works', [equipmentPanel(ctx)]),

    section('Progression', 'one exercise over time', [progressionPanel(ctx)]),
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

/**
 * The view that decides what today should be. Untrained groups carry the amber
 * signal because they are the ones that need reading; a trained group is
 * settled, and settled things recede.
 */
function coverageStrip(coverage, today) {
  return el('div.muscles', coverage.map((entry) => {
    const gap = entry.lastTrained ? -(diffDays(today, entry.lastTrained) ?? 0) : null;
    return el('div.muscle' + (entry.trained ? '.muscle--trained' : ''), {
      title: entry.trained
        ? `${entry.muscle}: ${entry.primarySets} direct set(s)${entry.secondarySets ? `, ${entry.secondarySets} as a secondary` : ''} across ${entry.sessions} session(s)`
        : entry.lastTrained
          ? `${entry.muscle}: no direct work this week — last trained ${formatDate(entry.lastTrained)}`
          : `${entry.muscle}: never trained`,
      dataset: { muscle: entry.muscle, trained: String(entry.trained) },
    }, [
      el('div.muscle__name', { text: entry.muscle }),
      el('div.muscle__count.mono', { text: entry.trained ? String(entry.primarySets) : '—' }),
      el('div.muscle__when.faint', {
        text: entry.trained
          ? (entry.secondarySets ? `+${entry.secondarySets} indirect` : 'this week')
          : gap === null ? 'never' : `${gap}d ago`,
      }),
    ]);
  }));
}

function gapPanel(ctx, gaps) {
  return el('div.card', [
    el('div.card__body.stack--tight.stack', [
      el('p.field__hint', {
        text: 'Muscle groups with no active exercise left. A group whose only options are dropped or untried stops being trained without anything ever announcing it.',
      }),
      ...gaps.map((gap) =>
        el('div.row.row--between', [
          el('div.row', [
            tag(gap.muscle, 'amber'),
            el('span.section__meta', { text: gap.reason }),
            gap.droppedForPain ? tag(`${gap.droppedForPain} dropped for pain`, 'danger') : null,
          ]),
          el('div.row', [
            ...gap.untried.slice(0, 3).map((e) => tag(`${e.name} — untried`)),
            el('a.btn.btn--ghost.btn--sm', { href: '#/gym/library', text: 'Library' }),
          ]),
        ])),
    ]),
  ]);
}

/**
 * Preference by equipment. The point of the field: cable and machine variants
 * can work where the free-weight version does not, and counting it beats
 * rediscovering it.
 */
function equipmentPanel(ctx) {
  const rows = equipmentPreference(ctx.state, { today: ctx.today });
  if (!rows.length) {
    return el('p.field__hint', { text: 'Nothing in the library yet.' });
  }
  const peak = Math.max(...rows.map((row) => row.sets), 1);

  return el('div.card', [
    el('div.card__body.stack--tight.stack', [
      ...rows.map((row) =>
        el('div.dist', { dataset: { equipment: row.equipment } }, [
          el('div.truncate', { text: row.equipment }),
          el('div.dist__bars', [
            el('div.dist__bar', [
              el('div.dist__fill.dist__fill--actual', { style: { width: `${(row.sets / peak) * 100}%` } }),
            ]),
            el('div.row', [
              row.active ? tag(`${row.active} active`, 'teal') : null,
              row.untried ? tag(`${row.untried} untried`) : null,
              row.droppedForPain ? tag(`${row.droppedForPain} dropped: pain`, 'danger') : null,
              row.droppedForDislike ? tag(`${row.droppedForDislike} dropped: disliked`, 'amber') : null,
              row.droppedForAvailability ? tag(`${row.droppedForAvailability} dropped: unavailable`) : null,
            ]),
          ]),
          el('div.mono', { text: `${row.sets} sets`, title: `${Math.round(row.shareOfSets * 100)}% of all sets` }),
        ])),
      el('p.field__hint', {
        text: 'Sets done, and what happened to the exercises. A kind of equipment you keep and never drop for pain is one that works for you — that is worth seeing rather than remembering.',
      }),
      rows.some((row) => row.equipment === 'unspecified' && row.total)
        ? el('p.field__hint', {
            text: 'Some exercises do not say what equipment they use, so they cannot be compared. The library flags them.',
          })
        : null,
    ]),
  ]);
}

function progressionPanel(ctx) {
  const ids = trainedExerciseIds(ctx.state);
  const options = ids
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
    const first = points[0];
    const last = points[points.length - 1];
    const delta = value(last) - value(first);
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
  const active = exercisesByStatus(ctx.state, 'active');
  const untried = exercisesByStatus(ctx.state, 'untried');
  const dropped = exercisesByStatus(ctx.state, 'dropped');
  const unspecified = allExercises(ctx.state).filter((e) => e.equipment === 'unspecified');

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
      routinePanelButton(ctx),
    ]),

    unspecified.length
      ? el('div.banner.banner--warn', [
          el('div.banner__body', [
            el('div.banner__title', { text: `${unspecified.length} exercise(s) do not say what equipment they use` }),
            el('div.banner__text', {
              text: `${unspecified.map((e) => e.name).slice(0, 6).join(', ')}${unspecified.length > 6 ? '…' : ''} — equipment is what makes the cable-versus-free-weight comparison possible, so these are left out of it until they say.`,
            }),
          ]),
        ])
      : null,

    libraryGroup(ctx, 'Active', active, 'What a session picks from.'),
    libraryGroup(ctx, 'Untried', untried, 'In the library, never done. Logging one moves it to active.'),
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
    el('div.stack--tight.stack', [
      el('div.row', [
        el('strong.break', { text: exercise.name }),
        tag(exercise.muscle, 'teal'),
        ...(exercise.secondary ?? []).map((m) => tag(m)),
        tag(exercise.equipment, exercise.equipment === 'unspecified' ? 'amber' : ''),
        exercise.status === 'dropped' && exercise.dropReason
          ? tag(`dropped: ${exercise.dropReason}`, exercise.dropReason === 'pain' ? 'danger' : 'locked')
          : null,
        exercise.status === 'dropped' && !exercise.dropReason ? tag('dropped: no reason given', 'amber') : null,
      ]),
      exercise.cues ? el('div.cues.break', { text: exercise.cues }) : null,
      exercise.dropNote ? el('div.section__meta.break', { text: exercise.dropNote }) : null,
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
      exercise.status === 'dropped'
        ? el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            text: 'Bring back',
            'aria-label': `Bring back ${exercise.name}`,
            onclick: () => ctx.commit('restore exercise', () => {
              exercise.status = 'active';
              exercise.dropReason = null;
              exercise.dropNote = '';
            }, { undoable: false }),
          })
        : el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            text: 'Drop',
            'aria-label': `Drop ${exercise.name}`,
            onclick: () => dropExercise(ctx, exercise),
          }),
    ]),
  ]);
}

async function dropExercise(ctx, exercise) {
  const reason = select(DROP_REASONS, 'disliked', { 'aria-label': 'Why it is being dropped' });
  const note = input({ placeholder: 'Optional detail', 'aria-label': 'Drop note' });

  const values = await ctx.openDialog({
    title: `Drop ${exercise.name}`,
    body: el('div.stack', [
      el('label.field', [el('span.field__label', { text: 'Why' }), reason]),
      el('label.field', [el('span.field__label', { text: 'Note' }), note]),
      el('p.field__hint', {
        text: 'Disliked, painful and unavailable are three different problems. Which one it was decides whether to find a variant, see someone about it, or change gym — so they are never collapsed into one "retired".',
      }),
    ]),
    footer: (close) => [
      el('button.btn', { type: 'button', text: 'Cancel', onclick: () => close(null) }),
      el('button.btn.btn--danger', {
        type: 'button',
        text: 'Drop it',
        onclick: () => close({ reason: reason.value, note: note.value.trim() }),
      }),
    ],
  });
  if (!values) return;

  ctx.commit('drop exercise', () => {
    exercise.status = 'dropped';
    exercise.dropReason = values.reason;
    exercise.dropNote = values.note;
  }, { undoable: false });
}

async function editExercise(ctx, exercise) {
  const isNew = !exercise;
  const values = await editRecord({
    title: isNew ? 'Add an exercise' : 'Exercise',
    submitLabel: isNew ? 'Add' : 'Save',
    deletable: !isNew,
    wide: true,
    fields: [
      { key: 'name', label: 'Name', required: true, placeholder: 'e.g. Seated cable row' },
      {
        key: 'muscle',
        label: 'Primary muscle',
        type: 'select',
        options: MUSCLE_GROUPS,
        default: 'chest',
        hint: 'What the weekly coverage counts as direct work.',
      },
      {
        key: 'secondary',
        label: 'Secondary muscles',
        placeholder: 'e.g. arms, core',
        hint: 'Comma-separated. Counted, but separately — assistance is not a training day.',
      },
      {
        key: 'equipment',
        label: 'Equipment',
        type: 'select',
        options: EQUIPMENT_TYPES,
        default: 'unspecified',
        hint: 'Cable, machine and Smith variants behave differently from free weights. Recording which is which is what makes that visible.',
      },
      {
        key: 'status',
        label: 'Status',
        type: 'select',
        options: EXERCISE_STATUSES,
        default: 'active',
      },
      {
        key: 'cues',
        label: 'Cues',
        type: 'textarea',
        rows: 3,
        hint: 'Coaching notes. These appear automatically when you log this exercise, which is the only moment they help.',
      },
    ],
    values: exercise ? { ...exercise, secondary: (exercise.secondary ?? []).join(', ') } : {},
  });
  if (!values) return;

  if (values.__delete) {
    const usage = exerciseUsage(ctx.state, exercise.id);
    if (usage.sessions) {
      const answer = await confirm({
        title: 'Drop it instead',
        message: `"${exercise.name}" appears in ${usage.sessions} session(s). Deleting it would leave those sets labelled "Removed exercise". Dropping takes it out of the picker and leaves the history intact.`,
        confirmLabel: 'Drop it',
        danger: false,
      });
      if (answer !== 'confirm') return;
      await dropExercise(ctx, exercise);
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
        equipment: values.equipment,
        status: values.status,
        cues: values.cues,
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
      equipment: values.equipment,
      status: values.status,
      cues: values.cues,
    });
    if (exercise.status !== 'dropped') {
      exercise.dropReason = null;
      exercise.dropNote = '';
    }
  }, { undoable: false });
}

function routinePanelButton(ctx) {
  return el('button.btn.btn--ghost', {
    type: 'button',
    text: 'Rotation',
    onclick: () => editRoutines(ctx),
  });
}

async function editRoutines(ctx) {
  const list = routines(ctx.state);
  await ctx.openDialog({
    title: 'The rotation',
    wide: true,
    body: el('div.stack', [
      el('p.field__hint', {
        text: 'Slots run in order and repeat. The app offers the next one when you log a session; deviating from it costs nothing and changes nothing.',
      }),
      list.length
        ? el('div.stack--tight.stack', list.map((routine, index) =>
            el('div.row.row--between', [
              el('div.row', [
                el('span.mono.faint', { text: String(index + 1).padStart(2, '0') }),
                el('strong', { text: routine.name }),
                nextRoutine(ctx.state)?.id === routine.id ? tag('next', 'teal') : null,
              ]),
              el('button.btn.btn--ghost.btn--sm', {
                type: 'button',
                text: 'Rename',
                'aria-label': `Rename ${routine.name}`,
                onclick: async () => {
                  const values = await editRecord({
                    title: 'Rename the slot',
                    fields: [{ key: 'name', label: 'Name', required: true }],
                    values: routine,
                  });
                  if (values && !values.__delete) {
                    ctx.commit('rename slot', () => { routine.name = values.name; }, { undoable: false });
                  }
                },
              }),
            ])))
        : el('p.muted', { text: 'No slots yet.' }),
    ]),
    footer: (close) => [el('button.btn', { type: 'button', text: 'Close', onclick: () => close() })],
  });
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
      text: `${list.length} session${list.length === 1 ? '' : 's'}, newest first. Sessions this week: ${sessionsInWeek(ctx.state, ctx.today).length}.`,
    }),
    ...list.slice(0, 60).map((session) => sessionCard(ctx, session)),
    list.length > 60 ? el('p.muted', { text: `…and ${list.length - 60} older sessions.` }) : null,
  ]);
}

function sessionCard(ctx, session) {
  const totals = sessionTotals(session);
  const muscles = sessionMuscles(ctx.state, session);
  const slot = routineName(ctx.state, session.routineId);

  return el('div.card.session', [
    el('div.card__body.stack--tight.stack', [
      el('div.row.row--between', [
        el('div.row', [
          el('strong.mono', { text: formatDate(session.date, { weekday: true }) }),
          el('span.section__meta', { text: relativeDay(session.date, ctx.today) }),
          slot ? tag(slot, 'teal') : null,
        ]),
        el('div.row', [
          session.startTime ? tag(`${session.startTime}${session.endTime ? `–${session.endTime}` : ''}`) : null,
          sessionMinutes(session) ? tag(formatDuration(sessionMinutes(session))) : null,
          session.warmup
            ? tag(`warm-up ${session.warmupMinutes ? `${session.warmupMinutes}m` : 'done'}`, 'teal')
            : tag('no warm-up', 'locked'),
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
          entry.substitutedFor
            ? el('span.section__meta', { text: ` (instead of ${exerciseName(ctx.state, entry.substitutedFor)})` })
            : null,
          entry.note ? el('div.hesitation.break', { text: entry.note }) : null,
        ]))),
      (session.skipped ?? []).length
        ? el('div.row', [
            el('span.field__label', { text: 'Skipped' }),
            ...session.skipped.map((entry) =>
              tag(`${exerciseName(ctx.state, entry.exerciseId)} — ${entry.reason}`, entry.reason === 'pain' ? 'danger' : 'amber')),
          ])
        : null,
      session.notes ? el('p.muted.break', { text: session.notes }) : null,
    ]),
  ]);
}
