// Logging a gym session.
//
// This form is filled in on a phone, between sets, by someone who would rather
// be lifting. So the design rule is one tap per repeat: adding an exercise
// prefills the sets you did last time, and "+ set" copies the row above it.
// Typing a number is the exception, not the default.

import { el, openDialog, confirm, toast, tag, select } from '../ui.js';
import { makeGymSession, makeSessionExercise, makeSet, MUSCLE_GROUPS } from '../../core/schema.js';
import { activeExercises, exerciseById, exerciseName, lastSetsFor, syncGymLog } from '../../core/gym.js';
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
export function openSessionDialog(ctx, habit, existing = null) {
  const isNew = !existing;
  const draft = {
    date: existing?.date ?? ctx.today,
    startTime: existing?.startTime ?? '',
    durationMinutes: existing?.durationMinutes ?? null,
    warmup: existing?.warmup ?? false,
    warmupMinutes: existing?.warmupMinutes ?? null,
    notes: existing?.notes ?? '',
    exercises: (existing?.exercises ?? []).map((entry) => ({
      id: entry.id,
      exerciseId: entry.exerciseId,
      sets: (entry.sets ?? []).map((s) => ({ id: s.id, reps: s.reps ?? null, weight: s.weight ?? null })),
    })),
  };

  const catalogue = activeExercises(ctx.state);
  const list = el('div.stack.sets', { id: 'session-exercises' });
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
  const durationInput = numeric({
    value: draft.durationMinutes ?? '',
    placeholder: 'minutes',
    'aria-label': 'Total duration in minutes',
    oninput: (e) => { draft.durationMinutes = toNumber(e.target.value); },
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
  const notesInput = el('textarea.textarea', {
    rows: 2,
    value: draft.notes,
    placeholder: 'Anything worth remembering (optional)',
    'aria-label': 'Session notes',
    oninput: (e) => { draft.notes = e.target.value; },
  });

  // --- the exercise blocks --------------------------------------------------

  /** @param {string|null} focusEntryId  which block's newest set to focus after redrawing */
  const draw = (focusEntryId = null) => {
    list.replaceChildren();

    if (!draft.exercises.length) {
      list.appendChild(el('p.field__hint', {
        text: catalogue.length
          ? 'No exercises yet. Pick one below — the sets you did last time are filled in for you.'
          : 'There are no exercises in your list yet. Add some in Settings › Exercises first.',
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
                exercise
                  ? tag(exercise.muscle, exercise.retired ? 'locked' : '')
                  : tag('no longer in your list', 'amber'),
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
              // The one that matters: same reps, same weight, one tap.
              el('button.btn.btn--primary.btn--sm', {
                type: 'button',
                text: entry.sets.length ? 'Repeat set' : 'Add set',
                'aria-label': `Repeat last set of ${name}`,
                onclick: () => {
                  const previous = entry.sets[entry.sets.length - 1];
                  entry.sets.push(makeSet({ reps: previous?.reps ?? null, weight: previous?.weight ?? null }));
                  draw(entry.id);
                },
              }),
              el('span.field__hint', {
                text: entry.sets.length
                  ? `${entry.sets.length} set${entry.sets.length === 1 ? '' : 's'} — repeats the reps and weight above`
                  : 'Starts an empty set',
              }),
            ]),
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

  // --- the picker -----------------------------------------------------------

  const picker = select(
    [
      { value: '', label: 'Add an exercise…' },
      ...MUSCLE_GROUPS.flatMap((muscle) => {
        const inGroup = catalogue.filter((e) => e.muscle === muscle);
        return inGroup.length
          ? [{ value: `__${muscle}`, label: `— ${muscle} —` }, ...inGroup.map((e) => ({ value: e.id, label: e.name }))]
          : [];
      }),
    ],
    '',
    { 'aria-label': 'Add an exercise' },
  );

  const addExercise = (exerciseId) => {
    if (!exerciseId || exerciseId.startsWith('__')) return;
    const previous = lastSetsFor(ctx.state, habit.id, exerciseId);
    const entry = makeSessionExercise({
      exerciseId,
      // Prefilled from last time. Correcting a number is faster than typing
      // four rows from scratch, and most sessions repeat most of the last one.
      sets: previous.length ? previous.map((s) => makeSet(s)) : [makeSet()],
    });
    draft.exercises.push(entry);
    draw(entry.id);
    picker.value = '';
    if (previous.length) {
      toast(`${exerciseName(ctx.state, exerciseId)} — filled in with last time's ${previous.length} set(s). Change what changed.`, { timeout: 4000 });
    }
  };

  picker.addEventListener('change', () => addExercise(picker.value));
  draw();

  return openDialog({
    title: isNew ? 'Log a session' : 'Session',
    wide: true,
    body: el('div.stack', [
      el('div.field-row', [
        el('label.field', [el('span.field__label', { text: 'Date' }), dateInput]),
        el('label.field', [el('span.field__label', { text: 'Started' }), startInput]),
        el('label.field', [el('span.field__label', { text: 'Duration' }), durationInput]),
      ]),
      el('div.row', [
        el('label.check', [warmupToggle, el('span', { text: 'Warmed up' })]),
        warmupMinutes,
      ]),
      el('div.stack--tight.stack', [
        el('span.field__label', { text: 'Exercises' }),
        list,
        el('div.row', [picker]),
      ]),
      el('label.field', [el('span.field__label', { text: 'Notes' }), notesInput]),
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
        await removeSession(ctx, habit, existing);
        return;
      }
      saveSession(ctx, habit, existing, value);
    },
  });
}

function saveSession(ctx, habit, existing, draft) {
  const dropped = draft.exercises.length === 0;

  ctx.commit(existing ? 'edit gym session' : 'log gym session', (state) => {
    const target = existing
      ? state.gymSessions.find((s) => s.id === existing.id)
      : makeGymSession({ habitId: habit.id });
    if (!target) return;

    Object.assign(target, {
      date: draft.date,
      startTime: draft.startTime || null,
      durationMinutes: draft.durationMinutes,
      warmup: !!draft.warmup,
      warmupMinutes: draft.warmup ? draft.warmupMinutes : null,
      notes: draft.notes,
      exercises: draft.exercises.map((entry) =>
        makeSessionExercise({
          exerciseId: entry.exerciseId,
          sets: entry.sets.map((s) => makeSet({ reps: s.reps, weight: s.weight })),
        })),
    });

    if (!existing) state.gymSessions.push(target);
    // The habit's day log is a mirror of the session dates, never edited by
    // hand, so the weekly target and the streak see exactly this.
    syncGymLog(state, habit.id);
  }, { undoable: false });

  toast(
    dropped
      ? 'Session logged with no exercises — the day still counts towards your target.'
      : `Session logged — ${draft.exercises.length} exercise(s).`,
    { action: { label: 'Undo', onClick: () => { ctx.store.undo(); ctx.render(); } } },
  );
}

async function removeSession(ctx, habit, session) {
  const answer = await confirm({
    title: 'Delete this session?',
    message: `The ${session.exercises?.length ?? 0} exercise(s) recorded on ${session.date} will be removed, and the day will stop counting towards that week's target.`,
    confirmLabel: 'Delete',
  });
  if (answer !== 'confirm') return;
  ctx.commit('delete gym session', (state) => {
    const index = state.gymSessions.findIndex((s) => s.id === session.id);
    if (index >= 0) state.gymSessions.splice(index, 1);
    syncGymLog(state, habit.id);
  });
}
