// The gym.
//
// Four pages, one per thing the tab is for: how the week is going, the library
// it draws from, pain grouped by where it hurt, and the log itself.

import { el, tag, empty, confirm, meter, select, toast, downloadFile, copyText, openDialog, input } from '../ui.js';
import { pageHead, statTile, editRecord } from './shared.js';
import {
  allExercises,
  activeExercises,
  droppedExercises,
  exerciseName,
  exerciseUsage,
  exerciseNameTaken,
  unclassifiedExercises,
  warmups,
  warmupNameTaken,
  seedWarmups,
  weekProgress,
  sessions,
  sessionsInWeek,
  sessionTotals,
  sessionMuscles,
  sessionMinutes,
  warmupMovements,
  warmupMinutes,
  weekDaySessions,
  painByLocation,
  painRecords,
  painTableCsv,
  painTableMarkdown,
  seedLibrary,
} from '../../core/gym.js';
import {
  makeExercise,
  makeWarmup,
  makePainRecord,
  MUSCLE_GROUPS,
  EXERCISE_STATUSES,
  PAIN_TIMING,
  muscleGroup,
} from '../../core/schema.js';
import { musclePicker } from './body-diagram.js';
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

// --- library ----------------------------------------------------------------

function renderLibrary(ctx) {
  const active = activeExercises(ctx.state);
  const dropped = droppedExercises(ctx.state);
  const unclassified = unclassifiedExercises(ctx.state);

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

    // Exercises the migration would not guess a muscle for. Surfaced at the
    // top rather than left to be discovered: an exercise with no specific
    // muscle is missing from the body diagram entirely.
    unclassified.length
      ? el('div.banner.banner--warn', [
          el('div.banner__body', [
            el('div.banner__title', {
              text: `${unclassified.length} exercise${unclassified.length === 1 ? '' : 's'} without a specific muscle`,
            }),
            el('div.banner__text', {
              text: `${unclassified.map((e) => e.name).join(', ')} — each kept its broad group because the specific muscle could not be worked out without guessing. Set it, or delete the entry if it is not an exercise.`,
            }),
          ]),
        ])
      : null,

    libraryGroup(ctx, 'Active', active, 'What a session picks from.'),
    libraryGroup(ctx, 'Dropped', dropped, 'Out of the picker, still in every session that used them.'),

    warmupSection(ctx),
  ]);
}

/**
 * The warm-up library.
 *
 * Its own list, because a warm-up movement is not an exercise: no sets, no
 * load, no muscle. They used to sit under muscle groups, which is what made
 * the core group a mix of things to train and things to do first.
 */
function warmupSection(ctx) {
  const list = warmups(ctx.state);
  return section('Warm-up movements', `${list.length}`, [
    el('p.field__hint', {
      text: 'Mobility and activation drills. A session picks from these separately from its exercises.',
    }),
    el('div.row', [
      el('button.btn.btn--sm', { type: 'button', text: 'Add a movement', onclick: () => editWarmup(ctx, null) }),
      list.length
        ? null
        : el('button.btn.btn--sm', {
            type: 'button',
            text: 'Add the usual ones',
            onclick: () => {
              const added = ctx.commit('seed warm-ups', (state) => seedWarmups(state));
              toast(`${added} warm-up movements added.`);
            },
          }),
    ]),
    list.length
      ? el('div.warmup-picker', list.map((movement) =>
          el('button.muscle-chip', {
            type: 'button',
            text: movement.name,
            'aria-label': `Edit ${movement.name}`,
            onclick: () => editWarmup(ctx, movement),
          })))
      : el('p.muted', { text: 'Nothing here yet.' }),
  ]);
}

