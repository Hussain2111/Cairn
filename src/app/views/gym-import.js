// "Import logbook": the one-time path out of a markdown training log.
//
// The outline importer refuses anything it does not understand, because a plan
// pasted from a chat can be asked again. This one cannot refuse — the source is
// a year of handwriting and there is no second copy. So it reads what it can,
// shows all of it, and lists every line it could not interpret by number and
// verbatim. Corrections happen in the preview; nothing is written until commit.

import { el, openDialog, toast, tag, copyText } from '../ui.js';
import { parseLogbook, planLogbookImport, LOGBOOK_EXAMPLE } from '../../core/gym-import.js';
import {
  makeExercise,
  makeGymSession,
  makeSessionExercise,
  makeSkippedExercise,
  makeSet,
  makePainRecord,
  makeRoutine,
  MUSCLE_GROUPS,
  EQUIPMENT_TYPES,
} from '../../core/schema.js';
import { findExerciseByName, routines } from '../../core/gym.js';
import { formatDate } from '../../core/dates.js';

export function openLogbookImport(ctx) {
  const input = el('textarea.textarea.textarea--tall', {
    placeholder: 'Paste the whole document. Headings, tables, prose lists — all of it.',
    spellcheck: 'false',
    'aria-label': 'Logbook',
  });
  const preview = el('div.stack');
  let parsed = null;
  let plan = null;
  // Corrections made in the preview, keyed by exercise name.
  const overrides = new Map();

  const goButton = el('button.btn.btn--primary', {
    type: 'button',
    text: 'Import',
    disabled: true,
    id: 'logbook-import-go',
  });

  const draw = () => {
    preview.replaceChildren();
    const text = input.value.trim();

    if (!text) {
      preview.appendChild(el('p.field__hint', {
        text: 'Nothing pasted yet. Everything found — exercises, sessions, sets, skips, pain and cues — is listed here before anything is created.',
      }));
      goButton.disabled = true;
      return;
    }

    parsed = parseLogbook(input.value);
    plan = planLogbookImport(parsed, ctx.state);

    preview.appendChild(
      el('div.row', [
        tag(`${plan.counts.newExercises} new exercise${plan.counts.newExercises === 1 ? '' : 's'}`, 'teal'),
        plan.counts.updatedExercises ? tag(`${plan.counts.updatedExercises} already in the library`) : null,
        tag(`${parsed.stats.sessions} session${parsed.stats.sessions === 1 ? '' : 's'}`),
        tag(`${parsed.stats.sets} sets`),
        parsed.stats.skipped ? tag(`${parsed.stats.skipped} skipped`) : null,
        parsed.stats.pain ? tag(`${parsed.stats.pain} pain record(s)`, 'danger') : null,
        parsed.stats.cues ? tag(`${parsed.stats.cues} cue(s)`) : null,
        parsed.stats.drops ? tag(`${parsed.stats.drops} dropped`) : null,
      ]),
    );

    if (plan.counts.clashes) {
      preview.appendChild(banner('warn', `${plan.counts.clashes} session(s) fall on a date you already have`,
        'Two sessions in a day is legitimate; importing the same logbook twice is not. Check the dates below before committing.'));
    }
    if (plan.counts.undated) {
      preview.appendChild(banner('warn', `${plan.counts.undated} session(s) have no date`,
        'They will be imported without one and will not count towards any week until a date is added.'));
    }

    // --- what could not be read --------------------------------------------
    if (parsed.unparsed.length) {
      preview.appendChild(
        el('div.stack--tight.stack', [
          banner('warn', `${parsed.unparsed.length} line(s) could not be interpreted`,
            'These are listed rather than dropped. Most are prose or headings that carry nothing; anything that matters can be fixed in the box above and re-parsed.'),
          el('div.unparsed', parsed.unparsed.slice(0, 40).map((entry) =>
            el('div.row', [
              tag(`line ${entry.line}`, 'amber'),
              entry.section ? tag(entry.section) : null,
              el('code.break.faint', { text: entry.text }),
            ]))),
          parsed.unparsed.length > 40
            ? el('p.muted', { text: `…and ${parsed.unparsed.length - 40} more.` })
            : null,
        ]),
      );
    } else {
      preview.appendChild(el('p.field__hint', { text: 'Every line was understood.' }));
    }

    if (parsed.warnings.length) {
      preview.appendChild(
        el('div.stack--tight.stack', [
          el('span.field__label', { text: `${parsed.warnings.length} thing(s) worth checking` }),
          ...parsed.warnings.slice(0, 30).map((w) =>
            el('div.row', [
              w.line ? tag(`line ${w.line}`) : null,
              el('span.break', { text: w.message }),
            ])),
        ]),
      );
    }

    // --- the library, correctable ------------------------------------------
    preview.appendChild(
      el('section.section', [
        el('div.section__head', [
          el('h2.section__title', { text: 'Exercises' }),
          el('div.section__rule'),
          el('span.section__meta', { text: `${plan.library.length}` }),
        ]),
        el('p.field__hint', {
          text: 'Anything read from the name rather than stated in the document is marked. Correct it here — this is the last moment before it is written.',
        }),
        el('div.card', [
          el('div.card__body.stack--tight.stack', plan.library.map((exercise) => libraryRow(exercise, overrides))),
        ]),
      ]),
    );

    // --- sessions -----------------------------------------------------------
    preview.appendChild(
      el('section.section', [
        el('div.section__head', [
          el('h2.section__title', { text: 'Sessions' }),
          el('div.section__rule'),
          el('span.section__meta', { text: `${plan.sessions.length}` }),
        ]),
        plan.sessions.length
          ? el('div.stack--tight.stack', plan.sessions.slice(0, 40).map((session) => sessionRow(session)))
          : el('p.muted', { text: 'No sessions found.' }),
        plan.sessions.length > 40
          ? el('p.muted', { text: `…and ${plan.sessions.length - 40} more, all of which will be imported.` })
          : null,
      ]),
    );

    if (parsed.pain.length) {
      preview.appendChild(
        el('section.section', [
          el('div.section__head', [
            el('h2.section__title', { text: 'Pain' }),
            el('div.section__rule'),
          ]),
          el('table.table', [
            el('thead', [el('tr', [
              el('th', { text: 'Date' }),
              el('th', { text: 'Where' }),
              el('th', { text: 'Exercise' }),
              el('th', { text: 'When' }),
            ])]),
            el('tbody', parsed.pain.map((record) =>
              el('tr', [
                el('td.mono', { text: record.date ?? '—' }),
                el('td.break', { text: record.location || '(not named — fix in the source)' }),
                el('td.break', { text: record.exerciseName ?? '—' }),
                el('td', { text: record.when }),
              ]))),
          ]),
        ]),
      );
    }

    goButton.disabled = !(plan.library.length || plan.sessions.length || parsed.pain.length);
  };

  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    overrides.clear();
    timer = setTimeout(draw, 300);
  });
  draw();

  return openDialog({
    title: 'Import your logbook',
    wide: true,
    body: el('div.stack', [
      el('p.field__hint', {
        text: 'A one-time path. Paste the markdown document you have been keeping and it becomes exercises, sessions, sets, skips, cues and pain records. After this, log in the app.',
      }),
      el('div.row', [
        el('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          text: 'Show me the shapes it understands',
          onclick: () => {
            input.value = LOGBOOK_EXAMPLE;
            overrides.clear();
            draw();
          },
        }),
        el('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          text: 'Copy the example',
          onclick: async () => {
            const ok = await copyText(LOGBOOK_EXAMPLE);
            toast(ok ? 'Example copied.' : 'Could not reach the clipboard.', { variant: ok ? '' : 'danger' });
          },
        }),
      ]),
      input,
      preview,
    ]),
    footer: (close) => {
      goButton.onclick = () => {
        if (!parsed || !plan) return;
        close({ parsed, plan, overrides: new Map(overrides) });
      };
      return [
        el('button.btn', { type: 'button', text: 'Cancel', onclick: () => close(null) }),
        goButton,
      ];
    },
    onClose: (value) => {
      if (value) commitLogbook(ctx, value);
    },
  });
}

