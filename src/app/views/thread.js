// The tree: stages down a spine, expanding into steps and tasks.

import { el, meter, tag, icon, confirm, openDialog, toast, empty } from '../ui.js';
import { pageHead, dueTag, linkEditor, editRecord } from './shared.js';
import {
  stageState,
  stageProgress,
  threadProgress,
  stepCounts,
  isStageComplete,
  isStageActionable,
  isStageUnlocked,
  canStartStage,
  moveStage,
  nextTask,
  threadStall,
} from '../../core/threads.js';
import { makeStage, makeStep, makeTask, THREAD_TYPES } from '../../core/schema.js';
import { nowStamp, formatDate, formatDuration } from '../../core/dates.js';
import { activityThreadId } from '../../core/activities.js';

export function title(ctx) {
  const thread = ctx.state.threads.find((t) => t.id === ctx.route.params[0]);
  return thread?.name ?? 'Thread';
}

const STATE_LABEL = {
  locked: 'locked',
  available: 'ready',
  'in-progress': 'in progress',
  complete: 'complete',
};

export function render(ctx) {
  const threadId = ctx.route.params[0];
  const thread = ctx.state.threads.find((t) => t.id === threadId);
  if (!thread) {
    return el('div', [
      pageHead('Thread not found'),
      empty('That thread is gone', 'It may have been deleted, or the link is out of date.', el('a.btn', { href: '#/threads', text: 'All threads' })),
    ]);
  }

  const focusId = ctx.route.query.get('focus');
  const progress = threadProgress(thread);
  const stall = threadStall(thread, { today: ctx.today, days: ctx.state.settings.stallDays });
  const next = nextTask(thread);

  const view = el('div', [
    pageHead(thread.name, {
      sub: thread.description || null,
      actions: [
        el('button.btn', { type: 'button', text: 'Add stage', onclick: () => addStage(ctx, thread) }),
        el('button.btn', { type: 'button', text: 'Edit', onclick: () => editThread(ctx, thread) }),
        el('a.btn', { href: `#/notes?attach=thread:${thread.id}`, text: 'Notes' }),
      ],
    }),

    el('div.card', [
      el('div.card__body.stack--tight.stack', [
        el('div.row', [
          tag(thread.type),
          tag(`${progress.done}/${progress.total} tasks`),
          tag(`${progress.stagesComplete}/${progress.stages} stages`),
          thread.archived ? tag('archived', 'locked') : null,
          stall.stalled ? tag(`stalled ${stall.idleDays}d`, 'danger') : null,
          el('div.spacer'),
          el('span.section__meta', {
            text: stall.lastCompletion ? `last completion ${formatDate(stall.lastCompletion)}` : 'nothing completed yet',
          }),
        ]),
        meter(progress.ratio, progress.ratio === 1 ? 'complete' : ''),
        next.task
          ? el('div.row', [
              el('span.field__label', { text: 'Up next' }),
              el('strong.break', { text: next.task.title }),
            ])
          : el('div.row', [
              el('span.field__label', { text: 'Up next' }),
              el('span.muted', { text: blockedReason(next) }),
            ]),
      ]),
    ]),

    thread.links?.length
      ? el('div.row', { style: { marginTop: 'var(--sp-3)' } },
          thread.links.map((link) =>
            el('a.tag', { href: link.url, target: '_blank', rel: 'noopener noreferrer', text: link.label || link.url })))
      : null,

    thread.notes
      ? el('div.card', { style: { marginTop: 'var(--sp-3)' } }, [el('div.card__body.break', { text: thread.notes })])
      : null,

    el('div.tree', { style: { marginTop: 'var(--sp-5)' } },
      thread.stages.length
        ? thread.stages.map((stage, index) => renderStage(ctx, thread, stage, index, focusId))
        : [empty(
            'No stages yet',
            'A thread is a sequence of stages. Add the first one, and write what "done" means for it before you start working in it.',
            el('button.btn.btn--primary', { type: 'button', text: 'Add the first stage', onclick: () => addStage(ctx, thread) }),
          )]),
  ]);

  wireKeyboard(ctx, thread, view);
  if (focusId) {
    requestAnimationFrame(() => {
      const target = view.querySelector(`[data-id="${CSS.escape(focusId)}"]`);
      target?.scrollIntoView({ block: 'center' });
      target?.classList.add('is-focused');
    });
  }
  return view;
}