async function editWarmup(ctx, movement) {
  const isNew = !movement;
  const values = await editRecord({
    title: isNew ? 'Add a warm-up movement' : 'Warm-up movement',
    submitLabel: isNew ? 'Add' : 'Save',
    deletable: !isNew,
    fields: [{ key: 'name', label: 'Name', required: true, placeholder: 'e.g. Ankle rocks' }],
    values: movement ?? {},
  });
  if (!values) return;

  if (values.__delete) {
    const used = (ctx.state.gymSessions ?? []).filter((s) => (s.warmup?.movementIds ?? []).includes(movement.id)).length;
    const answer = await confirm({
      title: 'Remove this movement?',
      message: used
        ? `"${movement.name}" is on ${used} logged session(s). Removing it takes it off those sessions too. This can be undone.`
        : `"${movement.name}" will be removed. This can be undone.`,
      confirmLabel: 'Remove',
    });
    if (answer !== 'confirm') return;
    ctx.commit('remove warm-up movement', (state) => {
      const index = state.warmups.findIndex((w) => w.id === movement.id);
      if (index >= 0) state.warmups.splice(index, 1);
      for (const session of state.gymSessions) {
        if (!session.warmup) continue;
        session.warmup.movementIds = (session.warmup.movementIds ?? []).filter((id) => id !== movement.id);
      }
    });
    return;
  }

  if (warmupNameTaken(ctx.state, values.name, movement?.id)) {
    toast(`There is already a movement called "${values.name}".`, { variant: 'danger' });
    return;
  }
  if (isNew) {
    ctx.commit('add warm-up movement', (state) => {
      state.warmups.push(makeWarmup({ name: values.name }));
    }, { undoable: false });
    return;
  }
  ctx.commit('edit warm-up movement', () => { movement.name = values.name; }, { undoable: false });
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
  return el('div.row.row--between.exercise-row', {
    dataset: { status: exercise.status, unclassified: String(!exercise.muscle) },
  }, [
    el('div.row', [
      el('strong.break', { text: exercise.name }),
      tag(exercise.group),
      exercise.muscle ? tag(exercise.muscle, 'teal') : tag('no muscle set', 'amber'),
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
  const draft = {
    muscle: exercise?.muscle ?? null,
    group: exercise?.group ?? 'chest',
    secondary: [...(exercise?.secondary ?? [])],
  };

  const nameInput = el('input.input', { value: exercise?.name ?? '', placeholder: 'e.g. Seated cable row', 'aria-label': 'Name' });
  const statusSelect = select(EXERCISE_STATUSES.map((v) => ({ value: v, label: v })), exercise?.status ?? 'active', {
    'aria-label': 'Status',
  });
  const chosen = el('div.row');
  const errorNode = el('div.field__error');

  const drawChosen = () => {
    chosen.replaceChildren(
      draft.muscle
        ? tag(`${muscleGroup(draft.muscle)} › ${draft.muscle}`, 'teal')
        : tag(`${draft.group} — no specific muscle set`, 'amber'),
    );
  };

  // The diagram and the list are two views of one selection, so the editor
  // holds the value and both of them render it.
  const groupSelect = select(MUSCLE_GROUPS.map((g) => ({ value: g, label: g })), draft.group, {
    'aria-label': 'Broad group',
  });

  const picker = musclePicker({
    selected: draft.muscle,
    onChange: (muscle) => {
      draft.muscle = muscle;
      // The group is derived from the muscle, so the select follows rather
      // than being a second thing to keep in step by hand.
      if (muscle) {
        draft.group = muscleGroup(muscle);
        groupSelect.value = draft.group;
      }
      drawChosen();
    },
  });
  drawChosen();
  groupSelect.addEventListener('change', () => {
    draft.group = groupSelect.value;
    // Choosing a group by hand clears a specific muscle that contradicts it.
    if (draft.muscle && muscleGroup(draft.muscle) !== draft.group) {
      draft.muscle = null;
      picker.select?.(null);
    }
    drawChosen();
  });

  const secondaryInput = el('input.input', {
    value: draft.secondary.join(', '),
    placeholder: 'e.g. triceps, front delts',
    'aria-label': 'Secondary muscles',
  });

  const result = await openDialog({
    title: isNew ? 'Add an exercise' : 'Exercise',
    wide: true,
    body: el('div.stack', [
      el('label.field', [el('span.field__label', { text: 'Name' }), nameInput]),
      el('div.stack--tight.stack', [
        el('span.field__label', { text: 'What it trains' }),
        chosen,
        picker,
        el('span.field__hint', {
          text: 'Pick the specific muscle on the figure or in the list — they are the same selection. Leave it unset if you are not sure; the library will keep asking.',
        }),
      ]),
      el('div.field-row', [
        el('label.field', [
          el('span.field__label', { text: 'Broad group' }),
          groupSelect,
          el('span.field__hint', { text: 'Set automatically by the muscle above.' }),
        ]),
        el('label.field', [el('span.field__label', { text: 'Status' }), statusSelect]),
      ]),
      el('label.field', [
        el('span.field__label', { text: 'Secondary muscles' }),
        secondaryInput,
        el('span.field__hint', { text: 'Comma-separated, specific muscles. Optional.' }),
      ]),
      errorNode,
    ]),
    footer: (close) => [
      isNew ? null : el('button.btn.btn--danger', { type: 'button', text: 'Delete', onclick: () => close({ __delete: true }) }),
      el('div.spacer'),
      el('button.btn', { type: 'button', text: 'Cancel', onclick: () => close(null) }),
      el('button.btn.btn--primary', {
        type: 'button',
        text: isNew ? 'Add' : 'Save',
        onclick: () => {
          const name = nameInput.value.trim();
          if (!name) {
            errorNode.textContent = 'It needs a name.';
            nameInput.focus();
            return;
          }
          close({
            name,
            status: statusSelect.value,
            group: draft.group,
            muscle: draft.muscle,
            secondary: secondaryInput.value,
          });
        },
      }),
    ],
  });
  if (!result) return;

  if (result.__delete) {
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

  if (exerciseNameTaken(ctx.state, result.name, exercise?.id)) {
    toast(`There is already an exercise called "${result.name}".`, { variant: 'danger' });
    return;
  }

  const secondary = String(result.secondary ?? '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((m) => muscleGroup(m) && m !== result.muscle);

  if (isNew) {
    ctx.commit('add exercise', (state) => {
      state.exercises.push(makeExercise({
        name: result.name,
        group: result.group,
        muscle: result.muscle,
        secondary,
        status: result.status,
      }));
    }, { undoable: false });
    return;
  }
  // Renaming is a correction, so it propagates to every session that used it —
  // which is the point of storing the id rather than the name.
  ctx.commit('edit exercise', () => {
    Object.assign(exercise, makeExercise({
      name: result.name,
      group: result.group,
      muscle: result.muscle,
      secondary,
      status: result.status,
    }), { id: exercise.id, createdAt: exercise.createdAt });
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
  const warmupNames = warmupMovements(ctx.state, session);
  const warmedFor = warmupMinutes(session);

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
      warmupNames.length || warmedFor
        ? el('div.row', [
            el('span.section__meta', { text: 'Warm-up' }),
            ...warmupNames.map((m) => tag(m.name)),
            warmedFor ? tag(formatDuration(warmedFor)) : null,
          ])
        : null,
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
