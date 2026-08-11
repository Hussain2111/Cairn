// Logging a gym session.
//
// This form is filled in on a phone, between sets, by someone who would rather
// be lifting. So the design rule is one tap per repeat: picking an exercise
// fills in the sets you did last time, "Repeat set" copies the row above, and
// the routine slot that is due next arrives already chosen. Typing a number is
// the exception, not the default.
//
// A partial session is the normal case. What was skipped and why is recorded
// beside what was done, not treated as a failure to fill the form in properly.

import { el, openDialog, confirm, toast, tag, select, input } from '../ui.js';
import {
  makeGymSession,
  makeSessionExercise,
  makeSkippedExercise,
  makeSet,
  makePainRecord,
  MUSCLE_GROUPS,
  SKIP_REASONS,
  PAIN_TIMING,
} from '../../core/schema.js';
import {
  activeExercises,
  exerciseById,
  exerciseName,
  lastSetsFor,
  nextRoutine,
  routines,
  routineById,
} from '../../core/gym.js';
import { todayISO } from '../../core/dates.js';

const numeric = (props = {}) =>
  el('input.input.input--num', { type: 'number', inputmode: 'decimal', min: '0', step: 'any', ...props });

const toNumber = (value) => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Open the session editor. Pass a session to edit it, or null to log a new one.
 * Everything is written in a single commit when the dialog is confirmed.
 */
