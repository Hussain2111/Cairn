// Chess.
//
// The smallest thing that could be useful: a row per game, and one line saying
// what went wrong or what was learned. No board, no engine, no move list, no
// PGN import — the sites you played on already do all of that, and better.
//
// The lesson line is the reason this view exists, so it is the one field the
// editor will not let you skip. Everything else here is arranged to make those
// lines readable in bulk.

import { el, tag, empty, confirm, toast, input } from '../ui.js';
import { pageHead, statTile, editRecord } from './shared.js';
import {
  games,
  summary,
  resultsOverTime,
  lessons,
  lessonThemes,
  isLoggable,
} from '../../core/chess.js';
import { makeChessGame, CHESS_COLOURS, CHESS_RESULTS, CHESS_VENUES } from '../../core/schema.js';
import { formatDate, relativeDay } from '../../core/dates.js';

export function title(ctx) {
  return ctx.route.params[0] === 'lessons' ? 'Chess lessons' : 'Chess';
}

export function render(ctx) {
  return ctx.route.params[0] === 'lessons' ? renderLessons(ctx) : renderGames(ctx);
}

// --- games ------------------------------------------------------------------

function renderGames(ctx) {
  const all = games(ctx.state);
  const stats = summary(ctx.state, { today: ctx.today });

  return el('div', [
    pageHead('Chess', {
      sub: all.length
        ? `${stats.played} game${stats.played === 1 ? '' : 's'} · ${stats.win}W ${stats.draw}D ${stats.loss}L${stats.lastPlayed ? ` · last played ${relativeDay(stats.lastPlayed, ctx.today)}` : ''}`
        : 'A row per game, and one line about what to fix.',
      actions: [
        el('button.btn.btn--primary', { type: 'button', text: 'Log a game', onclick: () => editGame(ctx, null) }),
        el('a.btn', { href: '#/chess/lessons', text: 'Lessons' }),
      ],
    }),

    all.length
      ? el('div.stack', [
          el('div.grid.grid--4', [
            statTile(stats.played, 'games'),
            statTile(`${Math.round(stats.score * 100)}%`, 'score', stats.score >= 0.5 ? 'teal' : ''),
            statTile(
              `${stats.recent.win}-${stats.recent.draw}-${stats.recent.loss}`,
              `last ${stats.recentCount} (W-D-L)`,
            ),
            statTile(stats.averageOpponent ?? '—', 'average opponent'),
          ]),

          section('Results over time', 'by week', [
            resultsChart(resultsOverTime(ctx.state, { today: ctx.today, weeks: 12 })),
            el('div.row', [
              legend('win', 'teal'),
              legend('draw', ''),
              legend('loss', 'danger'),
            ]),
            el('div.row', [
              tag(`as white: ${describe(stats.byColour.white)}`),
              tag(`as black: ${describe(stats.byColour.black)}`),
              stats.strongestBeaten ? tag(`best win vs ${stats.strongestBeaten}`, 'teal') : null,
            ]),
          ]),

          section('Games', `${all.length}`, [
            el('div.stack--tight.stack', all.slice(0, 100).map((game) => gameRow(ctx, game))),
            all.length > 100 ? el('p.muted', { text: `…and ${all.length - 100} older games.` }) : null,
          ]),
        ])
      : empty(
          'No games logged',
          'Log a game the moment it ends, while you still remember what went wrong. The one required field is that line — over fifty games the lines cluster, and the clusters are the study list.',
          el('button.btn.btn--primary', { type: 'button', text: 'Log the first game', onclick: () => editGame(ctx, null) }),
        ),
  ]);
}

const describe = (t) => `${t.win}-${t.draw}-${t.loss}`;

function legend(label, variant) {
  return el('span.row.legend', [
    el('span.legend__swatch' + (variant ? `.legend__swatch--${variant}` : '')),
    el('span.section__meta', { text: label }),
  ]);
}

const RESULT_VARIANT = { win: 'teal', loss: 'danger', draw: '' };

