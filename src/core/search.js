// Search across tasks, stages, steps, threads, notes, questions, applications,
// outreach, reading and the gym.

import { walkTasks } from './threads.js';

function norm(value) {
  return String(value ?? '').toLowerCase();
}

function score(haystack, needle) {
  const text = norm(haystack);
  if (!text) return 0;
  const index = text.indexOf(needle);
  if (index < 0) return 0;
  if (text === needle) return 100;
  if (index === 0) return 60;
  return 30;
}

/** A ranking bonus, but only for something that actually matched. */
function boost(value, amount) {
  return value > 0 ? value + amount : 0;
}

function snippet(text, needle, length = 140) {
  const raw = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const index = norm(raw).indexOf(needle);
  if (index < 0) return raw.slice(0, length);
  const start = Math.max(0, index - 40);
  return (start ? '…' : '') + raw.slice(start, start + length) + (raw.length > start + length ? '…' : '');
}

/**
 * @returns {Array<{type,id,title,context,snippet,route,score}>} ranked results.
 */
export function search(state, query, { limit = 80 } = {}) {
  const needle = norm(query).trim();
  if (needle.length < 2) return [];
  const results = [];

  const push = (result) => {
    if (result.score > 0) results.push(result);
  };

  for (const thread of state?.threads ?? []) {
    const base = Math.max(score(thread.name, needle), score(thread.description, needle), score(thread.notes, needle));
    push({
      type: 'thread',
      id: thread.id,
      title: thread.name,
      context: thread.type,
      snippet: snippet(thread.description || thread.notes, needle),
      route: `#/thread/${thread.id}`,
      score: boost(base, 5),
    });

    for (const stage of thread.stages ?? []) {
      push({
        type: 'stage',
        id: stage.id,
        title: stage.title,
        context: thread.name,
        snippet: snippet(stage.doneWhen || stage.notes, needle),
        route: `#/thread/${thread.id}?focus=${stage.id}`,
        score: Math.max(score(stage.title, needle), score(stage.doneWhen, needle), score(stage.notes, needle)),
      });
      for (const step of stage.steps ?? []) {
        push({
          type: 'step',
          id: step.id,
          title: step.title,
          context: `${thread.name} › ${stage.title}`,
          snippet: snippet(step.notes, needle),
          route: `#/thread/${thread.id}?focus=${step.id}`,
          score: Math.max(score(step.title, needle), score(step.notes, needle)),
        });
      }
    }

    for (const { task, stage } of walkTasks(thread)) {
      push({
        type: 'task',
        id: task.id,
        title: task.title,
        context: `${thread.name} › ${stage.title}`,
        snippet: snippet(task.notes, needle),
        route: `#/thread/${thread.id}?focus=${task.id}`,
        score: Math.max(score(task.title, needle), score(task.notes, needle)) + (task.done ? -5 : 0),
      });
    }
  }

  for (const note of state?.notes ?? []) {
    push({
      type: 'note',
      id: note.id,
      title: note.title || 'Untitled note',
      context: 'note',
      snippet: snippet(note.body, needle),
      route: `#/notes/${note.id}`,
      score: Math.max(boost(score(note.title, needle), 5), score(note.body, needle)),
    });
  }

  for (const q of state?.questions ?? []) {
    const fieldText = Object.values(q.fields ?? {}).join(' ');
    const hesitations = (q.attempts ?? []).map((a) => a.hesitation).join(' ');
    push({
      type: 'question',
      id: q.id,
      title: q.title,
      context: q.bank,
      snippet: snippet(hesitations || q.notes, needle),
      route: `#/questions/${q.bank}?focus=${q.id}`,
      score: Math.max(
        boost(score(q.title, needle), 5),
        score((q.tags ?? []).join(' '), needle),
        score(fieldText, needle),
        score(q.notes, needle),
        score(hesitations, needle),
      ),
    });
  }

  for (const app of state?.applications ?? []) {
    push({
      type: 'application',
      id: app.id,
      title: `${app.role || 'Role'} — ${app.company || 'Company'}`,
      context: app.status,
      snippet: snippet(app.notes || app.nextAction, needle),
      route: `#/pipelines?focus=${app.id}`,
      score: Math.max(
        boost(score(app.company, needle), 5),
        score(app.role, needle),
        score(app.notes, needle),
        score(app.resumeVersion, needle),
        score(app.referral, needle),
      ),
    });
  }

  for (const item of state?.outreach ?? []) {
    push({
      type: 'outreach',
      id: item.id,
      title: item.name || 'Contact',
      context: item.company,
      snippet: snippet(item.notes, needle),
      route: `#/pipelines?tab=outreach&focus=${item.id}`,
      score: Math.max(boost(score(item.name, needle), 5), score(item.company, needle), score(item.notes, needle)),
    });
  }

  for (const book of state?.reading ?? []) {
    const marks = (book.bookmarks ?? []).map((mark) => mark.note).filter(Boolean).join(' ');
    push({
      type: 'reading',
      id: book.id,
      title: book.title,
      context: book.author,
      snippet: snippet(book.notes || marks, needle),
      route: `#/reading/${book.id}`,
      score: Math.max(
        boost(score(book.title, needle), 5),
        score(book.author, needle),
        score(book.notes, needle),
        // Bookmark notes are the reason a bookmark is worth making, so they are
        // findable the same way a hesitation is.
        score(marks, needle),
      ),
    });
  }

  for (const game of state?.chessGames ?? []) {
    push({
      type: 'chess',
      id: game.id,
      title: game.lesson || `${game.result} as ${game.colour}`,
      context: [game.opening, game.venue].filter(Boolean).join(' · '),
      snippet: snippet(game.lesson, needle),
      route: '#/chess/lessons',
      score: Math.max(
        score(game.lesson, needle),
        boost(score(game.opening, needle), 3),
      ),
    });
  }

  for (const exercise of state?.exercises ?? []) {
    push({
      type: 'exercise',
      id: exercise.id,
      title: exercise.name,
      context: [exercise.muscle, exercise.equipment].filter(Boolean).join(' · '),
      snippet: snippet(exercise.cues, needle),
      route: '#/gym/library',
      score: Math.max(
        boost(score(exercise.name, needle), 5),
        // Cues are coaching notes worth finding by what they say, not only by
        // which exercise they belong to.
        score(exercise.cues, needle),
        score(exercise.dropNote, needle),
      ),
    });
  }

  for (const record of state?.painRecords ?? []) {
    push({
      type: 'pain',
      id: record.id,
      title: record.location || 'pain',
      context: record.date,
      snippet: snippet(record.note, needle),
      route: '#/gym/pain',
      score: Math.max(boost(score(record.location, needle), 4), score(record.note, needle)),
    });
  }

  for (const session of state?.gymSessions ?? []) {
    const notes = [session.notes, ...(session.exercises ?? []).map((e) => e.note)].filter(Boolean).join(' ');
    if (!notes) continue;
    push({
      type: 'session',
      id: session.id,
      title: `Gym — ${session.date}`,
      context: `${(session.exercises ?? []).length} exercises`,
      snippet: snippet(notes, needle),
      route: '#/gym/history',
      // The per-exercise notes are the useful part: "no tension in the target
      // muscle" is the kind of thing worth finding again.
      score: score(notes, needle),
    });
  }

  return results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}

export function groupByType(results) {
  const groups = new Map();
  for (const result of results) {
    if (!groups.has(result.type)) groups.set(result.type, []);
    groups.get(result.type).push(result);
  }
  return groups;
}
