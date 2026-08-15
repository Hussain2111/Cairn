// Logging a gym session.
//
// Filled in on a phone, between sets, by someone who would rather be lifting.
// The design rule is one tap per repeat: picking an exercise fills in the sets
// you did last time, and "Repeat set" copies the row above. Typing a number is
// the exception, not the default.
//
// Everything that is not sets, reps, weight or a sentence about how it felt
// lives in the note. That is deliberate: a dropdown for warm-ups and skips
// records less than one line of text does.

import { el, openDialog, confirm, toast, tag, select, input } from '../ui.js';
import {
  makeGymSession,
  makeSessionExercise,
  makeSet,
  makePainRecord,
  makeExercise,
  makeWarmup,
  MUSCLE_GROUPS,
  PAIN_TIMING,
} from '../../core/schema.js';
import {
  exerciseById,
  exerciseName,
  exerciseOptionsForGroup,
  exerciseNameTaken,
  lastSetsFor,
  warmups,
  warmupName,
  warmupNameTaken,
} from '../../core/gym.js';
import { todayISO } from '../../core/dates.js';

/**
 * Time inputs are hour-and-minute only.
 *
 * `step="60"` is what stops the browser offering a seconds spinner at all —
 * without it a time input volunteers a third field nobody wants to fill in for
 * a gym session that gets rounded to the hour anyway.
 */
const timeInput = (props) => el('input.input', { type: 'time', step: '60', ...props });

