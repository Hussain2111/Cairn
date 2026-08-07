// Search across everything.

import { el, tag, empty } from '../ui.js';
import { pageHead } from './shared.js';
import { search, groupByType } from '../../core/search.js';

export function title() {
  return 'Search';
}

const TYPE_LABEL = {
  task: 'Tasks',
  step: 'Steps',
  stage: 'Stages',
  thread: 'Threads',
  note: 'Notes',
  question: 'Questions',
  application: 'Applications',
  outreach: 'Outreach',
  reading: 'Reading',
  habit: 'Habits',
};

export function render(ctx) {
  const query = ctx.route.query.get('q') ?? '';
  const results = search(ctx.state, query);
  const groups = groupByType(results);

  const box = el('input.input', {
    type: 'search',
    value: query,
    placeholder: 'Search tasks, notes, questions, applications…',
    autofocus: true,
    'aria-label': 'Search',
  });

  let timer = null;
  box.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const next = box.value.trim();
      // replace() keeps the browser's back button useful while typing.
      location.replace(next ? `#/search?q=${encodeURIComponent(next)}` : '#/search');
    }, 180);
  });
  box.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const first = document.querySelector('.result');
      first?.click();
    }
    if (event.key === 'Escape') {
      box.value = '';
      location.replace('#/search');
    }
  });

  requestAnimationFrame(() => {
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  });

  return el('div', [
    pageHead('Search', { sub: query ? `${results.length} result(s) for “${query}”` : 'Everything is searchable, including what you hesitated on.' }),
    box,
    el('div', { style: { marginTop: 'var(--sp-4)' } }, [
      query.trim().length < 2
        ? el('p.muted', { text: 'Type at least two characters.' })
        : results.length
          ? el('div.stack', [...groups.entries()].map(([type, rows]) =>
              el('section.section', [
                el('div.section__head', [
                  el('h2.section__title', { text: TYPE_LABEL[type] ?? type }),
                  el('div.section__rule'),
                  el('span.section__meta', { text: String(rows.length) }),
                ]),
                el('div.card', rows.map((result) => resultRow(ctx, result))),
              ])))
          : empty('No matches', `Nothing in your data mentions “${query}”.`),
    ]),
  ]);
}

function resultRow(ctx, result) {
  return el('button.result', {
    type: 'button',
    onclick: () => ctx.navigate(result.route),
  }, [
    el('div.row', [
      el('span.result__title.break', { text: result.title || 'Untitled' }),
      result.context ? tag(result.context) : null,
    ]),
    result.snippet ? el('div.result__snippet.clamp-2', { text: result.snippet }) : null,
  ]);
}
