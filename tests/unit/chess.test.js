import test from 'node:test';
import assert from 'node:assert/strict';

import {
  games,
  summary,
  resultsOverTime,
  lessons,
  lessonThemes,
  scoreCurve,
  isLoggable,
} from '../../src/core/chess.js';
import { createEmptyState, makeChessGame } from '../../src/core/schema.js';

const FRI = '2026-08-07';

function fixture(rows) {
  const state = createEmptyState([]);
  for (const row of rows) state.chessGames.push(makeChessGame(row));
  return state;
}

test('a game without a lesson line is not properly logged', () => {
  assert.equal(isLoggable(makeChessGame({ lesson: 'hung a knight on move 14' })), true);
  assert.equal(isLoggable(makeChessGame({ lesson: '' })), false);
  assert.equal(isLoggable(makeChessGame({ lesson: '   ' })), false, 'whitespace is not a lesson');
  assert.equal(isLoggable({}), false);
});

test('games come back newest first', () => {
  const state = fixture([
    { date: '2026-08-01', lesson: 'a' },
    { date: '2026-08-06', lesson: 'b' },
    { date: '2026-07-20', lesson: 'c' },
  ]);
  assert.deepEqual(games(state).map((g) => g.date), ['2026-08-06', '2026-08-01', '2026-07-20']);
});

test('the score counts a draw as half a point, not as a loss', () => {
  const state = fixture([
    { date: '2026-08-01', result: 'win', lesson: 'a' },
    { date: '2026-08-02', result: 'draw', lesson: 'b' },
    { date: '2026-08-03', result: 'loss', lesson: 'c' },
    { date: '2026-08-04', result: 'draw', lesson: 'd' },
  ]);
  const stats = summary(state, { today: FRI });
  assert.equal(stats.played, 4);
  assert.deepEqual({ win: stats.win, draw: stats.draw, loss: stats.loss }, { win: 1, draw: 2, loss: 1 });
  assert.equal(stats.score, 0.5);
});

test('the summary splits by colour and finds the strongest opponent beaten', () => {
  const state = fixture([
    { date: '2026-08-01', colour: 'white', result: 'win', opponentRating: 1400, lesson: 'a' },
    { date: '2026-08-02', colour: 'white', result: 'loss', opponentRating: 1600, lesson: 'b' },
    { date: '2026-08-03', colour: 'black', result: 'win', opponentRating: 1550, lesson: 'c' },
    { date: '2026-08-04', colour: 'black', result: 'loss', lesson: 'd' },
  ]);
  const stats = summary(state, { today: FRI });
  assert.deepEqual(
    { w: stats.byColour.white.win, l: stats.byColour.white.loss },
    { w: 1, l: 1 },
  );
  assert.equal(stats.byColour.black.played, 2);
  assert.equal(stats.strongestBeaten, 1550, 'the 1600 was a loss');
  assert.equal(stats.averageOpponent, 1517, 'unrated games are left out of the average');
});

test('the summary counts games that are missing their lesson line', () => {
  const state = fixture([
    { date: '2026-08-01', lesson: 'a' },
    { date: '2026-08-02', lesson: '' },
  ]);
  assert.equal(summary(state, { today: FRI }).withoutLesson, 1);
  assert.equal(lessons(state).length, 1, 'and leaves it off the lessons page');
});

test('days since the last game is never negative', () => {
  const state = fixture([{ date: '2026-08-06', lesson: 'a' }]);
  assert.equal(summary(state, { today: FRI }).daysSinceLast, 1);
  assert.equal(summary(fixture([]), { today: FRI }).daysSinceLast, null);
});

test('results bucket by Sunday week, and empty weeks stay empty', () => {
  const state = fixture([
    { date: '2026-08-02', result: 'win', lesson: 'a' }, // Sunday opens this week
    { date: '2026-08-06', result: 'loss', lesson: 'b' },
    { date: '2026-08-01', result: 'win', lesson: 'c' }, // Saturday closed the last one
  ]);
  const weeks = resultsOverTime(state, { today: FRI, weeks: 3 });
  assert.deepEqual(weeks.map((w) => w.weekStart), ['2026-07-19', '2026-07-26', '2026-08-02']);
  assert.equal(weeks[0].played, 0, 'a week with no games is kept, not closed up');
  assert.equal(weeks[1].played, 1, 'Sat Aug 1 belongs to the week starting Jul 26');
  assert.equal(weeks[2].played, 2);
  assert.equal(weeks[2].current, true);
});

test('the score curve runs oldest to newest', () => {
  const state = fixture([
    { date: '2026-08-01', result: 'win', lesson: 'a' },
    { date: '2026-08-02', result: 'loss', lesson: 'b' },
    { date: '2026-08-03', result: 'draw', lesson: 'c' },
  ]);
  const curve = scoreCurve(state);
  assert.deepEqual(curve.map((p) => p.points), [1, 1, 1.5]);
  assert.equal(curve[2].rate, 0.5);
});

// --- the lessons, which are the point ---------------------------------------

test('lessons filter on the line and on the opening', () => {
  const state = fixture([
    { date: '2026-08-01', opening: 'Caro-Kann', lesson: 'hung a knight on move 14', lessonId: 1 },
    { date: '2026-08-02', opening: 'Sicilian', lesson: 'drifted in a level endgame' },
  ]);
  assert.equal(lessons(state, { query: 'knight' }).length, 1);
  assert.equal(lessons(state, { query: 'caro' }).length, 1, 'the opening is searchable too');
  assert.equal(lessons(state, { query: '' }).length, 2);
  assert.equal(lessons(state, { query: 'zzz' }).length, 0);
});

test('themes are terms that recur across games, not within one', () => {
  const state = fixture([
    { date: '2026-08-01', lesson: 'hung a knight after a careless trade' },
    { date: '2026-08-02', lesson: 'hung a knight again, same careless pattern' },
    { date: '2026-08-03', lesson: 'endgame technique, endgame technique, endgame technique' },
  ]);
  const themes = lessonThemes(state);
  const byTerm = Object.fromEntries(themes.map((t) => [t.term, t.count]));

  assert.equal(byTerm.knight, 2);
  assert.equal(byTerm.careless, 2);
  // Repeated three times inside a single game — one game, so not a pattern.
  assert.equal(byTerm.endgame, undefined);
  assert.ok(themes.every((t) => t.count >= 2));
});

test('themes skip filler words and anything too short to mean something', () => {
  const state = fixture([
    { date: '2026-08-01', lesson: 'I was too slow in the opening and it was bad' },
    { date: '2026-08-02', lesson: 'I was too slow in the opening again' },
  ]);
  const terms = lessonThemes(state).map((t) => t.term);
  assert.ok(terms.includes('slow'));
  assert.ok(terms.includes('opening'));
  for (const filler of ['was', 'the', 'and', 'too', 'again']) {
    assert.equal(terms.includes(filler), false, `"${filler}" carries no signal`);
  }
});

test('a theme carries the games it came from, so it can be read back', () => {
  const state = fixture([
    { date: '2026-08-01', lesson: 'blundered the exchange' },
    { date: '2026-08-02', lesson: 'blundered a pawn in time trouble' },
  ]);
  const [theme] = lessonThemes(state).filter((t) => t.term === 'blundered');
  assert.equal(theme.count, 2);
  assert.equal(theme.gameIds.length, 2);
});

test('no lessons means no themes rather than an error', () => {
  assert.deepEqual(lessonThemes(createEmptyState([])), []);
  assert.deepEqual(lessons(createEmptyState([])), []);
});
