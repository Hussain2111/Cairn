// "Import outline": paste a plan drafted elsewhere and turn it into threads.
//
// The dialog parses as you type and shows exactly what will be created before
// anything is written. Import stays disabled while there are errors, so a
// half-understood paste cannot be committed by reflex.

import { el, openDialog, toast, tag, copyText } from '../ui.js';
import { parseOutline, planImport, OUTLINE_EXAMPLE } from '../../core/outline.js';
import { makeThread, makeStage, makeStep, makeTask, makeLink } from '../../core/schema.js';

/** The prompt to hand a chat so its answer pastes straight in. */
export const OUTLINE_PROMPT = `Break this down as a Cairn outline. Use exactly this format and nothing else:

# Thread name (project)
## Stage title
> what "done" means for this stage, concretely and testably
### Step title
- A task small enough to start in one sitting @45m ^2026-09-01
| An optional note about the line above it.

Rules:
- Thread type is one of: project, study, pipeline, habit, reading.
- EVERY stage needs a "> " done-when line. It must be checkable, not vague.
- Stages must be in the order they should be done — later ones stay locked until earlier ones finish.
- Tasks are concrete actions, not headings. @45m is an optional estimate, ^YYYY-MM-DD an optional due date. Both are optional — leave them out rather than inventing one.
- A URL on any line is lifted out of the title and kept as a link on that record, so put one there if it is worth keeping.
- A "| " line attaches a note to whatever line comes directly above it — thread, stage, step or task. Consecutive "| " lines are one note. Use them for context that is not a task.
- No prose, no commentary, no other markdown. Only the lines above.`;

export function openOutlineImport(ctx) {
  const input = el('textarea.textarea.textarea--tall', {
    placeholder: 'Paste your outline here…',
    spellcheck: 'false',
    'aria-label': 'Outline',
  });
  const preview = el('div.stack');
  let parsed = null;
  let plan = [];

  // Held directly rather than looked up: the preview redraws on a timer, and a
  // DOM query would silently do nothing if the dialog were ever restructured.
  const goButton = el('button.btn.btn--primary', {
    type: 'button',
    text: 'Import',
    disabled: true,
  });
  const submitEnabled = (on) => {
    goButton.disabled = !on;
  };

  const draw = () => {
    preview.replaceChildren();
    const text = input.value.trim();

    if (!text) {
      preview.appendChild(el('p.field__hint', {
        text: 'Nothing pasted yet. Threads, stages, steps and tasks will be listed here before anything is created.',
      }));
      submitEnabled(false);
      return;
    }

    parsed = parseOutline(input.value);
    plan = parsed.ok ? planImport(parsed, ctx.state) : [];

    if (parsed.errors.length) {
      preview.appendChild(
        el('div.banner.banner--danger', [
          el('div.banner__body', [
            el('div.banner__title', {
              text: `${parsed.errors.length} problem${parsed.errors.length > 1 ? 's' : ''} — nothing will be imported until these are fixed`,
            }),
            el('div.banner__text', { text: 'Fix them in the box above, or ask for the outline again.' }),
          ]),
        ]),
      );
      preview.appendChild(
        el('div.stack--tight.stack', parsed.errors.slice(0, 25).map((e) =>
          el('div.row', [
            e.line ? tag(`line ${e.line}`, 'danger') : tag('outline', 'danger'),
            el('div', [
              el('div.break', { text: e.message }),
              e.text ? el('code.break.faint', { text: e.text }) : null,
            ]),
          ]))),
      );
      if (parsed.errors.length > 25) {
        preview.appendChild(el('p.muted', { text: `…and ${parsed.errors.length - 25} more.` }));
      }
      submitEnabled(false);
      return;
    }

    // --- what will happen -------------------------------------------------
    const s = parsed.stats;
    preview.appendChild(
      el('div.row', [
        tag(`${s.threads} thread${s.threads === 1 ? '' : 's'}`, 'teal'),
        tag(`${s.stages} stage${s.stages === 1 ? '' : 's'}`),
        tag(`${s.steps} step${s.steps === 1 ? '' : 's'}`),
        tag(`${s.tasks} task${s.tasks === 1 ? '' : 's'}`),
        s.links ? tag(`${s.links} link${s.links === 1 ? '' : 's'}`) : null,
        s.notes ? tag(`${s.notes} note${s.notes === 1 ? '' : 's'}`) : null,
      ]),
    );

    if (parsed.warnings.length) {
      preview.appendChild(
        el('div.stack--tight.stack', [
          el('span.field__label', { text: `${parsed.warnings.length} thing(s) worth knowing` }),
          ...parsed.warnings.map((w) =>
            el('div.row', [
              w.line ? tag(`line ${w.line}`, 'amber') : null,
              el('span.break', { text: w.message }),
            ])),
        ]),
      );
    }

    for (const entry of plan) {
      const { thread, action, existing, clashes } = entry;
      preview.appendChild(
        el('div.card', [
          el('div.card__body.stack--tight.stack', [
            el('div.row.row--between', [
              el('strong.break', { text: thread.name }),
              el('div.row', [
                tag(thread.type),
                action === 'append'
                  ? tag('adds to the existing thread', 'amber')
                  : tag('new thread', 'teal'),
              ]),
            ]),
            action === 'append'
              ? el('p.field__hint', {
                  text: `"${existing.name}" already exists, so these ${thread.stages.length} stage(s) will be added to the end of it rather than creating a second thread with the same name.`,
                })
              : null,
            clashes.length
              ? el('div.banner.banner--warn', [
                  el('div.banner__body', [
                    el('div.banner__title', { text: 'Stage titles that already exist in that thread' }),
                    el('div.banner__text', {
                      text: `${clashes.join(', ')} — importing will give you two stages with each of those names. Rename them first if that is not what you want.`,
                    }),
                  ]),
                ])
              : null,
            ...annotationRows(thread),
            el('ul.stack--tight.stack', thread.stages.map((stage) =>
              el('li', [
                el('div.row', [
                  el('span.mono.faint', { text: String(thread.stages.indexOf(stage) + 1).padStart(2, '0') }),
                  el('strong.break', { text: stage.title }),
                  tag(`${stage.steps.reduce((n, p) => n + p.tasks.length, 0)} tasks`),
                ]),
                el('div.hesitation.break', { text: stage.doneWhen }),
                ...annotationRows(stage),
                // Every task carrying a link or a note is listed, so what the
                // parser lifted out of a title can be checked before it lands
                // rather than discovered in the tree afterwards.
                ...stage.steps.flatMap((step) => [
                  ...annotationRows(step, step.title),
                  ...step.tasks.filter(carriesAnnotation).flatMap((task) => annotationRows(task, task.title)),
                ]),
              ]))),
          ]),
        ]),
      );
    }
    submitEnabled(true);
  };

  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(draw, 250);
  });
  draw();

  return openDialog({
    title: 'Import outline',
    wide: true,
    body: el('div.stack', [
      el('p.field__hint', {
        text: 'Paste a plan written in the outline format. Nothing is created until you confirm, and the import can be undone.',
      }),
      el('div.row', [
        el('button.btn.btn--sm', {
          type: 'button',
          text: 'Copy the prompt for a chat',
          onclick: async () => {
            const ok = await copyText(OUTLINE_PROMPT);
            toast(ok ? 'Prompt copied — paste it into a chat with your project description.' : 'Could not reach the clipboard.',
              { variant: ok ? '' : 'danger' });
          },
        }),
        el('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          text: 'Show me an example',
          onclick: () => {
            input.value = OUTLINE_EXAMPLE;
            draw();
          },
        }),
      ]),
      input,
      preview,
    ]),
    footer: (close) => [
      el('button.btn', { type: 'button', text: 'Cancel', onclick: () => close(null) }),
      wireGo(goButton, () => {
        if (!parsed?.ok) return;
        close({ parsed, plan });
      }),
    ],
    onClose: (value) => {
      if (value) commitOutline(ctx, value.plan);
    },
  });
}