function blockedReason(next) {
  switch (next.blocked) {
    case 'no-stages':
      return 'No stages yet.';
    case 'no-tasks':
      return 'The open stage has no tasks in it. Break it down.';
    case 'no-done-when':
      return `"${next.stage?.title}" needs a done-when before you can work in it.`;
    case 'all-locked':
      return 'Everything ahead is locked. Finish the current stage, or force-unlock one.';
    case 'complete':
      return 'Every stage is complete.';
    default:
      return 'Nothing available.';
  }
}

// --- stages -----------------------------------------------------------------

function renderStage(ctx, thread, stage, index, focusId) {
  const state = stageState(thread, index);
  const progress = stageProgress(stage);
  const actionable = isStageActionable(thread, index);
  const unlocked = isStageUnlocked(thread, index);
  const hasDoneWhen = canStartStage(stage);

  return el(`div.stage.stage--${state}`, { dataset: { id: stage.id, state } }, [
    el('div.stage__node', { title: STATE_LABEL[state] }, [
      state === 'complete' ? icon('check') : null,
    ]),

    el('div.stage__head', [
      el('span.stage__no', { text: String(index + 1).padStart(2, '0') }),
      el('div.stage__titlewrap', [
        el('button.stage__title.break', {
          type: 'button',
          text: stage.title,
          title: 'Edit this stage',
          onclick: () => editStage(ctx, thread, stage),
        }),
        hasDoneWhen
          ? el('span.stage__donewhen', { text: `Done when: ${stage.doneWhen}` })
          : el('span.stage__donewhen.stage__donewhen--missing', {
              text: 'No done-when written — this stage cannot be started until there is one.',
            }),
      ]),
      el('div.stage__meta', [
        tag(`${progress.done}/${progress.total}`, state === 'complete' ? 'teal' : state === 'locked' ? 'locked' : ''),
        progress.forced ? tag('force-completed', 'amber') : null,
        stage.forceUnlocked && !unlockedByPredecessor(thread, index) ? tag('force-unlocked', 'amber') : null,
        state === 'locked' ? tag('locked', 'locked') : null,
        el('div.stage__progress', [meter(progress.ratio, state === 'complete' ? 'complete' : state === 'locked' ? 'locked' : '')]),
      ]),
    ]),

    el('div.stage__body', [
      stage.notes ? el('p.muted.break', { text: stage.notes }) : null,
      stage.links?.length
        ? el('div.row', stage.links.map((link) =>
            el('a.tag', { href: link.url, target: '_blank', rel: 'noopener noreferrer', text: link.label || link.url })))
        : null,

      ...stage.steps.map((step) => renderStep(ctx, thread, stage, step, actionable, focusId)),

      !stage.steps.length
        ? el('p.muted', { style: { paddingLeft: 'var(--sp-3)', marginTop: 'var(--sp-2)' }, text: 'No steps yet.' })
        : null,

      el('div.stage__tools', [
        el('button.btn.btn--sm', { type: 'button', text: '+ Step', onclick: () => addStep(ctx, thread, stage) }),
        el('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          text: 'Edit',
          'aria-label': `Edit stage ${stage.title}`,
          onclick: () => editStage(ctx, thread, stage),
        }),
        index > 0
          ? el('button.btn.btn--ghost.btn--sm', { type: 'button', text: '↑', title: 'Move up', onclick: () => reorder(ctx, thread, index, index - 1) })
          : null,
        index < thread.stages.length - 1
          ? el('button.btn.btn--ghost.btn--sm', { type: 'button', text: '↓', title: 'Move down', onclick: () => reorder(ctx, thread, index, index + 1) })
          : null,
        !unlocked
          ? el('button.btn.btn--sm', { type: 'button', text: 'Force unlock', onclick: () => forceUnlock(ctx, thread, stage) })
          : null,
        stage.forceUnlocked
          ? el('button.btn.btn--ghost.btn--sm', { type: 'button', text: 'Drop override', onclick: () => dropUnlock(ctx, thread, stage) })
          : null,
        !isStageComplete(stage) && hasDoneWhen
          ? el('button.btn.btn--ghost.btn--sm', { type: 'button', text: 'Mark complete', onclick: () => forceComplete(ctx, thread, stage) })
          : null,
        stage.forceCompleted
          ? el('button.btn.btn--ghost.btn--sm', { type: 'button', text: 'Reopen', onclick: () => reopenStage(ctx, thread, stage) })
          : null,
        el('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          text: 'Delete',
          'aria-label': `Delete stage ${stage.title}`,
          onclick: () => deleteStage(ctx, thread, stage, index),
        }),
      ]),
    ]),
  ]);
}

