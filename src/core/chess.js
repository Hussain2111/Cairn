// Chess games.
//
// Deliberately not a chess program. There is no board, no engine and no move
// list, because Chess.com and Lichess already do that better. What is kept here
// is the one thing they do not keep: a line, written by hand after each game,
// saying what went wrong or what was learned. Over enough games those lines
// cluster, and the clusters are the study list.

import { todayISO, startOfWeek, addDays, withinRange, diffDays } from './dates.js';
import { CHESS_RESULTS, CHESS_COLOURS } from './schema.js';

export const RESULT_SCORE = { win: 1, draw: 0.5, loss: 0 };

/** Newest first. */
export function games(state) {
  return [...(state?.chessGames ?? [])].sort(
    (a, b) => String(b.date).localeCompare(String(a.date)) ||
      String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')),
  );
}

export function gameById(state, id) {
  return (state?.chessGames ?? []).find((g) => g.id === id) ?? null;
}

/** The lesson line is mandatory. This is the check the editor enforces. */
export function isLoggable(game) {
  return typeof game?.lesson === 'string' && game.lesson.trim().length > 0;
}

function tally(list) {
  const counts = { win: 0, loss: 0, draw: 0 };
  for (const game of list) {
    if (counts[game.result] !== undefined) counts[game.result] += 1;
  }
  const played = counts.win + counts.loss + counts.draw;
  return {
    ...counts,
    played,
    // Score, not win rate: a draw is half a point, which is how chess counts.
    score: played ? (counts.win + counts.draw * 0.5) / played : 0,
  };
}

export function summary(state, { today = todayISO(), recent = 10 } = {}) {
  const all = games(state);
  const byColour = {};
  for (const colour of CHESS_COLOURS) {
    byColour[colour] = tally(all.filter((g) => g.colour === colour));
  }

  // `Number(null)` is 0 and 0 is finite, so an unrated game would otherwise
  // drag the average down as if it were played against a beginner.
  const rated = all.filter((g) => g.opponentRating !== null && g.opponentRating !== undefined &&
    g.opponentRating !== '' && Number.isFinite(Number(g.opponentRating)));
  const ratings = rated.map((g) => Number(g.opponentRating));

  const lastPlayed = all[0]?.date ?? null;
  return {
    total: all.length,
    ...tally(all),
    byColour,
    recent: tally(all.slice(0, recent)),
    recentCount: Math.min(recent, all.length),
    averageOpponent: ratings.length ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length) : null,
    strongestBeaten: rated
      .filter((g) => g.result === 'win')
      .reduce((best, g) => (best === null || Number(g.opponentRating) > best ? Number(g.opponentRating) : best), null),
    lastPlayed,
    daysSinceLast: lastPlayed ? Math.max(0, -(diffDays(today, lastPlayed) ?? 0)) : null,
    withoutLesson: all.filter((g) => !isLoggable(g)).length,
  };
}

/**
 * Results bucketed by week, oldest first, with empty weeks kept so a gap in
 * play reads as a gap rather than being closed up.
 */
export function resultsOverTime(state, { today = todayISO(), weeks = 12 } = {}) {
  const thisWeek = startOfWeek(today);
  const all = games(state);
  const out = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const start = addDays(thisWeek, -7 * i);
    const end = addDays(start, 6);
    const inWeek = all.filter((g) => withinRange(g.date, start, end));
    out.push({ weekStart: start, weekEnd: end, current: start === thisWeek, ...tally(inWeek) });
  }
  return out;
}

/** Cumulative score over the games in order, for a running-form line. */
export function scoreCurve(state) {
  const ordered = games(state).slice().reverse();
  let points = 0;
  return ordered.map((game, i) => {
    points += RESULT_SCORE[game.result] ?? 0;
    return { game, index: i + 1, points, rate: points / (i + 1) };
  });
}

/** Every lesson line, newest first, optionally filtered. */
export function lessons(state, { query = '' } = {}) {
  const needle = String(query).trim().toLowerCase();
  return games(state)
    .filter(isLoggable)
    .filter((g) => !needle || g.lesson.toLowerCase().includes(needle) ||
      String(g.opening ?? '').toLowerCase().includes(needle))
    .map((game) => ({ game, lesson: game.lesson.trim() }));
}

// Words that carry no signal about what went wrong.
const STOPWORDS = new Set([
  'a', 'an', 'and', 'the', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'my', 'me', 'i',
  'it', 'is', 'was', 'were', 'be', 'been', 'am', 'are', 'that', 'this', 'then', 'than',
  'but', 'so', 'too', 'not', 'no', 'up', 'out', 'off', 'as', 'by', 'from', 'into', 'his',
  'her', 'their', 'they', 'he', 'she', 'we', 'you', 'had', 'have', 'has', 'did', 'do',
  'got', 'get', 'just', 'very', 'more', 'much', 'again', 'when', 'because', 'if', 'all',
  'him', 'them', 'its', 'about', 'after', 'before', 'over', 'under', 'game', 'games',
]);

/**
 * Terms that recur across lesson lines. This is what makes the page worth
 * opening at fifty games: five separate notes about hanging a piece read as one
 * problem only when they are counted.
 */
export function lessonThemes(state, { minCount = 2, limit = 12 } = {}) {
  const counts = new Map();
  for (const { game, lesson } of lessons(state)) {
    // Count each term once per game, so one long rambling note cannot
    // manufacture a theme by itself.
    const seen = new Set();
    for (const raw of lesson.toLowerCase().split(/[^a-z0-9'-]+/)) {
      const word = raw.replace(/^['-]+|['-]+$/g, '');
      if (word.length < 4 || STOPWORDS.has(word) || seen.has(word)) continue;
      seen.add(word);
      const entry = counts.get(word) ?? { term: word, count: 0, gameIds: [] };
      entry.count += 1;
      entry.gameIds.push(game.id);
      counts.set(word, entry);
    }
  }
  return [...counts.values()]
    .filter((e) => e.count >= minCount)
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term))
    .slice(0, limit);
}

export function isValidResult(value) {
  return CHESS_RESULTS.includes(value);
}