function banner(variant, title, text) {
  return el(`div.banner.banner--${variant}`, [
    el('div.banner__body', [
      el('div.banner__title', { text: title }),
      el('div.banner__text', { text }),
    ]),
  ]);
}

function libraryRow(exercise, overrides) {
  const key = exercise.name.toLowerCase();
  const current = () => overrides.get(key) ?? {};

  const muscle = el('select.select', { 'aria-label': `Primary muscle for ${exercise.name}` });
  for (const group of MUSCLE_GROUPS) {
    muscle.appendChild(el('option', { value: group, text: group, selected: group === exercise.muscle }));
  }
  muscle.value = exercise.muscle;
  muscle.addEventListener('change', () => {
    overrides.set(key, { ...current(), muscle: muscle.value });
  });

  const equipment = el('select.select', { 'aria-label': `Equipment for ${exercise.name}` });
  for (const kind of EQUIPMENT_TYPES) {
    equipment.appendChild(el('option', { value: kind, text: kind, selected: kind === exercise.equipment }));
  }
  equipment.value = exercise.equipment;
  equipment.addEventListener('change', () => {
    overrides.set(key, { ...current(), equipment: equipment.value });
  });

  return el('div.row.row--between', [
    el('div.row', [
      el('strong.break', { text: exercise.name }),
      exercise.action === 'update' ? tag('already in the library') : tag('new', 'teal'),
      exercise.guessedMuscle
        ? tag(exercise.guessedFromName ? 'muscle read from the name' : 'muscle not stated', 'amber')
        : null,
      exercise.equipment === 'unspecified' ? tag('equipment not stated', 'amber') : null,
      exercise.status === 'dropped'
        ? tag(`dropped: ${exercise.dropReason ?? 'reason unclear'}`, exercise.dropReason === 'pain' ? 'danger' : 'locked')
        : null,
      exercise.cues ? tag('has cues') : null,
    ]),
    el('div.row', [muscle, equipment]),
  ]);
}