function gameRow(ctx, game) {
  return el('div.card.game', { dataset: { result: game.result } }, [
    el('div.card__body.stack--tight.stack', [
      el('div.row.row--between', [
        el('div.row', [
          el('span.mono.faint', { text: formatDate(game.date) }),
          tag(game.result, RESULT_VARIANT[game.result]),
          tag(`as ${game.colour}`),
          game.opening ? el('span.break', { text: game.opening }) : null,
        ]),
        el('div.row', [
          game.opponentRating ? tag(`vs ${game.opponentRating}`) : null,
          game.venue ? el('span.section__meta', { text: game.venue }) : null,
          game.url
            ? el('a.btn.btn--ghost.btn--sm', {
                href: game.url,
                target: '_blank',
                rel: 'noopener noreferrer',
                text: 'View',
                'aria-label': `View the game played on ${game.date}`,
              })
            : null,
          el('button.btn.btn--ghost.btn--sm', {
            type: 'button',
            text: 'Edit',
            'aria-label': `Edit the game played on ${game.date}`,
            onclick: () => editGame(ctx, game),
          }),
        ]),
      ]),
      isLoggable(game)
        ? el('div.hesitation.break', { text: game.lesson })
        : el('div.row', [tag('no lesson recorded', 'amber')]),
    ]),
  ]);
}

function resultsChart(weeks) {
  const peak = Math.max(1, ...weeks.map((w) => w.played));
  return el('div.results', weeks.map((week) =>
    el('div.results__col' + (week.current ? '.results__col--current' : ''), {
      title: `Week of ${formatDate(week.weekStart)}: ${week.played ? describe(week) : 'no games'}`,
    }, [
      el('div.results__stack', [
        bar(week.loss, peak, 'loss'),
        bar(week.draw, peak, 'draw'),
        bar(week.win, peak, 'win'),
      ]),
      el('div.results__label.mono.faint', { text: formatDate(week.weekStart) }),
    ])));
}

function bar(count, peak, kind) {
  if (!count) return null;
  return el(`div.results__bar.results__bar--${kind}`, {
    style: { height: `${(count / peak) * 100}%` },
  });
}

// --- lessons ----------------------------------------------------------------

