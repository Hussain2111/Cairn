// Search across tasks, stages, steps, threads, notes, questions, applications,
// outreach, reading and habits.

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
      score: base + 5,
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
      score: Math.max(score(note.title, needle) + 5, score(note.body, needle)),
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
        score(q.title, needle) + 5,
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
        score(app.company, needle) + 5,
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
      score: Math.max(score(item.name, needle) + 5, score(item.company, needle), score(item.notes, needle)),
    });
  }

  for (const book of state?.reading ?? []) {
    push({
      type: 'reading',
      id: book.id,
      title: book.title,
      context: book.author,
      snippet: snippet(book.notes, needle),
      route: '#/reading',
      score: Math.max(score(book.title, needle) + 5, score(book.author, needle), score(book.notes, needle)),
    });
  }

  for (const habit of state?.habits ?? []) {
    push({
      type: 'habit',
      id: habit.id,
      title: habit.name,
      context: `${habit.weeklyTarget}×/week`,
      snippet: '',
      route: '#/habits',
      score: score(habit.name, needle),
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