export function openSessionDialog(ctx, existing = null) {
  const isNew = !existing;
  const slots = routines(ctx.state);
  const suggested = isNew ? nextRoutine(ctx.state) : routineById(ctx.state, existing?.routineId);

  const draft = {
    date: existing?.date ?? ctx.today,
    startTime: existing?.startTime ?? '',
    endTime: existing?.endTime ?? '',
    durationMinutes: existing?.durationMinutes ?? null,
    warmup: existing?.warmup ?? false,
    warmupMinutes: existing?.warmupMinutes ?? null,
    routineId: existing?.routineId ?? suggested?.id ?? null,
    notes: existing?.notes ?? '',
    exercises: (existing?.exercises ?? []).map((entry) => ({
      id: entry.id,
      exerciseId: entry.exerciseId,
      substitutedFor: entry.substitutedFor ?? null,
      note: entry.note ?? '',
      sets: (entry.sets ?? []).map((s) => ({ id: s.id, reps: s.reps ?? null, weight: s.weight ?? null })),
    })),
    skipped: (existing?.skipped ?? []).map((entry) => ({ ...entry })),
    pain: [],
  };

  const catalogue = activeExercises(ctx.state);
  const list = el('div.stack.sets', { id: 'session-exercises' });
  const skipList = el('div.stack--tight.stack');
  const painList = el('div.stack--tight.stack');
  const errorNode = el('div.field__error');

  // --- the fields at the top ------------------------------------------------

  const dateInput = el('input.input', {
    type: 'date',
    value: draft.date,
    'aria-label': 'Session date',
    oninput: (e) => { draft.date = e.target.value || todayISO(); },
  });
  const startInput = el('input.input', {
    type: 'time',
    value: draft.startTime ?? '',
    'aria-label': 'Start time',
    oninput: (e) => { draft.startTime = e.target.value; },
  });
  const endInput = el('input.input', {
    type: 'time',
    value: draft.endTime ?? '',
    'aria-label': 'End time',
    oninput: (e) => { draft.endTime = e.target.value; },
  });
  const warmupMinutes = numeric({
    value: draft.warmupMinutes ?? '',
    placeholder: 'minutes',
    'aria-label': 'Warm-up minutes',
    disabled: !draft.warmup,
    oninput: (e) => { draft.warmupMinutes = toNumber(e.target.value); },
  });
  const warmupToggle = el('input', {
    type: 'checkbox',
    checked: draft.warmup,
    'aria-label': 'Warmed up',
    onchange: (e) => {
      draft.warmup = e.target.checked;
      warmupMinutes.disabled = !draft.warmup;
      if (!draft.warmup) {
        draft.warmupMinutes = null;
        warmupMinutes.value = '';
      } else {
        warmupMinutes.focus();
      }
    },
  });
  const routinePicker = select(
    [{ value: '', label: 'No slot' }, ...slots.map((r) => ({ value: r.id, label: r.name }))],
    draft.routineId ?? '',
    { 'aria-label': 'Routine slot' },
  );
  routinePicker.addEventListener('change', () => {
    draft.routineId = routinePicker.value || null;
  });
  const notesInput = el('textarea.textarea', {
    rows: 2,
    value: draft.notes,
    placeholder: 'Anything about the session as a whole (optional)',
    'aria-label': 'Session notes',
    oninput: (e) => { draft.notes = e.target.value; },
  });

  // --- the exercise blocks --------------------------------------------------

  const draw = (focusEntryId = null) => {
    list.replaceChildren();

    if (!draft.exercises.length) {
      list.appendChild(el('p.field__hint', {
        text: catalogue.length
          ? 'Nothing logged yet. Pick an exercise below — the sets you did last time are filled in for you.'
          : 'The library is empty. Add exercises in the Library tab first, or import your logbook.',
      }));
    }

    draft.exercises.forEach((entry) => {
      const exercise = exerciseById(ctx.state, entry.exerciseId);
      const name = exerciseName(ctx.state, entry.exerciseId);

      const setRows = el('div.stack--tight.stack');
      entry.sets.forEach((set, index) => {
        setRows.appendChild(
          el('div.set-row', [
            el('span.set-row__n.mono.faint', { text: String(index + 1).padStart(2, '0') }),
            numeric({
              value: set.reps ?? '',
              placeholder: 'reps',
              'aria-label': `${name} set ${index + 1} reps`,
              oninput: (e) => { set.reps = toNumber(e.target.value); },
            }),
            el('span.set-row__x.faint', { text: '×' }),
            numeric({
              value: set.weight ?? '',
              placeholder: exercise?.equipment === 'bodyweight' ? 'bw' : 'kg',
              'aria-label': `${name} set ${index + 1} weight`,
              oninput: (e) => { set.weight = toNumber(e.target.value); },
            }),
            el('button.btn.btn--ghost.btn--sm.btn--icon', {
              type: 'button',
              text: '✕',
              title: 'Remove this set',
              'aria-label': `Remove ${name} set ${index + 1}`,
              onclick: () => {
                entry.sets.splice(index, 1);
                draw();
              },
            }),
          ]),
        );
      });

      list.appendChild(
        el('div.card.exercise-block', { dataset: { exercise: entry.exerciseId } }, [
          el('div.card__body.stack--tight.stack', [
            el('div.row.row--between', [
              el('div.row', [
                el('strong.break', { text: name }),
                exercise ? tag(exercise.muscle, exercise.status === 'dropped' ? 'locked' : '') : tag('no longer in the library', 'amber'),
                exercise && exercise.equipment !== 'unspecified' ? tag(exercise.equipment) : null,
                entry.substitutedFor
                  ? tag(`instead of ${exerciseName(ctx.state, entry.substitutedFor)}`, 'amber')
                  : null,
              ]),
              el('button.btn.btn--ghost.btn--sm', {
                type: 'button',
                text: 'Remove',
                'aria-label': `Remove ${name} from this session`,
                onclick: () => {
                  draft.exercises = draft.exercises.filter((x) => x !== entry);
                  draw();
                },
              }),
            ]),

            // Cues appear the moment the exercise is logged, which is the only
            // moment they are any use.
            exercise?.cues
              ? el('div.cues.break', { text: exercise.cues })
              : null,

            setRows,

            el('div.row', [
              el('button.btn.btn--primary.btn--sm', {
                type: 'button',
                text: entry.sets.length ? 'Repeat set' : 'Add set',
                'aria-label': `Repeat last set of ${name}`,
                onclick: () => {
                  const previous = entry.sets[entry.sets.length - 1];
                  entry.sets.push(makeSet({ reps: previous?.reps ?? null, weight: previous?.weight ?? null }));
                  draw(entry.exerciseId);
                },
              }),
              el('button.btn.btn--ghost.btn--sm', {
                type: 'button',
                text: 'Pain here',
                'aria-label': `Record pain during ${name}`,
                onclick: () => addPain(ctx, draft, entry.exerciseId, drawPain),
              }),
            ]),

            el('textarea.textarea', {
              rows: 2,
              value: entry.note,
              placeholder: 'How it felt — "good pump", "no tension in the target muscle", "locked out at the top for the first two"',
              'aria-label': `Note for ${name}`,
              oninput: (e) => { entry.note = e.target.value; },
            }),
          ]),
        ]),
      );
    });

    if (focusEntryId) {
      const block = list.querySelector(`.exercise-block[data-exercise="${focusEntryId}"]`);
      const inputs = block?.querySelectorAll('.set-row .input');
      const lastReps = inputs?.[inputs.length - 2];
      lastReps?.focus();
      lastReps?.select?.();
    }
  };

  // --- skipped --------------------------------------------------------------

  const drawSkipped = () => {
    skipList.replaceChildren();
    if (!draft.skipped.length) {
      skipList.appendChild(el('p.field__hint', {
        text: 'Nothing skipped. If something was meant to happen and did not, record it here — a partial session is normal, and the reason is the useful part.',
      }));
    }
    draft.skipped.forEach((entry, index) => {
      skipList.appendChild(
        el('div.row', [
          el('span.break', { text: exerciseName(ctx.state, entry.exerciseId) }),
          tag(entry.reason, entry.reason === 'pain' ? 'danger' : ''),
          entry.note ? el('span.section__meta.break', { text: entry.note }) : null,
          el('button.btn.btn--ghost.btn--sm.btn--icon', {
            type: 'button',
            text: '✕',
            'aria-label': `Remove the skipped ${exerciseName(ctx.state, entry.exerciseId)}`,
            onclick: () => {
              draft.skipped.splice(index, 1);
              drawSkipped();
            },
          }),
        ]),
      );
    });
  };

  const drawPain = () => {
    painList.replaceChildren();
    if (!draft.pain.length) return;
    painList.appendChild(el('span.field__label', { text: 'Pain recorded in this session' }));
    draft.pain.forEach((record, index) => {
      painList.appendChild(
        el('div.row', [
          tag(record.location, 'danger'),
          el('span.section__meta', {
            text: `${record.when} ${exerciseName(ctx.state, record.exerciseId)}`,
          }),
          record.note ? el('span.section__meta.break', { text: record.note }) : null,
          el('button.btn.btn--ghost.btn--sm.btn--icon', {
            type: 'button',
            text: '✕',
            'aria-label': `Remove the ${record.location} pain record`,
            onclick: () => {
              draft.pain.splice(index, 1);
              drawPain();
            },
          }),
        ]),
      );
    });
  };

  // --- pickers --------------------------------------------------------------

  const groupedOptions = (exercises) => [
    ...MUSCLE_GROUPS.flatMap((muscle) => {
      const inGroup = exercises.filter((e) => e.muscle === muscle);
      return inGroup.length
        ? [{ value: `__${muscle}`, label: `— ${muscle} —` }, ...inGroup.map((e) => ({
            value: e.id,
            label: e.status === 'untried' ? `${e.name} (untried)` : e.name,
          }))]
        : [];
    }),
  ];

  const picker = select(
    [{ value: '', label: 'Add an exercise…' }, ...groupedOptions(catalogue)],
    '',
    { 'aria-label': 'Add an exercise' },
  );

  const addExercise = (exerciseId, { substitutedFor = null } = {}) => {
    if (!exerciseId || exerciseId.startsWith('__')) return;
    const previous = lastSetsFor(ctx.state, exerciseId);
    draft.exercises.push({
      id: `draft_${draft.exercises.length}_${exerciseId}`,
      exerciseId,
      substitutedFor,
      note: '',
      // Prefilled from last time. Correcting a number is faster than typing
      // four rows, and most sessions repeat most of the last one.
      sets: previous.length ? previous.map((s) => makeSet(s)) : [makeSet()],
    });
    draw(exerciseId);
    picker.value = '';
    if (previous.length) {
      toast(`${exerciseName(ctx.state, exerciseId)} — filled in with last time's ${previous.length} set(s). Change what changed.`, { timeout: 4000 });
    }
  };

  picker.addEventListener('change', () => addExercise(picker.value));

  const skipPicker = select(
    [{ value: '', label: 'Record something skipped…' }, ...groupedOptions(catalogue)],
    '',
    { 'aria-label': 'Record a skipped exercise' },
  );
  skipPicker.addEventListener('change', async () => {
    const exerciseId = skipPicker.value;
    skipPicker.value = '';
    if (!exerciseId || exerciseId.startsWith('__')) return;
    const answer = await askSkipReason(exerciseName(ctx.state, exerciseId), groupedOptions(catalogue));
    if (!answer) return;
    if (answer.substituteFor) {
      // A substitution is both halves: what was meant to happen, and what did.
      addExercise(answer.substituteFor, { substitutedFor: exerciseId });
    }
    draft.skipped.push(makeSkippedExercise({ exerciseId, reason: answer.reason, note: answer.note }));
    drawSkipped();
  });

  draw();
  drawSkipped();
  drawPain();

  return openDialog({
    title: isNew ? 'Log a session' : 'Session',
    wide: true,
    body: el('div.stack', [
      el('div.field-row', [
        el('label.field', [el('span.field__label', { text: 'Date' }), dateInput]),
        el('label.field', [el('span.field__label', { text: 'Started' }), startInput]),
        el('label.field', [el('span.field__label', { text: 'Ended' }), endInput]),
        el('label.field', [
          el('span.field__label', { text: 'Slot' }),
          routinePicker,
        ]),
      ]),
      isNew && suggested
        ? el('p.field__hint', { text: `${suggested.name} is next in the rotation. Change it freely — the rotation is a suggestion, not a rule.` })
        : null,
      el('div.row', [
        el('label.check', [warmupToggle, el('span', { text: 'Warmed up' })]),
        warmupMinutes,
      ]),

      el('div.stack--tight.stack', [
        el('span.field__label', { text: 'Exercises' }),
        list,
        el('div.row', [picker]),
      ]),

      el('div.stack--tight.stack', [
        el('span.field__label', { text: 'Skipped' }),
        skipList,
        el('div.row', [skipPicker]),
      ]),

      painList,

      el('label.field', [el('span.field__label', { text: 'Session notes' }), notesInput]),
      errorNode,
    ]),
    footer: (close) => [
      existing
        ? el('button.btn.btn--danger', { type: 'button', text: 'Delete', onclick: () => close({ delete: true }) })
        : null,
      el('div.spacer'),
      el('button.btn', { type: 'button', text: 'Cancel', onclick: () => close(null) }),
      el('button.btn.btn--primary', {
        type: 'button',
        text: isNew ? 'Log it' : 'Save',
        onclick: () => {
          if (!draft.date) {
            errorNode.textContent = 'A session needs a date.';
            return;
          }
          // Empty blocks are dropped rather than saved as a phantom exercise
          // with no sets, which would light up muscle coverage for nothing.
          const kept = draft.exercises
            .map((entry) => ({
              ...entry,
              sets: entry.sets.filter((s) => s.reps !== null || s.weight !== null),
            }))
            .filter((entry) => entry.sets.length);
          close({ ...draft, exercises: kept });
        },
      }),
    ],
    onClose: async (value) => {
      if (!value) return;
      if (value.delete) {
        await removeSession(ctx, existing);
        return;
      }
      saveSession(ctx, existing, value);
    },
  });
}