function unlockedByPredecessor(thread, index) {
  return index === 0 || isStageComplete(thread.stages[index - 1]);
}

function renderStep(ctx, thread, stage, step, actionable, focusId) {
  const counts = stepCounts(step);
  const complete = counts.total > 0 && counts.done === counts.total;
  const addInput = el('input.input.input--sm', {
    type: 'text',
    placeholder: 'Add a task…',
    'aria-label': `Add a task to ${step.title}`,
    onkeydown: (event) => {
      if (event.key === 'Enter') {
        const value = event.target.value.trim();
        if (!value) return;
        event.target.value = '';
        ctx.commit('add task', () => {
          step.tasks.push(makeTask({ title: value }));
        }, { undoable: false });
        // The view was rebuilt, so put the cursor back where it was to keep a
        // run of tasks flowing.
        refocusAddBox(step.id);
      }
    },
  });

  return el('div.step' + (complete ? '.step--complete' : ''), { dataset: { id: step.id } }, [
    el('div.step__head', [
      el('span.step__title.break', { text: step.title }),
      tag(`${counts.done}/${counts.total}`, complete ? 'teal' : ''),
      el('div.spacer'),
      el('button.btn.btn--ghost.btn--sm', {
        type: 'button',
        text: 'Rename',
        'aria-label': `Rename step ${step.title}`,
        onclick: () => renameStep(ctx, step),
      }),
      el('button.btn.btn--ghost.btn--sm', {
        type: 'button',
        text: 'Delete',
        'aria-label': `Delete step ${step.title}`,
        onclick: () => deleteStep(ctx, stage, step),
      }),
    ]),
    el('div.tasks', step.tasks.map((task) => renderTask(ctx, thread, stage, step, task, actionable, focusId))),
    el('div.inline-add', [addInput]),
  ]);
}

/** Re-focus a step's add-task box after the tree is rebuilt. */
function refocusAddBox(stepId) {
  requestAnimationFrame(() => {
    document.querySelector(`.step[data-id="${CSS.escape(stepId)}"] .inline-add .input`)?.focus();
  });
}