function sessionRow(session) {
  return el('div.card', [
    el('div.card__body.stack--tight.stack', [
      el('div.row.row--between', [
        el('div.row', [
          el('strong.mono', { text: session.date ? formatDate(session.date) : 'no date' }),
          session.routineName ? tag(session.routineName, 'teal') : null,
          session.durationMinutes ? tag(`${session.durationMinutes}m`) : null,
          session.warmup ? tag(`warm-up ${session.warmupMinutes ?? ''}`.trim(), 'teal') : tag('no warm-up', 'locked'),
        ]),
        el('div.row', [
          session.clash ? tag('a session already exists on this date', 'amber') : null,
          session.undated ? tag('no date', 'danger') : null,
        ]),
      ]),
      el('ul.session__lines', session.exercises.map((entry) =>
        el('li.mono.break', {
          text: `${entry.substitutedForName ? `${entry.substitutedForName} → ` : ''}${entry.name} — ${
            entry.sets.length ? entry.sets.map((s) => `${s.reps}×${s.weight ?? 'bw'}`).join(', ') : 'no sets recorded'
          }${entry.note ? ` · ${entry.note}` : ''}`,
        }))),
      session.skipped.length
        ? el('div.row', [
            el('span.field__label', { text: 'Skipped' }),
            ...session.skipped.map((entry) => tag(`${entry.name} — ${entry.reason}`, 'amber')),
          ])
        : null,
    ]),
  ]);
}