function askSkipReason(name, options) {
  const reason = select(SKIP_REASONS, 'occupied', { 'aria-label': 'Why it was skipped' });
  const note = input({ placeholder: 'Anything worth adding (optional)', 'aria-label': 'Skip note' });
  const substitute = select(
    [{ value: '', label: 'Nothing — it just did not happen' }, ...options],
    '',
    { 'aria-label': 'Did something else instead' },
  );

  return openDialog({
    title: `Skipped ${name}`,
    body: el('div.stack', [
      el('label.field', [el('span.field__label', { text: 'Why' }), reason]),
      el('label.field', [
        el('span.field__label', { text: 'Did something else instead?' }),
        substitute,
        el('span.field__hint', {
          text: 'Both halves are kept: what was meant to happen and what actually did.',
        }),
      ]),
      el('label.field', [el('span.field__label', { text: 'Note' }), note]),
      el('p.field__hint', {
        text: 'A skipped exercise is recorded, not hidden. "Machine occupied" three weeks running is a fact about the gym worth having.',
      }),
    ]),
    footer: (close) => [
      el('button.btn', { type: 'button', text: 'Cancel', onclick: () => close(null) }),
      el('button.btn.btn--primary', {
        type: 'button',
        text: 'Record it',
        onclick: () => close({
          reason: reason.value,
          note: note.value.trim(),
          substituteFor: substitute.value && !substitute.value.startsWith('__') ? substitute.value : null,
        }),
      }),
    ],
  });
}