function renderTask(ctx, thread, stage, step, task, actionable, focusId) {
  const classes = ['task'];
  if (task.done) classes.push('task--done');
  if (!actionable) classes.push('task--locked');

  const node = el(`div.${classes.join('.')}`, {
    dataset: { id: task.id, task: '1' },
    tabIndex: 0,
    role: 'listitem',
  }, [
    el('button.task__box', {
      type: 'button',
      role: 'checkbox',
      'aria-checked': String(!!task.done),
      'aria-label': `Mark "${task.title}" ${task.done ? 'not done' : 'done'}`,
      disabled: !actionable && !task.done,
      title: actionable ? '' : 'This stage is locked or has no done-when',
      onclick: (event) => {
        event.stopPropagation();
        toggleTask(ctx, thread, stage, task, actionable);
      },
    }, [task.done ? icon('check') : null]),

    el('span.task__title.break', {
      text: task.title,
      onclick: () => editTask(ctx, task),
    }),

    el('div.task__meta', [
      task.estimateMinutes ? el('span', { text: formatDuration(task.estimateMinutes) }) : null,
      task.due ? dueTag(task.due, ctx.today, { done: task.done }) : null,
      task.notes ? tag('note') : null,
      task.links?.length ? tag(`${task.links.length} link${task.links.length > 1 ? 's' : ''}`) : null,
    ]),
  ]);

  node.addEventListener('keydown', (event) => {
    if (event.key === 'x' || event.key === ' ') {
      event.preventDefault();
      toggleTask(ctx, thread, stage, task, actionable);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      editTask(ctx, task);
    }
  });

  if (focusId === task.id) node.classList.add('is-focused');
  return node;
}

// --- actions ----------------------------------------------------------------

function toggleTask(ctx, thread, stage, task, actionable) {
  if (!actionable && !task.done) {
    const index = thread.stages.indexOf(stage);
    toast(
      canStartStage(stage)
        ? 'That stage is locked. Finish the one before it, or force-unlock it.'
        : 'Write a done-when for this stage before working in it.',
      { variant: 'danger' },
    );
    if (!canStartStage(stage)) editStage(ctx, thread, stage);
    else if (!isStageUnlocked(thread, index)) forceUnlock(ctx, thread, stage);
    return;
  }
  const wasComplete = isStageComplete(stage);
  ctx.commit(task.done ? 'untick task' : 'tick task', () => {
    task.done = !task.done;
    task.doneAt = task.done ? nowStamp() : null;
  }, { undoable: false });

  if (!wasComplete && isStageComplete(stage)) {
    const index = thread.stages.indexOf(stage);
    const next = thread.stages[index + 1];
    toast(next ? `Stage complete. "${next.title}" is now unlocked.` : 'Stage complete — that was the last one.');
  }
}

async function addStage(ctx, thread) {
  const values = await editRecord({
    title: 'New stage',
    submitLabel: 'Add stage',
    fields: [
      { key: 'title', label: 'Stage title', required: true, placeholder: 'e.g. Lexer' },
      {
        key: 'doneWhen',
        label: 'Done when',
        type: 'textarea',
        required: true,
        rows: 3,
        placeholder: 'e.g. every token type has a passing test and the fuzzer runs clean for 10k inputs',
        hint: 'Required. This is what stops the stage expanding forever.',
      },
    ],
  });
  if (!values) return;
  ctx.commit('add stage', () => {
    thread.stages.push(makeStage({ title: values.title, doneWhen: values.doneWhen }));
  }, { undoable: false });
}

async function editStage(ctx, thread, stage) {
  const draft = { links: stage.links.map((l) => ({ ...l })) };
  const result = await openDialog({
    title: 'Stage',
    wide: true,
    body: (close) => {
      const titleInput = el('input.input', { value: stage.title, placeholder: 'Stage title' });
      const doneWhenInput = el('textarea.textarea', { value: stage.doneWhen, rows: 3 });
      const notesInput = el('textarea.textarea', { value: stage.notes, rows: 5 });
      const error = el('div.field__error');
      draft.read = () => ({
        title: titleInput.value.trim(),
        doneWhen: doneWhenInput.value.trim(),
        notes: notesInput.value,
      });
      draft.error = error;
      return el('div.stack', [
        el('label.field', [el('span.field__label', { text: 'Title' }), titleInput]),
        el('label.field', [
          el('span.field__label', { text: 'Done when' }),
          doneWhenInput,
          el('span.field__hint', { text: 'Required before the stage can be started.' }),
        ]),
        el('label.field', [el('span.field__label', { text: 'Notes' }), notesInput]),
        linkEditor(draft.links),
        error,
      ]);
    },
    footer: (close) => [
      el('button.btn', { type: 'button', text: 'Cancel', onclick: () => close(null) }),
      el('button.btn.btn--primary', {
        type: 'button',
        text: 'Save',
        onclick: () => {
          const values = draft.read();
          if (!values.title) {
            draft.error.textContent = 'A stage needs a title.';
            return;
          }
          if (!values.doneWhen) {
            draft.error.textContent = 'A stage needs a done-when. It is what keeps the stage finite.';
            return;
          }
          close(values);
        },
      }),
    ],
  });
  if (!result) return;
  ctx.commit('edit stage', () => {
    Object.assign(stage, result, { links: draft.links });
  }, { undoable: false });
}

