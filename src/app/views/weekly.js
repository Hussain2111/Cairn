// The weekly review: generated from the data, exportable as markdown.

import { el, tag, empty, downloadFile, copyText, toast } from '../ui.js';
import { pageHead, statTile } from './shared.js';
import { generateWeeklyReview, weeklyReviewMarkdown } from '../../core/weekly.js';
import { formatDate, formatLongDate, formatDuration, addDays, startOfWeek } from '../../core/dates.js';

export function title() {
  return 'Weekly review';
}

export function render(ctx) {
  const weekStartsOn = ctx.state.settings.weekStartsOn;
  const weekStart = ctx.route.query.get('week') || startOfWeek(ctx.today, weekStartsOn);
  const report = generateWeeklyReview(ctx.state, { today: ctx.today, weekStart });
  const markdown = weeklyReviewMarkdown(report);
  const thisWeek = startOfWeek(ctx.today, weekStartsOn);

  return el('div', [
    pageHead('Weekly review', {
      sub: `${formatLongDate(report.weekStart)} — ${formatLongDate(report.weekEnd)}`,
      actions: [
        el('a.btn.btn--ghost', { href: `#/weekly?week=${addDays(weekStart, -7)}`, text: '← Prev' }),
        weekStart !== thisWeek ? el('a.btn.btn--ghost', { href: '#/weekly', text: 'This week' }) : null,
        el('a.btn.btn--ghost', { href: `#/weekly?week=${addDays(weekStart, 7)}`, text: 'Next →' }),
        el('button.btn', {
          type: 'button',
          text: 'Copy markdown',
          onclick: async () => {
            const ok = await copyText(markdown);
            toast(ok ? 'Markdown copied' : 'Could not reach the clipboard — use Download instead.', { variant: ok ? '' : 'danger' });
          },
        }),
        el('button.btn.btn--primary', {
          type: 'button',
          text: 'Download .md',
          onclick: () => downloadFile(`cairn-week-${report.weekStart}.md`, markdown, 'text/markdown'),
        }),
      ].filter(Boolean),
    }),

    el('div.grid.grid--3', [
      statTile(report.totals.tasksCompleted, 'tasks completed', report.totals.tasksCompleted ? 'teal' : ''),
      statTile(report.totals.stagesCompleted, 'stages closed'),
      statTile(report.questions.attempts, 'question attempts'),
      statTile(report.questions.retired.length, 'questions retired', 'teal'),
      statTile(report.pipeline.applicationsSent, 'applications sent'),
      statTile(formatDuration(report.time.actual), 'hours logged'),
    ]),

    section('What moved', report.moved.length
      ? report.moved.map((entry) =>
          el('div.card', [
            el('div.card__body.stack--tight.stack', [
              el('div.row.row--between', [
                el('a', { href: `#/thread/${entry.thread.id}`, text: entry.thread.name }),
                tag(`${entry.completed.length} completed`, 'teal'),
              ]),
              el('ul.stack--tight.stack', entry.completed.map((c) =>
                el('li.row', [
                  el('span.mono.faint', { text: formatDate(c.date) }),
                  el('span.break', { text: c.task.title }),
                  el('span.section__meta', { text: `${c.stage.title} › ${c.step.title}` }),
                ]))),
            ]),
          ]))
      : [el('p.muted', { text: 'Nothing completed this week.' })]),

    section('What didn’t', report.didNotMove.length
      ? [el('div.card', [
          el('div.card__body.stack--tight.stack', report.didNotMove.map((entry) =>
            el('div.row.row--between', [
              el('a', { href: `#/thread/${entry.thread.id}`, text: entry.thread.name }),
              el('div.row', [
                entry.stall.stalled ? tag(`stalled ${entry.stall.idleDays}d`, 'danger') : tag(`${entry.stall.idleDays}d idle`),
                el('span.section__meta', {
                  text: entry.stall.lastCompletion ? `last ${formatDate(entry.stall.lastCompletion)}` : 'never',
                }),
              ]),
            ]))),
        ])]
      : [el('p.muted', { text: 'Every active thread moved. Unusual and worth noticing.' })]),

    section('Questions', [
      el('div.card', [
        el('div.card__body.stack--tight.stack', [
          el('div.row', [
            tag(`${report.questions.attempts} attempts`),
            tag(`${report.questions.unaided} unaided`, report.questions.unaided ? 'teal' : ''),
            tag(`${report.questions.retired.length} retired`, 'teal'),
          ]),
          ...(report.questions.attempted.length
            ? report.questions.attempted.flatMap((entry) =>
                entry.attempts
                  .filter((a) => a.hesitation?.trim())
                  .map((a) => el('div.hesitation', { text: `${entry.question.title}: ${a.hesitation}` })))
            : [el('p.muted', { text: 'No attempts logged this week.' })]),
        ]),
      ]),
    ]),

    section('Pipeline', [
      el('div.card', [
        el('div.card__body.stack--tight.stack', [
          el('div.row', [
            tag(`${report.pipeline.applicationsSent} applications`),
            tag(`${report.pipeline.outreachSent} outreach`),
            tag(`${report.pipeline.replies} replies`, report.pipeline.replies ? 'teal' : ''),
            tag(`${report.pipeline.interviews} at interview or beyond`),
          ]),
          ...report.pipeline.applications.map((app) =>
            el('div.row', [
              el('span.mono.faint', { text: formatDate(app.dateApplied) }),
              el('span.break', { text: `${app.role || 'Role'} — ${app.company || 'Company'}` }),
              tag(app.status),
            ])),
        ]),
      ]),
    ]),

    section('Habits', report.habits.length
      ? [el('div.card', [
          el('div.card__body.stack--tight.stack', report.habits.map((entry) =>
            el('div.row.row--between', [
              el('span', { text: entry.habit.name }),
              tag(`${entry.count}/${entry.target}`, entry.met ? 'teal' : ''),
            ]))),
        ])]
      : [el('p.muted', { text: 'No habits tracked.' })]),

    section('Time', report.time.rows.length
      ? [el('div.card', [
          el('div.card__body.stack--tight.stack', [
            el('div.row', [
              tag(`${formatDuration(report.time.planned)} planned`),
              tag(`${formatDuration(report.time.actual)} actual`, 'teal'),
            ]),
            ...report.time.rows.map((row) =>
              el('div.row.row--between', [
                el('span.break', { text: row.name }),
                el('span.mono', {
                  text: `${formatDuration(row.actual)} / ${formatDuration(row.planned)} · ${Math.round(row.shareActual * 100)}%`,
                }),
              ])),
          ]),
        ])]
      : [el('p.muted', { text: 'No time blocks this week.' })]),

    el('section.section', [
      el('div.section__head', [
        el('h2.section__title', { text: 'Markdown' }),
        el('div.section__rule'),
      ]),
      el('pre.markdown', { style: { whiteSpace: 'pre-wrap' } }, [el('code', { text: markdown })]),
    ]),
  ]);
}

function section(heading, children) {
  return el('section.section', [
    el('div.section__head', [
      el('h2.section__title', { text: heading }),
      el('div.section__rule'),
    ]),
    el('div.stack', children),
  ]);
}
