// The weekly review is generated from the data, never typed. Memory is the
// thing being worked around, so nothing here asks you to remember.

import {
  todayISO,
  startOfWeek,
  endOfWeek,
  formatDate,
  formatLongDate,
  formatDuration,
  stampToDate,
  withinRange,
} from './dates.js';
import { walkTasks, threadProgress, isStageComplete, isActive, lastCompletionDate } from './threads.js';
import { weeklyDistribution } from './timeblocks.js';
import { pipelineStats } from './pipelines.js';
import { weekProgress, sessionsInWeek, sessionTotals } from './gym.js';

export function generateWeeklyReview(state, { today = todayISO(), weekStart = null } = {}) {
  const start = weekStart || startOfWeek(today);
  const end = endOfWeek(start);
  const inWeek = (iso) => !!iso && withinRange(iso, start, end);

  const threads = [];
  for (const thread of state?.threads ?? []) {
    if (!isActive(thread)) continue;
    const completed = [];
    for (const { task, stage, step } of walkTasks(thread)) {
      const doneDate = task.done ? stampToDate(task.doneAt) : null;
      if (doneDate && inWeek(doneDate)) completed.push({ task, stage, step, date: doneDate });
    }
    const stagesCompleted = (thread.stages ?? []).filter(
      (s) => isStageComplete(s) && inWeek(stampToDate(s.forceCompletedAt) || lastStageCompletion(s)),
    );
    threads.push({
      thread,
      completed: completed.sort((a, b) => a.date.localeCompare(b.date)),
      stagesCompleted,
      moved: completed.length > 0,
      progress: threadProgress(thread),
      lastCompletion: lastCompletionDate(thread),
    });
  }

  const questions = {
    attempted: [],
    retired: [],
    attempts: 0,
    unaided: 0,
  };
  for (const q of state?.questions ?? []) {
    const weekAttempts = (q.attempts ?? []).filter((a) => inWeek(a.date));
    if (weekAttempts.length) {
      questions.attempted.push({ question: q, attempts: weekAttempts });
      questions.attempts += weekAttempts.length;
      questions.unaided += weekAttempts.filter((a) => a.unaided).length;
    }
    if (q.retired && inWeek(q.retiredAt)) questions.retired.push(q);
  }

  const pipeline = pipelineStats(state, { from: start, to: end });
  const time = weeklyDistribution(state, { weekStart: start });
  // What belongs in a weekly review is the question the gym view asks: how many
  // sessions the week got, and what was in them.
  const gym = {
    ...weekProgress(state, start),
    sessions: sessionsInWeek(state, start).map((session) => ({
      session,
      totals: sessionTotals(session),
    })),
  };

  const reading = (state?.reading ?? []).filter((b) => b.status === 'reading');

  return {
    weekStart: start,
    weekEnd: end,
    generatedOn: today,
    threads,
    moved: threads.filter((t) => t.moved),
    didNotMove: threads.filter((t) => !t.moved),
    questions,
    pipeline,
    time,
    gym,
    reading,
    totals: {
      tasksCompleted: threads.reduce((sum, t) => sum + t.completed.length, 0),
      stagesCompleted: threads.reduce((sum, t) => sum + t.stagesCompleted.length, 0),
    },
  };
}

function lastStageCompletion(stage) {
  let latest = null;
  for (const step of stage.steps ?? []) {
    for (const task of step.tasks ?? []) {
      const date = task.done ? stampToDate(task.doneAt) : null;
      if (date && (!latest || date > latest)) latest = date;
    }
  }
  return latest;
}

/** Markdown export -- the format that gets pasted elsewhere. */
export function weeklyReviewMarkdown(report) {
  const lines = [];
  const pct = (n) => `${Math.round(n * 100)}%`;

  lines.push(`# Weekly review — ${formatLongDate(report.weekStart)} to ${formatLongDate(report.weekEnd)}`);
  lines.push('');
  lines.push(
    `${report.totals.tasksCompleted} tasks completed · ${report.totals.stagesCompleted} stages closed · ` +
      `${report.questions.attempts} question attempts · ${report.pipeline.applicationsSent} applications · ` +
      `${formatDuration(report.time.actual)} logged`,
  );
  lines.push('');

  lines.push('## Threads');
  lines.push('');
  if (!report.threads.length) {
    lines.push('_No active threads._');
  }
  for (const entry of report.threads) {
    const p = entry.progress;
    lines.push(`### ${entry.thread.name}`);
    lines.push('');
    lines.push(`- Progress: ${p.done}/${p.total} tasks (${pct(p.ratio)}), ${p.stagesComplete}/${p.stages} stages`);
    if (entry.completed.length) {
      lines.push(`- Completed this week:`);
      for (const c of entry.completed) {
        lines.push(`  - ${c.task.title} _(${c.stage.title} › ${c.step.title}, ${formatDate(c.date)})_`);
      }
    } else {
      lines.push(
        `- **Did not move.** Last completion: ${entry.lastCompletion ? formatDate(entry.lastCompletion) : 'never'}`,
      );
    }
    if (entry.stagesCompleted.length) {
      lines.push(`- Stages closed: ${entry.stagesCompleted.map((s) => s.title).join(', ')}`);
    }
    lines.push('');
  }

  lines.push('## Questions');
  lines.push('');
  lines.push(
    `- ${report.questions.attempts} attempts across ${report.questions.attempted.length} questions ` +
      `(${report.questions.unaided} unaided)`,
  );
  lines.push(`- Retired this week: ${report.questions.retired.length}`);
  for (const q of report.questions.retired) lines.push(`  - ${q.title} _(${q.bank})_`);
  const hesitations = report.questions.attempted
    .flatMap((entry) => entry.attempts.map((a) => ({ q: entry.question, a })))
    .filter((row) => row.a.hesitation?.trim());
  if (hesitations.length) {
    lines.push('- Hesitations:');
    for (const row of hesitations) lines.push(`  - ${row.q.title}: ${row.a.hesitation.trim()}`);
  }
  lines.push('');

  lines.push('## Pipeline');
  lines.push('');
  lines.push(`- Applications sent: ${report.pipeline.applicationsSent}`);
  for (const app of report.pipeline.applications) {
    lines.push(`  - ${app.role || 'Role'} at ${app.company || 'Company'} _(${app.source}, ${app.status})_`);
  }
  lines.push(`- Outreach: ${report.pipeline.outreachSent} sent, ${report.pipeline.replies} replied`);
  lines.push('');

  lines.push('## Gym');
  lines.push('');
  if (!report.gym.target && !report.gym.done) {
    lines.push('_Nothing logged._');
  } else {
    lines.push(`- Sessions: ${report.gym.done}/${report.gym.target}${report.gym.met ? ' ✓' : ''}`);
    for (const { session, totals } of report.gym.sessions) {
      lines.push(`  - ${session.date}: ${totals.exercises} exercise(s), ${totals.sets} sets, ${totals.reps} reps`);
    }
  }
  lines.push('');

  lines.push('## Time');
  lines.push('');
  lines.push(`- Planned ${formatDuration(report.time.planned)} · actual ${formatDuration(report.time.actual)}`);
  for (const row of report.time.rows) {
    lines.push(
      `  - ${row.name}: planned ${formatDuration(row.planned)}, actual ${formatDuration(row.actual)} ` +
        `(${pct(row.shareActual)} of logged time)`,
    );
  }
  lines.push('');

  if (report.reading.length) {
    lines.push('## Reading');
    lines.push('');
    for (const book of report.reading) {
      lines.push(`- ${book.title}${book.author ? ` — ${book.author}` : ''}${book.page ? `: page ${book.page}` : ''}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