/** Turn the parse into real records, in one undoable step. */
function commitLogbook(ctx, { parsed, plan, overrides }) {
  const created = { exercises: 0, sessions: 0, sets: 0, pain: 0, cues: 0 };

  ctx.commit('import logbook', (state) => {
    const byName = new Map();

    // 1. The library first: sessions and pain both point at it.
    for (const entry of plan.library) {
      const key = entry.name.toLowerCase();
      const override = overrides.get(key) ?? {};
      const muscle = override.muscle ?? entry.muscle;
      const equipment = override.equipment ?? entry.equipment;

      const existing = findExerciseByName(state, entry.name);
      if (existing) {
        // An exercise already in the library keeps what it has; the import only
        // fills in blanks and adds cues, so a hand-corrected record is not
        // overwritten by a guess from a document.
        if (existing.equipment === 'unspecified' && equipment !== 'unspecified') existing.equipment = equipment;
        if (!(existing.secondary ?? []).length && entry.secondary.length) {
          existing.secondary = entry.secondary.filter((m) => m !== existing.muscle);
        }
        if (entry.cues && !existing.cues) {
          existing.cues = entry.cues;
          created.cues += 1;
        }
        if (entry.status === 'dropped' && existing.status !== 'dropped') {
          existing.status = 'dropped';
          existing.dropReason = entry.dropReason;
          existing.dropNote = entry.dropNote;
        }
        byName.set(key, existing);
        continue;
      }

      const exercise = makeExercise({
        name: entry.name,
        muscle,
        secondary: entry.secondary,
        equipment,
        status: entry.status,
        cues: entry.cues,
      });
      exercise.dropReason = entry.dropReason ?? null;
      exercise.dropNote = entry.dropNote ?? '';
      state.exercises.push(exercise);
      byName.set(key, exercise);
      created.exercises += 1;
      if (entry.cues) created.cues += 1;
    }

    const idFor = (name) => byName.get(String(name ?? '').toLowerCase())?.id
      ?? findExerciseByName(state, name)?.id
      ?? null;

    // 2. Routine slots named in the document, so an A/B log keeps its rotation.
    const slotNames = [...new Set(plan.sessions.map((s) => s.routineName).filter(Boolean))];
    for (const name of slotNames) {
      const existing = routines(state).find((r) => r.name.toLowerCase().startsWith(String(name).toLowerCase()));
      if (!existing) state.routines.push(makeRoutine({ name: String(name), order: state.routines.length }));
    }
    const slotFor = (name) => {
      if (!name) return null;
      const match = routines(state).find((r) => r.name.toLowerCase().startsWith(String(name).toLowerCase()));
      return match?.id ?? null;
    };

    // 3. Sessions.
    const sessionByLine = new Map();
    for (const entry of plan.sessions) {
      const session = makeGymSession({
        date: entry.date ?? null,
        startTime: entry.startTime ?? null,
        endTime: entry.endTime ?? null,
        durationMinutes: entry.durationMinutes ?? null,
        warmup: !!entry.warmup,
        warmupMinutes: entry.warmupMinutes ?? null,
        routineId: slotFor(entry.routineName),
        notes: entry.notes ?? '',
      });
      session.exercises = entry.exercises.map((item) =>
        makeSessionExercise({
          exerciseId: idFor(item.name),
          substitutedFor: item.substitutedForName ? idFor(item.substitutedForName) : null,
          note: item.note ?? '',
          sets: item.sets.map((set) => makeSet({ reps: set.reps ?? null, weight: set.weight ?? null })),
        }));
      session.skipped = entry.skipped.map((item) =>
        makeSkippedExercise({ exerciseId: idFor(item.name), reason: item.reason, note: item.note }));

      state.gymSessions.push(session);
      sessionByLine.set(entry.line, session.id);
      created.sessions += 1;
      created.sets += session.exercises.reduce((sum, x) => sum + x.sets.length, 0);
    }

    // 4. Pain.
    for (const record of parsed.pain) {
      state.painRecords.push(makePainRecord({
        date: record.date ?? null,
        location: record.location || 'unspecified',
        exerciseId: record.exerciseName ? idFor(record.exerciseName) : null,
        when: record.when === 'after' ? 'after' : 'during',
        note: record.note ?? '',
      }));
      created.pain += 1;
    }
  }, { undoable: false });

  toast(
    `Imported ${created.exercises} exercise(s), ${created.sessions} session(s), ${created.sets} sets and ${created.pain} pain record(s).`,
    { action: { label: 'Undo', onClick: () => { ctx.store.undo(); ctx.render(); } }, timeout: 15000 },
  );
  ctx.navigate('#/gym/history');
}