function reorder(ctx, thread, from, to) {
  ctx.commit('reorder stages', () => {
    const { after } = moveStage(thread, from, to);
    const relocked = after.filter((s) => s === 'locked').length;
    if (relocked) {
      setTimeout(() => toast(`${relocked} stage(s) are locked in the new order.`), 0);
    }
  });
}

function forceUnlock(ctx, thread, stage) {
  ctx.commit('force unlock', () => {
    stage.forceUnlocked = true;
  }, { message: 'Stage force-unlocked' });
}

function dropUnlock(ctx, thread, stage) {
  ctx.commit('drop unlock override', () => {
    stage.forceUnlocked = false;
  });
}

async function forceComplete(ctx, thread, stage) {
  const progress = stageProgress(stage);
  const open = progress.total - progress.done;
  if (open > 0) {
    const answer = await confirm({
      title: 'Complete this stage with work still open?',
      message:
        `"${stage.title}" has ${open} task(s) that are not done. You can close it anyway — it will be recorded as ` +
        'force-completed, and it will show that way in the weekly review.',
      confirmLabel: 'Force-complete',
      danger: false,
    });
    if (answer !== 'confirm') return;
  }
  ctx.commit('force-complete stage', () => {
    stage.forceCompleted = true;
    stage.forceCompletedAt = nowStamp();
  });
}

function reopenStage(ctx, thread, stage) {
  ctx.commit('reopen stage', () => {
    stage.forceCompleted = false;
    stage.forceCompletedAt = null;
  });
}

async function deleteStage(ctx, thread, stage, index) {
  const progress = stageProgress(stage);
  const hasWork = progress.done > 0;
  const answer = await confirm({
    title: hasWork ? 'This stage contains completed work' : 'Delete this stage?',
    message: hasWork
      ? `"${stage.title}" has ${progress.done} completed task(s). Archiving keeps the record — it leaves the thread but stays in your data and in past weekly reviews.`
      : `"${stage.title}" and its ${progress.total} task(s) will be removed. This can be undone.`,
    confirmLabel: 'Delete',
    extraLabel: hasWork ? 'Archive instead' : null,
  });
  if (!answer) return;

  if (answer === 'extra') {
    ctx.commit('archive stage', () => {
      thread.stages.splice(index, 1);
      ctx.state.archivedStages.push({ threadId: thread.id, threadName: thread.name, stage, archivedAt: nowStamp() });
    }, { message: 'Stage archived' });
    return;
  }
  ctx.commit('delete stage', () => {
    thread.stages.splice(index, 1);
  });
}

async function addStep(ctx, thread, stage) {
  const values = await editRecord({
    title: 'New step',
    submitLabel: 'Add step',
    fields: [{ key: 'title', label: 'Step title', required: true, placeholder: 'e.g. Number literals' }],
  });
  if (!values) return;
  ctx.commit('add step', () => {
    stage.steps.push(makeStep({ title: values.title }));
  }, { undoable: false });
}

