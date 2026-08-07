// Markdown notes with templates, attachable to anything in a thread.

import { el, empty, confirm, toast, renderMarkdown, openDialog, downloadFile } from '../ui.js';
import { pageHead, attachPicker, parseAttach, describeAttach, editRecord } from './shared.js';
import { makeNote, makeTemplate } from '../../core/schema.js';
import { applyTemplate } from '../../core/templates.js';
import { nowStamp, formatDate, stampToDate } from '../../core/dates.js';

export function title() {
  return 'Notes';
}

export function render(ctx) {
  const noteId = ctx.route.params[0];
  const attachFilter = ctx.route.query.get('attach');
  const notes = [...ctx.state.notes].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const filtered = attachFilter
    ? notes.filter((n) => n.attach && `${n.attach.type}:${n.attach.id}` === attachFilter)
    : notes;
  const active = filtered.find((n) => n.id === noteId) ?? notes.find((n) => n.id === noteId) ?? filtered[0] ?? null;

  return el('div', [
    pageHead('Notes', {
      sub: attachFilter ? `Filtered to ${describeAttach(ctx.state, parseAttach(attachFilter))}` : `${notes.length} note(s)`,
      actions: [
        attachFilter ? el('a.btn.btn--ghost', { href: '#/notes', text: 'Show all' }) : null,
        el('button.btn', { type: 'button', text: 'Templates', onclick: () => manageTemplates(ctx) }),
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'New note',
          onclick: () => newNote(ctx, attachFilter ? parseAttach(attachFilter) : null),
        }),
      ].filter(Boolean),
    }),

    notes.length
      ? el('div.note-layout', [
          el('div.note-list', filtered.length
            ? filtered.map((note) => noteListItem(ctx, note, active))
            : [el('div', { style: { padding: 'var(--sp-3)' } }, [el('span.muted', { text: 'No notes here yet.' })])]),
          active ? noteEditor(ctx, active) : el('div'),
        ])
      : empty(
          'No notes yet',
          'Notes are markdown pages. They can stand alone or attach to a thread, stage, step or task — a daily log against a project, a retrospective against a stage, a write-up against a question.',
          el('button.btn.btn--primary', { type: 'button', text: 'Write the first note', onclick: () => newNote(ctx, null) }),
        ),
  ]);
}

function noteListItem(ctx, note, active) {
  return el('button.note-item', {
    type: 'button',
    'aria-current': active?.id === note.id ? 'true' : null,
    onclick: () => ctx.navigate(`#/notes/${note.id}`),
  }, [
    el('div.note-item__title.clamp-2', { text: note.title || 'Untitled note' }),
    el('div.note-item__meta', {
      text: `${formatDate(stampToDate(note.updatedAt) ?? '')} · ${describeAttach(ctx.state, note.attach)}`,
    }),
  ]);
}

function noteEditor(ctx, note) {
  const titleInput = el('input.input', { value: note.title, placeholder: 'Title' });
  const bodyInput = el('textarea.textarea.textarea--tall', { value: note.body, spellcheck: 'true' });
  const attachSelect = attachPicker(ctx.state, note.attach);
  const preview = el('div.markdown', { html: renderMarkdown(note.body) });
  let previewing = false;

  const save = () => {
    ctx.commit('edit note', () => {
      note.title = titleInput.value.trim() || 'Untitled note';
      note.body = bodyInput.value;
      note.attach = parseAttach(attachSelect.value);
      note.updatedAt = nowStamp();
    }, { undoable: false });
  };

  let timer = null;
  const scheduleSave = () => {
    clearTimeout(timer);
    // Debounced: typing should not push a store write (and a re-render) per key.
    timer = setTimeout(save, 600);
  };
  titleInput.addEventListener('input', scheduleSave);
  bodyInput.addEventListener('input', () => {
    preview.innerHTML = renderMarkdown(bodyInput.value);
    scheduleSave();
  });
  attachSelect.addEventListener('change', save);

  const toggle = el('button.btn.btn--sm', {
    type: 'button',
    text: 'Preview',
    onclick: () => {
      previewing = !previewing;
      toggle.textContent = previewing ? 'Edit' : 'Preview';
      bodyInput.classList.toggle('hidden', previewing);
      preview.classList.toggle('hidden', !previewing);
    },
  });
  preview.classList.add('hidden');

  return el('div.card', [
    el('div.card__body.stack', [
      titleInput,
      el('div.row', [
        el('span.field__label', { text: 'Attached to' }),
        attachSelect,
      ]),
      el('div.row', [
        toggle,
        el('button.btn.btn--ghost.btn--sm', {
          type: 'button',
          text: 'Export .md',
          onclick: () => downloadFile(`${(note.title || 'note').replace(/[^\w-]+/g, '-')}.md`, note.body, 'text/markdown'),
        }),
        el('div.spacer'),
        el('button.btn.btn--ghost.btn--sm.btn--danger', {
          type: 'button',
          text: 'Delete',
          onclick: async () => {
            const answer = await confirm({
              title: 'Delete this note?',
              message: `"${note.title || 'Untitled note'}" will be removed. This can be undone.`,
              confirmLabel: 'Delete',
            });
            if (answer !== 'confirm') return;
            clearTimeout(timer);
            ctx.commit('delete note', (state) => {
              const index = state.notes.findIndex((n) => n.id === note.id);
              if (index >= 0) state.notes.splice(index, 1);
            });
            ctx.navigate('#/notes');
          },
        }),
      ]),
      bodyInput,
      preview,
    ]),
  ]);
}