function addPain(ctx, draft, exerciseId, redraw) {
  const location = input({ placeholder: 'e.g. right shoulder', 'aria-label': 'Where it hurt' });
  const when = select(PAIN_TIMING, 'during', { 'aria-label': 'During or after' });
  const note = input({ placeholder: 'Optional detail', 'aria-label': 'Pain note' });

  openDialog({
    title: `Pain during ${exerciseName(ctx.state, exerciseId)}`,
    body: el('div.stack', [
      el('label.field', [el('span.field__label', { text: 'Where' }), location]),
      el('label.field', [el('span.field__label', { text: 'During or after' }), when]),
      el('label.field', [el('span.field__label', { text: 'Note' }), note]),
      el('p.field__hint', {
        text: 'Recorded as its own entry, not buried in a note. The pain view groups by location so a shoulder that hurts on four different exercises reads differently from one that hurts on a single machine.',
      }),
    ]),
    footer: (close) => [
      el('button.btn', { type: 'button', text: 'Cancel', onclick: () => close(null) }),
      el('button.btn.btn--primary', {
        type: 'button',
        text: 'Record it',
        onclick: () => {
          if (!location.value.trim()) {
            location.focus();
            return;
          }
          close({ location: location.value.trim(), when: when.value, note: note.value.trim() });
        },
      }),
    ],
    onClose: (value) => {
      if (!value) return;
      draft.pain.push({ ...value, exerciseId });
      redraw();
    },
  });
}