async function renameStep(ctx, step) {
  const values = await editRecord({
    title: 'Step',
    fields: [
      { key: 'title', label: 'Title', required: true },
      { key: 'notes', label: 'Notes', type: 'textarea', rows: 3 },
    ],
    values: step,
  });
  if (!values) return;
  ctx.commit('edit step', () => Object.assign(step, values), { undoable: false });
}

async function deleteStep(ctx, stage, step) {
  const counts = stepCounts(step);
  const answer = await confirm({
    title: 'Delete this step?',
    message: `"${step.title}" and its ${counts.total} task(s) will be removed${counts.done ? `, including ${counts.done} completed` : ''}. This can be undone.`,
    confirmLabel: 'Delete',
  });
  if (answer !== 'confirm') return;
  ctx.commit('delete step', () => {
    const index = stage.steps.indexOf(step);
    if (index >= 0) stage.steps.splice(index, 1);
  });
}

async function editTask(ctx, task) {
  const draft = { links: task.links.map((l) => ({ ...l })) };
  const result = await openDialog({
    title: 'Task',
    wide: true,
    body: () => {
      const titleInput = el('input.input', { value: task.title });
      const dueInput = el('input.input', { type: 'date', value: task.due ?? '' });
      const estimateInput = el('input.input', { type: 'number', min: '0', step: '5', value: task.estimateMinutes ?? '' });
      const notesInput = el('textarea.textarea', { value: task.notes, rows: 5 });
      draft.read = () => ({
        title: titleInput.value.trim(),
        due: dueInput.value || null,
        estimateMinutes: estimateInput.value === '' ? null : Number(estimateInput.value),
        notes: notesInput.value,
      });
      return el('div.stack', [
        el('label.field', [el('span.field__label', { text: 'Title' }), titleInput]),
        // Both have always been optional, but sitting side by side with the
        // same weight as the title they read as two more fields to fill in.
        // A due date invented to satisfy a form is worse than none: Today
        // surfaces overdue tasks, so a fake one costs attention every morning.
        el('div.field-row', [
          el('label.field', [
            el('span.field__label', { text: 'Due' }),
            dueInput,
            el('span.field__hint', { text: 'Optional. Only set one if the date is real.' }),
          ]),
          el('label.field', [
            el('span.field__label', { text: 'Estimate' }),
            estimateInput,
            el('span.field__hint', { text: 'Optional, in minutes.' }),
          ]),
        ]),
        el('label.field', [el('span.field__label', { text: 'Notes' }), notesInput]),
        linkEditor(draft.links),
      ]);
    },
    footer: (close) => [
      el('button.btn.btn--danger', { type: 'button', text: 'Delete', onclick: () => close({ delete: true }) }),
      el('div.spacer'),
      el('button.btn', { type: 'button', text: 'Cancel', onclick: () => close(null) }),
      el('button.btn.btn--primary', { type: 'button', text: 'Save', onclick: () => close(draft.read()) }),
    ],
  });
  if (!result) return;

  if (result.delete) {
    const answer = await confirm({
      title: 'Delete this task?',
      message: `"${task.title}" will be removed. This can be undone.`,
      confirmLabel: 'Delete',
    });
    if (answer !== 'confirm') return;
    ctx.commit('delete task', (state) => {
      for (const thread of state.threads) {
        for (const stage of thread.stages) {
          for (const step of stage.steps) {
            const index = step.tasks.findIndex((t) => t.id === task.id);
            if (index >= 0) step.tasks.splice(index, 1);
          }
        }
      }
      for (const block of state.timeBlocks) if (block.taskId === task.id) block.taskId = null;
    });
    return;
  }

  if (!result.title) {
    toast('A task needs a title.', { variant: 'danger' });
    return;
  }
  ctx.commit('edit task', () => {
    Object.assign(task, result, { links: draft.links });
  }, { undoable: false });
}

