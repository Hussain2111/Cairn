// Pieces shared between views: page headers, link editing, the note-attachment
// picker, and small formatters.

import { el, field, input, select, textarea, openDialog, tag } from '../ui.js';
import { formatDate, relativeDay, diffDays } from '../../core/dates.js';
import { makeLink } from '../../core/schema.js';

export function pageHead(title, { sub = null, actions = [] } = {}) {
  return el('header.page-head', [
    el('div', [
      el('h1.page-title', { text: title }),
      sub ? el('p.page-sub', { text: sub }) : null,
    ]),
    actions.length ? el('div.page-actions', actions) : null,
  ]);
}

export function statTile(value, label, variant = '') {
  return el('div.stat' + (variant ? `.stat--${variant}` : ''), [
    el('div.stat__value', { text: String(value) }),
    el('div.stat__label', { text: label }),
  ]);
}

/**
 * A due date rendered with the right urgency colour.
 *
 * `done` matters: once a task is ticked its due date is history, not a
 * deadline. Measuring it against today would keep shouting "3d overdue" at
 * something already finished — and in the amber-as-signal-lamp scheme, the
 * loudest thing on a completed row would be the one thing needing no action.
 */
export function dueTag(due, today, { done = false } = {}) {
  if (!due) return null;
  if (done) return tag(`due ${formatDate(due)}`);
  const delta = diffDays(today, due);
  const variant = delta === null ? '' : delta < 0 ? 'danger' : delta <= 2 ? 'amber' : '';
  return tag(`${formatDate(due)} · ${relativeDay(due, today)}`, variant);
}

/**
 * Editor for a list of links, used by threads, stages, steps and tasks.
 * Mutates `owner.links` through the supplied commit function.
 */
export function linkEditor(links, onChange) {
  const list = el('div.stack--tight.stack');

  const draw = () => {
    list.replaceChildren();
    if (!links.length) {
      list.appendChild(el('span.field__hint', { text: 'No links yet.' }));
    }
    for (const link of links) {
      list.appendChild(
        el('div.row', [
          el('a.tag', {
            href: link.url,
            target: '_blank',
            rel: 'noopener noreferrer',
            text: link.label?.trim() || link.url,
            title: link.url,
          }),
          el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            text: 'Remove',
            onclick: () => {
              const index = links.indexOf(link);
              if (index >= 0) links.splice(index, 1);
              draw();
              onChange?.();
            },
          }),
        ]),
      );
    }
  };

  const url = input({ placeholder: 'https://…', type: 'url' });
  const label = input({ placeholder: 'Label (optional)' });
  const add = el('button.btn.btn--sm', {
    type: 'button',
    text: 'Add link',
    onclick: () => {
      const value = url.value.trim();
      if (!value) return;
      links.push(makeLink({ url: value, label: label.value.trim() }));
      url.value = '';
      label.value = '';
      draw();
      onChange?.();
    },
  });

  draw();
  return el('div.stack--tight.stack', [
    el('span.field__label', { text: 'Links' }),
    list,
    el('div.row', [url, label, add]),
  ]);
}

/** Thread / stage / step / task picker used when attaching a note. */
export function attachPicker(state, current) {
  const options = [{ value: '', label: 'Standalone' }];
  for (const thread of state.threads) {
    options.push({ value: `thread:${thread.id}`, label: `Thread — ${thread.name}` });
    thread.stages.forEach((stage, si) => {
      options.push({ value: `stage:${stage.id}`, label: `  ${si + 1}. ${stage.title}` });
      for (const step of stage.steps) {
        options.push({ value: `step:${step.id}`, label: `    · ${step.title}` });
        for (const task of step.tasks) {
          options.push({ value: `task:${task.id}`, label: `      ▸ ${task.title}` });
        }
      }
    });
  }
  const value = current ? `${current.type}:${current.id}` : '';
  return select(options, value);
}

export function parseAttach(value) {
  if (!value) return null;
  const [type, id] = value.split(':');
  return type && id ? { type, id } : null;
}

export function describeAttach(state, attach) {
  if (!attach) return 'Standalone';
  for (const thread of state.threads) {
    if (attach.type === 'thread' && thread.id === attach.id) return thread.name;
    for (const stage of thread.stages) {
      if (attach.type === 'stage' && stage.id === attach.id) return `${thread.name} › ${stage.title}`;
      for (const step of stage.steps) {
        if (attach.type === 'step' && step.id === attach.id) return `${thread.name} › ${step.title}`;
        for (const task of step.tasks) {
          if (attach.type === 'task' && task.id === attach.id) return `${thread.name} › ${task.title}`;
        }
      }
    }
  }
  return 'Attached to something that no longer exists';
}

/**
 * Generic record editor: an array of field descriptors rendered into a dialog.
 * Returns the collected values, or null if cancelled.
 */
export function editRecord({ title, fields, values = {}, submitLabel = 'Save', wide = false, deletable = false }) {
  const controls = new Map();
  const errorNode = el('div.field__error');

  const body = el('div.stack', fields.map((spec) => {
    const value = values[spec.key] ?? spec.default ?? '';
    let control;
    if (spec.type === 'textarea') control = textarea({ value, rows: spec.rows ?? 4, placeholder: spec.placeholder ?? '' });
    else if (spec.type === 'select') control = select(spec.options, value);
    else if (spec.type === 'checkbox') {
      control = el('input', { type: 'checkbox', checked: !!values[spec.key] });
      controls.set(spec.key, control);
      return el('label.check', [control, el('span', { text: spec.label })]);
    } else {
      control = input({ type: spec.type ?? 'text', value: value === null ? '' : value, placeholder: spec.placeholder ?? '' });
    }
    controls.set(spec.key, control);
    return field(spec.label, control, { hint: spec.hint });
  }));

  return openDialog({
    title,
    wide,
    body: [body, errorNode],
    footer: (close) => {
      const submit = () => {
        const out = {};
        for (const spec of fields) {
          const control = controls.get(spec.key);
          let value = spec.type === 'checkbox' ? control.checked : control.value;
          if (typeof value === 'string') value = value.trim();
          if (spec.required && !value) {
            // `requiredMessage` is for the fields where "X is required" does not
            // explain why — the GRE portable move being the reason it exists.
            errorNode.textContent = spec.requiredMessage ?? `${spec.label} is required.`;
            control.focus();
            return;
          }
          if (spec.type === 'number') value = value === '' ? null : Number(value);
          if (spec.type === 'date') value = value || null;
          out[spec.key] = value;
        }
        close(out);
      };
      body.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && event.target.tagName !== 'TEXTAREA') {
          event.preventDefault();
          submit();
        }
      });
      return [
        // Resolves with { __delete: true } so callers can run their own
        // confirm step rather than deleting from inside the editor.
        deletable ? el('button.btn.btn--danger', { type: 'button', text: 'Delete', onclick: () => close({ __delete: true }) }) : null,
        el('div.spacer'),
        el('button.btn', { type: 'button', text: 'Cancel', onclick: () => close(null) }),
        el('button.btn.btn--primary', { type: 'button', text: submitLabel, onclick: submit }),
      ];
    },
  });
}

export function threadOptions(state, { includeNone = true, noneLabel = 'No thread' } = {}) {
  const options = includeNone ? [{ value: '', label: noneLabel }] : [];
  for (const thread of state.threads.filter((t) => !t.archived)) {
    options.push({ value: thread.id, label: thread.name });
  }
  return options;
}

export function findThread(state, id) {
  return state.threads.find((t) => t.id === id) ?? null;
}