const carriesAnnotation = (record) => !!(record.links?.length || record.notes);

/**
 * The links and the note attached to one record, rendered so they can be read
 * before the import is committed. Both are things the parser decided — text
 * moved out of a title, a `|` line bound to the line above it — and the rule
 * in outline.js is that such decisions are visible first.
 */
function annotationRows(record, label = null) {
  if (!carriesAnnotation(record)) return [];
  return [
    el('div.annotation', [
      label ? el('span.section__meta.break', { text: label }) : null,
      ...(record.links ?? []).map((link) =>
        el('a.tag', {
          href: link.url,
          target: '_blank',
          rel: 'noopener noreferrer',
          text: link.label || link.url,
          title: link.url,
        })),
      record.notes ? el('div.annotation__note.break', { text: record.notes }) : null,
    ]),
  ];
}

/** Attach the confirm handler once, at the point the dialog supplies `close`. */
function wireGo(button, onClick) {
  button.onclick = onClick;
  return button;
}

/** Turn the parsed tree into real records, in one undoable step. */
function commitOutline(ctx, plan) {
  const created = { threads: 0, stages: 0, tasks: 0, links: 0, notes: 0 };
  let firstThreadId = null;

  /**
   * Links and notes land on every level, not just tasks. Both arrays have
   * always been on every record and the editor has always filled them; the
   * parser is only catching up.
   */
  const annotate = (record, parsed) => {
    for (const link of parsed.links ?? []) {
      record.links.push(makeLink({ url: link.url, label: link.label }));
      created.links += 1;
    }
    if (parsed.notes) {
      record.notes = record.notes ? `${record.notes}\n\n${parsed.notes}` : parsed.notes;
      created.notes += 1;
    }
  };

  ctx.commit('import outline', (state) => {
    for (const { thread, action, existing } of plan) {
      const target =
        action === 'append'
          ? state.threads.find((t) => t.id === existing.id)
          : makeThread({ name: thread.name, type: thread.type });

      if (action !== 'append') {
        state.threads.push(target);
        created.threads += 1;
      }
      annotate(target, thread);
      firstThreadId = firstThreadId ?? target.id;

      for (const stage of thread.stages) {
        const newStage = makeStage({ title: stage.title, doneWhen: stage.doneWhen });
        annotate(newStage, stage);
        for (const step of stage.steps) {
          const newStep = makeStep({ title: step.title });
          annotate(newStep, step);
          for (const task of step.tasks) {
            const newTask = makeTask({
              title: task.title,
              due: task.due,
              estimateMinutes: task.estimateMinutes,
            });
            annotate(newTask, task);
            newStep.tasks.push(newTask);
            created.tasks += 1;
          }
          newStage.steps.push(newStep);
        }
        target.stages.push(newStage);
        created.stages += 1;
      }
    }
  }, { undoable: false });

  toast(
    `Imported ${created.stages} stage(s) and ${created.tasks} task(s)` +
      (created.links ? ` with ${created.links} link(s)` : '') +
      (created.notes ? ` and ${created.notes} note(s)` : '') +
      (created.threads ? ` into ${created.threads} new thread(s).` : '.'),
    { action: { label: 'Undo', onClick: () => { ctx.store.undo(); ctx.render(); } }, timeout: 10000 },
  );
  if (firstThreadId) ctx.navigate(`#/thread/${firstThreadId}`);
}