async function editThread(ctx, thread) {
  const draft = { links: thread.links.map((l) => ({ ...l })) };
  const result = await openDialog({
    title: 'Thread',
    wide: true,
    body: () => {
      const nameInput = el('input.input', { value: thread.name });
      const typeSelect = el('select.select', {}, THREAD_TYPES.map((t) =>
        el('option', { value: t, text: t, selected: t === thread.type })));
      const descInput = el('input.input', { value: thread.description ?? '' });
      const notesInput = el('textarea.textarea', { value: thread.notes, rows: 5 });
      const archived = el('input', { type: 'checkbox', checked: !!thread.archived });
      draft.read = () => ({
        name: nameInput.value.trim(),
        type: typeSelect.value,
        description: descInput.value.trim(),
        notes: notesInput.value,
        archived: archived.checked,
      });
      return el('div.stack', [
        el('label.field', [el('span.field__label', { text: 'Name' }), nameInput]),
        el('div.field-row', [
          el('label.field', [el('span.field__label', { text: 'Type' }), typeSelect]),
          el('label.field', [el('span.field__label', { text: 'Description' }), descInput]),
        ]),
        el('label.field', [el('span.field__label', { text: 'Notes' }), notesInput]),
        linkEditor(draft.links),
        el('label.check', [archived, el('span', { text: 'Archived — hidden from Today and stall detection' })]),
      ]);
    },
    footer: (close) => [
      el('button.btn.btn--danger', { type: 'button', text: 'Delete thread', onclick: () => close({ delete: true }) }),
      el('div.spacer'),
      el('button.btn', { type: 'button', text: 'Cancel', onclick: () => close(null) }),
      el('button.btn.btn--primary', { type: 'button', text: 'Save', onclick: () => close(draft.read()) }),
    ],
  });
  if (!result) return;

  if (result.delete) {
    const progress = threadProgress(thread);
    const answer = await confirm({
      title: 'Delete this thread?',
      message: `"${thread.name}" holds ${progress.stages} stage(s) and ${progress.total} task(s), ${progress.done} of them completed. Archiving keeps the history and hides it from Today.`,
      confirmLabel: 'Delete everything',
      extraLabel: 'Archive instead',
    });
    if (!answer) return;
    if (answer === 'extra') {
      ctx.commit('archive thread', () => { thread.archived = true; }, { message: 'Thread archived' });
      return;
    }
    ctx.commit('delete thread', (state) => {
      const index = state.threads.findIndex((t) => t.id === thread.id);
      if (index >= 0) state.threads.splice(index, 1);
      for (const block of state.timeBlocks) {
        if (activityThreadId(block.activity) === thread.id) {
          block.activity = null;
          block.taskId = null;
        }
      }
    });
    ctx.navigate('#/threads');
    return;
  }

  if (!result.name) {
    toast('A thread needs a name.', { variant: 'danger' });
    return;
  }
  ctx.commit('edit thread', () => Object.assign(thread, result, { links: draft.links }), { undoable: false });
}

// --- keyboard within the tree ----------------------------------------------

function wireKeyboard(ctx, thread, view) {
  const handler = (event) => {
    const { key } = event.detail;
    if (!document.body.contains(view)) {
      document.removeEventListener('cairn:key', handler);
      return;
    }
    const tasks = [...view.querySelectorAll('[data-task]')];
    const current = document.activeElement?.dataset?.task ? document.activeElement : null;
    const index = current ? tasks.indexOf(current) : -1;

    if (key === 'j') {
      tasks[Math.min(tasks.length - 1, index + 1)]?.focus();
    } else if (key === 'k') {
      tasks[Math.max(0, index - 1)]?.focus();
    } else if (key === 'a') {
      event.detail.event.preventDefault();
      const next = nextTask(thread);
      const target = next.task
        ? view.querySelector(`[data-id="${CSS.escape(next.step?.id ?? '')}"] .inline-add .input`)
        : view.querySelector('.inline-add .input');
      if (target) target.focus();
      else toast('Add a stage and a step first.');
    }
  };
  document.addEventListener('cairn:key', handler);
}