function saveSession(ctx, existing, draft) {
  ctx.commit(existing ? 'edit gym session' : 'log gym session', (state) => {
    const target = existing
      ? state.gymSessions.find((s) => s.id === existing.id)
      : makeGymSession();
    if (!target) return;

    Object.assign(target, {
      date: draft.date,
      startTime: draft.startTime || null,
      endTime: draft.endTime || null,
      durationMinutes: draft.durationMinutes,
      warmup: !!draft.warmup,
      warmupMinutes: draft.warmup ? draft.warmupMinutes : null,
      routineId: draft.routineId,
      notes: draft.notes,
      exercises: draft.exercises.map((entry) =>
        makeSessionExercise({
          exerciseId: entry.exerciseId,
          substitutedFor: entry.substitutedFor,
          note: entry.note,
          sets: entry.sets.map((s) => makeSet({ reps: s.reps, weight: s.weight })),
        })),
      skipped: draft.skipped.map((entry) =>
        makeSkippedExercise({ exerciseId: entry.exerciseId, reason: entry.reason, note: entry.note })),
    });

    if (!existing) state.gymSessions.push(target);

    // Trying something new counts as having tried it.
    for (const entry of draft.exercises) {
      const exercise = state.exercises.find((e) => e.id === entry.exerciseId);
      if (exercise && exercise.status === 'untried') exercise.status = 'active';
    }

    for (const record of draft.pain) {
      state.painRecords.push(makePainRecord({ ...record, date: draft.date, sessionId: target.id }));
    }
  }, { undoable: false });

  toast(
    `Session logged — ${draft.exercises.length} exercise(s)` +
      (draft.skipped.length ? `, ${draft.skipped.length} skipped` : '') +
      (draft.pain.length ? `, ${draft.pain.length} pain record(s)` : '') + '.',
    { action: { label: 'Undo', onClick: () => { ctx.store.undo(); ctx.render(); } } },
  );
}

async function removeSession(ctx, session) {
  const answer = await confirm({
    title: 'Delete this session?',
    message: `The ${session.exercises?.length ?? 0} exercise(s) recorded on ${session.date} will be removed. Pain recorded in it stays, because it happened.`,
    confirmLabel: 'Delete',
  });
  if (answer !== 'confirm') return;
  ctx.commit('delete gym session', (state) => {
    const index = state.gymSessions.findIndex((s) => s.id === session.id);
    if (index >= 0) state.gymSessions.splice(index, 1);
    for (const record of state.painRecords) {
      if (record.sessionId === session.id) record.sessionId = null;
    }
  });
}