/** Seconds are neither entered nor stored, so anything carrying them is trimmed. */
const toMinuteTime = (value) => {
  const text = String(value ?? '').trim();
  return /^\d{1,2}:\d{2}/.test(text) ? text.slice(0, 5) : '';
};

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

  const draft = {
    date: existing?.date ?? ctx.today,
    startTime: toMinuteTime(existing?.startTime),
    endTime: toMinuteTime(existing?.endTime),
    warmup: {
      movementIds: [...(existing?.warmup?.movementIds ?? [])],
      minutes: existing?.warmup?.minutes ?? null,
    },
    notes: existing?.notes ?? '',
    exercises: (existing?.exercises ?? []).map((entry) => ({
      id: entry.id,
      exerciseId: entry.exerciseId,
      note: entry.note ?? '',
      sets: (entry.sets ?? []).map((s) => ({ id: s.id, reps: s.reps ?? null, weight: s.weight ?? null })),
    })),
    pain: [],
  };

  const list = el('div.stack.sets', { id: 'session-exercises' });
  const painList = el('div.stack--tight.stack');
  const errorNode = el('div.field__error');

  const dateInput = el('input.input', {
    type: 'date',
    value: draft.date,
    'aria-label': 'Session date',
    oninput: (e) => { draft.date = e.target.value || todayISO(); },
  });
  const startInput = timeInput({
    value: draft.startTime,
    'aria-label': 'Start time',
    oninput: (e) => { draft.startTime = toMinuteTime(e.target.value); },
  });
  const endInput = timeInput({
    value: draft.endTime,
    'aria-label': 'End time',
    oninput: (e) => { draft.endTime = toMinuteTime(e.target.value); },
  });
  const notesInput = el('textarea.textarea', {
    rows: 2,
    value: draft.notes,
    placeholder: 'Anything about the session as a whole — warm-up, what was skipped, why it was short',
    'aria-label': 'Session notes',
    oninput: (e) => { draft.notes = e.target.value; },
  });

  // --- the exercise blocks --------------------------------------------------

  const draw = (focusExerciseId = null) => {
    list.replaceChildren();

    if (!draft.exercises.length) {
      list.appendChild(el('p.field__hint', {
        text: 'Nothing logged yet. Pick a muscle group below, then an exercise — the sets you did last time are filled in for you.',
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
              // A bodyweight movement records reps and leaves this empty.
              placeholder: 'kg',
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

    if (focusExerciseId) {
      const block = list.querySelector(`.exercise-block[data-exercise="${focusExerciseId}"]`);
      const inputs = block?.querySelectorAll('.set-row .input');
      const lastReps = inputs?.[inputs.length - 2];
      lastReps?.focus();
      lastReps?.select?.();
    }
  };

  const drawPain = () => {
    painList.replaceChildren();
    if (!draft.pain.length) return;
    painList.appendChild(el('span.field__label', { text: 'Pain recorded in this session' }));
    draft.pain.forEach((record, index) => {
      painList.appendChild(
        el('div.row', [
          tag(record.location, 'danger'),
          el('span.section__meta', { text: `${record.when} ${exerciseName(ctx.state, record.exerciseId)}` }),
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

  /**
   * Adding an exercise, in two steps: pick the muscle group, then the
   * exercise.
   *
   * One flat dropdown of the whole library meant scrolling past legs to reach
   * arms every time. Narrowing by group first cuts the second list to a
   * handful, and within it the ones you have actually logged come first,
   * most-recent-first — the exercise you are about to add is almost always one
   * you added last week.
   */
  const groupPicker = select(
    [{ value: '', label: 'Muscle group…' }, ...MUSCLE_GROUPS.map((g) => ({ value: g, label: g }))],
    '',
    { 'aria-label': 'Muscle group' },
  );

  const exercisePicker = select([{ value: '', label: 'Pick a group first' }], '', {
    'aria-label': 'Exercise',
  });
  exercisePicker.disabled = true;

  const fillExercises = (group) => {
    if (!group) {
      exercisePicker.replaceChildren(el('option', { value: '', text: 'Pick a group first' }));
      exercisePicker.disabled = true;
      return;
    }
    const { recent, rest } = exerciseOptionsForGroup(ctx.state, group);
    const options = [el('option', { value: '', text: 'Exercise…' })];

    if (recent.length) {
      const done = el('optgroup', { label: 'Done before' });
      for (const e of recent) done.appendChild(el('option', { value: e.id, text: e.name }));
      options.push(done);
    }
    if (rest.length) {
      const other = el('optgroup', { label: recent.length ? 'Rest of the library' : 'In the library' });
      for (const e of rest) other.appendChild(el('option', { value: e.id, text: e.name }));
      options.push(other);
    }
    options.push(el('option', { value: '__new', text: `+ New ${group} exercise…` }));

    exercisePicker.replaceChildren(...options);
    exercisePicker.disabled = false;
  };

  groupPicker.addEventListener('change', () => fillExercises(groupPicker.value));

  const addExercise = (exerciseId) => {
    const previous = lastSetsFor(ctx.state, exerciseId);
    draft.exercises.push({
      id: `draft_${draft.exercises.length}_${exerciseId}`,
      exerciseId,
      note: '',
      // Prefilled from last time. Correcting a number is faster than typing
      // four rows, and most sessions repeat most of the last one.
      sets: previous.length ? previous.map((s) => makeSet(s)) : [makeSet()],
    });
    draw(exerciseId);
    if (previous.length) {
      toast(`${exerciseName(ctx.state, exerciseId)} — filled in with last time's ${previous.length} set(s). Change what changed.`, { timeout: 4000 });
    }
  };

  exercisePicker.addEventListener('change', () => {
    const value = exercisePicker.value;
    const group = groupPicker.value;
    exercisePicker.value = '';
    if (!value) return;
    if (value === '__new') {
      createExerciseInline(ctx, group, (id) => {
        fillExercises(group);
        addExercise(id);
      });
      return;
    }
    addExercise(value);
  });

  // --- the warm-up ----------------------------------------------------------
  //
  // Separate from the exercise list because it is a different kind of thing:
  // no sets, no load, no muscle group. Keeping mobility drills out of the
  // muscle groups is what makes those groups a usable list of things to train.

  const warmupList = el('div.warmup-picker');
  const warmupMinutesInput = el('input.input.input--num', {
    type: 'number',
    min: '0',
    step: '1',
    value: draft.warmup.minutes ?? '',
    placeholder: 'min',
    'aria-label': 'Warm-up minutes',
    oninput: (e) => { draft.warmup.minutes = toNumber(e.target.value); },
  });

  const drawWarmup = () => {
    warmupList.replaceChildren();
    const library = warmups(ctx.state);
    if (!library.length) {
      warmupList.appendChild(el('span.field__hint', { text: 'No warm-up movements yet. Add one below.' }));
    }
    for (const movement of library) {
      const on = draft.warmup.movementIds.includes(movement.id);
      warmupList.appendChild(
        el('button.muscle-chip', {
          type: 'button',
          text: movement.name,
          'aria-pressed': String(on),
          'aria-label': `Warm-up: ${movement.name}`,
          onclick: () => {
            draft.warmup.movementIds = on
              ? draft.warmup.movementIds.filter((id) => id !== movement.id)
              : [...draft.warmup.movementIds, movement.id];
            drawWarmup();
          },
        }),
      );
    }
    warmupList.appendChild(
      el('button.btn.btn--ghost.btn--sm', {
        type: 'button',
        text: '+ New movement',
        onclick: () => createWarmupInline(ctx, (id) => {
          draft.warmup.movementIds.push(id);
          drawWarmup();
        }),
      }),
    );
  };

  draw();
  drawPain();
  drawWarmup();

  return openDialog({
    title: isNew ? 'Log a session' : 'Session',
    wide: true,
    body: el('div.stack', [
      el('div.field-row', [
        el('label.field', [el('span.field__label', { text: 'Date' }), dateInput]),
        el('label.field', [el('span.field__label', { text: 'Started' }), startInput]),
        el('label.field', [el('span.field__label', { text: 'Ended' }), endInput]),
      ]),

      el('div.stack--tight.stack', [
        el('span.field__label', { text: 'Warm-up' }),
        warmupList,
        el('div.row', [
          el('span.field__hint', { text: 'For how long' }),
          warmupMinutesInput,
        ]),
      ]),

      el('div.stack--tight.stack', [
        el('span.field__label', { text: 'Exercises' }),
        list,
        el('div.row', [groupPicker, exercisePicker]),
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
          // with no sets.
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

/**
 * Create an exercise without leaving the session.
 *
 * Asks for the name and nothing else: the group came from the picker one step
 * ago, and re-asking for it would be the form demanding something it already
 * knows. The specific muscle is left unset — it can be filled in later in the
 * library, and blocking a session mid-log to classify a movement is exactly
 * the friction that stops sessions getting logged.
 */
function createExerciseInline(ctx, group, onCreated) {
  const name = input({ placeholder: 'e.g. Incline cable fly', 'aria-label': 'Exercise name' });
  const errorNode = el('div.field__error');

  openDialog({
    title: `New ${group} exercise`,
    body: el('div.stack', [
      el('label.field', [el('span.field__label', { text: 'Name' }), name]),
      el('p.field__hint', {
        text: `It goes under ${group}. Set the specific muscle later in the library if you want it on the body diagram.`,
      }),
      errorNode,
    ]),
    footer: (close) => [
      el('button.btn', { type: 'button', text: 'Cancel', onclick: () => close(null) }),
      el('button.btn.btn--primary', {
        type: 'button',
        text: 'Add',
        onclick: () => {
          const value = name.value.trim();
          if (!value) {
            errorNode.textContent = 'It needs a name.';
            name.focus();
            return;
          }
          if (exerciseNameTaken(ctx.state, value)) {
            errorNode.textContent = `"${value}" is already in the library.`;
            return;
          }
          close(value);
        },
      }),
    ],
    onClose: (value) => {
      if (!value) return;
      let id = null;
      ctx.commit('add exercise', (state) => {
        const exercise = makeExercise({ name: value, group });
        state.exercises.push(exercise);
        id = exercise.id;
      }, { undoable: false, rerender: false });
      if (id) onCreated(id);
    },
  });
}

function createWarmupInline(ctx, onCreated) {
  const name = input({ placeholder: 'e.g. Ankle rocks', 'aria-label': 'Warm-up movement name' });
  const errorNode = el('div.field__error');

  openDialog({
    title: 'New warm-up movement',
    body: el('div.stack', [
      el('label.field', [el('span.field__label', { text: 'Name' }), name]),
      errorNode,
    ]),
    footer: (close) => [
      el('button.btn', { type: 'button', text: 'Cancel', onclick: () => close(null) }),
      el('button.btn.btn--primary', {
        type: 'button',
        text: 'Add',
        onclick: () => {
          const value = name.value.trim();
          if (!value) {
            errorNode.textContent = 'It needs a name.';
            return;
          }
          if (warmupNameTaken(ctx.state, value)) {
            errorNode.textContent = `"${value}" is already there.`;
            return;
          }
          close(value);
        },
      }),
    ],
    onClose: (value) => {
      if (!value) return;
      let id = null;
      ctx.commit('add warm-up movement', (state) => {
        const movement = makeWarmup({ name: value });
        state.warmups.push(movement);
        id = movement.id;
      }, { undoable: false, rerender: false });
      if (id) onCreated(id);
    },
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
      warmup: {
        movementIds: [...draft.warmup.movementIds],
        minutes: draft.warmup.minutes ?? null,
      },
      notes: draft.notes,
      exercises: draft.exercises.map((entry) =>
        makeSessionExercise({
          exerciseId: entry.exerciseId,
          note: entry.note,
          sets: entry.sets.map((s) => makeSet({ reps: s.reps, weight: s.weight })),
        })),
    });

    if (!existing) state.gymSessions.push(target);

    for (const record of draft.pain) {
      state.painRecords.push(makePainRecord({ ...record, date: draft.date, sessionId: target.id }));
    }
  }, { undoable: false });

  toast(
    `Session logged — ${draft.exercises.length} exercise(s)` +
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