async function newNote(ctx, attach) {
  const templates = ctx.state.noteTemplates;
  const values = await editRecord({
    title: 'New note',
    submitLabel: 'Create',
    fields: [
      { key: 'title', label: 'Title', required: true },
      {
        key: 'templateId',
        label: 'Template',
        type: 'select',
        options: [{ value: '', label: 'Blank' }, ...templates.map((t) => ({ value: t.id, label: t.name }))],
      },
    ],
  });
  if (!values) return;

  let noteId = null;
  ctx.commit('create note', (state) => {
    const template = state.noteTemplates.find((t) => t.id === values.templateId);
    const note = makeNote({
      title: values.title,
      body: template ? applyTemplate(template.body, { title: values.title, date: ctx.today }) : '',
      templateId: template?.id ?? null,
      attach,
    });
    state.notes.push(note);
    noteId = note.id;
  }, { undoable: false });
  ctx.navigate(`#/notes/${noteId}`);
}

async function manageTemplates(ctx) {
  const list = el('div.stack--tight.stack');

  const draw = () => {
    list.replaceChildren();
    for (const template of ctx.state.noteTemplates) {
      list.appendChild(
        el('div.row.row--between', [
          el('div', [
            el('strong', { text: template.name }),
            template.builtin ? el('span.section__meta', { text: ' built-in' }) : null,
          ]),
          el('div.row', [
            el('button.btn.btn--sm', {
              type: 'button',
              text: 'Edit',
              onclick: async () => {
                const values = await editRecord({
                  title: 'Template',
                  wide: true,
                  fields: [
                    { key: 'name', label: 'Name', required: true },
                    {
                      key: 'body',
                      label: 'Body',
                      type: 'textarea',
                      rows: 14,
                      hint: 'Use {{title}} and {{date}} — they are filled in when the note is created.',
                    },
                  ],
                  values: template,
                });
                if (!values) return;
                ctx.commit('edit template', () => Object.assign(template, values), { undoable: false });
                draw();
              },
            }),
            el('button.btn.btn--ghost.btn--sm', {
              type: 'button',
              text: 'Delete',
              onclick: () => {
                ctx.commit('delete template', (state) => {
                  const index = state.noteTemplates.findIndex((t) => t.id === template.id);
                  if (index >= 0) state.noteTemplates.splice(index, 1);
                });
                draw();
              },
            }),
          ]),
        ]),
      );
    }
  };
  draw();

  await openDialog({
    title: 'Note templates',
    wide: true,
    body: el('div.stack', [
      list,
      el('button.btn', {
        type: 'button',
        text: 'New template',
        onclick: async () => {
          const values = await editRecord({
            title: 'New template',
            fields: [
              { key: 'name', label: 'Name', required: true },
              { key: 'body', label: 'Body', type: 'textarea', rows: 12 },
            ],
          });
          if (!values) return;
          ctx.commit('add template', (state) => {
            state.noteTemplates.push(makeTemplate({ name: values.name, body: values.body }));
          }, { undoable: false });
          draw();
        },
      }),
    ]),
    footer: (close) => [el('button.btn', { type: 'button', text: 'Done', onclick: () => close() })],
  });
}