function renderLessons(ctx) {
  const query = ctx.route.query.get('q') ?? '';
  const all = lessons(ctx.state);
  const shown = lessons(ctx.state, { query });
  const themes = lessonThemes(ctx.state);

  const box = input({
    value: query,
    placeholder: 'Filter the lines…',
    'aria-label': 'Filter lessons',
  });
  // Navigating on change keeps the filter in the URL, so a theme chip and a
  // typed filter are the same thing.
  box.addEventListener('change', () => {
    ctx.navigate(box.value.trim() ? `#/chess/lessons?q=${encodeURIComponent(box.value.trim())}` : '#/chess/lessons');
  });

  return el('div', [
    el('a.crumb', { href: '#/chess', text: '← Chess' }),
    pageHead('Lessons', {
      sub: `${all.length} line${all.length === 1 ? '' : 's'} written after ${all.length === 1 ? 'a game' : 'games'}. Read them together, not one at a time.`,
      actions: [el('button.btn', { type: 'button', text: 'Log a game', onclick: () => editGame(ctx, null) })],
    }),

    all.length
      ? el('div.stack', [
          themes.length
            ? el('div.stack--tight.stack', [
                el('span.field__label', { text: 'What keeps coming up' }),
                el('div.row', themes.map((theme) =>
                  el('a.tag' + (query === theme.term ? '.tag--amber' : ''), {
                    href: `#/chess/lessons?q=${encodeURIComponent(theme.term)}`,
                    text: `${theme.term} ${theme.count}`,
                  }))),
                el('p.field__hint', {
                  text: 'Words that appear in more than one game. Five separate notes about hanging a piece are one problem, not five.',
                }),
              ])
            : el('p.field__hint', {
                text: 'Nothing repeats yet. Themes appear once a word turns up in more than one game.',
              }),

          el('div.row', [
            box,
            query
              ? el('a.btn.btn--ghost.btn--sm', { href: '#/chess/lessons', text: 'Clear' })
              : null,
          ]),

          shown.length
            ? el('div.stack--tight.stack', shown.map(({ game, lesson }) =>
                el('div.card', [
                  el('div.card__body.stack--tight.stack', [
                    el('p.break', { text: lesson }),
                    el('div.row', [
                      el('span.mono.faint', { text: formatDate(game.date) }),
                      tag(game.result, RESULT_VARIANT[game.result]),
                      tag(`as ${game.colour}`),
                      game.opening ? el('span.section__meta', { text: game.opening }) : null,
                      el('button.btn.btn--ghost.btn--sm', {
                        type: 'button',
                        text: 'Edit',
                        'aria-label': `Edit the game played on ${game.date}`,
                        onclick: () => editGame(ctx, game),
                      }),
                    ]),
                  ]),
                ])))
            : el('p.field__hint', { text: `Nothing matches "${query}".` }),
        ])
      : empty(
          'No lessons yet',
          'Every logged game carries one. This page is where they add up.',
          el('button.btn.btn--primary', { type: 'button', text: 'Log a game', onclick: () => editGame(ctx, null) }),
        ),
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

// --- editing ----------------------------------------------------------------

async function editGame(ctx, game) {
  const isNew = !game;
  const values = await editRecord({
    title: isNew ? 'Log a game' : 'Game',
    submitLabel: isNew ? 'Log it' : 'Save',
    deletable: !isNew,
    wide: true,
    fields: [
      { key: 'date', label: 'Date', type: 'date', default: ctx.today },
      { key: 'colour', label: 'Played as', type: 'select', options: CHESS_COLOURS, default: 'white' },
      { key: 'result', label: 'Result', type: 'select', options: CHESS_RESULTS, default: 'win' },
      { key: 'venue', label: 'Where', type: 'select', options: CHESS_VENUES, default: 'chess.com' },
      { key: 'opponentRating', label: 'Opponent rating', type: 'number', hint: 'Leave blank if you do not know it.' },
      { key: 'url', label: 'Link to the game', placeholder: 'https://…' },
      { key: 'opening', label: 'Opening', placeholder: 'e.g. Caro-Kann, advance variation' },
      {
        key: 'lesson',
        label: 'What went wrong, or what you learned',
        type: 'textarea',
        rows: 3,
        required: true,
        requiredMessage: 'This is the field the whole view exists for. One line — a game logged without it is not logged.',
        hint: 'One line. Concrete beats profound: "traded into a lost endgame a pawn down" tells you more in six months than "played badly".',
      },
    ],
    values: game ?? {},
  });
  if (!values) return;

  if (values.__delete) {
    const answer = await confirm({
      title: 'Delete this game?',
      message: `The game on ${game.date} and its lesson will be removed. This can be undone.`,
      confirmLabel: 'Delete',
    });
    if (answer !== 'confirm') return;
    ctx.commit('delete chess game', (state) => {
      const index = state.chessGames.findIndex((g) => g.id === game.id);
      if (index >= 0) state.chessGames.splice(index, 1);
    });
    return;
  }

  const patch = {
    date: values.date || ctx.today,
    colour: values.colour,
    result: values.result,
    venue: values.venue,
    opponentRating: values.opponentRating,
    url: values.url,
    opening: values.opening,
    lesson: values.lesson,
  };

  if (isNew) {
    ctx.commit('log chess game', (state) => {
      state.chessGames.push(makeChessGame(patch));
    }, { undoable: false });
    toast('Game logged.', { action: { label: 'Undo', onClick: () => { ctx.store.undo(); ctx.render(); } } });
    return;
  }
  ctx.commit('edit chess game', () => Object.assign(game, patch), { undoable: false });
}
